import mongoose from "mongoose";
import { createGzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "../config/env.js";
import { targetConfig, envKeyFor } from "../config/targets.js";
import { Backup, BackupRun, type IBackup, type IBackupCollection } from "../models/Backup.js";
import { backupStore, storeMissing } from "../lib/backupStore.js";
import { mailer } from "../lib/mailer.js";

/**
 * Backups (the user, 2026-10-16): "all will be in R2, twice a day — the lunch
 * break and the night — in all portals".
 *
 * Every portal's whole database, every collection (new ones included without
 * a code change), read straight from its MongoDB with the connection the
 * reports already use and written to R2 as one gzipped file per portal per
 * run. Nothing is ever written to a portal's database.
 *
 * The file is newline-delimited canonical Extended JSON, not JSON.stringify:
 * plain JSON turns an ObjectId into a string and a Date into text, and a
 * restore of that puts back documents that look right and match nothing. Each
 * collection starts with a `{"$backup":"collection",…}` line carrying its
 * indexes and options, its documents follow one per line, and the file ends
 * with `{"$backup":"end",…}` — a file without that last line was cut short and
 * is never restored. src/scripts/backup-restore.ts reads it back.
 *
 * Streamed — database → gzip → a file on this server's disk → R2 in parts —
 * because the LMS alone is over 200 MB as data and would not fit in memory as
 * one string.
 */

const { MongoClient } = mongoose.mongo;
const { EJSON } = mongoose.mongo.BSON;

export const FORMAT = "delta-backup-v1";

/** Every portal, in the order the page lists them. `code` names its {CODE}_MONGODB_URI. */
export const PORTALS: { code: string; label: string; optional?: boolean; uri?: () => string }[] = [
  { code: "delta", label: "Sales CRM" },
  { code: "draw", label: "Draw CRM" },
  { code: "remote", label: "Remote CRM" },
  { code: "banglore", label: "Bangalore CRM" },
  { code: "finance-hq", label: "Finance" },
  // Only when it is a database of its own; finance keeps its organizations in one.
  { code: "finance-banglore", label: "Finance (Bangalore)", optional: true },
  { code: "lms", label: "LMS" },
  { code: "commission", label: "Tetra Commission" },
  { code: "hrms", label: "HRMS" },
  { code: "media-erp", label: "Media ERP" },
  { code: "root", label: "Root portal", uri: () => env.MONGODB_URI },
];

const DUBAI_OFFSET_MIN = 4 * 60; // Asia/Dubai has no daylight saving
const HOUR = 3_600_000;

const keepDays = () => Math.max(1, Number(env.BACKUP_KEEP_DAYS) || 30);

/* ── Which database each portal is ───────────────────────────────────────── */

/** The parts of a connection string that say where it points — never the credentials. */
export function parseMongoUri(uri: string): { hosts: string; database: string } {
  const rest = uri.replace(/^mongodb(\+srv)?:\/\//, "");
  const slash = rest.indexOf("/");
  const authority = slash >= 0 ? rest.slice(0, slash) : rest.split("?")[0];
  const hosts = authority.slice(authority.lastIndexOf("@") + 1).toLowerCase();
  const database = slash >= 0 ? decodeURIComponent(rest.slice(slash + 1).split("?")[0]) : "";
  return { hosts: hosts.split(",").sort().join(","), database };
}

export interface ResolvedPortal {
  code: string;
  label: string;
  uri: string;
  database: string;
  /** Empty when it can be backed up; otherwise why not, naming what to set. */
  problem: string;
}

export function resolvePortals(): ResolvedPortal[] {
  const seen = new Map<string, string>();
  const out: ResolvedPortal[] = [];
  for (const p of PORTALS) {
    const k = envKeyFor(p.code);
    const uri = (p.uri ? p.uri() : targetConfig(p.code).mongoUri).trim();
    if (!uri) {
      if (!p.optional) out.push({ code: p.code, label: p.label, uri: "", database: "", problem: `Not set up — set ${k}_MONGODB_URI on the Root server` });
      continue;
    }
    const parsed = parseMongoUri(uri);
    const database = (process.env[`${k}_MONGODB_DB`] ?? "").trim() || parsed.database;
    if (!database) {
      out.push({ code: p.code, label: p.label, uri, database: "", problem: `${k}_MONGODB_URI names no database — add it to the address or set ${k}_MONGODB_DB` });
      continue;
    }
    const same = seen.get(`${parsed.hosts}/${database}`);
    if (same) {
      if (!p.optional) out.push({ code: p.code, label: p.label, uri, database, problem: `Same database as ${same} — backed up there` });
      continue;
    }
    seen.set(`${parsed.hosts}/${database}`, p.label);
    out.push({ code: p.code, label: p.label, uri, database, problem: "" });
  }
  return out;
}

/* ── One portal ──────────────────────────────────────────────────────────── */

const stampOf = (d: Date) => d.toISOString().slice(0, 19).replace(/:/g, "-") + "Z"; // 2026-10-17T09-30-00Z

async function backupPortal(runId: mongoose.Types.ObjectId, p: ResolvedPortal): Promise<IBackup> {
  const started = new Date();
  const row = await Backup.create({ run: runId, portal: p.code, label: p.label, database: p.database, startedAt: started });
  if (p.problem) {
    row.status = "skipped";
    row.error = p.problem;
    row.finishedAt = new Date();
    await row.save();
    return row.toObject();
  }

  const tmp = join(tmpdir(), `root-backup-${p.code}-${process.pid}-${Date.now()}.ndjson.gz`);
  const client = new MongoClient(p.uri, {
    serverSelectionTimeoutMS: 15_000,
    socketTimeoutMS: 10 * 60_000,
    readPreference: "secondaryPreferred",
    appName: "root-backup",
  });
  try {
    await client.connect();
    const db = client.db(p.database);

    const gz = createGzip({ level: 6 });
    const out = createWriteStream(tmp);
    gz.pipe(out);
    const write = async (line: string) => {
      if (!gz.write(line + "\n")) await once(gz, "drain");
    };

    const listed = (await db.listCollections({}, { nameOnly: false }).toArray())
      .filter((c) => !c.name.startsWith("system."))
      .sort((a, b) => a.name.localeCompare(b.name));
    const collections: IBackupCollection[] = [];
    let documents = 0;

    await write(JSON.stringify({ $backup: "start", format: FORMAT, portal: p.code, label: p.label, database: p.database, startedAt: started.toISOString() }));
    for (const c of listed) {
      const options = (c as { options?: Record<string, unknown> }).options ?? {};
      if (c.type === "view") {
        await write(EJSON.stringify({ $backup: "view", name: c.name, options }, { relaxed: false }));
        collections.push({ name: c.name, type: "view", documents: 0 });
        continue;
      }
      const coll = db.collection(c.name);
      const indexes = await coll.indexes();
      await write(EJSON.stringify({ $backup: "collection", name: c.name, options, indexes }, { relaxed: false }));
      let n = 0;
      for await (const doc of coll.find({}, { batchSize: 1000 })) {
        await write(EJSON.stringify(doc, { relaxed: false }));
        n++;
      }
      collections.push({ name: c.name, type: "collection", documents: n });
      documents += n;
    }
    // The last line is what says the file is whole; a restore refuses one without it.
    await write(JSON.stringify({ $backup: "end", collections: collections.length, documents, finishedAt: new Date().toISOString() }));
    gz.end();
    await finished(out);

    const hash = createHash("sha256");
    for await (const chunk of createReadStream(tmp)) hash.update(chunk as Buffer);
    const bytes = (await stat(tmp)).size;
    // The run's id in the name as well as the time: two runs in the same second
    // must never share a file, or removing the older one would take the newer.
    const key = `${p.code}/${p.code}_${stampOf(started)}_${String(runId).slice(-6)}.ndjson.gz`;
    await backupStore.upload(key, tmp);

    Object.assign(row, {
      status: "complete", key, bytes, sha256: hash.digest("hex"), collections, documents,
      finishedAt: new Date(), durationMs: Date.now() - started.getTime(),
    });
    await row.save();
    return row.toObject();
  } catch (e) {
    // The connection string can be inside a driver message; never put it on a page or in a log.
    const message = (e instanceof Error ? e.message : String(e)).replace(/mongodb(\+srv)?:\/\/\S+/g, "<database address>");
    Object.assign(row, { status: "failed", error: message.slice(0, 500), finishedAt: new Date(), durationMs: Date.now() - started.getTime() });
    await row.save();
    return row.toObject();
  } finally {
    await client.close().catch(() => {});
    await unlink(tmp).catch(() => {});
  }
}

/* ── A run: every portal ─────────────────────────────────────────────────── */

let busy = false;

/**
 * Back up every portal (or the ones named), one after another.
 *
 * Null when the slot is already taken — another process has it, or it ran.
 * One at a time, not all at once: the night run should not put every database
 * server under a full read at the same moment.
 */
export async function runBackups(opts: { slot: string; trigger: "scheduled" | "manual"; triggeredBy?: string; portals?: string[] }) {
  let run;
  try {
    run = await BackupRun.create({ slot: opts.slot, trigger: opts.trigger, triggeredBy: opts.triggeredBy ?? "", portals: opts.portals ?? [] });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return null;
    throw e;
  }
  busy = true;
  try {
    const all = resolvePortals();
    const list = opts.portals?.length ? all.filter((p) => opts.portals!.includes(p.code)) : all;
    const rows: IBackup[] = [];
    for (const p of list) {
      try {
        rows.push(await backupPortal(run._id, p));
      } catch (e) {
        // Only the bookkeeping can throw here (this portal's own database
        // stumbling); the next portal still gets its backup.
        const error = (e instanceof Error ? e.message : String(e)).replace(/mongodb(\+srv)?:\/\/\S+/g, "<database address>").slice(0, 500);
        console.error(`💾 backup ${opts.slot}: ${p.label} could not be recorded — ${error}`);
        await Backup.updateOne({ run: run._id, portal: p.code }, { $set: { status: "failed", error, finishedAt: new Date() } }).catch(() => {});
        rows.push({ portal: p.code, label: p.label, status: "failed", error, bytes: 0 } as IBackup);
      }
    }
    run.status = rows.some((r) => r.status === "failed") ? "failed" : "complete";
    run.finishedAt = new Date();
    await run.save();

    const done = rows.filter((r) => r.status === "complete");
    console.log(`💾 backup ${opts.slot}: ${done.length}/${rows.length} portals, ${(done.reduce((n, r) => n + r.bytes, 0) / 1048576).toFixed(1)} MB`);
    const bad = rows.filter((r) => r.status === "failed" || (r.status === "skipped" && !r.error.startsWith("Same database")));
    if (bad.length) {
      console.error(`💾 backup ${opts.slot}: not backed up — ${bad.map((r) => `${r.label} (${r.error})`).join("; ")}`);
      await alert(opts.slot, bad);
    }
    await prune().catch((e) => console.error("💾 backup prune failed:", e instanceof Error ? e.message : e));
    return { run: run.toObject(), rows };
  } catch (e) {
    run.status = "failed";
    run.finishedAt = new Date();
    await run.save().catch(() => {});
    throw e;
  } finally {
    busy = false;
  }
}

async function alert(slot: string, bad: IBackup[]) {
  const to = env.BACKUP_ALERT_EMAIL.split(",").map((s) => s.trim()).filter(Boolean);
  if (!to.length || !mailer.isConfigured()) return;
  const lines = bad.map((r) => `- ${r.label}: ${r.status === "failed" ? "FAILED" : "not backed up"} — ${r.error}`);
  await mailer
    .sendBackupAlert(to, `Backup ${slot}: ${bad.length} portal${bad.length === 1 ? "" : "s"} not backed up`, [
      `The ${slot} backup did not back up every portal:`, "", ...lines, "", "See Root portal → Backups.",
    ].join("\n"))
    .catch((e) => console.error("💾 backup alert email failed:", e instanceof Error ? e.message : e));
}

/**
 * Archives older than the keep window leave R2; their rows stay as history.
 *
 * Never a portal's newest good backup, however old: if a portal has been
 * failing for a month, the last copy that worked is the one still worth having.
 */
export async function prune(now = new Date()) {
  const cutoff = new Date(now.getTime() - keepDays() * 24 * HOUR);
  const newest = await Backup.aggregate<{ _id: string; id: mongoose.Types.ObjectId }>([
    { $match: { status: "complete", expiredAt: null } },
    { $sort: { startedAt: -1 } },
    { $group: { _id: "$portal", id: { $first: "$_id" } } },
  ]);
  const old = await Backup.find({ status: "complete", expiredAt: null, startedAt: { $lt: cutoff }, _id: { $nin: newest.map((n) => n.id) } });
  let removed = 0;
  for (const row of old) {
    try {
      if (row.key) await backupStore.remove(row.key);
      row.expiredAt = new Date();
      await row.save();
      removed++;
    } catch (e) {
      console.error(`💾 backup prune: could not remove ${row.key}:`, e instanceof Error ? e.message : e);
    }
  }
  if (removed) console.log(`💾 backup: removed ${removed} archive(s) older than ${keepDays()} days`);
  return removed;
}

/** A run left "running" by a process that stopped part way is not running. */
async function settleInterrupted() {
  const stale = new Date(Date.now() - 3 * HOUR);
  const runs = await BackupRun.find({ status: "running", startedAt: { $lt: stale } });
  for (const r of runs) {
    await Backup.updateMany({ run: r._id, status: "running" }, { $set: { status: "failed", error: "Interrupted — the server stopped during the backup", finishedAt: new Date() } });
    r.status = "failed";
    r.finishedAt = new Date();
    await r.save();
  }
}

/* ── When ────────────────────────────────────────────────────────────────── */

export const backupTimes = (): { h: number; m: number }[] =>
  env.BACKUP_TIMES.split(",")
    .map((t) => t.trim().match(/^(\d{1,2}):(\d{2})$/))
    .filter((m): m is RegExpMatchArray => !!m && Number(m[1]) < 24 && Number(m[2]) < 60)
    .map((m) => ({ h: Number(m[1]), m: Number(m[2]) }));

/** Every scheduled moment from yesterday to tomorrow (Dubai days), in time order. */
function slotsAround(now: Date): Date[] {
  const dubai = new Date(now.getTime() + DUBAI_OFFSET_MIN * 60_000);
  const out: Date[] = [];
  for (const dayShift of [-1, 0, 1]) {
    for (const t of backupTimes()) {
      const utc = Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth(), dubai.getUTCDate() + dayShift, t.h, t.m) - DUBAI_OFFSET_MIN * 60_000;
      out.push(new Date(utc));
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

export const nextSlot = (now = new Date()) => slotsAround(now).find((d) => d.getTime() > now.getTime()) ?? null;
export const lastSlot = (now = new Date()) => slotsAround(now).filter((d) => d.getTime() <= now.getTime()).pop() ?? null;

/** "2026-10-17 13:30", Dubai — the run's name, and what makes a slot run once. */
export const slotId = (d: Date) => new Date(d.getTime() + DUBAI_OFFSET_MIN * 60_000).toISOString().slice(0, 16).replace("T", " ");

async function runSlot(at: Date) {
  if (storeMissing().length) {
    console.error(`💾 backup ${slotId(at)} not run — backups are not set up: ${storeMissing().join(", ")}`);
    return;
  }
  try {
    await runBackups({ slot: slotId(at), trigger: "scheduled" });
  } catch (e) {
    console.error(`💾 backup ${slotId(at)} FAILED:`, e instanceof Error ? e.message : e);
  }
}

/**
 * Twice a day at BACKUP_TIMES (Dubai).
 *
 * A restart that lands on 13:30 — a deploy at lunch — would otherwise lose that
 * backup, so a slot missed in the last six hours runs when the server comes
 * back. The slot's claim keeps that from ever running one twice.
 */
export function startBackupWorker() {
  if (env.BACKUP_WORKER === "false") return;
  if (!backupTimes().length) {
    console.error(`💾 backup worker off — BACKUP_TIMES "${env.BACKUP_TIMES}" has no HH:MM times`);
    return;
  }
  const missing = storeMissing();
  console.log(
    missing.length
      ? `💾 backups not set up (${missing.join(", ")}) — the Backups page says what is missing`
      : `💾 backups at ${env.BACKUP_TIMES} Dubai time into R2 ${env.BACKUP_R2_BUCKET}, kept ${keepDays()} days`
  );

  const scheduleNext = () => {
    const next = nextSlot();
    if (!next) return;
    const wait = Math.min(next.getTime() - Date.now(), 2 ** 31 - 1);
    setTimeout(async () => {
      if (Date.now() < next.getTime()) return scheduleNext(); // a wait longer than a timer can hold
      await runSlot(next);
      scheduleNext();
    }, Math.max(1000, wait));
  };

  setTimeout(async () => {
    try {
      await settleInterrupted();
      const last = lastSlot();
      if (last && Date.now() - last.getTime() < 6 * HOUR && !(await BackupRun.exists({ slot: slotId(last) }))) {
        console.log(`💾 backup ${slotId(last)} was missed while the server was down — running it now`);
        await runSlot(last);
      }
    } catch (e) {
      console.error("💾 backup catch-up failed:", e instanceof Error ? e.message : e);
    }
    scheduleNext();
  }, 60_000).unref?.();
}

/* ── For the page ────────────────────────────────────────────────────────── */

const err = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

const publicRow = (r: IBackup) => ({
  id: String(r._id),
  portal: r.portal,
  label: r.label,
  database: r.database,
  status: r.status,
  error: r.error,
  bytes: r.bytes,
  sha256: r.sha256,
  documents: r.documents,
  collections: r.collections?.length ?? 0,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  durationMs: r.durationMs,
  expired: !!r.expiredAt,
  file: r.key ? r.key.split("/").pop() : "",
});

export async function backupOverview() {
  const portals = resolvePortals();
  const codes = portals.map((p) => p.code);
  const runs = await BackupRun.find({}).sort({ startedAt: -1 }).limit(20).lean();
  const rows = await Backup.find({ run: { $in: runs.map((r) => r._id) } }).lean();
  const byRun = new Map<string, IBackup[]>();
  for (const r of rows) byRun.set(String(r.run), [...(byRun.get(String(r.run)) ?? []), r as IBackup]);

  const latest = await Backup.aggregate<{ _id: string; last: IBackup; good: IBackup | null; kept: number; keptBytes: number }>([
    { $match: { portal: { $in: codes } } },
    { $sort: { startedAt: -1 } },
    {
      $group: {
        _id: "$portal",
        last: { $first: "$$ROOT" },
        good: { $max: { $cond: [{ $eq: ["$status", "complete"] }, { startedAt: "$startedAt", row: "$$ROOT" }, null] } },
        kept: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "complete"] }, { $eq: ["$expiredAt", null] }] }, 1, 0] } },
        keptBytes: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "complete"] }, { $eq: ["$expiredAt", null] }] }, "$bytes", 0] } },
      },
    },
  ]);
  const byPortal = new Map(latest.map((l) => [l._id, l]));
  const now = new Date();

  return {
    store: { ready: storeMissing().length === 0, missing: storeMissing(), bucket: backupStore.bucket() },
    schedule: {
      times: backupTimes().map((t) => `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}`),
      timezone: "Dubai",
      next: nextSlot(now),
      keepDays: keepDays(),
      worker: env.BACKUP_WORKER !== "false",
    },
    running: busy || runs.some((r) => r.status === "running" && now.getTime() - new Date(r.startedAt).getTime() < 3 * HOUR),
    portals: portals.map((p) => {
      const l = byPortal.get(p.code);
      const good = (l?.good as unknown as { row?: IBackup } | null)?.row ?? null;
      return {
        code: p.code,
        label: p.label,
        database: p.database,
        problem: p.problem,
        last: l?.last ? publicRow(l.last) : null,
        lastGood: good ? publicRow(good) : null,
        kept: l?.kept ?? 0,
        keptBytes: l?.keptBytes ?? 0,
      };
    }),
    runs: runs.map((r) => ({
      id: String(r._id),
      slot: r.slot,
      trigger: r.trigger,
      triggeredBy: r.triggeredBy,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      backups: (byRun.get(String(r._id)) ?? [])
        .sort((a, b) => codes.indexOf(a.portal) - codes.indexOf(b.portal))
        .map(publicRow),
    })),
  };
}

