/**
 * Sales TV end to end (services/salesTvService.ts, routes/salesTvRoutes.ts, routes/publicRoutes.ts):
 *
 *   Case 1  happy path   the three CRMs merged: Delta's and Draw's tables, who is on a break with the HRMS
 *                        photo (signed POST to work-modes), the closes of both tagged with their CRM, newest first
 *                        — only the people working this month: given a lead this month (counted from Delta's
 *                        database) or credited with a close; Draw, whose leads can't be read, shows everybody
 *   Case 2  edge         the cache — no CRM asked twice inside 5 s, live parts (with ?after=) after 5 s, the people
 *                        again only after 30 s; a close sent twice kept once; ?since= keeps only what is new;
 *                        HRMS asked once per email
 *   Case 3  errors       Remote's old server says it needs updating; Draw going down shows on Draw's table only,
 *                        the open answer says so without the CRM's own words
 *   Case 4  permission   /sales-tv: no session 401, not a root admin 403; /public/sales-tv open, with no email
 *                        anywhere in it
 *   Case 1b bosses       (2026-10-23) Delta's team leader (Tom), Sales Manager (Sam) and Super Admin (Ada) — read
 *                        from Delta's database — hidden on the Sales TV, shown on the Manager TV; a leader of an
 *                        inactive team (Dev) still shown
 *   Case 6  today + hidden (2026-10-31) each CRM's money collected today, counted as the leaderboard counts (no rupees,
 *                        a balance payment once approved, not yesterday's), on the TV's own people; the Manager TV
 *                        hides Dilshad (a Super Admin) but counts his figures in the CRM's total, as `hidden`
 *   Case 5  Manager TV   (services/managerTvService.ts, 2026-10-23) the same three CRMs and the CS team as a fourth
 *                        card from CS Portal's open CS board, ranked as it ranks them; its approved payments
 *                        among the closes ("CS payment"), only the new ones with ?since=; asked at most every 20 s;
 *                        CS Portal down: the CS card says so (plainly on the open link), the CRMs carry on;
 *                        /manager-tv root admins only, /public/manager-tv open
 *
 * Run through scripts/sales-tv-check.sh. Scratch database on 127.0.0.1 only; the CRMs and HRMS are a stand-in.
 */
import mongoose from "mongoose";
import crypto from "node:crypto";
import { createServer } from "node:http";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(uri)) {
  console.error(`Refusing to run: MONGODB_URI must be a scratch e2e database on 127.0.0.1, got "${uri}"`);
  process.exit(1);
}
const deltaUri = process.env.DELTA_MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(deltaUri)) {
  console.error(`Refusing to run: DELTA_MONGODB_URI must be a scratch e2e database on 127.0.0.1, got "${deltaUri}"`);
  process.exit(1);
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const PASSWORD = "SalesTvE2e!pass1";

let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const same = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const step = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);
const show = (v: unknown) => JSON.stringify(v).slice(0, 500);
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const pd0 = (r: { body: Json }) => r.body?.data ?? {};
async function call(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Json; text: string; headers: Headers }> {
  const r = await fetch(`${ROOT}${path}`, { headers: { "content-type": "application/json", ...headers } });
  const text = await r.text();
  let body: Json = {};
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, body, text, headers: r.headers };
}

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const MONTH_NOW = (() => { const g = new Date(Date.now() + 4 * 3_600_000); return `${g.getUTCFullYear()}-${String(g.getUTCMonth() + 1).padStart(2, "0")}`; })();
// Delta's people are CRM users: ObjectIds, as a lead's assignedTo holds them.
const oid = () => new mongoose.Types.ObjectId();
const DELTA_ID = { asha: oid(), bina: oid(), cara: oid(), dev: oid(), eli: oid(), tom: oid(), sam: oid(), ada: oid(), dilshad: oid() };

// ── The stand-in: three CRMs and HRMS ────────────────────────────────────────
const hits: { crm: string; query: string }[] = [];
const hrmsHits: { emails: string[]; signed: boolean }[] = [];
let drawDown = false;
const SECRETS: Record<string, string> = { delta: "sales-tv-e2e-delta", draw: "sales-tv-e2e-draw", remote: "sales-tv-e2e-remote" };

