/**
 * Read a backup file back (Root portal → Backups → Download).
 *
 *   # check it: whole, its checksum, what is in it — writes nothing
 *   bun --no-env-file src/scripts/backup-restore.ts lms_2026-10-17T09-30Z.ndjson.gz [--sha256 <hex>]
 *
 *   # put it into a database
 *   bun --no-env-file src/scripts/backup-restore.ts <file> --to 'mongodb://…/lms_restored?authSource=admin' --write [--only leads,users]
 *
 * It only ever creates: a collection that already holds documents in the
 * target is refused, never added to or replaced. So the way back is to restore
 * into a new database (lms_restored), look at it, and then point the portal at
 * it or copy across what was lost — a decision made by a person, not this.
 *
 * A file without its closing line was cut short and is refused before
 * anything is written.
 */
import mongoose from "mongoose";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";

const { MongoClient } = mongoose.mongo;
const { EJSON } = mongoose.mongo.BSON;

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith("--") && !["--to", "--sha256", "--only"].includes(args[i - 1] ?? ""));
const TO = opt("--to");
const WRITE = args.includes("--write");
const ONLY = opt("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const SHA = opt("--sha256");
if (!file) {
  console.error("Usage: backup-restore.ts <file.ndjson.gz> [--sha256 <hex>] [--to <mongodb uri> --write] [--only a,b]");
  process.exit(2);
}
if (WRITE && !TO) {
  console.error("--write needs --to <mongodb uri with the database name>");
  process.exit(2);
}

const lines = () => createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
const isMarker = (l: string) => l.startsWith('{"$backup":');

/* ── 1. Check the file, writing nothing ──────────────────────────────────── */
if (SHA) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  if (h.digest("hex") !== SHA.toLowerCase()) {
    console.error("✗ The file's checksum does not match — it is not the file that was backed up.");
    process.exit(1);
  }
  console.log("✓ Checksum matches");
}

let start: Record<string, unknown> | null = null;
let end: Record<string, unknown> | null = null;
const counts = new Map<string, number>();
let current = "";
for await (const line of lines()) {
  if (!line) continue;
  if (isMarker(line)) {
    const m = EJSON.parse(line) as Record<string, unknown>;
    if (m.$backup === "start") start = m;
    else if (m.$backup === "collection") counts.set((current = String(m.name)), 0);
    else if (m.$backup === "view") counts.set(`${m.name} (view)`, 0);
    else if (m.$backup === "end") end = m;
    continue;
  }
  if (end) {
    console.error("✗ Data after the closing line — this is not a backup file.");
    process.exit(1);
  }
  counts.set(current, (counts.get(current) ?? 0) + 1);
}
if (!start || start.format !== "delta-backup-v1") {
  console.error("✗ Not a backup file from the Root portal.");
  process.exit(1);
}
if (!end) {
  console.error("✗ The file was cut short (no closing line). Do not restore it.");
  process.exit(1);
}
const total = [...counts.values()].reduce((a, b) => a + b, 0);
if (total !== end.documents) {
  console.error(`✗ The file says ${end.documents} documents but holds ${total}.`);
  process.exit(1);
}
console.log(`✓ ${start.label} (${start.database}), backed up ${start.startedAt}: ${counts.size} collections, ${total} documents — whole`);
if (!TO) {
  for (const [name, n] of counts) console.log(`   ${name.padEnd(36)} ${n}`);
  process.exit(0);
}

/* ── 2. Restore ──────────────────────────────────────────────────────────── */
const client = new MongoClient(TO, { serverSelectionTimeoutMS: 15_000 });
await client.connect();
const db = client.db();
const wanted = (name: string) => !ONLY || ONLY.includes(name);
const plan = [...counts.keys()].filter((n) => !n.endsWith(" (view)") && wanted(n));
const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
const clash: string[] = [];
for (const n of plan) if (existing.has(n) && (await db.collection(n).estimatedDocumentCount()) > 0) clash.push(n);
if (clash.length) {
  console.error(`✗ ${db.databaseName} already has documents in: ${clash.join(", ")}. Restore into an empty database (e.g. ${db.databaseName}_restored).`);
  await client.close();
  process.exit(1);
}
if (!WRITE) {
  console.log(`Would restore ${plan.length} collection(s) into ${db.databaseName}. Add --write.`);
  await client.close();
  process.exit(0);
}

let name = "";
let indexes: Record<string, unknown>[] = [];
let batch: Record<string, unknown>[] = [];
const views: { name: string; options: Record<string, unknown> }[] = [];
const flush = async () => {
  if (batch.length && wanted(name)) await db.collection(name).insertMany(batch, { ordered: true, bypassDocumentValidation: true });
  batch = [];
};
const finishCollection = async () => {
  await flush();
  if (!name || !wanted(name)) return;
  const own = indexes.filter((i) => i.name !== "_id_").map(({ v: _v, ns: _ns, ...rest }) => rest);
  if (own.length) await db.collection(name).createIndexes(own as never);
  console.log(`   ${name.padEnd(36)} ${counts.get(name)}${own.length ? ` (+${own.length} index${own.length === 1 ? "" : "es"})` : ""}`);
};
for await (const line of lines()) {
  if (!line) continue;
  if (isMarker(line)) {
    const m = EJSON.parse(line, { relaxed: false }) as Record<string, unknown>;
    if (m.$backup === "collection") {
      await finishCollection();
      name = String(m.name);
      indexes = (m.indexes as Record<string, unknown>[]) ?? [];
      if (wanted(name) && !existing.has(name)) await db.createCollection(name, (m.options ?? {}) as never);
    } else if (m.$backup === "view") {
      views.push({ name: String(m.name), options: (m.options ?? {}) as Record<string, unknown> });
    }
    continue;
  }
  if (!wanted(name)) continue;
  batch.push(EJSON.parse(line, { relaxed: false }) as Record<string, unknown>);
  if (batch.length >= 1000) await flush();
}
await finishCollection();
for (const v of views) if (wanted(v.name) && !existing.has(v.name)) await db.createCollection(v.name, v.options as never);
console.log(`✓ Restored into ${db.databaseName}`);
await client.close();