/** Start a run now, in the background. Every portal, or the ones named. */
export async function startManualRun(by: string, portals?: string[]) {
  const missing = storeMissing();
  if (missing.length) throw err(`Backups are not set up: ${missing.join(", ")}`, 503);
  const known = new Set(PORTALS.map((p) => p.code));
  const wanted = (portals ?? []).filter((c) => known.has(c));
  if (portals?.length && !wanted.length) throw err("No such portal", 400);
  const recent = new Date(Date.now() - 3 * HOUR);
  if (busy || (await BackupRun.exists({ status: "running", startedAt: { $gte: recent } }))) {
    throw err("A backup is already running — wait for it to finish", 409);
  }
  const slot = `manual ${new Date().toISOString().slice(0, 19).replace("T", " ")}Z`;
  runBackups({ slot, trigger: "manual", triggeredBy: by, portals: wanted }).catch((e) =>
    console.error(`💾 backup ${slot} FAILED:`, e instanceof Error ? e.message : e)
  );
  return { slot };
}

/** A ten-minute download link for one archive. */
export async function downloadLink(id: string) {
  if (!mongoose.isValidObjectId(id)) throw err("Backup not found", 404);
  const row = await Backup.findById(id).lean();
  if (!row) throw err("Backup not found", 404);
  if (row.status !== "complete" || !row.key) throw err("That backup has no file", 404);
  if (row.expiredAt) throw err(`That backup was removed after ${keepDays()} days`, 410);
  return { url: backupStore.link(row.key), file: row.key.split("/").pop(), label: row.label, portal: row.portal };
}
