/**
 * Drives lead traffic end to end: the sheet posting into the portal over HTTP,
 * the split, and what each CRM's intake is sent.
 *
 * What it proves:
 *   - each segment is split 50/50 by turns, the Hindi leads Delta takes go to
 *     Lubna, and each CRM gets the same fields and source labels the sheet
 *     used to send it directly;
 *   - somebody already in either CRM — however the number was typed — or
 *     already sent from here goes back to where they are, and takes no place
 *     in the split;
 *   - resending the same row changes nothing and sends nothing;
 *   - a CRM that is down, loses the answer, or refuses the key does not lose
 *     the lead: it waits, and the worker sends it once it can;
 *   - pausing holds leads and resuming sends them; changing the split starts
 *     the new ratio from there;
 *   - bad rows are turned away with a reason and come through once fixed;
 *   - only the sheet's key opens the intake, and only root admins see the rest.
 *
 * Run through scripts/traffic-check.sh (throwaway mongod, the real backend, and
 * stand-in CRMs served from here).
 */
import http from "node:http";
import mongoose, { Types } from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
for (const [name, value] of [
  ["MONGODB_URI", uri],
  ["DELTA_MONGODB_URI", process.env.DELTA_MONGODB_URI ?? ""],
  ["DRAW_MONGODB_URI", process.env.DRAW_MONGODB_URI ?? ""],
] as const) {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(value)) {
    console.error(`Refusing to run: ${name} must be a scratch e2e database on 127.0.0.1, got "${value}"`);
    process.exit(1);
  }
}

const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const SHEET_KEY = process.env.LEAD_TRAFFIC_SHEET_KEY ?? "";
const LUBNA = "6a7d78a7aa93812c05d38466";
const REPORTER = "69ef14534e41f5008be375d2";
const PASSWORD = "TrafficE2e!pass1";

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
function step(name: string) { console.log(`\n\x1b[1m${name}\x1b[0m`); }
const show = (v: unknown) => JSON.stringify(v).slice(0, 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn: () => Promise<boolean>, ms = 8000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return true;
    await sleep(250);
  }
  return fn();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${ROOT}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const sheet = (rows: unknown, key = SHEET_KEY) => call("POST", "/traffic/intake", { rows }, key ? { "x-traffic-key": key } : {});

// ── Stand-in CRMs: their sheet intake, as the real ones answer it ───────────

type Mode = "ok" | "down" | "refuse" | "lost";
const crm = {
  delta: { mode: "ok" as Mode, calls: 0, rows: [] as Json[], key: process.env.DELTA_SHEETS_API_KEY ?? "", port: Number(process.env.E2E_DELTA_PORT) },
  draw: { mode: "ok" as Mode, calls: 0, rows: [] as Json[], key: process.env.DRAW_SHEETS_API_KEY ?? "", port: Number(process.env.E2E_DRAW_PORT) },
};