const deltaCloses = [
  { id: "d1", closer: "Asha", closerEmail: "asha@delta-e2e.test", courses: ["Forex Mastery"], amount: 5500, academy: "dubai", currency: "AED", at: ago(30) },
  { id: "d2", closer: "Bina", closerEmail: "bina@delta-e2e.test", courses: ["Crypto Pro", "Mentorship"], amount: 8000, academy: "dubai", currency: "AED", at: ago(10) },
  { id: "d-old", closer: "Asha", closerEmail: "asha@delta-e2e.test", courses: ["Old"], amount: 100, academy: "dubai", currency: "AED", at: ago(200) }, // older than 2 h: dropped
];
const drawCloses: Json[] = [
  { id: "w1", closer: "Wasim", closerEmail: "wasim@draw-e2e.test", courses: ["Draw Basics"], amount: 55000, academy: "bangalore", currency: "INR", at: ago(20) },
];

function crmAnswer(crm: string, url: URL) {
  const live = url.searchParams.get("parts") === "live";
  const after = url.searchParams.get("after");
  const list = crm === "delta" ? deltaCloses : drawCloses;
  // Delta ignores ?after= and sends everything again, so Root's dedupe is tested.
  const closes = crm === "delta" || !after ? list : list.filter((c) => Date.parse(c.at) > Date.parse(after));
  const onBreak = crm === "delta"
    ? [{ id: "u-bina", name: "Bina", email: "bina@delta-e2e.test", team: "Falcons", since: ago(12), kind: "lunch" }]
    : [{ id: "u-zed", name: "Zed", email: "zed@draw-e2e.test", team: "Tigers", since: ago(3), kind: null }];
  const base = { crm, generatedAt: new Date().toISOString(), onBreak, closes };
  if (live) return base;
  const people = crm === "delta"
    ? [
      // Asha: leads this month. Bina: no lead this month, but closes. Cara: nothing at all. Dev: a lead this month
      // and nothing else yet. Eli: a lead last month only. Cara and Eli are not working this month: hidden.
      { id: String(DELTA_ID.asha), name: "Asha", email: "asha@delta-e2e.test", team: "Falcons", closingsMonth: 9, closingsToday: 1, revenueMonth: 50000, callsToday: 40, connectedToday: 22, talkSecondsToday: 5400 },
      { id: String(DELTA_ID.bina), name: "Bina", email: "bina@delta-e2e.test", team: "Falcons", closingsMonth: 4, closingsToday: 1, revenueMonth: 30000, callsToday: 25, connectedToday: 11, talkSecondsToday: 2000 },
      { id: String(DELTA_ID.dev), name: "Dev", email: "dev@delta-e2e.test", team: "Falcons", closingsMonth: 0, closingsToday: 0, revenueMonth: 0, callsToday: 3, connectedToday: 1, talkSecondsToday: 60 },
      { id: String(DELTA_ID.cara), name: "Cara", email: "cara@delta-e2e.test", team: "Falcons", closingsMonth: 0, closingsToday: 0, revenueMonth: 0, callsToday: 0, connectedToday: 0, talkSecondsToday: 0 },
      // The bosses, all working this month: Tom leads Falcons, Sam is the Sales Manager, Ada a Super Admin.
      { id: String(DELTA_ID.tom), name: "Tom", email: "tom@delta-e2e.test", team: "Falcons", closingsMonth: 2, closingsToday: 0, revenueMonth: 3500, callsToday: 5, connectedToday: 2, talkSecondsToday: 300 },
      // In an order Root must fix (2026-10-26): revenue first — Tom's 2 closings (AED 3,500) come after Sam's and Ada's
      // 1 (AED 4,000 each) — and on the same revenue and closings, more calls today first: Ada, then Sam.
      { id: String(DELTA_ID.sam), name: "Sam", email: "sam@delta-e2e.test", team: "Falcons", closingsMonth: 1, closingsToday: 0, revenueMonth: 4000, callsToday: 0, connectedToday: 0, talkSecondsToday: 0 },
      { id: String(DELTA_ID.ada), name: "Ada", email: "ada@delta-e2e.test", team: "Falcons", closingsMonth: 1, closingsToday: 0, revenueMonth: 4000, callsToday: 3, connectedToday: 1, talkSecondsToday: 0 },
      { id: String(DELTA_ID.dilshad), name: "Dilshad", email: "dilshad@delta-e2e.test", team: "Falcons", closingsMonth: 2, closingsToday: 1, revenueMonth: 7000, callsToday: 2, connectedToday: 1, talkSecondsToday: 100 },
      { id: String(DELTA_ID.eli), name: "Eli", email: "eli@delta-e2e.test", team: "Falcons", closingsMonth: 0, closingsToday: 0, revenueMonth: 0, callsToday: 0, connectedToday: 0, talkSecondsToday: 0 },
    ]
    : [
      { id: "u-wasim", name: "Wasim", email: "wasim@draw-e2e.test", team: "Tigers", closingsMonth: 3, closingsToday: 1, revenueMonth: 9000, callsToday: 30, connectedToday: 15, talkSecondsToday: 3600 },
      { id: "u-yan", name: "Yan", email: "yan@draw-e2e.test", team: "Tigers", closingsMonth: 0, closingsToday: 0, revenueMonth: 0, callsToday: 0, connectedToday: 0, talkSecondsToday: 0 },
    ];
  return { ...base, month: MONTH_NOW, people };
}

