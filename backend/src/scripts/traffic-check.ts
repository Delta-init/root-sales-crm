/**
 * Drives lead traffic end to end: the lead sheets posting into the portal over
 * HTTP, the split, and what each CRM's intake is sent.
 *
 * What it proves:
 *   - the split kept before there was more than one sheet — as it is live on
 *     30 September 2026 — becomes Abhin's, with its percentages, its person
 *     and its count;
 *   - Abhin's sheet, posting as its deployed script does without naming
 *     itself, is split segment by segment as before, the Hindi leads Delta
 *     takes go to one person, and each CRM gets the fields and source labels
 *     the sheet used to send it directly;
 *   - Shoaib's sheet is split 15.38 / 61.54 / 23.08 between three teams, two
 *     of them in Delta — every 13 leads are 2, 8 and 3 — the Dilshad team's
 *     going straight to Nusra, with the sheet's own source label, and the
 *     trading-knowledge answer and ad set in place of the ad name;
 *   - somebody already in either CRM — however the number was typed — or
 *     already sent from either sheet goes back to where they are, and takes no
 *     place in the split;
 *   - resending the same row changes nothing and sends nothing;
 *   - a CRM that is down, loses the answer, or refuses the key does not lose
 *     the lead: it waits, and the worker sends it once it can;
 *   - pausing one sheet holds its leads and not the other's; changing one
 *     segment's split starts that segment's count again and no other's;
 *   - bad rows are turned away with a reason and come through once fixed;
 *   - only the sheet key opens the intake, an unknown sheet is turned away,
 *     and only people given lead-traffic access see the rest;
 *   - the Dilshad team moves to its own CRM, remote, straight to Nusra's
 *     account there, without its count starting again; somebody the remote
 *     CRM already has goes back to it; Abhin's sheet is not bothered by it;
 *   - the Leads list keeps to the dates the page picks — Gulf days, as the
 *     totals count them — and without dates lists everything, as before;
 *   - TRADING-LEADS NITRO, the DRAW LEAD SHEET, sends every lead to the Sales
 *     CRM as its own script did — rows typed in by hand too — under the ID
 *     its script writes, and somebody another CRM has stays there.
 *
 * Run through scripts/traffic-check.sh (throwaway mongod, the real backend, and
 * stand-in CRMs served from here). With `seed` it only writes the old split
 * and leads into the scratch database, before the backend starts — as they
 * will be there when the new version is deployed over them.
 */
import http from "node:http";
import mongoose, { Types } from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
for (const [name, value] of [
  ["MONGODB_URI", uri],
  ["DELTA_MONGODB_URI", process.env.DELTA_MONGODB_URI ?? ""],
  ["DRAW_MONGODB_URI", process.env.DRAW_MONGODB_URI ?? ""],
  ["REMOTE_MONGODB_URI", process.env.REMOTE_MONGODB_URI ?? ""],
] as const) {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(value)) {
    console.error(`Refusing to run: ${name} must be a scratch e2e database on 127.0.0.1, got "${value}"`);
    process.exit(1);
  }
}

const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const SHEET_KEY = process.env.LEAD_TRAFFIC_SHEET_KEY ?? "";
const LUBNA = "6a7d78a7aa93812c05d38466";
const VANDANA = "6a5b1786c1b944ae77c10f87";
const NUSRA = "69ecc78e9e1a9d99d1607c95";
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
const post = (body: unknown, key = SHEET_KEY) => call("POST", "/traffic/intake", body, key ? { "x-traffic-key": key } : {});
/** As Abhin's deployed script posts: without naming the sheet. */
const abhin = (rows: unknown, key = SHEET_KEY) => post({ rows }, key);
const shoaib = (rows: unknown) => post({ sheet: "shoaib", rows });

// ── Before the backend starts: the old split and leads, as they are live ─────

const OLD = new Date("2026-09-30T12:52:44Z");
const legacyLead = (key: string, phone: string, extra: Record<string, unknown> = {}) => ({
  sourceKey: key, metaId: key, tab: "Abhin | NORMAL LEADS  | New | 1", segment: "gcc", source: "FOREX LEADS ALPHA GCC",
  name: "Old lead", phone, phone9: phone.slice(-9), email: "", platform: "meta", campaign: "", adName: "", isOrganic: false,
  createdTime: OLD, destination: "delta", reason: "split", counted: true, ruleVersion: 3, assignTo: null, status: "sent",
  crmLeadId: "", note: "", attempts: 1, nextAttemptAt: null, claimedAt: null, lastError: "", sentAt: OLD, receivedAt: OLD,
  createdAt: OLD, updatedAt: OLD, ...extra,
});

async function seed() {
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  const db = mongoose.connection.db!;
  // The one rule, "sheet", as it is live: version 3, Hindi all Vandana's —
  // paused here, so the check that its count carries on sends nothing.
  await db.collection("trafficrules").insertOne({
    key: "sheet", paused: true, version: 3, reporters: { delta: REPORTER, draw: "" }, updatedBy: null, updatedByEmail: "",
    segments: {
      hindi: [{ org: "delta", percent: 100, assignTo: { id: VANDANA, name: "vandanavikraman" } }, { org: "draw", percent: 0, assignTo: null }],
      gcc: [{ org: "delta", percent: 50, assignTo: null }, { org: "draw", percent: 50, assignTo: null }],
      uk: [{ org: "delta", percent: 50, assignTo: null }, { org: "draw", percent: 50, assignTo: null }],
    },
    createdAt: OLD, updatedAt: OLD,
  });
  await db.collection("trafficleads").insertMany([
    // Delta's, in this version: GCC stands at Delta 1, Draw 0.
    legacyLead("legacy-1", "+971598888881"),
    // Draw's, in the version before: not counted now.
    legacyLead("legacy-2", "+971598888882", { destination: "draw", ruleVersion: 2 }),
    // Already in Draw, so sent back there outside the split.
    legacyLead("legacy-3", "+971598888883", { destination: "draw", reason: "known", counted: false, status: "duplicate", ruleVersion: 0 }),
  ]);
  await mongoose.disconnect();
  console.log("  the old split and leads are in place");
}

// ── Stand-in CRMs: their sheet intake, as the real ones answer it ───────────

