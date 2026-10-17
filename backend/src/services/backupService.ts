import mongoose from "mongoose";
import { createGzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { createHash, randomBytes } from "node:crypto";
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

interface StopState {
  stop: "" | "now" | "after";
  stopBy: string;
  restart: boolean;
}

async function backupPortal(runId: mongoose.Types.ObjectId, p: ResolvedPortal, stopState: () => Promise<StopState>): Promise<IBackup> {
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
  /*
   * Stop (2026-10-17): checked every second while this portal is copied. On
   * "now" the database connection is closed under the copy, which ends
   * whatever it is waiting on — connecting, reading — and the half-written file
   * is thrown away, never uploaded. "after" is left alone: this portal finishes.
   */
  let stopped = false;
  let checking = false;
  const watch = setInterval(async () => {
    if (stopped || checking) return;
    checking = true;
    try {
      if ((await stopState()).stop === "now") {
        stopped = true;
        await client.close(true).catch(() => {});
      }
    } catch {
      /* the next tick asks again */
    } finally {
      checking = false;
    }
  }, 1000);
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
    if (stopped || (await stopState()).stop === "now") throw new Error("stopped");
    await backupStore.upload(key, tmp);

    Object.assign(row, {
      status: "complete", key, bytes, sha256: hash.digest("hex"), collections, documents,
      finishedAt: new Date(), durationMs: Date.now() - started.getTime(),
    });
    await row.save();
    return row.toObject();
  } catch (e) {
    clearInterval(watch);
    const st = await stopState().catch(() => null);
    if (stopped || st?.stop === "now") {
      Object.assign(row, { status: "stopped", error: `Stopped by ${st?.stopBy || "a root admin"} while it was being copied`, finishedAt: new Date(), durationMs: Date.now() - started.getTime() });
      await row.save();
      return row.toObject();
    }
    // The connection string can be inside a driver message; never put it on a page or in a log.
    const message = (e instanceof Error ? e.message : String(e)).replace(/mongodb(\+srv)?:\/\/\S+/g, "<database address>");
    Object.assign(row, { status: "failed", error: message.slice(0, 500), finishedAt: new Date(), durationMs: Date.now() - started.getTime() });
    await row.save();
    return row.toObject();
  } finally {
    clearInterval(watch);
    await client.close().catch(() => {});
    await unlink(tmp).catch(() => {});
  }
}

/* ── A run: every portal ─────────────────────────────────────────────────── */

/**
 * A manual run's name. Unique to the millisecond and then some: two presses in
 * the same second once shared a name, and the second run's claim on it failed
 * quietly — "Backup started" on the page and nothing running.
 */