async function main() {
  // The backend builds the collections and indexes, as it does in production;
  // two processes building them at once on a fresh database can leave some out.
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  const db = mongoose.connection.db!;
  const deltaDb = (await mongoose.createConnection(process.env.DELTA_MONGODB_URI!).asPromise()).db!;
  const drawDb = (await mongoose.createConnection(process.env.DRAW_MONGODB_URI!).asPromise()).db!;
  const crmDb = { delta: deltaDb, draw: drawDb };

  const servers = (["delta", "draw"] as const).map((org) =>
    http.createServer(async (req, res) => {
      const me = crm[org];
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.url !== "/api/v1/sheets/sync/batch" || req.method !== "POST") return reply(404, { success: false, message: "Route not found" });
      if (req.headers["x-api-key"] !== me.key || me.mode === "refuse") return reply(401, { success: false, message: "Invalid or missing API key" });
      if (me.mode === "down") return reply(503, { success: false, message: "CRM is down (e2e)" });
      me.calls++;
      const rows: Json[] = JSON.parse(Buffer.concat(chunks).toString("utf8")).rows ?? [];
      const results: Json[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        me.rows.push(r);
        if (typeof r.full_name !== "string" || typeof r.phone_number !== "string") {
          results.push({ index: i, status: "invalid", reason: "full_name and phone_number are required" });
        } else if (r.full_name === "BADROW") {
          results.push({ index: i, status: "invalid", reason: "Note cannot exceed 2000 characters" });
        } else {
          const exists = await crmDb[org].collection("leads").findOne({ phone: r.phone_number });
          if (exists) results.push({ index: i, status: "duplicate", leadId: String(exists._id), phone: r.phone_number });
          else {
            const ins = await crmDb[org].collection("leads").insertOne({
              name: r.full_name, phone: r.phone_number, source: r.source, assignedTo: r.assigned_to ?? null,
              reporter: r.reporter ?? null, createdAt: new Date(),
            });
            results.push({ index: i, status: "created", leadId: String(ins.insertedId), phone: r.phone_number });
          }
        }
      }
      if (me.mode === "lost") {
        // Took them, and the answer never got back.
        me.mode = "ok";
        return reply(502, { success: false, message: "Bad gateway (e2e)" });
      }
      reply(201, { success: true, message: "Batch processed", data: { summary: {}, results } });
    }).listen(crm[org].port, "127.0.0.1"),
  );

  step("Setting up: the portal's registry and admins, and two CRMs with people and leads");
  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  const { TrafficLead } = await import("../models/TrafficLead.js");
  for (const [code, name] of [["delta", "Delta CRM"], ["draw", "Draw CRM"]] as const) {
    await Organization.create({ code, kind: "crm", name, timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true });
  }
  await AdminUser.create({ name: "Root E2E", email: "root@traffic-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@traffic-e2e.test", password: PASSWORD, role: "member", status: "active" });
  const old = new Types.ObjectId();
  await deltaDb.collection("users").insertMany([
    { _id: new Types.ObjectId(LUBNA), name: "lubna", email: "lubna@delta-e2e.test", status: "active" },
    { _id: new Types.ObjectId(REPORTER), name: "Sheets Reporter", email: "reporter@delta-e2e.test", status: "active" },
    { _id: new Types.ObjectId(), name: "Asha", email: "asha@delta-e2e.test", status: "active" },
    { _id: old, name: "Old Hand", email: "old@delta-e2e.test", status: "inactive" },
  ]);
  const anagha = new Types.ObjectId();
  await drawDb.collection("users").insertMany([{ _id: anagha, name: "Anagha", email: "anagha@draw-e2e.test", status: "active" }]);
  await deltaDb.collection("leads").insertOne({ name: "Known to Delta", phone: "+971501111111", createdAt: new Date("2026-08-01") });
  await drawDb.collection("leads").insertOne({ name: "Known to Draw", phone: "0502222222", createdAt: new Date("2026-09-01") });

  const login = async (email: string) => (await call("POST", "/auth/login", { email, password: PASSWORD })).body?.data?.accessToken as string;
  const root = { authorization: `Bearer ${await login("root@traffic-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@traffic-e2e.test")}` };

  let n = 0;
  const row = (tab: string, phone: string, extra: Record<string, unknown> = {}) => {
    n++;
    return {
      id: `l:${1000 + n}`, tab, created_time: `2026-09-30T0${n % 10}:00:00+0400`, full_name: `Lead ${n}`,
      phone_number: `p:${phone}`, email: `lead${n}@example.test`, platform: n % 2 ? "ig" : "fb",
      campaign_name: "Abhin | Delta UK CAMPAIGNS", ad_name: "Ad A", is_organic: "false", ...extra,
    };
  };
  const UK = "Abhin | UK | New | 12926";
  const UAE = "Abhin | NORMAL LEADS  | New | 1";
  const GCC = "Abhin | GCC NEW LEAD SHEET | 30";
  const HINDI = "Abhin | Hindi FORM UAE ,QATAR  ";
  const leadDoc = (metaId: string) => TrafficLead.findOne({ metaId }).lean();

  // ── Case 1 ─────────────────────────────────────────────────────────────────
  step("Case 1 — the split, the fields each CRM gets, and resending");
  const ping = await call("GET", "/traffic/intake/ping", undefined, { "x-traffic-key": SHEET_KEY });
  check("the sheet's connection test answers, routing on, both CRMs ready",
    ping.status === 200 && ping.body?.data?.paused === false && ping.body?.data?.crms?.every((c: Json) => c.ready), show(ping.body));

  const batchA = [row(UK, "+44 7700 900001"), row(UK, "+447700900002"), row(UAE, "+971500000003"), row(UAE, "+971500000004")];
  const a = await sheet(batchA);
  const destA = (a.body?.data?.results ?? []).map((r: Json) => r.destination);
  check("UK & GCC leads take turns: Delta, Draw, Delta, Draw", a.status === 200 && show(destA) === show(["delta", "draw", "delta", "draw"]), show(a.body));
  check("and the sheet is told where each went", show((a.body?.data?.results ?? []).map((r: Json) => r.label)) === show(["✅ Delta", "✅ Draw", "✅ Delta", "✅ Draw"]));
  const d0 = crm.delta.rows[0];
  check("Delta gets the sheet's fields, cleaned", d0?.full_name === "Lead 1" && d0?.phone_number === "+447700900001" && d0?.platform === "instagram"
    && d0?.id === "l:1001" && d0?.email === "lead1@example.test" && d0?.created_time === new Date(batchA[0].created_time).toISOString()
    && d0?.campaign_name === "Abhin | Delta UK CAMPAIGNS" && d0?.ad_creative === "Ad A", show(d0));
  check("with the UK source label and the sheet's reporter, and nobody named", d0?.source === "FOREX LEADS ALPHA UK" && d0?.reporter === REPORTER && !("assigned_to" in (d0 ?? {})), show(d0));
  check("a UAE/Qatar tab lead carries the GCC label", crm.delta.rows[1]?.source === "FOREX LEADS ALPHA GCC", show(crm.delta.rows[1]));
  check("Draw gets no reporter — it records its own", crm.draw.rows.length === 2 && crm.draw.rows.every((r) => !("reporter" in r)), show(crm.draw.rows));

  const b = await sheet([row(HINDI, "+919800000005"), row(HINDI, "+919800000006")]);
  check("Hindi is split on its own: Delta, then Draw", show((b.body?.data?.results ?? []).map((r: Json) => r.destination)) === show(["delta", "draw"]), show(b.body));
  const hindiDelta = crm.delta.rows.at(-1);
  check("Delta's Hindi lead goes straight to Lubna, with the Hindi label", hindiDelta?.assigned_to === LUBNA && hindiDelta?.source === "FOREX LEADS ALPHA HINDI", show(hindiDelta));
  check("Draw's Hindi lead names nobody", !("assigned_to" in (crm.draw.rows.at(-1) ?? {})), show(crm.draw.rows.at(-1)));

  const g = await sheet([row(GCC, "+966500000007")]);
  check("the GCC tab is UK & GCC, labelled GCC, and at 2–2 the tie goes to Delta",
    g.body?.data?.results?.[0]?.destination === "delta" && crm.delta.rows.at(-1)?.source === "FOREX LEADS ALPHA GCC", show(g.body));

  const callsBefore = crm.delta.calls + crm.draw.calls;
  const again = await sheet(batchA);
  check("resending the same rows gives the same answers", show((again.body?.data?.results ?? []).map((r: Json) => r.label)) === show(["✅ Delta", "✅ Draw", "✅ Delta", "✅ Draw"]), show(again.body));
  check("and sends nothing", crm.delta.calls + crm.draw.calls === callsBefore);

  const sum1 = (await call("GET", "/traffic/summary", undefined, root)).body?.data;
  const seg = (s: Json, key: string) => s?.segments?.find((x: Json) => x.key === key);
  const share = (s: Json, key: string, org: string) => seg(s, key)?.shares?.find((x: Json) => x.org === org);
  check("today's numbers: UK & GCC Delta 3 (60%), Draw 2 (40%), against 50/50",
    share(sum1, "uk_gcc", "delta")?.split === 3 && share(sum1, "uk_gcc", "delta")?.actual === 60 && share(sum1, "uk_gcc", "draw")?.split === 2
    && share(sum1, "uk_gcc", "delta")?.target === 50, show(seg(sum1, "uk_gcc")));
  check("Hindi 1 and 1; seven sent in all", share(sum1, "hindi", "delta")?.split === 1 && share(sum1, "hindi", "draw")?.split === 1 && sum1?.totals?.sent === 7, show(sum1?.totals));
  const list1 = (await call("GET", "/traffic/leads?limit=50", undefined, root)).body?.data;
  check("the list shows them newest first, numbers masked", list1?.total === 7 && list1?.items?.[0]?.name === "Lead 7" && String(list1?.items?.[0]?.phone).includes("•"), show(list1?.items?.[0]));

  // ── Case 2 ─────────────────────────────────────────────────────────────────
  step("Case 2 — people already somewhere, a CRM down, a lost answer, pausing, a new split");
  const k1 = await sheet([row(UAE, "+971502222222")]);
  check("somebody Draw already has (typed 050…) goes back to Draw as a duplicate", k1.body?.data?.results?.[0]?.label === "⚠️ Duplicate · Draw", show(k1.body));
  const k2 = await sheet([row(UAE, "0501111111")]);
  check("somebody Delta already has (typed +971…) goes back to Delta", k2.body?.data?.results?.[0]?.label === "⚠️ Duplicate · Delta", show(k2.body));
  const k3 = await sheet([row(UK, "07700900002")]);
  check("somebody sent from here before goes where they went, however typed", k3.body?.data?.results?.[0]?.label === "⚠️ Duplicate · Draw", show(k3.body));
  check("none of the three was sent", crm.delta.calls + crm.draw.calls === callsBefore);
  const twice = await sheet([row(UAE, "+971500000099"), row(UAE, "+971 50 000 0099")]);
  const tw = (twice.body?.data?.results ?? []).map((r: Json) => r.status);
  check("the same person twice in one batch: sent once, then a duplicate", show(tw) === show(["sent", "duplicate"]), show(twice.body));
  const sum2 = (await call("GET", "/traffic/summary", undefined, root)).body?.data;
  check("duplicates take no place in the split", seg(sum2, "uk_gcc")?.split === 6, show(seg(sum2, "uk_gcc")));

  // UK & GCC now Delta 3, Draw 3: the next goes to Delta (tie), the one after to Draw.
  await sheet([row(UK, "+447700900010")]);
  crm.draw.mode = "down";
  const downRow = row(UK, "+447700900011");
  const down = await sheet([downRow]);
  const downId = downRow.id;
  const downDoc = await leadDoc(downId);
  check("with Draw down, its lead waits instead of being lost", down.body?.data?.results?.[0]?.label === "⏳ Waiting · Draw"
    && downDoc?.status === "retrying" && downDoc?.attempts === 1 && /Draw answered 503/.test(downDoc?.lastError ?? ""), show(downDoc));
  check("and it will be tried again in a minute", !!downDoc?.nextAttemptAt && new Date(downDoc.nextAttemptAt).getTime() - Date.now() > 50_000, String(downDoc?.nextAttemptAt));
  crm.draw.mode = "ok";
  await TrafficLead.updateOne({ metaId: downId }, { $set: { nextAttemptAt: new Date() } });
  check("when its time comes and Draw is back, the worker sends it", await waitFor(async () => (await leadDoc(downId))?.status === "sent"), show(await leadDoc(downId)));
  check("and the sheet's next pass reads ✅ Draw", (await sheet([downRow])).body?.data?.results?.[0]?.label === "✅ Draw");

  // Next UK & GCC decision: Delta 4, Draw 4 → Delta. Lose its answer.
  crm.delta.mode = "lost";
  const lostRow = row(UK, "+447700900012");
  const lost = await sheet([lostRow]);
  const lostId = lostRow.id;
  check("an answer lost on the way back leaves the lead waiting", lost.body?.data?.results?.[0]?.status === "retrying", show(lost.body));
  await TrafficLead.updateOne({ metaId: lostId }, { $set: { nextAttemptAt: new Date() } });
  check("tried again, Delta says it already has it — and that counts as sent",
    await waitFor(async () => (await leadDoc(lostId))?.status === "sent"), show(await leadDoc(lostId)));
  check("with only one copy in Delta", (await deltaDb.collection("leads").countDocuments({ phone: "+447700900012" })) === 1);

  const pause = async (paused: boolean, uk: [number, number] = [50, 50]) =>
    call("PUT", "/traffic/rules", {
      paused,
      segments: {
        uk_gcc: [{ org: "delta", percent: uk[0], assignToId: null }, { org: "draw", percent: uk[1], assignToId: null }],
        hindi: [{ org: "delta", percent: 50, assignToId: LUBNA }, { org: "draw", percent: 50, assignToId: null }],
      },
    }, root);
  const p1 = await pause(true);
  check("routing can be paused", p1.status === 200 && p1.body?.data?.paused === true, show(p1.body));
  const callsPaused = crm.delta.calls + crm.draw.calls;
  const heldRow = row(UAE, "+971500000013");
  const held = await sheet([heldRow]);
  const heldId = heldRow.id;
  check("a lead that arrives while paused is decided and held", held.body?.data?.results?.[0]?.label?.startsWith("⏸ Paused · ") && (await leadDoc(heldId))?.status === "held", show(held.body));
  await sleep(2500);
  check("and not sent while paused", crm.delta.calls + crm.draw.calls === callsPaused);
  await pause(false);
  check("resuming sends it", await waitFor(async () => (await leadDoc(heldId))?.status === "sent"), show(await leadDoc(heldId)));

  const v = await pause(false, [100, 0]);
  check("the split can change, and a new count starts", v.status === 200 && v.body?.data?.version > 1, show(v.body?.data?.version));
  const all = await sheet([row(UK, "+447700900014"), row(UAE, "+971500000015"), row(GCC, "+966500000016")]);
  check("at 100/0 every UK & GCC lead goes to Delta", (all.body?.data?.results ?? []).every((r: Json) => r.destination === "delta"), show(all.body));
  await pause(false, [50, 50]);

  const tooMany = await sheet(Array.from({ length: 201 }, (_, i) => row(UK, `+4477009${String(10000 + i)}`)));
  check("more than 200 rows at once is refused", tooMany.status === 400, show(tooMany.body));
  check("so is an empty batch", (await sheet([])).status === 400);

  // ── Case 3 ─────────────────────────────────────────────────────────────────
  step("Case 3 — bad rows, a CRM turning one down, wrong keys, bad settings");
  const badRows = [row(UK, "12"), row(UK, "+447700900020", { full_name: "Test Lead — dummy data" }), row(UK, "+447700900021", { created_time: "" })];
  const bad = await sheet(badRows);
  check("rows missing a number, Meta's test leads and undated rows are turned away with a reason",
    show((bad.body?.data?.results ?? []).map((r: Json) => r.label)) === show(["❌ Invalid: No usable phone number", "❌ Invalid: Meta test lead", "❌ Invalid: No created time"]), show(bad.body));
  const fixed = await sheet([{ ...badRows[0], phone_number: "p:+447700900022", full_name: "Fixed Lead" }]);
  check("a row fixed in the sheet comes through on the next pass", fixed.body?.data?.results?.[0]?.status === "sent", show(fixed.body));

  const rejectedRow = row(UK, "+447700900023", { full_name: "BADROW" });
  const rejected = await sheet([rejectedRow]);
  check("a lead the CRM turns down says why", /^❌ Invalid: (Delta|Draw) turned it down: Note cannot exceed 2000 characters/.test(rejected.body?.data?.results?.[0]?.label ?? ""), show(rejected.body));
  const rejDoc = await leadDoc(rejectedRow.id);
  check("and gives its place in the split back", rejDoc?.counted === false, show(rejDoc));

  check("a wrong sheet key is refused", (await sheet([row(UK, "+447700900024")], "not-the-key")).status === 401);
  check("so is no key", (await sheet([row(UK, "+447700900025")], "")).status === 401);
  check("an admin's session is not a sheet key", (await call("POST", "/traffic/intake", { rows: [row(UK, "+447700900026")] }, root)).status === 401);

  crm.delta.mode = "refuse";
  crm.draw.mode = "refuse";
  const refusedRow = row(UK, "+447700900027");
  await sheet([refusedRow]);
  const refDoc = await leadDoc(refusedRow.id);
  check("a CRM refusing the portal's key leaves the lead waiting, and says so", refDoc?.status === "retrying" && /answered 401/.test(refDoc?.lastError ?? ""), show(refDoc));
  crm.delta.mode = "ok";
  crm.draw.mode = "ok";
  const retried = await call("POST", `/traffic/leads/${refDoc?._id}/retry`, undefined, root);
  check("sending it by hand works once the key is right", retried.status === 200 && retried.body?.data?.status === "sent", show(retried.body));
  check("retrying something already sent is refused", (await call("POST", `/traffic/leads/${refDoc?._id}/retry`, undefined, root)).status === 409);
  check("retrying something that does not exist is a 404", (await call("POST", `/traffic/leads/${new Types.ObjectId()}/retry`, undefined, root)).status === 404);

  const putBad = (segments: Json) => call("PUT", "/traffic/rules", { paused: false, segments }, root);
  const good = (d: number, w: number, to: string | null = null) => [{ org: "delta", percent: d, assignToId: to }, { org: "draw", percent: w, assignToId: null }];
  check("shares that do not add up to 100 are refused", (await putBad({ uk_gcc: good(50, 40), hindi: good(50, 50) })).status === 400);
  check("fractions of a percent are refused", (await putBad({ uk_gcc: good(50.5, 49.5), hindi: good(50, 50) })).status === 400);
  check("a segment missing a CRM is refused", (await putBad({ uk_gcc: [{ org: "delta", percent: 100, assignToId: null }], hindi: good(50, 50) })).status === 400);
  check("handing leads to somebody inactive in that CRM is refused", (await putBad({ uk_gcc: good(50, 50), hindi: good(50, 50, String(old)) })).status === 400);
  const audit = await db.collection("auditlogs").find({ action: "traffic_rules_changed" }).toArray();
  check("every saved change is in the audit log", audit.length >= 4 && audit.every((x) => x.adminEmail === "root@traffic-e2e.test"), `${audit.length} rows`);
  check("and so is the lead sent by hand", (await db.collection("auditlogs").countDocuments({ action: "traffic_lead_retried" })) === 1);

  // ── Case 4 ─────────────────────────────────────────────────────────────────
  step("Case 4 — who may see and change it");
  for (const path of ["/traffic/rules", "/traffic/summary", "/traffic/leads", "/traffic/crm-users/delta"]) {
    check(`${path}: no session → 401`, (await call("GET", path)).status === 401);
    check(`${path}: a member → 403`, (await call("GET", path, undefined, member)).status === 403);
  }
  check("a member cannot change the split", (await call("PUT", "/traffic/rules", { paused: true, segments: {} }, member)).status === 403);
  const rules = (await call("GET", "/traffic/rules", undefined, root)).body?.data;
  const hindiDeltaShare = rules?.segments?.find((s: Json) => s.key === "hindi")?.shares?.find((s: Json) => s.org === "delta");
  check("the settings say Delta's Hindi share goes to Lubna, and nothing is missing", hindiDeltaShare?.assignTo?.id === LUBNA
    && rules?.sheetKeySet === true && rules?.crms?.every((c: Json) => c.missing.length === 0), show(rules));
  const people = (await call("GET", "/traffic/crm-users/delta", undefined, root)).body?.data ?? [];
  check("the people to pick from are Delta's active ones", people.some((p: Json) => p.id === LUBNA) && !people.some((p: Json) => p.id === String(old)), show(people));
  check("an unknown CRM is a 404", (await call("GET", "/traffic/crm-users/banglore", undefined, root)).status === 404);

  console.log(`\n${checks - failures}/${checks} checks passed`);
  for (const s of servers) s.close();
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
