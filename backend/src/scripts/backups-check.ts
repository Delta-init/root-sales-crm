/**
 * Checks Backups (2026-10-16) — GET /backups, POST /backups/run,
 * GET /backups/:id/link and src/scripts/backup-restore.ts — against scratch
 * databases and an R2 stand-in:
 *
 *   - root admins only;
 *   - every portal: the ones set up are backed up, one not set up, one naming
 *     no database and one whose server is down say so (and never show the
 *     database address or its password); one database under two names once;
 *   - the file in R2 under the portal's folder, its checksum, a download link;
 *   - restored into a new database, every document is the same — ObjectIds,
 *     dates, decimals, binary, longs — with its indexes and views; restoring
 *     onto data is refused; a file cut short is refused;
 *   - a second run while one is running is refused; a scheduled slot runs once;
 *   - after 30 days an archive leaves R2, never a portal's newest good one;
 *   - the times: 02:30 and 13:30 Dubai;
 *   - who started a run and who downloaded is in the audit log.
 *
 * Run by backups-check.sh. Scratch databases only.
 */
import mongoose from "mongoose";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const { EJSON, Decimal128, Binary, Long, ObjectId } = mongoose.mongo.BSON;

const uri = process.env.MONGODB_URI ?? "";
const MONGO = process.env.E2E_MONGO ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(uri) || !/^mongodb:\/\/127\.0\.0\.1:\d+$/.test(MONGO)) {
  console.error(`Refusing to run: MONGODB_URI must be a scratch e2e database on 127.0.0.1`);
  process.exit(1);
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const R2_DIR = process.env.E2E_R2_DIR!;
const OUT = process.env.E2E_OUT!;
const PASSWORD = "BackupsE2e!pass1";

let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);
const show = (v: unknown) => String(JSON.stringify(v)).slice(0, 400);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const restore = (...a: string[]) => {
  const p = spawnSync("bun", ["--no-env-file", join(dirname(fileURLToPath(import.meta.url)), "backup-restore.ts"), ...a], { cwd: OUT, env: { PATH: process.env.PATH ?? "" } });
  return { code: p.status, out: String(p.stdout) + String(p.stderr) };
};
const canon = (d: unknown) => EJSON.stringify(d, { relaxed: false });