type Mode = "ok" | "down" | "refuse" | "lost";
const crm = {
  delta: { mode: "ok" as Mode, calls: 0, rows: [] as Json[], key: process.env.DELTA_SHEETS_API_KEY ?? "", port: Number(process.env.E2E_DELTA_PORT) },
  draw: { mode: "ok" as Mode, calls: 0, rows: [] as Json[], key: process.env.DRAW_SHEETS_API_KEY ?? "", port: Number(process.env.E2E_DRAW_PORT) },
  remote: { mode: "ok" as Mode, calls: 0, rows: [] as Json[], key: process.env.REMOTE_SHEETS_API_KEY ?? "", port: Number(process.env.E2E_REMOTE_PORT) },
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
  const remoteDb = (await mongoose.createConnection(process.env.REMOTE_MONGODB_URI!).asPromise()).db!;
  const crmDb = { delta: deltaDb, draw: drawDb, remote: remoteDb };

  const servers = (["delta", "draw", "remote"] as const).map((org) =>
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
  for (const [code, name] of [["delta", "Delta CRM"], ["draw", "Draw CRM"], ["remote", "Remote CRM"]] as const) {
    await Organization.create({ code, kind: "crm", name, timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true });
  }
  await AdminUser.create({ name: "Root E2E", email: "root@traffic-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@traffic-e2e.test", password: PASSWORD, role: "member", status: "active" });
  const old = new Types.ObjectId();
  await deltaDb.collection("users").insertMany([
    { _id: new Types.ObjectId(LUBNA), name: "lubna", email: "lubna@delta-e2e.test", status: "active" },
    { _id: new Types.ObjectId(VANDANA), name: "vandanavikraman", email: "vandana@delta-e2e.test", status: "active" },
    { _id: new Types.ObjectId(NUSRA), name: "Nusra", email: "nusra@delta-e2e.test", status: "active" },
    { _id: new Types.ObjectId(REPORTER), name: "Sheets Reporter", email: "reporter@delta-e2e.test", status: "active" },
    { _id: new Types.ObjectId(), name: "Asha", email: "asha@delta-e2e.test", status: "active" },
    { _id: old, name: "Old Hand", email: "old@delta-e2e.test", status: "inactive" },
  ]);
  const anagha = new Types.ObjectId();
  await drawDb.collection("users").insertMany([{ _id: anagha, name: "Anagha", email: "anagha@draw-e2e.test", status: "active" }]);
  // Nusra has an account of her own in the remote CRM, with its own id.
  const NUSRA_REMOTE = String(new Types.ObjectId());
  await remoteDb.collection("users").insertMany([{ _id: new Types.ObjectId(NUSRA_REMOTE), name: "Nusra", email: "nusra@remote-e2e.test", status: "active" }]);
  await remoteDb.collection("leads").insertOne({ name: "Known to Remote", phone: "+971509999001", createdAt: new Date("2026-09-30") });
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

  // The settings, sheet by sheet.
  const allRules = async () => (await call("GET", "/traffic/rules", undefined, root)).body?.data;
  const sheetIn = (rules: Json, key: string) => rules?.sheets?.find((s: Json) => s.key === key);
  const rulesOf = async (key: string) => sheetIn(await allRules(), key);
  const segOf = (sheet: Json, seg: string) => sheet?.segments?.find((s: Json) => s.key === seg);
  const teamOf = (sheet: Json, seg: string, key: string) => segOf(sheet, seg)?.shares?.find((s: Json) => s.key === key);

  /** Delta's percent, Draw's, and who takes Delta's leads. */
  type Pair = [number, number, string?];
  const abhinTeams = ([d, w, to]: Pair) => [
    { key: "delta", name: "Delta sales team", org: "delta", percent: d, assignToId: to ?? null },
    { key: "draw", name: "Draw department", org: "draw", percent: w, assignToId: null },
  ];
  const abhinSplit = (o: { uk?: Pair; gcc?: Pair; hindi?: Pair } = {}) => ({
    uk: abhinTeams(o.uk ?? [50, 50]),
    gcc: abhinTeams(o.gcc ?? [50, 50]),
    hindi: abhinTeams(o.hindi ?? [50, 50, LUBNA]),
  });
  const putAbhin = (o: { paused?: boolean; uk?: Pair; gcc?: Pair; hindi?: Pair } = {}, as = root) =>
    call("PUT", "/traffic/rules/abhin", { paused: o.paused ?? false, segments: abhinSplit(o) }, as);

  // ── Case 0 ─────────────────────────────────────────────────────────────────
  step("Case 0 — the split kept before there were two sheets becomes Abhin's");
  const live = await rulesOf("abhin");
  check("every segment keeps its version, so its count carries on where it is",
    ["uk", "gcc", "hindi"].every((k) => segOf(live, k)?.version === 3), show(live?.segments?.map((s: Json) => [s.key, s.version])));
  check("Hindi stays all Vandana's, and Draw's 0% of it is kept", teamOf(live, "hindi", "delta")?.percent === 100
    && teamOf(live, "hindi", "delta")?.assignTo?.id === VANDANA && teamOf(live, "hindi", "draw")?.percent === 0, show(segOf(live, "hindi")));
  check("UK and GCC stay half and half, each CRM's share now a named team",
    teamOf(live, "uk", "delta")?.percent === 50 && teamOf(live, "uk", "delta")?.name === "Delta sales team"
    && teamOf(live, "gcc", "draw")?.percent === 50 && teamOf(live, "gcc", "draw")?.name === "Draw department", show(live?.segments));
  check("its pause and the account Delta's leads are added by come with it",
    live?.paused === true && (await db.collection("trafficrules").findOne({ key: "abhin" }))?.reporters?.delta === REPORTER);
  const oldRule = await db.collection("trafficrules").findOne({ key: "sheet" });
  check("the old rule is kept as it was, marked converted, for the previous version to find if it is put back",
    !!oldRule?.convertedAt && oldRule?.segments?.hindi?.[0]?.assignTo?.id === VANDANA, show(oldRule));
  const [l1, l2, l3] = await Promise.all(["legacy-1", "legacy-2", "legacy-3"].map((k) => db.collection("trafficleads").findOne({ sourceKey: k })));
  check("the leads so far are Abhin's, counted for their CRM's team — and one sent back where it was, for none",
    l1?.sheet === "abhin" && l1?.share === "delta" && l2?.share === "draw" && l3?.sheet === "abhin" && l3?.share === "",
    show([l1?.sheet, l1?.share, l2?.share, l3?.share]));
  const sheet0 = await rulesOf("shoaib");
  check("Shoaib's sheet has a split of its own from the start", segOf(sheet0, "all")?.shares?.length === 3, show(sheet0));
  const carryOn = {
    id: "l:900", tab: UAE, created_time: "2026-09-30T13:00:00+0400", full_name: "Carry On", phone_number: "p:+971598888884",
    email: "", platform: "fb", campaign_name: "", ad_name: "", is_organic: "false",
  };
  const cont = await abhin([carryOn]);
  check("GCC stands at Delta 1, Draw 0 in this version, so the next GCC lead is Draw's — held, as the sheet is paused",
    cont.body?.data?.results?.[0]?.destination === "draw" && cont.body?.data?.results?.[0]?.label === "⏸ Paused · Draw", show(cont.body));
  await db.collection("trafficleads").deleteMany({ sourceKey: { $in: ["legacy-1", "legacy-2", "legacy-3", "meta:l:900"] } });
  const reset = await putAbhin();
  const resetSheet = sheetIn(reset.body?.data, "abhin");
  check("it can be set to half and half everywhere, Hindi's Delta half to Lubna", reset.status === 200
    && teamOf(resetSheet, "hindi", "delta")?.assignTo?.id === LUBNA && resetSheet?.paused === false, show(reset.body));
  check("which starts Hindi's count again, and not UK's or GCC's",
    segOf(resetSheet, "hindi")?.version === 4 && segOf(resetSheet, "uk")?.version === 3 && segOf(resetSheet, "gcc")?.version === 3,
    show(resetSheet?.segments?.map((s: Json) => [s.key, s.version])));

  // ── Case 1 ─────────────────────────────────────────────────────────────────
  step("Case 1 — Abhin's sheet: the split, the fields each CRM gets, and resending");
  const ping = await call("GET", "/traffic/intake/ping", undefined, { "x-traffic-key": SHEET_KEY });
  check("the connection test naming no sheet is Abhin's: routing on, both CRMs ready", ping.status === 200
    && ping.body?.data?.sheet === "abhin" && ping.body?.data?.paused === false && ping.body?.data?.crms?.every((c: Json) => c.ready), show(ping.body));

  const batchA = [row(UK, "+44 7700 900001"), row(UK, "+447700900002"), row(UAE, "+971500000003"), row(UAE, "+971500000004")];
  const a = await abhin(batchA);
  const destA = (a.body?.data?.results ?? []).map((r: Json) => r.destination);
  check("UK and GCC each take turns: UK Delta, Draw; GCC Delta, Draw", a.status === 200 && show(destA) === show(["delta", "draw", "delta", "draw"]), show(a.body));
  check("and the sheet is told where each went", show((a.body?.data?.results ?? []).map((r: Json) => r.label)) === show(["✅ Delta", "✅ Draw", "✅ Delta", "✅ Draw"]));
  const d0 = crm.delta.rows[0];
  check("Delta gets the sheet's fields, cleaned", d0?.full_name === "Lead 1" && d0?.phone_number === "+447700900001" && d0?.platform === "instagram"
    && d0?.id === "l:1001" && d0?.email === "lead1@example.test" && d0?.created_time === new Date(batchA[0].created_time).toISOString()
    && d0?.campaign_name === "Abhin | Delta UK CAMPAIGNS" && d0?.ad_creative === "Ad A", show(d0));
  check("with the UK source label and the sheet's reporter, and nobody named", d0?.source === "FOREX LEADS ALPHA UK" && d0?.reporter === REPORTER && !("assigned_to" in (d0 ?? {})), show(d0));
  check("a UAE/Qatar tab lead carries the GCC label", crm.delta.rows[1]?.source === "FOREX LEADS ALPHA GCC", show(crm.delta.rows[1]));
  check("Draw gets no reporter — it records its own", crm.draw.rows.length === 2 && crm.draw.rows.every((r) => !("reporter" in r)), show(crm.draw.rows));

  const b = await abhin([row(HINDI, "+919800000005"), row(HINDI, "+919800000006")]);
  check("Hindi is split on its own: Delta, then Draw", show((b.body?.data?.results ?? []).map((r: Json) => r.destination)) === show(["delta", "draw"]), show(b.body));
  const hindiDelta = crm.delta.rows.at(-1);
  check("Delta's Hindi lead goes straight to Lubna, with the Hindi label", hindiDelta?.assigned_to === LUBNA && hindiDelta?.source === "FOREX LEADS ALPHA HINDI", show(hindiDelta));
  check("and the sheet is told so", b.body?.data?.results?.[0]?.label === "✅ Delta → lubna", show(b.body?.data?.results?.[0]));
  check("Draw's Hindi lead names nobody", !("assigned_to" in (crm.draw.rows.at(-1) ?? {})), show(crm.draw.rows.at(-1)));

  const g = await post({ sheet: "abhin", rows: [row(GCC, "+966500000007")] });
  check("naming the sheet works the same: the GCC tab counts with UAE & Qatar, labelled GCC, and at 1–1 the tie goes to Delta",
    g.body?.data?.results?.[0]?.destination === "delta" && crm.delta.rows.at(-1)?.source === "FOREX LEADS ALPHA GCC", show(g.body));

  const callsBefore = crm.delta.calls + crm.draw.calls;
  const again = await abhin(batchA);
  check("resending the same rows gives the same answers", show((again.body?.data?.results ?? []).map((r: Json) => r.label)) === show(["✅ Delta", "✅ Draw", "✅ Delta", "✅ Draw"]), show(again.body));
  check("and sends nothing", crm.delta.calls + crm.draw.calls === callsBefore);

  const sum1 = (await call("GET", "/traffic/summary", undefined, root)).body?.data;
  const seg = (s: Json, key: string) => s?.segments?.find((x: Json) => x.key === key);
  const share = (s: Json, key: string, team: string) => seg(s, key)?.shares?.find((x: Json) => x.key === team);
  check("today's numbers: UK Delta 1 and Draw 1 (50/50); GCC Delta 2 (66.7%) and Draw 1, against 50/50",
    share(sum1, "uk", "delta")?.split === 1 && share(sum1, "uk", "delta")?.actual === 50 && share(sum1, "uk", "draw")?.split === 1
    && share(sum1, "gcc", "delta")?.split === 2 && share(sum1, "gcc", "delta")?.actual === 66.7 && share(sum1, "gcc", "draw")?.split === 1
    && share(sum1, "gcc", "delta")?.target === 50, show(sum1?.segments));
  check("three segments are reported, each team with its CRM", sum1?.segments?.map((x: Json) => x.key).join(",") === "uk,gcc,hindi"
    && share(sum1, "uk", "delta")?.crm === "Delta CRM" && share(sum1, "uk", "draw")?.name === "Draw department", show(sum1?.segments?.[0]));
  check("Hindi 1 and 1; seven sent in all", share(sum1, "hindi", "delta")?.split === 1 && share(sum1, "hindi", "draw")?.split === 1 && sum1?.totals?.sent === 7, show(sum1?.totals));
  const list1 = (await call("GET", "/traffic/leads?limit=50", undefined, root)).body?.data;
  check("the list shows them newest first, numbers masked, with their team", list1?.total === 7 && list1?.items?.[0]?.name === "Lead 7"
    && String(list1?.items?.[0]?.phone).includes("•") && list1?.items?.[0]?.team === "Delta sales team", show(list1?.items?.[0]));

  // ── Case 2 ─────────────────────────────────────────────────────────────────
  step("Case 2 — people already somewhere, a CRM down, a lost answer, pausing, a new split");
  const k1 = await abhin([row(UAE, "+971502222222")]);
  check("somebody Draw already has (typed 050…) goes back to Draw as a duplicate", k1.body?.data?.results?.[0]?.label === "⚠️ Duplicate · Draw", show(k1.body));
  const k2 = await abhin([row(UAE, "0501111111")]);
  check("somebody Delta already has (typed +971…) goes back to Delta", k2.body?.data?.results?.[0]?.label === "⚠️ Duplicate · Delta", show(k2.body));
  const k3 = await abhin([row(UK, "07700900002")]);
  check("somebody sent from here before goes where they went, however typed", k3.body?.data?.results?.[0]?.label === "⚠️ Duplicate · Draw", show(k3.body));
  check("none of the three was sent", crm.delta.calls + crm.draw.calls === callsBefore);
  const twice = await abhin([row(UAE, "+971500000099"), row(UAE, "+971 50 000 0099")]);
  const tw = (twice.body?.data?.results ?? []).map((r: Json) => r.status);
  check("the same person twice in one batch: sent once, then a duplicate", show(tw) === show(["sent", "duplicate"]), show(twice.body));
  const sum2 = (await call("GET", "/traffic/summary", undefined, root)).body?.data;
  check("duplicates take no place in the split", seg(sum2, "uk")?.split === 2 && seg(sum2, "gcc")?.split === 4, show(sum2?.segments));
  // GCC: the one Draw had, the one Delta had, and the second of the pair — sent back after the first.
  check("and are counted as sent back to their CRM", seg(sum2, "gcc")?.known?.find((k: Json) => k.org === "draw")?.count === 2
    && seg(sum2, "gcc")?.known?.find((k: Json) => k.org === "delta")?.count === 1, show(seg(sum2, "gcc")?.known));

  // UK now Delta 1, Draw 1: the next UK lead goes to Delta (tie), the one after to Draw.
  await abhin([row(UK, "+447700900010")]);
  crm.draw.mode = "down";
  const downRow = row(UK, "+447700900011");
  const down = await abhin([downRow]);
  const downId = downRow.id;
  const downDoc = await leadDoc(downId);
  check("with Draw down, its lead waits instead of being lost", down.body?.data?.results?.[0]?.label === "⏳ Waiting · Draw"
    && downDoc?.status === "retrying" && downDoc?.attempts === 1 && /Draw answered 503/.test(downDoc?.lastError ?? ""), show(downDoc));
  check("and it will be tried again in a minute", !!downDoc?.nextAttemptAt && new Date(downDoc.nextAttemptAt).getTime() - Date.now() > 50_000, String(downDoc?.nextAttemptAt));
  crm.draw.mode = "ok";
  await TrafficLead.updateOne({ metaId: downId }, { $set: { nextAttemptAt: new Date() } });
  check("when its time comes and Draw is back, the worker sends it", await waitFor(async () => (await leadDoc(downId))?.status === "sent"), show(await leadDoc(downId)));
  check("and the sheet's next pass reads ✅ Draw", (await abhin([downRow])).body?.data?.results?.[0]?.label === "✅ Draw");

  // Next UK decision: Delta 2, Draw 2 → Delta. Lose its answer.
  crm.delta.mode = "lost";
  const lostRow = row(UK, "+447700900012");
  const lost = await abhin([lostRow]);
  const lostId = lostRow.id;
  check("an answer lost on the way back leaves the lead waiting", lost.body?.data?.results?.[0]?.status === "retrying", show(lost.body));
  await TrafficLead.updateOne({ metaId: lostId }, { $set: { nextAttemptAt: new Date() } });
  check("tried again, Delta says it already has it — and that counts as sent",
    await waitFor(async () => (await leadDoc(lostId))?.status === "sent"), show(await leadDoc(lostId)));
  check("with only one copy in Delta", (await deltaDb.collection("leads").countDocuments({ phone: "+447700900012" })) === 1);

  const p1 = await putAbhin({ paused: true });
  check("routing can be paused", p1.status === 200 && sheetIn(p1.body?.data, "abhin")?.paused === true, show(p1.body));
  const callsPaused = crm.delta.calls + crm.draw.calls;
  const heldRow = row(UAE, "+971500000013");
  const held = await abhin([heldRow]);
  const heldId = heldRow.id;
  check("a lead that arrives while paused is decided and held", held.body?.data?.results?.[0]?.label?.startsWith("⏸ Paused · ") && (await leadDoc(heldId))?.status === "held", show(held.body));
  await sleep(2500);
  check("and not sent while paused", crm.delta.calls + crm.draw.calls === callsPaused);
  await putAbhin();
  check("resuming sends it", await waitFor(async () => (await leadDoc(heldId))?.status === "sent"), show(await leadDoc(heldId)));

  const before2 = await rulesOf("abhin");
  const v = await putAbhin({ uk: [100, 0], gcc: [100, 0] });
  const after2 = sheetIn(v.body?.data, "abhin");
  check("the split can change: UK and GCC start a new count, and Hindi's is left alone", v.status === 200
    && segOf(after2, "uk")?.version === segOf(before2, "uk")?.version + 1 && segOf(after2, "gcc")?.version === segOf(before2, "gcc")?.version + 1
    && segOf(after2, "hindi")?.version === segOf(before2, "hindi")?.version, show(after2?.segments?.map((s: Json) => [s.key, s.version])));
  const all100 = await abhin([row(UK, "+447700900014"), row(UAE, "+971500000015"), row(GCC, "+966500000016")]);
  check("at 100/0 every UK and GCC lead goes to Delta", (all100.body?.data?.results ?? []).every((r: Json) => r.destination === "delta"), show(all100.body));
  await putAbhin();

  const tooMany = await abhin(Array.from({ length: 201 }, (_, i) => row(UK, `+4477009${String(10000 + i)}`)));
  check("more than 200 rows at once is refused", tooMany.status === 400, show(tooMany.body));
  check("so is an empty batch", (await abhin([])).status === 400);

  // ── Case 3 ─────────────────────────────────────────────────────────────────
  step("Case 3 — bad rows, a CRM turning one down, wrong keys, bad settings");
  const badRows = [row(UK, "12"), row(UK, "+447700900020", { full_name: "Test Lead — dummy data" }), row(UK, "+447700900021", { created_time: "" })];
  const bad = await abhin(badRows);
  check("rows missing a number, Meta's test leads and undated rows are turned away with a reason",
    show((bad.body?.data?.results ?? []).map((r: Json) => r.label)) === show(["❌ Invalid: No usable phone number", "❌ Invalid: Meta test lead", "❌ Invalid: No created time"]), show(bad.body));
  const fixed = await abhin([{ ...badRows[0], phone_number: "p:+447700900022", full_name: "Fixed Lead" }]);
  check("a row fixed in the sheet comes through on the next pass", fixed.body?.data?.results?.[0]?.status === "sent", show(fixed.body));

  const rejectedRow = row(UK, "+447700900023", { full_name: "BADROW" });
  const rejected = await abhin([rejectedRow]);
  check("a lead the CRM turns down says why", /^❌ Invalid: (Delta|Draw) turned it down: Note cannot exceed 2000 characters/.test(rejected.body?.data?.results?.[0]?.label ?? ""), show(rejected.body));
  const rejDoc = await leadDoc(rejectedRow.id);
  check("and gives its place in the split back", rejDoc?.counted === false, show(rejDoc));

  check("a wrong sheet key is refused", (await abhin([row(UK, "+447700900024")], "not-the-key")).status === 401);
  check("so is no key", (await abhin([row(UK, "+447700900025")], "")).status === 401);
  check("an admin's session is not a sheet key", (await call("POST", "/traffic/intake", { rows: [row(UK, "+447700900026")] }, root)).status === 401);

  crm.delta.mode = "refuse";
  crm.draw.mode = "refuse";
  const refusedRow = row(UK, "+447700900027");
  await abhin([refusedRow]);
  const refDoc = await leadDoc(refusedRow.id);
  check("a CRM refusing the portal's key leaves the lead waiting, and says so", refDoc?.status === "retrying" && /answered 401/.test(refDoc?.lastError ?? ""), show(refDoc));
  crm.delta.mode = "ok";
  crm.draw.mode = "ok";
  const retried = await call("POST", `/traffic/leads/${refDoc?._id}/retry`, undefined, root);
  check("sending it by hand works once the key is right", retried.status === 200 && retried.body?.data?.status === "sent", show(retried.body));
  check("retrying something already sent is refused", (await call("POST", `/traffic/leads/${refDoc?._id}/retry`, undefined, root)).status === 409);
  check("retrying something that does not exist is a 404", (await call("POST", `/traffic/leads/${new Types.ObjectId()}/retry`, undefined, root)).status === 404);

  const putBad = (segments: Json, sheet = "abhin") => call("PUT", `/traffic/rules/${sheet}`, { paused: false, segments }, root);
  const good = (d: number, w: number, to: string | null = null) => abhinTeams([d, w, to ?? undefined]);
  check("shares that do not add up to 100 are refused", (await putBad({ uk: good(50, 40), gcc: good(50, 50), hindi: good(50, 50) })).status === 400);
  check("more than two decimals are refused", (await putBad({ uk: good(50.555, 49.445), gcc: good(50, 50), hindi: good(50, 50) })).status === 400);
  check("a split missing a segment is refused", (await putBad({ uk: good(50, 50), hindi: good(50, 50) })).status === 400);
  check("a segment with no teams is refused", (await putBad({ uk: [], gcc: good(50, 50), hindi: good(50, 50) })).status === 400);
  check("two teams of one name are refused", (await putBad({
    uk: [good(50, 50)[0], { ...good(50, 50)[1], name: "delta sales team" }], gcc: good(50, 50), hindi: good(50, 50),
  })).status === 400);
  check("a segment the sheet does not have is refused", (await putBad({ ...abhinSplit(), all: good(50, 50) })).status === 400);
  check("handing leads to somebody inactive in that CRM is refused", (await putBad({ uk: good(50, 50), gcc: good(50, 50), hindi: good(50, 50, String(old)) })).status === 400);
  check("a sheet that does not exist is a 404", (await putBad(abhinSplit(), "nope")).status === 404);
  const audit = await db.collection("auditlogs").find({ action: "traffic_rules_changed" }).toArray();
  check("every saved change is in the audit log, naming the sheet", audit.length >= 4
    && audit.every((x) => x.adminEmail === "root@traffic-e2e.test" && String(x.detail).startsWith("Abhin — Meta leads")), `${audit.length} rows: ${show(audit[0]?.detail)}`);
  check("and so is the lead sent by hand", (await db.collection("auditlogs").countDocuments({ action: "traffic_lead_retried" })) === 1);

  // ── Case 4 ─────────────────────────────────────────────────────────────────
  step("Case 4 — who may see and change it");
  for (const path of ["/traffic/rules", "/traffic/summary", "/traffic/leads", "/traffic/crm-users/delta"]) {
    check(`${path}: no session → 401`, (await call("GET", path)).status === 401);
    check(`${path}: a member → 403`, (await call("GET", path, undefined, member)).status === 403);
  }
  check("a member cannot change the split", (await call("PUT", "/traffic/rules/abhin", { paused: true, segments: {} }, member)).status === 403);
  const rules = await allRules();
  check("the settings say Delta's Hindi share goes to Lubna, and nothing is missing",
    teamOf(sheetIn(rules, "abhin"), "hindi", "delta")?.assignTo?.id === LUBNA
    && rules?.sheetKeySet === true && rules?.crms?.every((c: Json) => c.missing.length === 0), show(rules));
  const people = (await call("GET", "/traffic/crm-users/delta", undefined, root)).body?.data ?? [];
  check("the people to pick from are Delta's active ones", people.some((p: Json) => p.id === LUBNA) && !people.some((p: Json) => p.id === String(old)), show(people));
  check("an unknown CRM is a 404", (await call("GET", "/traffic/crm-users/banglore", undefined, root)).status === 404);

  step("Case 4b — lead-traffic access for people who are not root admins");
  const memberRow = await AdminUser.findOne({ email: "member@traffic-e2e.test" }).lean();
  const rootRow = await AdminUser.findOne({ email: "root@traffic-e2e.test" }).lean();
  const setAccess = (id: unknown, access: string, as = root) => call("PATCH", `/access/${String(id)}/traffic`, { access }, as);
  check("a member cannot hand out lead-traffic access", (await setAccess(memberRow?._id, "view", member)).status === 403);
  check("nor can anybody be given a level that does not exist", (await setAccess(memberRow?._id, "admin")).status === 400);
  check("a root admin already has it all, so theirs is not set", (await setAccess(rootRow?._id, "view")).status === 409);
  const gaveView = await setAccess(memberRow?._id, "view");
  check("a root admin gives a member View", gaveView.status === 200 && gaveView.body?.data?.trafficAccess === "view", show(gaveView.body));
  check("which takes effect at once, on the session they already have",
    (await call("GET", "/traffic/summary?sheet=shoaib", undefined, member)).status === 200 && (await call("GET", "/traffic/leads", undefined, member)).status === 200
    && (await call("GET", "/traffic/rules", undefined, member)).status === 200);
  check("and their session says so", (await call("GET", "/auth/me", undefined, member)).body?.data?.trafficAccess === "view");
  check("View cannot change the split", (await putAbhin({}, member)).status === 403);
  check("…send a lead by hand", (await call("POST", `/traffic/leads/${refDoc?._id}/retry`, undefined, member)).status === 403);
  check("…or list a CRM's people", (await call("GET", "/traffic/crm-users/delta", undefined, member)).status === 403);
  check("nor see who is who in the Users area", (await call("GET", "/access/people", undefined, member)).status === 403);
  const gaveManage = await setAccess(memberRow?._id, "manage");
  check("Manage can change the split", gaveManage.status === 200 && (await putAbhin({}, member)).status === 200);
  check("…and list a CRM's people, and get as far as a retry", (await call("GET", "/traffic/crm-users/delta", undefined, member)).status === 200
    && (await call("POST", `/traffic/leads/${refDoc?._id}/retry`, undefined, member)).status === 409);
  await setAccess(memberRow?._id, "none");
  check("taking it away takes effect at once too", (await call("GET", "/traffic/summary", undefined, member)).status === 403);
  const accessAudit = await db.collection("auditlogs").find({ action: "traffic_access_changed" }).toArray();
  check("every change of access is in the audit log", accessAudit.length === 3 && accessAudit.every((x) => x.adminEmail === "root@traffic-e2e.test"), `${accessAudit.length} rows`);

  // ── Case 5 ─────────────────────────────────────────────────────────────────
  step("Case 5 — Shoaib's Forex sheet: three teams, two of them in Delta");
  const abhinReceived = (await call("GET", "/traffic/summary", undefined, root)).body?.data?.totals?.received;
  const sh = await rulesOf("shoaib");
  check("it starts at Delta sales team 15.38%, Draw department 61.54%, Dilshad team 23.08%",
    show(segOf(sh, "all")?.shares?.map((s: Json) => [s.key, s.name, s.org, s.percent])) === show([
      ["delta", "Delta sales team", "delta", 15.38], ["draw", "Draw department", "draw", 61.54], ["dilshad", "Dilshad team", "delta", 23.08],
    ]), show(segOf(sh, "all")?.shares));
  check("the Dilshad team's leads go into Delta, straight to Nusra; the others to nobody in particular",
    teamOf(sh, "all", "dilshad")?.assignTo?.id === NUSRA && !teamOf(sh, "all", "delta")?.assignTo && !teamOf(sh, "all", "draw")?.assignTo);
  check("each CRM records them as FOREX LEADS SEIRRA", segOf(sh, "all")?.source === "FOREX LEADS SEIRRA");
  const shPing = await call("GET", "/traffic/intake/ping?sheet=shoaib", undefined, { "x-traffic-key": SHEET_KEY });
  check("its connection test knows which sheet it is", shPing.status === 200 && shPing.body?.data?.name === "Shoaib — Forex leads" && shPing.body?.data?.paused === false, show(shPing.body));

  let m = 0;
  const srow = (phone: string, extra: Record<string, unknown> = {}) => {
    m++;
    return {
      id: `s:${2000 + m}`, tab: "Sheet1", created_time: `2026-09-30T0${m % 10}:30:00-05:00`, full_name: `Forex ${m}`,
      phone_number: `p:${phone}`, email: `forex${m}@example.test`, platform: m % 2 ? "fb" : "ig",
      campaign_name: "FOREX-Leads|KSA|18/09/2026 –", ad_name: "Ad S", adset_name: "KSA broad", knowledge: "beginner",
      is_organic: "false", ...extra,
    };
  };
  check("an unknown sheet is turned away, on the test and on the intake",
    (await call("GET", "/traffic/intake/ping?sheet=nope", undefined, { "x-traffic-key": SHEET_KEY })).status === 400
    && (await post({ sheet: "nope", rows: [srow("+966530000999")] })).status === 400);

  const deltaAt = crm.delta.rows.length;
  const drawAt = crm.draw.rows.length;
  const thirteen = Array.from({ length: 13 }, (_, i) => srow(`+9665300000${10 + i}`));
  const s13 = await shoaib(thirteen);
  const r13 = (s13.body?.data?.results ?? []) as Json[];
  check("13 leads, all sent", s13.status === 200 && r13.length === 13 && r13.every((r) => r.status === "sent"), show(s13.body));
  const docs13 = await Promise.all(thirteen.map((r) => leadDoc(r.id)));
  const teamsOf13 = docs13.map((d) => d?.share);
  check("every 13 are 2, 8 and 3", teamsOf13.filter((t) => t === "delta").length === 2 && teamsOf13.filter((t) => t === "draw").length === 8
    && teamsOf13.filter((t) => t === "dilshad").length === 3, show(teamsOf13));
  check("dealt so that no team is ever a whole lead from its share",
    show(teamsOf13) === show(["draw", "dilshad", "delta", "draw", "draw", "dilshad", "draw", "draw", "delta", "draw", "dilshad", "draw", "draw"]), show(teamsOf13));
  const toDelta = crm.delta.rows.slice(deltaAt);
  const toDraw = crm.draw.rows.slice(drawAt);
  check("Delta gets 5 of them and Draw 8", toDelta.length === 5 && toDraw.length === 8, `${toDelta.length} / ${toDraw.length}`);
  check("the Dilshad team's 3 go straight to Nusra, the Delta sales team's 2 to nobody in particular",
    toDelta.filter((r) => r.assigned_to === NUSRA).length === 3 && toDelta.filter((r) => !("assigned_to" in r)).length === 2, show(toDelta));
  check("every one carries the sheet's own source label", [...toDelta, ...toDraw].every((r) => r.source === "FOREX LEADS SEIRRA"));
  check("Delta's are recorded as added by the sheets' account; Draw records its own",
    toDelta.every((r) => r.reporter === REPORTER) && toDraw.every((r) => !("reporter" in r)));
  check("the CRM is told the trading-knowledge answer and the ad set, as the sheet's own script did",
    [...toDelta, ...toDraw].every((r) => r.ad_creative === "Trading knowledge: beginner\nAd set: KSA broad"), show(toDelta[0]));
  check("and the sheet is told who got each: 3 × Delta → Nusra, 2 × Delta, 8 × Draw",
    r13.filter((r) => r.label === "✅ Delta → Nusra").length === 3 && r13.filter((r) => r.label === "✅ Delta").length === 2
    && r13.filter((r) => r.label === "✅ Draw").length === 8, show(r13.map((r) => r.label)));

  const plain = srow("+966530000099", { knowledge: "", adset_name: "", email: "test@meta.com" });
  const metaTest = srow("<test lead: dummy data for phone>", {
    full_name: "<test lead: dummy data for full_name>", email: "test@meta.com",
    knowledge: "<test lead: dummy data for what_is_your_current_level_of_trading_knowledge?>",
  });
  const edge = await shoaib([plain, metaTest]);
  const plainSent = [...crm.delta.rows, ...crm.draw.rows].find((r) => r.id === plain.id);
  check("with neither, the CRM is told the ad name; Meta's test@meta address is not passed on",
    edge.body?.data?.results?.[0]?.status === "sent" && plainSent?.ad_creative === "Ad S" && !("email" in (plainSent ?? {})), show(plainSent));
  check("Meta's test rows are turned away", edge.body?.data?.results?.[1]?.label === "❌ Invalid: Meta test lead", show(edge.body?.data?.results?.[1]));

  const shSum = (await call("GET", "/traffic/summary?sheet=shoaib", undefined, root)).body?.data;
  const shTeam = (key: string) => seg(shSum, "all")?.shares?.find((x: Json) => x.key === key);
  // After a full 2 / 8 / 3 every team is level to within a hair (15.38% is not quite 2/13),
  // and the Dilshad team is the hair behind: the 14th is its.
  check("the 14th goes to whichever team is furthest behind — the Dilshad team, by a hair",
    (await leadDoc(plain.id))?.share === "dilshad", show(await leadDoc(plain.id)));
  check("its numbers: Delta sales team 2, Draw department 8, Dilshad team 4, against their targets",
    shTeam("delta")?.split === 2 && shTeam("draw")?.split === 8 && shTeam("dilshad")?.split === 4
    && shTeam("delta")?.target === 15.38 && shTeam("dilshad")?.target === 23.08 && shTeam("dilshad")?.crm === "Delta CRM"
    && shTeam("dilshad")?.assignTo?.id === NUSRA, show(seg(shSum, "all")));
  check("and Abhin's are its own", (await call("GET", "/traffic/summary", undefined, root)).body?.data?.totals?.received === abhinReceived);
  const shList = (await call("GET", "/traffic/leads?sheet=shoaib&limit=50", undefined, root)).body?.data;
  check("its list is its own, and names the team and the person",
    shList?.total === 15 && shList?.items?.every((i: Json) => i.sheet === "shoaib")
    && shList?.items?.some((i: Json) => i.team === "Dilshad team" && i.assignTo === "Nusra"), show(shList?.items?.[0]));

  const crossA = await shoaib([srow("+447700900001")]);
  check("somebody Abhin's sheet already sent goes back to the same CRM", crossA.body?.data?.results?.[0]?.label === "⚠️ Duplicate · Delta", show(crossA.body));
  const crossB = await abhin([row(UAE, "+966530000010")]);
  check("and the other way round", crossB.body?.data?.results?.[0]?.label === "⚠️ Duplicate · Draw", show(crossB.body));

  const shoaibTeams = (draw = 61.54, extra: Json[] = [], delta = 15.38) => [
    { key: "delta", name: "Delta sales team", org: "delta", percent: delta, assignToId: null },
    { key: "draw", name: "Draw department", org: "draw", percent: draw, assignToId: null },
    { key: "dilshad", name: "Dilshad team", org: "delta", percent: 23.08, assignToId: NUSRA },
    ...extra,
  ];
  const putShoaib = (paused: boolean, teams: Json[] = shoaibTeams()) =>
    call("PUT", "/traffic/rules/shoaib", { paused, segments: { all: teams } }, root);
  const vShoaib = segOf(await rulesOf("shoaib"), "all")?.version;
  const ps = await putShoaib(true);
  check("Shoaib's sheet can be paused on its own, without starting its count again",
    ps.status === 200 && sheetIn(ps.body?.data, "shoaib")?.paused === true && sheetIn(ps.body?.data, "abhin")?.paused === false
    && segOf(sheetIn(ps.body?.data, "shoaib"), "all")?.version === vShoaib, show(ps.body));
  const heldS = srow("+966530000200");
  const hs = await shoaib([heldS]);
  const ha = await abhin([row(UK, "+447700900300")]);
  check("its leads wait while Abhin's still go", hs.body?.data?.results?.[0]?.label?.startsWith("⏸ Paused · ")
    && ha.body?.data?.results?.[0]?.status === "sent", show([hs.body?.data?.results, ha.body?.data?.results]));
  await sleep(2500);
  check("and are not sent while it is paused", (await leadDoc(heldS.id))?.status === "held");
  await putShoaib(false);
  check("resuming sends them", await waitFor(async () => (await leadDoc(heldS.id))?.status === "sent"), show(await leadDoc(heldS.id)));

  const abhinNow = await rulesOf("abhin");
  const added = await putShoaib(false, shoaibTeams(51.54, [{ name: "Test team", org: "draw", percent: 10, assignToId: null }]));
  const addedSheet = sheetIn(added.body?.data, "shoaib");
  check("a fourth team can be added, and is given a key of its own", added.status === 200
    && teamOf(addedSheet, "all", "test-team")?.percent === 10 && teamOf(addedSheet, "all", "draw")?.percent === 51.54, show(added.body));
  check("which starts Shoaib's count again, and leaves Abhin's alone", segOf(addedSheet, "all")?.version === vShoaib + 1
    && ["uk", "gcc", "hindi"].every((k) => segOf(sheetIn(added.body?.data, "abhin"), k)?.version === segOf(abhinNow, k)?.version),
    show([segOf(addedSheet, "all")?.version, vShoaib]));
  const renamed = await putShoaib(false, shoaibTeams(51.54, [{ key: "test-team", name: "Renamed team", org: "draw", percent: 10, assignToId: null }]));
  check("renaming a team does not", renamed.status === 200 && teamOf(sheetIn(renamed.body?.data, "shoaib"), "all", "test-team")?.name === "Renamed team"
    && segOf(sheetIn(renamed.body?.data, "shoaib"), "all")?.version === vShoaib + 1, show(renamed.body));
  check("three decimals are refused", (await putShoaib(false, shoaibTeams(61.535, [], 15.385))).status === 400);
  check("99.99% in all is refused", (await putShoaib(false, shoaibTeams(61.54, [], 15.37))).status === 400);
  const back = await putShoaib(false);
  check("and it goes back to the three teams", back.status === 200 && segOf(sheetIn(back.body?.data, "shoaib"), "all")?.shares?.length === 3);
  const shAudit = (await db.collection("auditlogs").find({ action: "traffic_rules_changed" }).toArray())
    .find((x) => String(x.detail).startsWith("Shoaib — Forex leads"));
  check("Shoaib's changes are in the audit log too, team by team",
    /Dilshad team \(Delta → Nusra\) 23\.08%/.test(String(shAudit?.detail)), show(shAudit?.detail));

  // ── Case 6 ─────────────────────────────────────────────────────────────────
  step("Case 6 — the Dilshad team moves to its own CRM, remote");
  const remotePeople = (await call("GET", "/traffic/crm-users/remote", undefined, root)).body?.data ?? [];
  check("the remote CRM's people can be picked from", remotePeople.some((p: Json) => p.id === NUSRA_REMOTE), show(remotePeople));
  const dilshadTo = (org: string, to: string) => shoaibTeams().map((t) => (t.key === "dilshad" ? { ...t, org, assignToId: to } : t));
  check("handing it to Delta's Nusra in the remote CRM is refused — she has another account there",
    (await putShoaib(false, dilshadTo("remote", NUSRA))).status === 400);
  const vBeforeMove = segOf(await rulesOf("shoaib"), "all")?.version;
  const moved = await putShoaib(false, dilshadTo("remote", NUSRA_REMOTE));
  const movedSheet = sheetIn(moved.body?.data, "shoaib");
  check("the Dilshad team goes to the remote CRM, straight to Nusra there", moved.status === 200
    && teamOf(movedSheet, "all", "dilshad")?.org === "remote" && teamOf(movedSheet, "all", "dilshad")?.assignTo?.id === NUSRA_REMOTE, show(moved.body));
  check("moving a team to another CRM does not start its count again", segOf(movedSheet, "all")?.version === vBeforeMove,
    `${segOf(movedSheet, "all")?.version} / ${vBeforeMove}`);
  check("Shoaib's sheet now sends to three CRMs, Abhin's still to two",
    show(movedSheet?.uses) === show(["delta", "draw", "remote"]) && show(sheetIn(moved.body?.data, "abhin")?.uses) === show(["delta", "draw"]),
    show([movedSheet?.uses, sheetIn(moved.body?.data, "abhin")?.uses]));
  const shPing2 = await call("GET", "/traffic/intake/ping?sheet=shoaib", undefined, { "x-traffic-key": SHEET_KEY });
  check("Shoaib's connection test lists the remote CRM, ready", shPing2.body?.data?.crms?.some((c: Json) => c.code === "remote" && c.ready), show(shPing2.body));
  const abPing = await call("GET", "/traffic/intake/ping", undefined, { "x-traffic-key": SHEET_KEY });
  check("Abhin's still names only Delta and Draw", show(abPing.body?.data?.crms?.map((c: Json) => c.code)) === show(["delta", "draw"]), show(abPing.body));

  const remoteAt = crm.remote.rows.length;
  const deltaAt2 = crm.delta.rows.length;
  const next13 = Array.from({ length: 13 }, (_, i) => srow(`+9665400000${10 + i}`));
  const r13b = ((await shoaib(next13)).body?.data?.results ?? []) as Json[];
  const toRemote = crm.remote.rows.slice(remoteAt);
  const toDelta2 = crm.delta.rows.slice(deltaAt2);
  check("13 more leads: all sent, 3 of them into the remote CRM", r13b.every((r) => r.status === "sent") && toRemote.length === 3, show(r13b));
  check("each straight to Nusra's account there, with the sheet's label and no reporter — the CRM records its own",
    toRemote.every((r) => r.assigned_to === NUSRA_REMOTE && r.source === "FOREX LEADS SEIRRA" && !("reporter" in r)), show(toRemote));
  check("and the trading-knowledge answer and ad set, as before", toRemote.every((r) => r.ad_creative === "Trading knowledge: beginner\nAd set: KSA broad"));
  check("Delta gets only the Delta sales team's 2, handed to nobody in particular",
    toDelta2.length === 2 && toDelta2.every((r) => !("assigned_to" in r)), show(toDelta2));
  check("the sheet is told: 3 × Remote → Nusra", r13b.filter((r) => r.label === "✅ Remote → Nusra").length === 3, show(r13b.map((r) => r.label)));

  const kr = await shoaib([srow("+971509999001")]);
  check("somebody the remote CRM already has goes back there, as a duplicate", kr.body?.data?.results?.[0]?.label === "⚠️ Duplicate · Remote", show(kr.body));
  const sum6 = (await call("GET", "/traffic/summary?sheet=shoaib", undefined, root)).body?.data;
  const dil = seg(sum6, "all")?.shares?.find((x: Json) => x.key === "dilshad");
  check("the page shows the Dilshad team in the Remote CRM, going to Nusra",
    dil?.crm === "Remote CRM" && dil?.org === "remote" && dil?.assignTo?.id === NUSRA_REMOTE, show(dil));
  const remoteList = (await call("GET", "/traffic/leads?sheet=shoaib&org=remote&limit=50", undefined, root)).body?.data;
  check("and its leads can be listed by that CRM", remoteList?.total === 4 && remoteList?.items?.every((i: Json) => i.destination === "remote"), show(remoteList?.items?.[0]));
  const moveAudit = (await db.collection("auditlogs").find({ action: "traffic_rules_changed" }).toArray())
    .find((x) => /Dilshad team \(Remote → Nusra\) 23\.08%/.test(String(x.detail)));
  check("the move is in the audit log", !!moveAudit);

  // ── TRADING-LEADS NITRO, the DRAW LEAD SHEET ────────────────────────────────
  step("TRADING-LEADS NITRO (the DRAW LEAD SHEET) — every lead to the Sales CRM, rows typed in by hand too, on the page");
  const NITRO = "TRADING-LEADS NITRO"; // its ID, as sheets/draw-lead-sheet.gs writes it
  const dsRules = (await call("GET", "/traffic/rules", undefined, root)).body?.data;
  const ds = sheetIn(dsRules, "trading-leads-nitro");
  check("it is the third sheet, TRADING-LEADS NITRO: one split, all of it to the Delta sales team, with its own source label",
    dsRules?.sheets?.map((s: Json) => s.key).join(",") === "abhin,shoaib,trading-leads-nitro" && ds?.name === "TRADING-LEADS NITRO"
    && ds?.segments?.length === 1 && segOf(ds, "all")?.source === "TRADING-LEADS NITRO" && show(ds?.uses) === show(["delta"])
    && show(segOf(ds, "all")?.shares?.map((s: Json) => [s.name, s.org, s.percent])) === show([["Delta sales team", "delta", 100]]), show(ds));
  const dsRule = await db.collection("trafficrules").findOne({ key: "trading-leads-nitro" });
  check("…naming no reporter for the Sales CRM, as its own script named none", dsRule?.reporters?.delta === "", show(dsRule?.reporters));
  const dsPing = await call("GET", `/traffic/intake/ping?sheet=${encodeURIComponent(NITRO)}`, undefined, { "x-traffic-key": SHEET_KEY });
  check("its connection test, asked as the script asks, names it, and only the Sales CRM", dsPing.status === 200
    && dsPing.body?.data?.name === "TRADING-LEADS NITRO" && dsPing.body?.data?.sheet === "trading-leads-nitro"
    && show(dsPing.body?.data?.crms?.map((c: Json) => c.code)) === show(["delta"]), show(dsPing.body));
  const oldId = await call("GET", "/traffic/intake/ping?sheet=drawsheet", undefined, { "x-traffic-key": SHEET_KEY });
  check("the ID it had before going live is not a sheet", oldId.status === 400 && /Unknown sheet/.test(String(oldId.body?.message)), show(oldId.body));
  // As sheets/draw-lead-sheet.gs builds them: Meta's rows, and a row typed in by hand — no lead id, no created time.
  const dsMeta = (n: number) => ({
    id: `l:77000${n}`, tab: "Sheet1", created_time: `2026-10-05T0${n}:00:00+05:30`, full_name: `Nitro ${n}`,
    phone_number: `p:+97155877000${n}`, email: `nitro${n}@example.test`, platform: "Meta", campaign_name: "Nitro | Draw | Forex",
    ad_name: `Ad ${n}`, adset_name: "Kerala 25-45", is_organic: "false",
  });
  const dsHand = { id: "", tab: "Sheet1", created_time: "", full_name: "Typed In", phone_number: "971556667777", email: "typed@example.test", platform: "Meta" };
  const dsPost = (rows: unknown[]) => post({ sheet: NITRO, rows });
  const [deltaAtDs, drawAtDs, remoteAtDs] = [crm.delta.rows.length, crm.draw.rows.length, crm.remote.rows.length];
  const ds1 = await dsPost([dsMeta(1), dsMeta(2), dsHand]);
  const dsRes = (ds1.body?.data?.results ?? []) as Json[];
  check("three rows: all sent to the Sales CRM, the typed-in one too", ds1.status === 200 && dsRes.length === 3
    && dsRes.every((r) => r.status === "sent" && r.destination === "delta" && r.label === "✅ Delta"), show(ds1.body));
  check("…and nothing to Draw or Remote", crm.draw.rows.length === drawAtDs && crm.remote.rows.length === remoteAtDs);
  const toDeltaDs = crm.delta.rows.slice(deltaAtDs);
  const nitro1 = toDeltaDs.find((r) => r.full_name === "Nitro 1");
  check("the Sales CRM gets the sheet's source label, the lead id, its time and the campaign — and no reporter: it records its own",
    nitro1?.source === "TRADING-LEADS NITRO" && nitro1?.id === "l:770001" && nitro1?.phone_number === "+971558770001"
    && nitro1?.created_time === new Date("2026-10-05T01:00:00+05:30").toISOString() && nitro1?.campaign_name === "Nitro | Draw | Forex"
    && !("reporter" in nitro1) && !("assigned_to" in nitro1), show(nitro1));
  check("…with the ad and the ad set where the ad goes", nitro1?.ad_creative === "Ad: Ad 1\nAd set: Kerala 25-45", show(nitro1?.ad_creative));
  const typedIn = toDeltaDs.find((r) => r.full_name === "Typed In");
  check("the typed-in row goes too, without a lead id or a time", typedIn?.phone_number === "971556667777"
    && typedIn?.source === "TRADING-LEADS NITRO" && !("id" in typedIn) && !("created_time" in typedIn), show(typedIn));
  const dsAgain = await dsPost([dsHand, dsMeta(1)]);
  check("sent again: the same answers, nothing posted twice", (dsAgain.body?.data?.results ?? []).every((r: Json) => r.label === "✅ Delta")
    && crm.delta.rows.length === deltaAtDs + 3, show(dsAgain.body));
  const slugged = await post({ sheet: "trading-leads-nitro", rows: [dsMeta(2)] });
  check("…and named in small letters with hyphens, it is the same sheet", slugged.body?.data?.results?.[0]?.label === "✅ Delta"
    && crm.delta.rows.length === deltaAtDs + 3, show(slugged.body));
  const dsKnown = await dsPost([
    { ...dsHand, full_name: "Known to Draw", phone_number: "+971502222222" },
    { ...dsHand, full_name: "Known to Delta", phone_number: "0501111111" },
  ]);
  check("somebody the Draw CRM already has stays Draw's — not sent to the Sales CRM, as for the other sheets",
    dsKnown.body?.data?.results?.[0]?.label === "⚠️ Duplicate · Draw" && dsKnown.body?.data?.results?.[1]?.label === "⚠️ Duplicate · Delta"
    && crm.delta.rows.length === deltaAtDs + 3 && crm.draw.rows.length === drawAtDs, show(dsKnown.body));
  const dsBad = await dsPost([{ ...dsHand, full_name: "No Phone", phone_number: "12" }]);
  check("a row without a usable phone is turned away with its reason", dsBad.body?.data?.results?.[0]?.label === "❌ Invalid: No usable phone number", show(dsBad.body));
  const dsSum = (await call("GET", "/traffic/summary?sheet=trading-leads-nitro", undefined, root)).body?.data;
  const dsTeam = seg(dsSum, "all")?.shares?.find((x: Json) => x.key === "delta");
  check("the page counts them: 3 to the Delta sales team — 100% against its 100% — 2 duplicates, 1 invalid",
    dsSum?.totals?.sent === 3 && dsTeam?.split === 3 && dsTeam?.actual === 100 && dsTeam?.target === 100
    && dsSum?.totals?.duplicates === 2 && dsSum?.totals?.invalid === 1, show(dsSum?.totals));
  const dsList = (await call("GET", "/traffic/leads?sheet=trading-leads-nitro&limit=50", undefined, root)).body?.data;
  check("and lists them, this sheet's only", dsList?.total === 6 && dsList?.items?.every((i: Json) => i.sheet === "trading-leads-nitro"),
    show(dsList?.items?.map((i: Json) => [i.name, i.status])));
  const shoaibNoDate = await shoaib([srow("+966540000099", { created_time: "" })]);
  check("Shoaib's sheet still turns a row without a created time away", shoaibNoDate.body?.data?.results?.[0]?.label === "❌ Invalid: No created time", show(shoaibNoDate.body));

  // ── The Leads list, by the page's dates ────────────────────────────────────
  step("The Leads list by date — the page's Today, 30 days, This month and Custom");
  const dated = (n: number, at: string, extra: Record<string, unknown> = {}) =>
    legacyLead(`dated-${n}`, `+97159777000${n}`, { sheet: "abhin", name: `Dated ${n}`, receivedAt: new Date(at), createdTime: new Date(at), ...extra });
  await db.collection("trafficleads").insertMany([
    dated(1, "2026-08-31T19:59:00Z"),                            // 23:59 Gulf on 31 August
    dated(2, "2026-08-31T20:00:00Z"),                            // midnight Gulf: 1 September
    dated(3, "2026-09-15T08:00:00Z", { destination: "draw" }),
    dated(4, "2026-09-30T19:59:59Z"),                            // September's last second, Gulf
    dated(5, "2026-09-30T20:00:00Z"),                            // 1 October, Gulf
  ]);
  const byDates = async (q: string) => (await call("GET", `/traffic/leads?limit=100${q}`, undefined, root)).body?.data;
  const names = (l: Json) => ((l?.items ?? []) as Json[]).map((i) => i.name).filter((n) => /^Dated/.test(String(n)));
  const sept = await byDates("&from=2026-09-01&to=2026-09-30");
  check("September: its three, newest first — the boundaries in Gulf time",
    sept?.total === 3 && show(names(sept)) === show(["Dated 4", "Dated 3", "Dated 2"]), show(sept?.items?.map((i: Json) => i.name)));
  check("one day: 31 August is its last minute only", show(names(await byDates("&from=2026-08-31&to=2026-08-31"))) === show(["Dated 1"]));
  check("1 October, Gulf, is the lead at 20:00 UTC on 30 September", show(names(await byDates("&from=2026-10-01&to=2026-10-01"))) === show(["Dated 5"]));
  const septDraw = await byDates("&from=2026-09-01&to=2026-09-30&org=draw");
  check("with a CRM picked as well: September's Draw one", septDraw?.total === 1 && septDraw?.items?.[0]?.name === "Dated 3", show(septDraw?.items));
  const septPage2 = (await call("GET", "/traffic/leads?limit=2&page=2&from=2026-09-01&to=2026-09-30", undefined, root)).body?.data;
  check("paged within the dates: page 2 of 2", septPage2?.total === 3 && show(septPage2?.items?.map((i: Json) => i.name)) === show(["Dated 2"]), show(septPage2));
  const onwards = names(await byDates("&from=2026-09-30"));
  check("from a day on, with no end", onwards.includes("Dated 4") && onwards.includes("Dated 5") && !onwards.includes("Dated 3"), show(onwards));
  const upTo = await byDates("&to=2026-08-31");
  check("up to a day, with no start", upTo?.total === 1 && upTo?.items?.[0]?.name === "Dated 1", show(upTo?.items));
  const all = await byDates("");
  check("no dates: every lead, as before", all?.total === await db.collection("trafficleads").countDocuments({ sheet: "abhin" }), show(all?.total));
  const septSum = (await call("GET", "/traffic/summary?sheet=abhin&from=2026-09-01&to=2026-09-30", undefined, root)).body?.data;
  check("the totals for the same dates count the same three", septSum?.totals?.received === 3, show(septSum?.totals));
  const badDate = await call("GET", "/traffic/leads?from=2026-9-1&to=2026-09-30", undefined, root);
  check("a date not written YYYY-MM-DD is refused", badDate.status === 400 && /YYYY-MM-DD/.test(String(badDate.body?.message)), show(badDate.body));
  const backwards = await call("GET", "/traffic/leads?from=2026-09-30&to=2026-09-01", undefined, root);
  check("'from' after 'to' is refused", backwards.status === 400 && /after/.test(String(backwards.body?.message)), show(backwards.body));

  step("The All tab — every sheet together (the user, 2026-10-06)");
  const gulfNow = new Date(Date.now() + 4 * 60 * 60_000).toISOString().slice(0, 10);
  const span = `from=2020-01-01&to=${gulfNow}`;
  const inSpan = { receivedAt: { $gte: new Date("2019-12-31T20:00:00Z"), $lt: new Date(Date.parse(`${gulfNow}T00:00:00+04:00`) + 24 * 60 * 60_000) } };
  const KEYS = ["abhin", "shoaib", "trading-leads-nitro"];
  const TOTALS = ["received", "sent", "duplicates", "invalid", "waiting", "failed"];
  const leadsIn = (q: Record<string, unknown>) => db.collection("trafficleads").countDocuments({ sheet: { $in: KEYS }, ...inSpan, ...q });
  const allSum = (await call("GET", `/traffic/summary?sheet=all&${span}`, undefined, root)).body?.data;
  const each = await Promise.all(KEYS.map(async (k) => (await call("GET", `/traffic/summary?sheet=${k}&${span}`, undefined, root)).body?.data));
  check("All: every sheet, in the page's order", allSum?.sheet === "all" && show(allSum?.sheets?.map((s: Json) => s.key)) === show(KEYS),
    show(allSum?.sheets?.map((s: Json) => s.key)));
  check("…each with the totals its own tab has", KEYS.every((_, i) => show(allSum?.sheets?.[i]?.totals) === show(each[i]?.totals)),
    show([allSum?.sheets?.map((s: Json) => s.totals), each.map((e) => e?.totals)]));
  check("…the totals theirs added up — every lead on those days",
    TOTALS.every((t) => allSum?.totals?.[t] === each.reduce((n, e) => n + (e?.totals?.[t] ?? 0), 0))
    && allSum?.totals?.received === (await leadsIn({})) && allSum.totals.received > 0, show(allSum?.totals));
  let byCrm = true;
  for (const s of allSum?.sheets ?? []) {
    for (const org of ["delta", "draw", "remote"]) {
      const c = s.crms.find((x: Json) => x.org === org);
      const went = await leadsIn({ sheet: s.key, destination: org });
      const sent = await leadsIn({ sheet: s.key, destination: org, status: "sent" });
      if ((c?.received ?? 0) !== went || (c?.sent ?? 0) !== sent) byCrm = false;
    }
  }
  check("…each sheet's leads by the CRM they went to — only CRMs that got some",
    byCrm && (allSum?.sheets ?? []).every((s: Json) => s.crms.every((c: Json) => c.received > 0 && typeof c.name === "string"))
    && (allSum?.sheets ?? []).some((s: Json) => s.crms.length > 1), show(allSum?.sheets?.map((s: Json) => [s.key, s.crms])));
  const rulesNow = await allRules();
  check("…paused or routing, as each sheet's rule is", (allSum?.sheets ?? []).every((s: Json) => s.paused === sheetIn(rulesNow, s.key)?.paused));
  check("the same days written ALL", (await call("GET", `/traffic/summary?sheet=ALL&${span}`, undefined, root)).body?.data?.totals?.received === allSum?.totals?.received);
  const allList = (await call("GET", `/traffic/leads?sheet=all&limit=100&${span}`, undefined, root)).body?.data;
  check("All's leads: every sheet's, newest first", allList?.total === allSum?.totals?.received
    && new Set((allList?.items ?? []).map((l: Json) => l.sheet)).size > 1
    && (allList?.items ?? []).every((l: Json, i: number, a: Json[]) => i === 0 || String(a[i - 1].receivedAt) >= String(l.receivedAt)), show(allList?.total));
  const shOwn = (await call("GET", `/traffic/leads?sheet=shoaib&limit=100&${span}`, undefined, root)).body?.data;
  const teamOnTab = new Map(((shOwn?.items ?? []) as Json[]).map((l) => [l.id, l.team]));
  const shoaibOnAll = ((allList?.items ?? []) as Json[]).filter((l) => l.sheet === "shoaib" && l.team && teamOnTab.has(l.id));
  check("…each lead's team named by its own sheet's split", shoaibOnAll.length > 0 && shoaibOnAll.every((l) => teamOnTab.get(l.id) === l.team),
    show(shoaibOnAll.slice(0, 3)));
  const sentToDelta = (await call("GET", `/traffic/leads?sheet=all&filter=sent&org=delta&limit=1&${span}`, undefined, root)).body?.data;
  check("…the status and CRM filters work on it as on a sheet", sentToDelta?.total === (await leadsIn({ status: "sent", destination: "delta" })) && sentToDelta.total > 0,
    show(sentToDelta?.total));
  const intoAll = await post({ sheet: "all", rows: [srow("+966530000998")] });
  check("nothing posts to \"all\": the intake refuses it", intoAll.status === 400, `${intoAll.status} ${show(intoAll.body)}`);
  const pingAll = await call("GET", "/traffic/intake/ping?sheet=all", undefined, { "x-traffic-key": SHEET_KEY });
  check("…nor does a sheet's Test connection take it", pingAll.status === 400, `${pingAll.status} ${show(pingAll.body)}`);
  const splitAll = await call("PUT", "/traffic/rules/all", { paused: true, segments: {} }, root);
  // As for any sheet that is not one: the split's route answers 404.
  check("…and there is no split of \"all\" to change", splitAll.status === 404 && /Unknown sheet "all"/.test(String(splitAll.body?.message)),
    `${splitAll.status} ${show(splitAll.body)}`);
  check("and it needs lead-traffic access like a sheet", (await call("GET", "/traffic/summary?sheet=all", undefined, member)).status === 403
    && (await call("GET", "/traffic/leads?sheet=all", undefined, member)).status === 403);

  console.log(`\n${checks - failures}/${checks} checks passed`);
  for (const s of servers) s.close();
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}

(process.argv[2] === "seed" ? seed() : main()).catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