const manualSlot = () => `manual ${new Date().toISOString().slice(0, 23).replace("T", " ")}Z ${randomBytes(2).toString("hex")}`;

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
  let restartBy = "";
  // Read fresh each time: the Stop / Finish / Restart buttons write it, maybe from another process.
  const stopState = async (): Promise<StopState> =>
    ((await BackupRun.findById(run._id).select("stop stopBy restart").lean()) as StopState | null) ?? { stop: "", stopBy: "", restart: false };
  try {
    const all = resolvePortals();
    const list = opts.portals?.length ? all.filter((p) => opts.portals!.includes(p.code)) : all;
    const rows: IBackup[] = [];
    for (const [i, p] of list.entries()) {
      // Stop or Finish: nothing more starts. The portals not reached are listed as stopped.
      const st = await stopState();
      if (st.stop) {
        for (const q of list.slice(i)) {
          const row = await Backup.create({
            run: run._id, portal: q.code, label: q.label, database: q.database, status: "stopped",
            error: `Stopped by ${st.stopBy || "a root admin"} before it started`, finishedAt: new Date(),
          });
          rows.push(row.toObject());
        }
        break;
      }
      try {
        rows.push(await backupPortal(run._id, p, stopState));
      } catch (e) {
        // Only the bookkeeping can throw here (this portal's own database
        // stumbling); the next portal still gets its backup.
        const error = (e instanceof Error ? e.message : String(e)).replace(/mongodb(\+srv)?:\/\/\S+/g, "<database address>").slice(0, 500);
        console.error(`💾 backup ${opts.slot}: ${p.label} could not be recorded — ${error}`);
        await Backup.updateOne({ run: run._id, portal: p.code }, { $set: { status: "failed", error, finishedAt: new Date() } }).catch(() => {});
        rows.push({ portal: p.code, label: p.label, status: "failed", error, bytes: 0 } as IBackup);
      }
    }
    const final = await stopState();
    run.status = final.stop ? "stopped" : rows.some((r) => r.status === "failed") ? "failed" : "complete";
    run.finishedAt = new Date();
    await run.save();
    if (final.restart) restartBy = final.stopBy || "a root admin";

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
    // Restart: the stopped run is put away first, then a new one from the first portal.
    if (restartBy) {
      const slot = manualSlot();
      console.log(`💾 backup restarted by ${restartBy} — ${slot}`);
      setTimeout(() => {
        runBackups({ slot, trigger: "manual", triggeredBy: restartBy }).catch((e) =>
          console.error(`💾 backup ${slot} FAILED:`, e instanceof Error ? e.message : e)
        );
      }, 0);
    }
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

/** Two runs a day: a portal whose last good backup is older than this missed one. */
export const STALE_HOURS = 14;

/** Not a backup that went wrong: the portal shares a database backed up under another name. */
const notAProblem = (r: Pick<IBackup, "status" | "error">) => r.status === "skipped" && r.error.startsWith("Same database");

/** Each portal's last backup, its last good one, and what is kept of it. */
async function latestPerPortal(codes: string[]) {
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
  return new Map(
    latest.map((l) => [l._id, { last: l.last, good: (l.good as unknown as { row?: IBackup } | null)?.row ?? null, kept: l.kept, keptBytes: l.keptBytes }])
  );
}

const staleHours = (good: IBackup | null, now: Date) => (good ? (now.getTime() - new Date(good.startedAt).getTime()) / HOUR : Infinity);

export async function backupOverview() {
  const portals = resolvePortals();
  const codes = portals.map((p) => p.code);
  const runs = await BackupRun.find({}).sort({ startedAt: -1 }).limit(20).lean();
  const rows = await Backup.find({ run: { $in: runs.map((r) => r._id) } }).lean();
  const byRun = new Map<string, IBackup[]>();
  for (const r of rows) byRun.set(String(r.run), [...(byRun.get(String(r.run)) ?? []), r as IBackup]);
  const byPortal = await latestPerPortal(codes);
  const now = new Date();

  // The keep window, counted: how many backups worked, failed, could not run.
  const since = new Date(now.getTime() - keepDays() * 24 * HOUR);
  const recent = (await Backup.find({ portal: { $in: codes }, startedAt: { $gte: since }, status: { $ne: "running" } })
    .select("portal label status error startedAt")
    .sort({ startedAt: 1 })
    .lean()) as IBackup[];
  const counted = recent.filter((r) => !notAProblem(r));
  const tally = (list: IBackup[]) => ({
    ok: list.filter((r) => r.status === "complete").length,
    failed: list.filter((r) => r.status === "failed").length,
    skipped: list.filter((r) => r.status === "skipped").length,
    // Stopped from the page: not a failure, and not counted as one.
    stopped: list.filter((r) => r.status === "stopped").length,
  });
  const retry = await retryable();
  const kept = [...byPortal.values()];

  return {
    totals: {
      stored: { count: kept.reduce((n, l) => n + l.kept, 0), bytes: kept.reduce((n, l) => n + l.keptBytes, 0) },
      window: { days: keepDays(), runs: await BackupRun.countDocuments({ startedAt: { $gte: since } }), ...tally(counted) },
    },
    staleHours: STALE_HOURS,
    retry: retry ? retry.rows.map((r) => r.label) : [],
    failures: counted
      .filter((r) => r.status === "failed" || r.status === "skipped")
      .reverse()
      .slice(0, 100)
      .map((r) => ({ id: String(r._id), portal: r.portal, label: r.label, status: r.status, error: r.error, startedAt: r.startedAt })),
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
      const mine = counted.filter((r) => r.portal === p.code);
      return {
        code: p.code,
        label: p.label,
        database: p.database,
        problem: p.problem,
        last: l?.last ? publicRow(l.last) : null,
        lastGood: l?.good ? publicRow(l.good) : null,
        kept: l?.kept ?? 0,
        keptBytes: l?.keptBytes ?? 0,
        window: tally(mine),
        /** Every backup in the window, oldest first: a dot each on the page. */
        history: mine.map((r) => ({ id: String(r._id), status: r.status, startedAt: r.startedAt, error: r.error })),
      };
    }),
    runs: runs.map((r) => ({
      id: String(r._id),
      slot: r.slot,
      trigger: r.trigger,
      triggeredBy: r.triggeredBy,
      status: r.status,
      stop: r.stop ?? "",
      stopBy: r.stopBy ?? "",
      restart: !!r.restart,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      backups: (byRun.get(String(r._id)) ?? [])
        .sort((a, b) => codes.indexOf(a.portal) - codes.indexOf(b.portal))
        .map(publicRow),
    })),
  };
}