async function main() {
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  const client = mongoose.connection.getClient();
  const dbOf = (name: string) => client.db(name);

  step("Setting up: two admins, the portals' data");
  const { AdminUser } = await import("../models/AdminUser.js");
  await AdminUser.create({ name: "Root E2E", email: "root@backups-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@backups-e2e.test", password: PASSWORD, role: "member", status: "active" });

  const delta = dbOf("delta-bk-e2e");
  const leadId = new ObjectId();
  await delta.collection("leads").insertMany([
    { _id: leadId, name: "Asha", phone: "971500000001", createdAt: new Date("2026-10-01T08:00:00.123Z"), amount: Decimal128.fromString("2250.50"),
      big: Long.fromString("9007199254740993"), file: new Binary(Buffer.from([0, 1, 2, 250])), notes: [{ at: new Date("2026-10-02T00:00:00Z"), content: "first call" }],
      nested: { course: new ObjectId(), tags: ["forex", "jura"], none: null }, ratio: 0.1, whole: 3.0, int: 7 },
    { name: "Ravi", phone: "971500000002", createdAt: new Date("2026-10-03T08:00:00Z"), status: "new", "dotted-key": true },
  ]);
  await delta.collection("leads").createIndex({ phone: 1 }, { unique: true, name: "phone_unique" });
  await delta.collection("leads").createIndex({ createdAt: -1, status: 1 });
  await delta.collection("threecx_calls").insertMany(Array.from({ length: 50 }, (_, i) => ({ n: i, at: new Date(Date.UTC(2026, 9, 1, 0, i)) })));
  await delta.createCollection("open_leads", { viewOn: "leads", pipeline: [{ $match: { status: "new" } }] });
  await delta.createCollection("empty_one");

  // The LMS: big enough that the file is written and sent in parts.
  const lms = dbOf("lms-bk-e2e");
  for (let b = 0; b < 30; b++) {
    await lms.collection("progress").insertMany(Array.from({ length: 1000 }, (_, i) => ({ user: new ObjectId(), lesson: b * 1000 + i, at: new Date(), text: randomBytes(200).toString("hex") })));
  }
  await dbOf("banglore-bk-e2e").collection("leads").insertOne({ name: "Kiran", amountInr: 150000 });
  await dbOf("finance-bk-e2e").collection("invoices").insertOne({ number: "IN-00001", totalMinor: Long.fromNumber(550500) });
  await dbOf("tc-bk-e2e").collection("students").insertOne({ code: "STU-1", name: "Stella" });
  await dbOf("hrms-bk-e2e").collection("employees").insertOne({ name: "Hana" });

  const login = async (email: string) => (await (await fetch(`${ROOT}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  })).json())?.data?.accessToken as string;
  const root = { authorization: `Bearer ${await login("root@backups-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@backups-e2e.test")}` };
  const call = async (method: string, path: string, headers: Record<string, string> = root, body?: unknown): Promise<{ status: number; body: Json }> => {
    const r = await fetch(`${ROOT}${path}`, { method, headers: { ...headers, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const overview = async () => (await call("GET", "/backups")).body?.data as Json;
  const waitIdle = async () => {
    for (let i = 0; i < 240; i++) {
      const o = await overview();
      if (!o.running) return o;
      await sleep(250);
    }
    throw new Error("the backup never finished");
  };

  step("Root admins only");
  check("a member is refused", (await call("GET", "/backups", member)).status === 403);
  check("…and cannot start one", (await call("POST", "/backups/run", member)).status === 403);
  const before = await overview();
  check("the store is set up", before.store.ready === true && before.store.bucket === "delta-backups-e2e", show(before.store));
  check("02:30 and 13:30 Dubai, kept 30 days", show(before.schedule.times) === show(["02:30", "13:30"]) && before.schedule.keepDays === 30 && before.schedule.timezone === "Dubai");
  const codes = before.portals.map((p: Json) => p.code);
  check("every portal, in order; finance's one database listed once",
    show(codes) === show(["delta", "draw", "remote", "banglore", "finance-hq", "lms", "commission", "hrms", "media-erp", "root"]), show(codes));
  const problem = (c: string) => before.portals.find((p: Json) => p.code === c)?.problem ?? "";
  check("Remote: not set up, naming the variable", /REMOTE_MONGODB_URI/.test(problem("remote")), problem("remote"));
  check("Media ERP: no database named", /MEDIA_ERP_MONGODB_DB/.test(problem("media-erp")), problem("media-erp"));
  check("Tetra Commission: the database named apart is used", before.portals.find((p: Json) => p.code === "commission")?.database === "tc-bk-e2e" && !problem("commission"));
  check("no address or password on the page", !/mongodb:|secretpw/.test(JSON.stringify(before)));

  step("Back up now — every portal");
  const started = await call("POST", "/backups/run");
  check("started (202)", started.status === 202 && /^manual /.test(started.body?.data?.slot ?? ""), show(started.body));
  check("a manual run's name is its own, to the millisecond", /^manual \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}Z [0-9a-f]{4}$/.test(started.body?.data?.slot ?? ""), started.body?.data?.slot);
  const again = await call("POST", "/backups/run");
  check("a second run while one runs is refused (409)", again.status === 409, show(again));
  const after = await waitIdle();
  const run1 = after.runs[0];
  const row = (code: string, run = run1) => run.backups.find((b: Json) => b.portal === code);
  check("one run, by the root admin", after.runs.length === 1 && run1.trigger === "manual" && run1.triggeredBy === "root@backups-e2e.test");
  for (const c of ["delta", "banglore", "finance-hq", "lms", "commission", "hrms", "root"]) {
    check(`${c}: complete`, row(c)?.status === "complete" && row(c).bytes > 0, show(row(c)));
  }
  check("Draw (server down): failed", row("draw")?.status === "failed", show(row("draw")));
  check("…without its address or password", !/secretpw|mongodb:|drawuser/.test(row("draw")?.error ?? "x"), row("draw")?.error);
  check("Remote and Media ERP: skipped, saying why", row("remote")?.status === "skipped" && row("media-erp")?.status === "skipped");
  check("the run is marked failed (Draw)", run1.status === "failed");
  check("Sales CRM: 4 collections (and the view), 52 documents", row("delta").collections === 4 && row("delta").documents === 52, show(row("delta")));
  check("LMS: 30,000 documents", row("lms").documents === 30_000);
  const portalCard = after.portals.find((p: Json) => p.code === "delta");
  check("the Sales CRM card: last good backup, 1 kept", portalCard.lastGood?.id === row("delta").id && portalCard.kept === 1 && portalCard.keptBytes === row("delta").bytes);
  check("Draw's card: last is the failure, no good one", after.portals.find((p: Json) => p.code === "draw").last?.status === "failed" && !after.portals.find((p: Json) => p.code === "draw").lastGood);

  step("Counted: the last 30 days, each portal, the failures");
  check("1 run, 7 worked, 1 failed, 2 not backed up", show(after.totals.window) === show({ days: 30, runs: 1, ok: 7, failed: 1, skipped: 2, stopped: 0 }), show(after.totals.window));
  check("7 backups stored", after.totals.stored.count === 7 && after.totals.stored.bytes > 0, show(after.totals.stored));
  const deltaCard = after.portals.find((p: Json) => p.code === "delta");
  check("the Sales CRM: 1 of 1 worked, a dot for it", show(deltaCard.window) === show({ ok: 1, failed: 0, skipped: 0, stopped: 0 }) && deltaCard.history.length === 1 && deltaCard.history[0].status === "complete");
  check("the failures: Draw, Remote, Media ERP, with why",
    show(after.failures.map((f: Json) => f.label).sort()) === show(["Draw CRM", "Media ERP", "Remote CRM"]) && after.failures.every((f: Json) => f.error), show(after.failures));
  check("…no password in them", !/secretpw|mongodb:/.test(JSON.stringify(after.failures)));
  const sum1 = (await call("GET", "/backups/summary")).body?.data;
  check("Pending's line: 7 of 10 portals fine", sum1?.ready === true && sum1.portals === 10 && sum1.healthy === 7, show(sum1));
  check("…naming the 3 that are not, and why", show(sum1.problems.map((p: Json) => p.code).sort()) === show(["draw", "media-erp", "remote"]) && /not set up/i.test(sum1.problems.find((p: Json) => p.code === "remote").reason), show(sum1.problems));
  check("…no scheduled run yet, the next one named", sum1.lastScheduled === null && !!sum1.next);
  check("…root admins only", (await call("GET", "/backups/summary", member)).status === 403);

  step("In R2");
  const deltaKey = `delta/${row("delta").file}`;
  const inR2 = join(R2_DIR, deltaKey);
  check("under the portal's folder", existsSync(inR2) && /^delta_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z_[0-9a-f]{6}\.ndjson\.gz$/.test(row("delta").file), deltaKey);
  check("the checksum is the file's", createHash("sha256").update(readFileSync(inR2)).digest("hex") === row("delta").sha256);
  const parts = existsSync(join(R2_DIR, "..", "_multipart.log")) ? readFileSync(join(R2_DIR, "..", "_multipart.log"), "utf8") : "";
  check("the LMS file went up in parts and arrived whole", new RegExp(`/lms/${row("lms").file} [2-9]`).test(parts) && readFileSync(join(R2_DIR, `lms/${row("lms").file}`)).length === row("lms").bytes, `${row("lms").bytes} bytes; ${parts.trim()}`);

  step("Download");
  const link = await call("GET", `/backups/${row("delta").id}/link`);
  check("a link for root admins", link.status === 200 && /X-Amz-Signature=/.test(link.body?.data?.url ?? ""), show(link.body));
  check("members get none", (await call("GET", `/backups/${row("delta").id}/link`, member)).status === 403);
  check("a failed one has no file (404)", (await call("GET", `/backups/${row("draw").id}/link`)).status === 404);
  check("nonsense id → 404", (await call("GET", `/backups/nope/link`)).status === 404);
  const file = await (await fetch(link.body.data.url)).arrayBuffer();
  const local = join(OUT, row("delta").file);
  writeFileSync(local, Buffer.from(file));
  check("the link downloads the file", Buffer.from(file).equals(readFileSync(inR2)));

  step("Restore");
  const verify = restore(local, "--sha256", row("delta").sha256);
  check("the file checks out: checksum, whole", verify.code === 0 && /Checksum matches/.test(verify.out) && /whole/.test(verify.out), verify.out);
  const wrongSha = restore(local, "--sha256", "0".repeat(64));
  check("a wrong checksum is refused", wrongSha.code === 1, wrongSha.out);
  const dry = restore(local, "--to", `${MONGO}/delta-restored-e2e`);
  check("without --write it writes nothing", dry.code === 0 && /Add --write/.test(dry.out) && (await dbOf("delta-restored-e2e").listCollections().toArray()).length === 0, dry.out);
  const done = restore(local, "--to", `${MONGO}/delta-restored-e2e`, "--write");
  check("restored into a new database", done.code === 0 && /Restored into delta-restored-e2e/.test(done.out), done.out);
  const back = dbOf("delta-restored-e2e");
  for (const c of ["leads", "threecx_calls", "empty_one"]) {
    const a = (await delta.collection(c).find().sort({ _id: 1 }).toArray()).map(canon);
    const b = (await back.collection(c).find().sort({ _id: 1 }).toArray()).map(canon);
    check(`${c}: every document the same, types and all`, a.length === b.length && a.every((x, i) => x === b[i]), `${a.length} vs ${b.length}`);
  }
  const asha = await back.collection("leads").findOne({ _id: leadId });
  check("…an ObjectId, a Date, a Decimal128, a Long and Binary come back as themselves",
    asha?._id instanceof ObjectId && asha?.createdAt instanceof Date && asha.amount instanceof Decimal128 && asha.big?.toString() === "9007199254740993" && asha.file instanceof Binary);
  const idx = (await back.collection("leads").indexes()).map((i) => i.name).sort();
  check("the indexes, unique one included", show(idx) === show(["_id_", "createdAt_-1_status_1", "phone_unique"]) && (await back.collection("leads").indexes()).find((i) => i.name === "phone_unique")?.unique === true, show(idx));
  const view = (await back.listCollections({ name: "open_leads" }).toArray())[0];
  check("the view, still a view", view?.type === "view" && (await back.collection("open_leads").countDocuments()) === 1);
  const onto = restore(local, "--to", `${MONGO}/delta-restored-e2e`, "--write");
  check("restoring onto data is refused", onto.code === 1 && /already has documents/.test(onto.out), onto.out);
  const only = restore(local, "--to", `${MONGO}/delta-only-e2e`, "--write", "--only", "threecx_calls");
  check("--only restores just those", only.code === 0 && show((await dbOf("delta-only-e2e").listCollections().toArray()).map((c) => c.name)) === show(["threecx_calls"]), only.out);
  const lines = gunzipSync(readFileSync(local)).toString().trimEnd().split("\n");
  const cut = join(OUT, "cut.ndjson.gz");
  writeFileSync(cut, gzipSync(lines.slice(0, -1).join("\n") + "\n"));
  const cutRes = restore(cut, "--to", `${MONGO}/delta-cut-e2e`, "--write");
  check("a file cut short is refused, nothing written", cutRes.code === 1 && /cut short/.test(cutRes.out) && (await dbOf("delta-cut-e2e").listCollections().toArray()).length === 0, cutRes.out);

  step("A scheduled slot runs once");
  const svc = await import("../services/backupService.js");
  const [a, b] = await Promise.all([
    svc.runBackups({ slot: "2026-10-17 13:30", trigger: "scheduled", portals: ["hrms"] }),
    svc.runBackups({ slot: "2026-10-17 13:30", trigger: "scheduled", portals: ["hrms"] }),
  ]);
  check("two processes, one backup", [a, b].filter(Boolean).length === 1 && (a ?? b)!.rows.length === 1 && (a ?? b)!.rows[0].status === "complete");
  const hrmsKeys = [row("hrms").file, (a ?? b)!.rows[0].key.split("/").pop()];
  check("two backups of a portal in the same minute are two files", hrmsKeys[0] !== hrmsKeys[1] && hrmsKeys.every((f) => existsSync(join(R2_DIR, `hrms/${f}`))), show(hrmsKeys));

  const sum2 = (await call("GET", "/backups/summary")).body?.data;
  check("Pending's line names the last scheduled run", sum2?.lastScheduled?.slot === "2026-10-17 13:30" && sum2.lastScheduled.ok === 1 && sum2.lastScheduled.total === 1, show(sum2?.lastScheduled));

  step("The times (Dubai)");
  const iso = (d: Date | null) => d?.toISOString() ?? "";
  check("13:00 Dubai → next 13:30", iso(svc.nextSlot(new Date("2026-10-17T09:00:00Z"))) === "2026-10-17T09:30:00.000Z");
  check("00:00 Dubai → next 02:30 that night", iso(svc.nextSlot(new Date("2026-10-17T20:00:00Z"))) === "2026-10-17T22:30:00.000Z");
  check("13:31 Dubai → last was 13:30", iso(svc.lastSlot(new Date("2026-10-17T09:31:00Z"))) === "2026-10-17T09:30:00.000Z");
  check("the slot's name is Dubai time", svc.slotId(new Date("2026-10-17T22:30:00Z")) === "2026-10-18 02:30");

  step("After 30 days");
  const { Backup, BackupRun } = await import("../models/Backup.js");
  const old = new Date(Date.now() - 40 * 86_400_000);
  await Backup.updateMany({ run: new mongoose.Types.ObjectId(String(run1.id)) }, { $set: { startedAt: old } });
  await BackupRun.updateOne({ _id: new mongoose.Types.ObjectId(String(run1.id)) }, { $set: { startedAt: old } });
  const second = await call("POST", "/backups/run", root, { portals: ["delta"] });
  check("one portal backed up on its own", second.status === 202);
  const pruned = await waitIdle();
  const run2 = pruned.runs[0];
  check("…only that portal", run2.backups.length === 1 && run2.backups[0].portal === "delta" && run2.backups[0].status === "complete", show(run2.backups));
  const oldRun = pruned.runs.find((r: Json) => r.id === run1.id);
  check("the old Sales CRM archive left R2", !existsSync(inR2) && oldRun.backups.find((x: Json) => x.portal === "delta").expired === true);
  check("…its row stays as history", !!oldRun.backups.find((x: Json) => x.portal === "delta"));
  check("the LMS's old one stays — still its newest good backup", existsSync(join(R2_DIR, `lms/${row("lms").file}`)) && oldRun.backups.find((x: Json) => x.portal === "lms").expired === false);
  check("HRMS: the old one left, the newer one from the same minute stayed", !existsSync(join(R2_DIR, `hrms/${hrmsKeys[0]}`)) && existsSync(join(R2_DIR, `hrms/${hrmsKeys[1]}`)));
  check("40-day-old backups are out of the 30-day counts", pruned.totals.window.runs === 2 && pruned.totals.window.failed === 0, show(pruned.totals.window));
  const sum3 = (await call("GET", "/backups/summary")).body?.data;
  const lmsProblem = sum3.problems.find((p: Json) => p.code === "lms");
  check("the LMS, last good 40 days ago, is flagged as missed", /No good backup for \d+ hours/.test(lmsProblem?.reason ?? ""), show(sum3.problems));
  check("…the Sales CRM, backed up just now, is not", !sum3.problems.some((p: Json) => p.code === "delta"));
  check("a removed one has no link (410)", (await call("GET", `/backups/${row("delta").id}/link`)).status === 410);

  step("The audit log");
  const { AuditLog } = await import("../models/AuditLog.js");
  check("who started a run", (await AuditLog.countDocuments({ action: "backup_run", adminEmail: "root@backups-e2e.test" })) === 2);
  check("who downloaded what", (await AuditLog.countDocuments({ action: "backup_downloaded", detail: new RegExp(`Sales CRM: ${row("delta").file}`) })) === 1);

  step("Stop, Finish, Restart, Retry failed");
  // Draw's server is down: its connection waits 15 seconds before failing — a window to press the buttons in.
  const latestRun = async () => (await overview()).runs[0];
  const waitFor = async (what: string, ok: (o: Json) => boolean, ms = 30_000) => {
    for (let t = 0; t < ms; t += 200) {
      const o = await overview();
      if (ok(o)) return o;
      await sleep(200);
    }
    throw new Error(`timed out waiting for ${what}: ${show((await overview()).runs.slice(0, 2).map((r: Json) => [r.status, r.backups.map((b: Json) => `${b.portal}:${b.status}`)]))}`);
  };
  const drawRunning = (o: Json) => o.running && o.runs[0]?.backups.some((b: Json) => b.portal === "draw" && b.status === "running");
  check("nothing running: Stop is refused (409)", (await call("POST", "/backups/stop")).status === 409);
  check("members can't stop, finish, restart or retry",
    (await Promise.all(["stop", "finish", "restart", "retry"].map((a) => call("POST", `/backups/${a}`, member)))).every((r) => r.status === 403));

  // Stop: right away, mid-portal.
  await call("POST", "/backups/run");
  await waitFor("Draw to start", drawRunning);
  const pressed = Date.now();
  const stopRes = await call("POST", "/backups/stop");
  check("Stop while it runs (202)", stopRes.status === 202 && stopRes.body?.data?.stop === "now", show(stopRes.body));
  await waitFor("the run to stop", (o) => !o.running);
  const stoppedIn = Date.now() - pressed;
  const sRun = await latestRun();
  check(`stopped right away (${stoppedIn} ms, not the 15 s Draw's connection would take)`, stoppedIn < 8000);
  check("the run is Stopped", sRun.status === "stopped" && sRun.stop === "now" && sRun.stopBy === "root@backups-e2e.test", show(sRun));
  check("the Sales CRM, done before, kept its backup", sRun.backups.find((b: Json) => b.portal === "delta")?.status === "complete");
  check("Draw, being copied, is Stopped — not Failed", sRun.backups.find((b: Json) => b.portal === "draw")?.status === "stopped" && /while it was being copied/.test(sRun.backups.find((b: Json) => b.portal === "draw").error));
  const notReached = sRun.backups.filter((b: Json) => !["delta", "draw"].includes(b.portal));
  check("every portal not reached is Stopped, nothing uploaded", notReached.length === 8 && notReached.every((b: Json) => b.status === "stopped" && !b.bytes && /before it started/.test(b.error)), show(notReached.map((b: Json) => b.status)));
  const afterStop = await overview();
  check("stopped is not a failure: not in Failures, counted apart", afterStop.failures.every((f: Json) => f.status !== "stopped") && afterStop.totals.window.stopped === 9, show(afterStop.totals.window));
  check("Retry failed is offered for the stopped ones", afterStop.retry.length === 9 && afterStop.retry.includes("Draw CRM"), show(afterStop.retry));

  // Finish: the portal being copied finishes, then it stops.
  await call("POST", "/backups/run");
  await waitFor("Draw to start", drawRunning);
  const finRes = await call("POST", "/backups/finish");
  check("Finish while it runs (202)", finRes.status === 202 && finRes.body?.data?.stop === "after");
  await waitFor("the run to finish", (o) => !o.running);
  const fRun = await latestRun();
  check("Draw was let finish (its own way: the server is down, so Failed)", fRun.backups.find((b: Json) => b.portal === "draw")?.status === "failed");
  check("…then nothing more started", fRun.status === "stopped" && fRun.backups.filter((b: Json) => !["delta", "draw"].includes(b.portal)).every((b: Json) => b.status === "stopped"));

  // Restart: stopped, then a new run from the first portal.
  await call("POST", "/backups/run");
  await waitFor("Draw to start", drawRunning);
  const oldId = (await latestRun()).id;
  const rsRes = await call("POST", "/backups/restart");
  check("Restart while it runs (202)", rsRes.status === 202 && rsRes.body?.data?.restart === true);
  const restarted = await waitFor("a new run", (o) => o.runs[0]?.id !== oldId && o.runs[0]?.trigger === "manual");
  const stoppedRun = restarted.runs.find((r: Json) => r.id === oldId);
  check("the old run stopped, marked as restarted", stoppedRun?.status === "stopped" && stoppedRun.restart === true);
  check("a new run, by whoever pressed it, from the first portal", restarted.runs[0].triggeredBy === "root@backups-e2e.test" && restarted.runs[0].backups[0]?.portal === "delta");
  const done3 = await waitFor("the new run to end", (o) => !o.running, 60_000);
  check("…and it backed every portal up again", done3.runs[0].backups.length === 10 && done3.runs[0].backups.filter((b: Json) => b.status === "complete").length === 7);

  // Retry failed: only what failed or was stopped last time.
  const rtRes = await call("POST", "/backups/retry");
  check("Retry failed: Draw only (it failed), not the 7 that worked", rtRes.status === 202 && show(rtRes.body?.data?.portals) === show(["Draw CRM"]), show(rtRes.body));
  const done4 = await waitFor("the retry to end", (o) => !o.running, 60_000);
  check("…a run of Draw alone", done4.runs[0].backups.length === 1 && done4.runs[0].backups[0].portal === "draw");
  const { AuditLog: Audit } = await import("../models/AuditLog.js");
  check("Stop, Finish, Restart and the retry are in the audit log",
    (await Audit.countDocuments({ action: { $in: ["backup_stopped", "backup_finish_requested", "backup_restarted"] } })) === 3
      && (await Audit.countDocuments({ action: "backup_run", detail: "retry: Draw CRM" })) === 1);

  step("A backup whose server restarted under it");
  const ago = (ms: number) => new Date(Date.now() - ms);
  const ghost = async (slot: string) => {
    const r = await BackupRun.create({ slot, trigger: "manual", triggeredBy: "root@backups-e2e.test", status: "running", heartbeatAt: ago(60_000), startedAt: ago(60_000) });
    await Backup.create({ run: r._id, portal: "hrms", label: "HRMS", database: "hrms-bk-e2e", status: "running", startedAt: ago(50_000) });
    return String(r._id);
  };
  const g1 = await ghost("ghost one");
  const seen = await overview();
  check("not shown as running — nobody is working on it", seen.running === false, show(seen.runs[0]));
  const g1Run = seen.runs.find((r: Json) => r.id === g1);
  check("settled: the run failed, its portal Interrupted", g1Run?.status === "failed" && /Interrupted — the server restarted/.test(g1Run.backups[0]?.error ?? ""), show(g1Run));
  check("the summary agrees", (await call("GET", "/backups/summary")).body?.data?.running === false);
  await ghost("ghost two");
  const fresh = await call("POST", "/backups/run", root, { portals: ["hrms"] });
  check("Back up now is not blocked by it", fresh.status === 202, show(fresh));
  const live = await waitFor("that backup to end", (o) => !o.running, 60_000);
  check("…and it ran", live.runs[0].backups[0]?.portal === "hrms" && live.runs[0].backups[0].status === "complete");
  const g3 = await ghost("ghost three");
  const rs = await call("POST", "/backups/restart");
  check("Restart on it starts a fresh backup (202)", rs.status === 202 && rs.body?.data?.restart === true, show(rs));
  const after3 = await waitFor("the fresh backup to end", (o) => !o.running && o.runs[0].trigger === "manual" && o.runs[0].backups.length === 10, 90_000);
  check("…the dead one settled, a new run from the first portal", after3.runs.find((r: Json) => r.id === g3)?.status === "failed" && after3.runs[0].backups[0].portal === "delta");
  check("Stop on it: nothing is running (409)", (await (async () => { await ghost("ghost four"); return (await call("POST", "/backups/stop")).status; })()) === 409);
  // A live backup longer than the 8-second window stays alive: Draw waits 15 s on its dead server.
  await call("POST", "/backups/run");
  await waitFor("Draw to start", drawRunning);
  await sleep(10_000);
  const still = await overview();
  check("a live backup past the dead window is still running (its mark keeps it alive)", still.running === true && still.runs[0].status === "running", show(still.runs[0]?.status));
  await call("POST", "/backups/stop");
  await waitFor("it to stop", (o) => !o.running);

  console.log(`\n${checks - failures}/${checks} checks passed`);
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