// CS Portal's open CS board, as its /api/public/cs-tv answers (functions/csTv.ts there).
const csHits: string[] = [];
let csDown = false;
const csRecent: Json[] = [
  { id: "p1", cs: "Noor", team: "Falcons", aed: 3670, product: "DQMP", at: ago(15) },
];
const csBoard = () => ({
  location: "dubai", month: MONTH_NOW, generated_at: new Date().toISOString(),
  cs: [
    { id: "c1", name: "Noor", team_id: "t1", team: "Falcons", month_aed: 12000, today_aed: 3670, payments: 4, today_payments: 1, photo: "https://hrms-e2e.test/photos/noor.jpg", rank: 1 },
    { id: "c2", name: "Omar", team_id: "t2", team: "Hawks", month_aed: 9000, today_aed: 0, payments: 3, today_payments: 0, photo: null, rank: 2 },
    { id: "c3", name: "Priya", team_id: "t1", team: "Falcons", month_aed: 0, today_aed: 0, payments: 0, today_payments: 0, photo: null, rank: 3 },
  ],
  teams: [{ id: "t1", team: "Falcons", month_aed: 12000, today_aed: 3670, payments: 4, cs_count: 2 }, { id: "t2", team: "Hawks", month_aed: 9000, today_aed: 0, payments: 3, cs_count: 1 }],
  totals: { month_aed: 21000, today_aed: 3670, payments: 7 },
  recent: csRecent,
});

const stand = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const crm = url.pathname.split("/")[1] ?? "";
  if (crm === "commission") {
    if (url.pathname !== "/commission/api/public/cs-tv") return send(404, { error: "Not found" });
    csHits.push(url.search);
    if (csDown) return send(500, { error: "CS board exploded at 10.0.0.9" });
    return send(200, csBoard()); // no envelope, as CS Portal's json() answers
  }
  if (crm === "hrms") {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const path = url.pathname.slice("/hrms".length) + url.search;
      const ts = String(req.headers["x-delta-timestamp"] ?? ""), nonce = String(req.headers["x-delta-nonce"] ?? "");
      const canonical = [req.method, path, ts, nonce, crypto.createHash("sha256").update(raw).digest("hex")].join("\n");
      const want = crypto.createHmac("sha256", "sales-tv-e2e-hrms-signing").update(canonical).digest("hex");
      const signed = req.headers["x-delta-signature"] === want && req.headers["x-delta-client"] === "sales-tv-e2e";
      const people: { email: string; name?: string }[] = (() => { try { return JSON.parse(raw).people ?? []; } catch { return []; } })();
      hrmsHits.push({ emails: people.map((p) => p.email), signed });
      if (!signed) return send(401, { success: false, message: "Bad signature" });
      if (req.method !== "POST" || path !== "/api/v1/integrations/directory/work-modes") return send(404, { success: false, message: "Route not found" });
      send(200, { success: true, data: people.map((p) => ({
        email: p.email, matchedBy: "email", hrmsEmail: p.email, hrmsName: p.name ?? null, workMode: "office", location: "Dubai", status: "active", designation: "Sales",
        photoUrl: p.email.startsWith("bina") ? "https://hrms-e2e.test/photos/bina.jpg?sig=abc" : null,
      })) });
    });
    return;
  }
  if (!SECRETS[crm]) return send(404, { success: false, message: "Route not found" });
  if (req.headers["x-portal-secret"] !== SECRETS[crm]) return send(401, { success: false, message: "Bad secret" });
  if (url.pathname !== `/${crm}/api/v1/service/sales-tv`) return send(404, { success: false, message: "Route not found" });
  hits.push({ crm, query: url.search });
  if (crm === "remote") return send(404, { success: false, message: "Route not found" }); // an old server
  if (crm === "draw" && drawDown) return send(500, { success: false, message: "Draw database exploded at 10.0.0.7" });
  send(200, { success: true, data: crmAnswer(crm, url) });
});
await new Promise<void>((ok) => stand.listen(Number(process.env.E2E_STANDIN_PORT), "127.0.0.1", ok));