/**
 * One line's worth, for the card on Pending: is every portal backed up, and if
 * not, which and why. A portal is fine when its last good backup is under
 * STALE_HOURS old — two runs a day, so older means one was missed.
 */
export async function backupSummary() {
  const portals = resolvePortals();
  const byPortal = await latestPerPortal(portals.map((p) => p.code));
  const now = new Date();
  const lastScheduled = await BackupRun.findOne({ trigger: "scheduled", status: { $ne: "running" } }).sort({ startedAt: -1 }).lean();
  const scheduledRows = lastScheduled ? ((await Backup.find({ run: lastScheduled._id }).lean()) as IBackup[]).filter((r) => !notAProblem(r)) : [];
  const counted = portals.filter((p) => !p.problem.startsWith("Same database"));
  const problems = counted.flatMap((p) => {
    const l = byPortal.get(p.code);
    if (staleHours(l?.good ?? null, now) <= STALE_HOURS) return [];
    const why = p.problem
      || (l?.last && l.last.status !== "complete" ? l.last.error : "")
      || (l?.good ? `No good backup for ${Math.round(staleHours(l.good, now))} hours` : "Never backed up");
    return [{ code: p.code, label: p.label, reason: why }];
  });
  return {
    ready: storeMissing().length === 0,
    missing: storeMissing(),
    running: busy || !!(await BackupRun.exists({ status: "running", startedAt: { $gte: new Date(now.getTime() - 3 * HOUR) } })),
    portals: counted.length,
    healthy: counted.length - problems.length,
    problems,
    lastScheduled: lastScheduled
      ? { slot: lastScheduled.slot, finishedAt: lastScheduled.finishedAt, ok: scheduledRows.filter((r) => r.status === "complete").length, total: scheduledRows.length }
      : null,
    next: nextSlot(now),
  };
}

/* ── Stop, Finish, Restart, Retry failed (2026-10-17) ────────────────────── */

const runningRun = () =>
  BackupRun.findOne({ status: "running", startedAt: { $gte: new Date(Date.now() - 3 * HOUR) } }).sort({ startedAt: -1 });

/**
 * Ask the running backup to stop: "now" drops the portal being copied, "after"
 * lets it finish; either way nothing more starts. Restart is a stop now that
 * starts a new run from the first portal once this one has stopped. A Finish
 * already asked for can still become a Stop, never the other way round.
 */
export async function requestStop(by: string, mode: "now" | "after", restart = false) {
  const run = await runningRun();
  if (!run) throw err("No backup is running", 409);
  const stop = mode === "now" || run.stop === "now" ? "now" : "after";
  await BackupRun.updateOne({ _id: run._id }, { $set: { stop, stopBy: by, ...(restart ? { restart: true } : {}) } });
  return { slot: run.slot, stop, restart: restart || !!run.restart };
}

/** The last finished run's portals that failed or were stopped — what Retry failed backs up again. */
async function retryable() {
  const last = await BackupRun.findOne({ status: { $ne: "running" } }).sort({ startedAt: -1 }).lean();
  if (!last) return null;
  const rows = (await Backup.find({ run: last._id, status: { $in: ["failed", "stopped"] } }).lean()) as IBackup[];
  return rows.length ? { run: last, rows } : null;
}

export async function retryFailed(by: string) {
  const r = await retryable();
  if (!r) throw err("Nothing failed or was stopped in the last backup", 400);
  const started = await startManualRun(by, r.rows.map((x) => x.portal));
  return { ...started, portals: r.rows.map((x) => x.label) };
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
  const slot = manualSlot();
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