const hitsOf = (crm: string) => hits.filter((h) => h.crm === crm);

async function main() {
  mongoose.set("autoIndex", false);
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  await mongoose.connection.db!.dropDatabase();

  step("Setting up: Delta's leads");
  const deltaDb = mongoose.createConnection(deltaUri);
  await deltaDb.asPromise();
  if (deltaDb.host !== "127.0.0.1") throw new Error("Delta's database is not local");
  await deltaDb.db!.dropDatabase();
  const monthStart = (() => { const [y, m] = MONTH_NOW.split("-").map(Number) as [number, number]; return new Date(Date.UTC(y, m - 1, 1) - 4 * 3_600_000); })();
  // Paid today (Dubai) as the CRMs store a payment's day: that date at 00:00 UTC.
  const todayPaid = (() => { const g = new Date(Date.now() + 4 * 3_600_000); return new Date(Date.UTC(g.getUTCFullYear(), g.getUTCMonth(), g.getUTCDate())); })();
  const yesterdayPaid = new Date(todayPaid.getTime() - 86_400_000);
  await deltaDb.collection("leads").insertMany([
    { name: "L1", phone: "1", status: "assigned", assignedTo: DELTA_ID.asha, createdAt: new Date(), payments: [
      { amount: 2000, paidAt: todayPaid }, { amount: 999, paidAt: todayPaid, currency: "INR" },
      { amount: 500, paidAt: todayPaid, finance: { externalId: "bp-1", state: "pending" } }, { amount: 300, paidAt: yesterdayPaid },
    ] },
    { name: "L6", phone: "6", status: "assigned", assignedTo: DELTA_ID.dev, createdAt: new Date(), payments: [{ amount: 1000, paidAt: todayPaid, finance: { externalId: "bp-2", state: "approved" } }] },
    { name: "L7", phone: "7", status: "assigned", assignedTo: DELTA_ID.dilshad, createdAt: new Date(), payments: [{ amount: 4000, paidAt: todayPaid }] },
    { name: "L8", phone: "8", status: "lost", assignedTo: DELTA_ID.cara, createdAt: new Date(monthStart.getTime() - 60_000), payments: [{ amount: 750, paidAt: todayPaid }] },
    { name: "L2", phone: "2", status: "assigned", assignedTo: DELTA_ID.asha, createdAt: new Date(monthStart.getTime() + 60_000) },
    { name: "L3", phone: "3", status: "assigned", assignedTo: DELTA_ID.dev, createdAt: new Date() },
    { name: "L4", phone: "4", status: "assigned", assignedTo: DELTA_ID.eli, createdAt: new Date(monthStart.getTime() - 60_000) }, // last month, a minute before
    { name: "L5", phone: "5", status: "new", assignedTo: null, createdAt: new Date() },
  ]);
  // Who leads and manages (2026-10-23): Falcons led by Tom; Dev leads only an inactive team; Sam the Sales Manager;
  // Ada a Super Admin.
  const adminRole = oid();
  await deltaDb.collection("teams").insertMany([
    { name: "Falcons", leaders: [DELTA_ID.tom], members: [DELTA_ID.asha, DELTA_ID.bina, DELTA_ID.dev], status: "active" },
    { name: "Old", leaders: [DELTA_ID.dev], members: [], status: "inactive" },
  ]);
  await deltaDb.collection("commissionsettings").insertOne({ key: "default", salesManager: DELTA_ID.sam });
  await deltaDb.collection("roles").insertOne({ _id: adminRole, roleName: "Super Admin", isSystemRole: true });
  await deltaDb.collection("users").insertMany([{ _id: DELTA_ID.ada, name: "Ada", role: adminRole, status: "active" }, { _id: DELTA_ID.dilshad, name: "Dilshad", role: adminRole, status: "active" }]);
  await deltaDb.close();

  step("Setting up: the registry and two admins");
  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  for (const [code, name, sortOrder] of [["delta", "Dubai Sales", 1], ["draw", "Draw CRM", 2], ["remote", "Remote CRM", 3]] as [string, string, number][]) {
    await Organization.create({ code, kind: "crm", name, timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder, accent: "#2563eb" });
  }
  await AdminUser.create({ name: "Root E2E", email: "root@sales-tv-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@sales-tv-e2e.test", password: PASSWORD, role: "member", status: "active" });
  const login = async (email: string) => (await (await fetch(`${ROOT}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  })).json())?.data?.accessToken as string;
  const root = { authorization: `Bearer ${await login("root@sales-tv-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@sales-tv-e2e.test")}` };

  step("Case 1 — happy path: the three CRMs merged");
  const firstAt = Date.now();
  let r = await call("/sales-tv", root);
  const d = r.body?.data ?? {};
  check("200 with serverTime", r.status === 200 && typeof d.serverTime === "string", show(r.body));
  same("three CRMs in order, with names from the registry", (d.crms ?? []).map((c: Json) => [c.code, c.name]), [["delta", "Dubai Sales"], ["draw", "Draw CRM"], ["remote", "Remote CRM"]]);
  const crmOf = (data: Json, code: string) => (data.crms ?? []).find((c: Json) => c.code === code) ?? {};
  same("Delta's people working this month, as the CRM sent them (Cara: nothing; Eli: last month's lead only — hidden)",
    crmOf(d, "delta").people?.map((p: Json) => [p.name, p.team, p.closingsMonth, p.closingsToday, p.callsToday, p.connectedToday, p.talkSecondsToday]),
    [["Asha", "Falcons", 9, 1, 40, 22, 5400], ["Bina", "Falcons", 4, 1, 25, 11, 2000], ["Dev", "Falcons", 0, 0, 3, 1, 60]]);
  same("Draw's leads can't be read here: everybody shown, nobody hidden", crmOf(d, "draw").people?.map((p: Json) => p.name), ["Wasim", "Yan"]);
  check("Delta and Draw ok, with this month", crmOf(d, "delta").status === "ok" && crmOf(d, "draw").status === "ok" && crmOf(d, "delta").month === MONTH_NOW, show(d.crms));
  check("the signed-in answer keeps emails", crmOf(d, "delta").people?.[0]?.email === "asha@delta-e2e.test");
  same("closes of both CRMs, newest first, older than 2 h left out", (d.closes ?? []).map((c: Json) => c.key), ["delta:d2", "draw:w1", "delta:d1"]);
  const w1 = (d.closes ?? []).find((c: Json) => c.key === "draw:w1");
  check("a close: CRM code and name, closer, courses, amount and currency", w1?.crm === "draw" && w1.crmName === "Draw CRM" && w1.closer === "Wasim"
    && w1.courses[0] === "Draw Basics" && w1.amount === 55000 && w1.currency === "INR" && !("student" in w1), show(w1));
  same("on a break: both CRMs, longest first, with CRM and team", (d.onBreak ?? []).map((b: Json) => [b.name, b.crm, b.crmName, b.team, b.kind]),
    [["Bina", "delta", "Dubai Sales", "Falcons", "lunch"], ["Zed", "draw", "Draw CRM", "Tigers", null]]);
  same("photos from HRMS: Bina's link, Zed has none (initials)", (d.onBreak ?? []).map((b: Json) => b.photoUrl), ["https://hrms-e2e.test/photos/bina.jpg?sig=abc", null]);
  check("HRMS asked once, signed, for the people on a break and in the tables (each once)", hrmsHits.length === 1 && hrmsHits[0].signed
    && hrmsHits[0].emails.sort().join() === "ada@delta-e2e.test,asha@delta-e2e.test,bina@delta-e2e.test,dev@delta-e2e.test,dilshad@delta-e2e.test,sam@delta-e2e.test,tom@delta-e2e.test,wasim@draw-e2e.test,yan@draw-e2e.test,zed@draw-e2e.test", show(hrmsHits));
  same("the tables' people carry their photo too (the podium): Bina's link, Asha none", crmOf(d, "delta").people?.map((p: Json) => p.photoUrl),
    [null, "https://hrms-e2e.test/photos/bina.jpg?sig=abc", null]);
  check("each CRM asked once, the full answer (no parts=live, no after yet)", hitsOf("delta").length === 1 && hitsOf("draw").length === 1 && hitsOf("delta")[0].query === "", show(hits));

  step("Case 1b — the bosses: hidden on the Sales TV, shown on the Manager TV");
  check("Sales TV: Tom (team leader), Sam (Sales Manager) and Ada (Super Admin) hidden; Dev (leads only an inactive team) shown",
    !crmOf(d, "delta").people?.some((p: Json) => ["Tom", "Sam", "Ada"].includes(p.name)) && crmOf(d, "delta").people?.some((p: Json) => p.name === "Dev"), show(crmOf(d, "delta").people?.map((p: Json) => p.name)));
  const pubSales = await call("/public/sales-tv");
  check("…the open link the same", !(crmOf(pubSales.body?.data ?? {}, "delta").people ?? []).some((p: Json) => ["Tom", "Sam", "Ada"].includes(p.name)));

  step("Case 3 — errors: Remote's old server");
  const remote = crmOf(d, "remote");
  check("Remote: outdated, its server needs updating; the others unaffected", remote.status === "outdated" && /Remote CRM's server needs updating/.test(remote.error ?? "") && (remote.people ?? []).length === 0, show(remote));

  step("Case 2 — the cache");
  const before = hits.length;
  await Promise.all([call("/sales-tv", root), call("/public/sales-tv"), call("/public/sales-tv"), call("/sales-tv", root)]);
  check("four screens inside 5 s: no CRM asked again", hits.length === before, show(hits.slice(before)));
  await sleep(5300);
  r = await call("/public/sales-tv");
  const liveHits = hits.slice(before);
  check("after 5 s: one live call per CRM", liveHits.filter((h) => h.crm === "delta").length === 1 && liveHits.filter((h) => h.crm === "draw").length === 1, show(liveHits));
  check("…parts=live, with after= the newest close seen", liveHits.filter((h) => h.crm !== "remote").every((h) => h.query.includes("parts=live"))
    && !!liveHits.find((h) => h.crm === "draw")?.query.includes("after="), show(liveHits));
  check("Remote's old server: not asked again inside 30 s", liveHits.filter((h) => h.crm === "remote").length === 0, show(liveHits));
  same("Delta sending its closes again: each kept once", (r.body?.data?.closes ?? []).filter((c: Json) => c.crm === "delta").map((c: Json) => c.id), ["d2", "d1"]);
  check("HRMS not asked again for the same people", hrmsHits.length === 1, show(hrmsHits));

  step("Case 2 — since: only what is new");
  const t0 = r.body?.data?.serverTime;
  r = await call(`/public/sales-tv?since=${encodeURIComponent(t0)}`);
  same("nothing new since the last answer", r.body?.data?.closes, []);
  drawCloses.push({ id: "w2", closer: "Wasim", closerEmail: "wasim@draw-e2e.test", courses: ["Draw Advanced"], amount: 7000, academy: "dubai", currency: "AED", at: ago(0) });
  await sleep(5300);
  r = await call(`/public/sales-tv?since=${encodeURIComponent(t0)}`);
  same("a close arriving after: only it", (r.body?.data?.closes ?? []).map((c: Json) => c.key), ["draw:w2"]);
  r = await call("/public/sales-tv?since=garbage");
  check("a since that isn't a date: ignored (everything)", r.status === 200 && (r.body?.data?.closes ?? []).length === 4, show(r.body?.data?.closes));

  step("Case 4 — the open answer has no emails");
  r = await call("/public/sales-tv");
  check("open: 200 without a session, noindex", r.status === 200 && /noindex/.test(r.headers.get("x-robots-tag") ?? ""), String(r.status));
  check("no email anywhere in it", !/@/.test(r.text.replace(/https:\/\/[^"]*/g, "")) && !/email/i.test(r.text), r.text.slice(0, 300));
  const pd = r.body?.data ?? {};
  check("open: the people not working this month are hidden there too", !/Cara|Eli/.test(r.text) && /Dev/.test(r.text), show(crmOf(pd0(r), "delta").people));
  check("…but names, teams, counts, photo links and close amounts", crmOf(pd, "delta").people?.[0]?.name === "Asha" && crmOf(pd, "delta").people?.[0]?.team === "Falcons"
    && crmOf(pd, "delta").people?.[0]?.closingsMonth === 9 && crmOf(pd, "delta").people?.[1]?.photoUrl?.startsWith("https://") && pd.onBreak?.[0]?.photoUrl?.startsWith("https://") && pd.closes?.[0]?.amount > 0, show(pd));
  check("…and this month's revenue (the user, 2026-10-20: shown on the TV)", crmOf(pd, "delta").people?.[0]?.revenueMonth === 50000, show(crmOf(pd, "delta").people?.[0]));

  step("Case 3 — Draw goes down");
  drawDown = true;
  await sleep(5300);
  r = await call("/sales-tv", root);
  let draw = crmOf(r.body?.data ?? {}, "draw");
  check("signed in: Draw in error with the CRM's reason; its last table kept", draw.status === "error" && /Draw CRM would not share its Sales TV/.test(draw.error ?? "") && draw.people?.length === 2, show(draw));
  check("…Delta carries on", crmOf(r.body?.data ?? {}, "delta").status === "ok");
  r = await call("/public/sales-tv");
  draw = crmOf(r.body?.data ?? {}, "draw");
  check("open: a plain sentence, not the CRM's own words", draw.status === "error" && draw.error === "Draw CRM can't be reached right now." && !/10\.0\.0\.7/.test(r.text), show(draw));
  drawDown = false;

  step("Case 2 — the people again only after 30 s");
  const fullBefore = hitsOf("delta").filter((h) => !h.query.includes("parts=live")).length;
  await sleep(Math.max(0, firstAt + 31_000 - Date.now()));
  r = await call("/sales-tv", root);
  const fullAfter = hitsOf("delta").filter((h) => !h.query.includes("parts=live")).length;
  check("Delta asked for its people a second time, once", fullAfter === fullBefore + 1, `full calls ${fullBefore} → ${fullAfter}; ${show(hitsOf("delta"))}`);
  check("Remote asked again after 30 s, once", hitsOf("remote").length === 2, show(hitsOf("remote")));
  check("Draw back: ok again", crmOf(r.body?.data ?? {}, "draw").status === "ok", show(crmOf(r.body?.data ?? {}, "draw")));
  check("no CRM asked more often than once per 5 s overall", ["delta", "draw", "remote"].every((c) => hitsOf(c).length <= 10), show(hits.map((h) => h.crm)));

  step("Case 5 — Manager TV: the three CRMs and the CS team");
  await Organization.create({ code: "commission", kind: "commission", name: "CS Portal", timezone: "Asia/Dubai", currency: "USD", fxToBase: 1, isActive: true, sortOrder: 5, accent: "#0d9488" });
  check("no session: 401", (await call("/manager-tv")).status === 401);
  check("not a root admin: 403", (await call("/manager-tv", member)).status === 403);
  let m = await call("/manager-tv", root);
  let md = m.body?.data ?? {};
  check("200: the Sales TV's three CRMs, in order", m.status === 200 && (md.crms ?? []).map((c: Json) => c.code).join() === "delta,draw,remote", show(md.crms?.map((c: Json) => c.code)));
  check("…with the team leader, Sales Manager and Super Admin the Sales TV hides", ["Tom", "Sam", "Ada", "Asha"].every((n) => (crmOf(md, "delta").people ?? []).some((p: Json) => p.name === n)), show(crmOf(md, "delta").people?.map((p: Json) => p.name)));
  const pubManager = await call("/public/manager-tv");
  check("…on the open link too", ["Tom", "Sam", "Ada"].every((n) => (crmOf(pubManager.body?.data ?? {}, "delta").people ?? []).some((p: Json) => p.name === n)));
  // The order (2026-10-26): closings, then revenue — whatever order the CRM sent.
  const order = (crmOf(md, "delta").people ?? []).map((p: Json) => p.name) as string[];
  check("ranked by revenue, then closings, then calls: Asha, Bina, Ada (AED 4,000, 3 calls), Sam (AED 4,000, none), Tom (2 closings but AED 3,500)",
    order.indexOf("Asha") === 0 && order.indexOf("Bina") === 1 && order.indexOf("Ada") === 2 && order.indexOf("Sam") === 3 && order.indexOf("Tom") === 4, show(order));
  const salesOrder = (crmOf(d, "delta").people ?? []).map((p: Json) => [p.name, p.revenueMonth, p.closingsMonth, p.callsToday]);
  check("…the Sales TV in the same order", salesOrder.every((r: Json, i: number) => {
    if (i === 0) return true;
    const [, rev, clo, calls] = salesOrder[i - 1];
    return rev > r[1] || (rev === r[1] && (clo > r[2] || (clo === r[2] && calls >= r[3])));
  }), show(salesOrder));
  check("…and the CS team card, as CS Portal ranks it", md.cs?.status === "ok" && md.cs?.name === "CS team" && (md.cs?.people ?? []).map((p: Json) => p.name).join() === "Noor,Omar,Priya", show(md.cs));
  same("…Noor's month, today, payments and HRMS photo", (({ monthAed, todayAed, payments, todayPayments, photoUrl, team }) => ({ monthAed, todayAed, payments, todayPayments, photoUrl, team }))(md.cs?.people?.[0] ?? {}),
    { monthAed: 12000, todayAed: 3670, payments: 4, todayPayments: 1, photoUrl: "https://hrms-e2e.test/photos/noor.jpg", team: "Falcons" });
  same("…the totals", md.cs?.totals, { monthAed: 21000, todayAed: 3670, payments: 7 });
  check("asked for Dubai's board", csHits[0] === "?location=dubai", show(csHits));
  const csClose = (md.closes ?? []).find((c: Json) => c.key === "cs:p1");
  check("the CS payment among the closes, as a CS payment", csClose?.crm === "cs" && csClose?.kind === "cs_payment" && csClose?.closer === "Noor" && csClose?.amount === 3670 && csClose?.courses?.join() === "DQMP", show(csClose));
  check("…with the sales' closes still there", (md.closes ?? []).some((c: Json) => c.crm === "delta"), show(md.closes));
  const mSince = md.serverTime;
  await call("/manager-tv", root);
  await call("/public/manager-tv");
  check("CS Portal asked once for three screens inside 20 s", csHits.length === 1, show(csHits));
  m = await call(`/manager-tv?since=${encodeURIComponent(mSince)}`, root);
  check("?since=: no CS payment it already had", !(m.body?.data?.closes ?? []).some((c: Json) => c.crm === "cs"), show(m.body?.data?.closes));
  const pub = await call("/public/manager-tv");
  check("the open link: the CS card too, no email anywhere", pub.status === 200 && pub.body?.data?.cs?.people?.length === 3 && !/@/.test(JSON.stringify(pub.body?.data ?? {}).replace(/https?:\/\/[^"]*/g, "")), pub.text.slice(0, 300));
  csRecent.unshift({ id: "p2", cs: "Omar", team: "Hawks", aed: 1835, product: "Forex Mastery", at: new Date().toISOString() });
  csDown = false;
  await sleep(21_000);
  m = await call(`/manager-tv?since=${encodeURIComponent(mSince)}`, root);
  const fresh = (m.body?.data?.closes ?? []).filter((c: Json) => c.crm === "cs").map((c: Json) => c.key);
  check("after 20 s: asked again, and only the new payment comes with ?since=", csHits.length === 2 && fresh.join() === "cs:p2", `${show(csHits)} ${show(fresh)}`);
  csDown = true;
  await sleep(21_000);
  m = await call("/manager-tv", root);
  md = m.body?.data ?? {};
  check("CS Portal down: the CS card says why, the CRMs carry on", md.cs?.status === "error" && /exploded/.test(md.cs?.error ?? "") && (md.crms ?? []).length === 3, show(md.cs));
  const pubDown = await call("/public/manager-tv");
  check("…the open link in a plain sentence, without its words", pubDown.body?.data?.cs?.error === "The CS figures can't be reached right now." && !pubDown.text.includes("10.0.0.9"), show(pubDown.body?.data?.cs));

  step("Case 6 — today's money, and Dilshad hidden on the Manager TV");
  const sNow = (await call("/sales-tv", root)).body?.data ?? {};
  check("Sales TV, Delta today: AED 3,000 — Asha 2,000 + Dev's approved 1,000 (not the rupees, the pending balance payment, yesterday's, nor Cara's, not on the TV)",
    crmOf(sNow, "delta").revenueToday === 3000, show(crmOf(sNow, "delta").revenueToday));
  check("…a CRM whose database can't be read: today unknown (null), not 0", crmOf(sNow, "draw").revenueToday === null && crmOf(sNow, "remote").revenueToday === null,
    show([crmOf(sNow, "draw").revenueToday, crmOf(sNow, "remote").revenueToday]));
  check("…nobody hidden on the Sales TV", !("hidden" in crmOf(sNow, "delta")), show(crmOf(sNow, "delta").hidden ?? null));
  for (const [label, path, who] of [["signed in", "/manager-tv", root], ["the open link", "/public/manager-tv", undefined]] as [string, string, Record<string, string> | undefined][]) {
    const mt = (await call(path, who)).body?.data ?? {};
    const delta = crmOf(mt, "delta");
    check(`Manager TV (${label}): Dilshad not listed — the other bosses still are`, !(delta.people ?? []).some((p: Json) => p.name === "Dilshad")
      && ["Tom", "Sam", "Ada"].every((n) => (delta.people ?? []).some((p: Json) => p.name === n)), show(delta.people?.map((p: Json) => p.name)));
    same(`…his figures counted as hidden (${label})`, delta.hidden, { count: 1, closingsMonth: 2, closingsToday: 1, revenueMonth: 7000, callsToday: 2, connectedToday: 1, talkSecondsToday: 100 });
    check(`…today includes his AED 4,000: 7,000 (${label})`, delta.revenueToday === 7000, show(delta.revenueToday));
  }

  step("Case 4 — root admins only for the signed-in page");
  check("no session: 401", (await call("/sales-tv")).status === 401);
  check("not a root admin: 403", (await call("/sales-tv", member)).status === 403);

  console.log(`\n${checks - failures}/${checks} checks passed`);
}

main()
  .catch((err) => { console.error(err); failures++; })
  .finally(async () => {
    stand.close();
    await mongoose.disconnect().catch(() => {});
    process.exit(failures ? 1 : 0);
  });
