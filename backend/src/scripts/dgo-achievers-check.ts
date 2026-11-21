/**
 * DGO achiever metrics end to end (routes/serviceRoutes.ts GET /service/dgo/achiever-metrics,
 * services/dgoAchieverMetricsService.ts), by the real backend:
 *
 *   Case 1  the door        no secret 401, a wrong one 401, HRMS switched off in the registry 503
 *   Case 2  the month       missing, malformed or not started yet → 400
 *   Case 3  a whole month   Dubai sales as gift rewards count them (who is left out, team leaders apart with their whole
 *                           team, a waiting balance payment not counted, Remote's rupees at its own rate), who took a
 *                           gift, Banglore left out; CS from the real board with emails and the Dubai CS Manager from
 *                           the overview; mentors with role, score and coverage; nothing in `problems`; kept, not re-read
 *   Case 4  a source down   last month: CS Portal's board fails — named in `problems`, sales and mentors still answer
 *   Case 5  more problems   a CRM switched off and a CS with no email: each named, the rest still answers
 *
 * Run through scripts/dgo-achievers-check.sh. Scratch databases on 127.0.0.1 only; CS Portal is a stand-in.
 */
import http from "node:http";
import mongoose, { Types } from "mongoose";
import { DEFAULT_CATEGORIES, emptyTargets, type FeedRow } from "../services/mentorKpiMetrics.js";

const uris = ["MONGODB_URI", "DELTA_MONGODB_URI", "DRAW_MONGODB_URI", "REMOTE_MONGODB_URI", "BANGLORE_MONGODB_URI"].map((k) => [k, process.env[k] ?? ""] as const);
for (const [name, value] of uris) {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(value)) {
    console.error(`Refusing to run: ${name} must be a scratch e2e database on 127.0.0.1, got "${value}"`);
    process.exit(1);
  }
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const HRMS_SECRET = process.env.HRMS_SSO_SECRET ?? "";
const COMMISSION_SECRET = process.env.COMMISSION_SSO_SECRET ?? "";

let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail !== "" ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}\x1b[0m`); }
}
const step = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function ask(month: string | null, secret: string | null = HRMS_SECRET): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${ROOT}/service/dgo/achiever-metrics${month === null ? "" : `?month=${month}`}`, { headers: secret === null ? {} : { "x-portal-secret": secret } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1 + n, 1)).toISOString().slice(0, 7);
};
const MONTH = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 7);
const M1 = addMonths(MONTH, -1), M2 = addMonths(MONTH, -2), NEXT = addMonths(MONTH, 1);
/** Noon on the 15th of a month, Dubai — well inside it. */
const midMonth = (month: string) => new Date(`${month}-15T08:00:00.000Z`);

/* ── The stand-in CS Portal ───────────────────────────────────────────────────────────────────────────────────── */

const stand = { boardDownFor: "" as string, asked: [] as string[], overviewRanges: [] as string[] };
const board = (month: string) => ({
  location: "dubai", month, generated_at: new Date().toISOString(),
  cs: [
    { id: "c1", name: "Cara CS", team: "Team One", month_aed: month === MONTH ? 120_000 : 40_000, today_aed: 0, payments: 3, today_payments: 0, photo: null, rank: 1 },
    { id: "c2", name: "Cole CS", team: "Team One", month_aed: 80_000, today_aed: 0, payments: 2, today_payments: 0, photo: null, rank: 2 },
    ...(month === M2 ? [{ id: "c3", name: "Nomail CS", team: "Team One", month_aed: 5_000, today_aed: 0, payments: 1, today_payments: 0, photo: null, rank: 3 }] : []),
  ],
  teams: [],
  totals: { month_aed: month === MONTH ? 200_000 : month === M2 ? 125_000 : 120_000, today_aed: 0, payments: 5 },
  recent: [],
});
const overviewRows = [
  { id: "c1", name: "Cara CS", email: "  Cara@CS-e2e.test ", role: "cs", active: true, location: "dubai" },
  { id: "c2", name: "Cole CS", email: "cole@cs-e2e.test", role: "cs", active: true, location: "dubai" },
  { id: "m1", name: "Mona Manager", email: "Mona@CS-e2e.test", role: "cs_manager", active: true, location: "dubai" },
  { id: "m2", name: "Blr Manager", email: "blr.manager@cs-e2e.test", role: "cs_manager", active: true, location: "bangalore" },
  { id: "m3", name: "Gone Manager", email: "gone.manager@cs-e2e.test", role: "cs_manager", active: false, location: "dubai" },
];
const tot = (held: number) => ({
  classes: held, held, classesCancelled: 0, bookings: 0, bookingsCancelled: 0, attended: 0, missed: 0, meetings: 0, meetingsCancelled: 0,
  lateJoins: 0, lateMinutes: 0, notJoined: 0, reviews: 0, lowRatings: 0, avgRating: null, commission_usd: 0,
  lateClockIns: 0, lateClockInMinutes: 0, daysPresent: 0, daysAbsent: 0, daysLeave: 0, workedMinutes: 0,
});
const mentorRow = (id: string, name: string, email: string, role: string, held: number): FeedRow =>
  ({ id, name, email, role, in_lms: true, in_hrms: true, total: tot(held) } as FeedRow);
const mentors = [
  mentorRow("p-chief", "Chief Test", "Chief@Mentor-e2e.test", "chief_mentor", 44),
  mentorRow("p-senior", "Senior Test", "senior@mentor-e2e.test", "senior_mentor", 36),
  mentorRow("p-junior", "Junior Test", "junior@mentor-e2e.test", "junior_mentor", 20),
  mentorRow("p-norole", "No Role", "norole@mentor-e2e.test", "", 50),
];

const standin = http.createServer((req, res) => {
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  stand.asked.push(`${u.pathname}${u.search}`);
  if (u.pathname === "/commission/api/public/cs-tv") {
    const month = u.searchParams.get("month") ?? MONTH;
    if (u.searchParams.get("location") !== "dubai") return send(400, { error: "location" });
    if (stand.boardDownFor === month) return send(500, { error: "The board couldn't be made — try again" });
    const b = board(month);
    // Without real=1 the board would carry the amounts typed for the TV: shown here as a figure nobody should see.
    if (u.searchParams.get("real") !== "1") b.cs = b.cs.map((c) => ({ ...c, month_aed: 99_999 }));
    return send(200, b);
  }
  if (req.headers["x-portal-secret"] !== COMMISSION_SECRET) return send(401, { success: false, message: "bad secret" });
  if (u.pathname === "/commission/api/v1/service/cs-overview") {
    stand.overviewRanges.push(`${u.searchParams.get("from")}|${u.searchParams.get("to")}`);
    return send(200, { success: true, data: { rows: overviewRows, totals: {}, recentUpgrades: [] } });
  }
  if (u.pathname === "/commission/api/v1/service/mentor-report") {
    return send(200, { success: true, data: { from: u.searchParams.get("from"), to: u.searchParams.get("to"), everyone: true, mentors, lms: { available: true }, hrms: { available: true } } });
  }
  send(404, { success: false, message: "Not found" });
});

/* ── The CRMs ─────────────────────────────────────────────────────────────────────────────────────────────────── */

const id = () => new Types.ObjectId();
const now = new Date(Date.now() - 60_000);
const pay = (amount: number, extra: Record<string, unknown> = {}) => ({ _id: id(), amount, paidAt: now, ...extra });

async function main() {
  mongoose.set("autoIndex", false);
  await new Promise<void>((ok) => standin.listen(Number(process.env.E2E_STANDIN_PORT), "127.0.0.1", ok));
  await mongoose.connect(process.env.MONGODB_URI!);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  await mongoose.connection.db!.dropDatabase();
  const open = async (k: string) => { const c = await mongoose.createConnection(process.env[k]!).asPromise(); await c.dropDatabase(); return c.db!; };
  const delta = await open("DELTA_MONGODB_URI"), draw = await open("DRAW_MONGODB_URI"), remote = await open("REMOTE_MONGODB_URI"), banglore = await open("BANGLORE_MONGODB_URI");

  step("Setting up: the registry, four CRMs, gift claims, a mentor KPI plan");
  const { Organization } = await import("../models/Organization.js");
  const { RewardClaim } = await import("../models/RewardClaim.js");
  const { MentorKpiPlan } = await import("../models/MentorKpiPlan.js");
  const crm = (code: string, name: string, currency: string, sortOrder: number) =>
    ({ code, kind: "crm", name, timezone: "Asia/Dubai", currency, fxToBase: currency === "INR" ? 0.044 : 1, isActive: true, sortOrder, accent: "#2563eb" });
  await Organization.create([
    crm("delta", "Dubai Sales", "AED", 1), crm("draw", "Draw", "AED", 2), crm("remote", "Remote", "AED", 3), crm("banglore", "Banglore", "INR", 4),
    { code: "commission", kind: "commission", name: "CS Portal", timezone: "Asia/Dubai", currency: "USD", fxToBase: 1, isActive: true, sortOrder: 5, accent: "#0d9488" },
    { code: "hrms", kind: "hrms", name: "Delta HRMS", timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder: 6, accent: "#0891b2" },
  ]);

  // Delta: Team Alpha (active) led by Lead Alpha; an inactive team; the people gift rewards leave out.
  const saRole = id(), repRole = id();
  const P = { lead: id(), sana: id(), sam: id(), sid: id(), manager: id(), excluded: id(), admin: id(), inactive: id(), noTeam: id(), oldTeam: id() };
  await delta.collection("roles").insertMany([{ _id: saRole, roleName: "Super Admin", isSystemRole: true }, { _id: repRole, roleName: "BDE", isSystemRole: false }]);
  const user = (_id: Types.ObjectId, name: string, email: string, extra: Record<string, unknown> = {}) => ({ _id, name, email, status: "active", role: repRole, ...extra });
  await delta.collection("users").insertMany([
    user(P.lead, "Lead Alpha", "Lead.Alpha@Delta-e2e.test"),
    user(P.sana, "Sana One", "sana@delta-e2e.test"),
    user(P.sam, "Sam Two", "sam@delta-e2e.test"),
    user(P.sid, "Sid Three", "sid@delta-e2e.test"),
    user(P.manager, "Sales Manager", "manager@delta-e2e.test"),
    user(P.excluded, "Excluded Person", "excluded@delta-e2e.test"),
    user(P.admin, "Admin Person", "admin@delta-e2e.test", { role: saRole }),
    user(P.inactive, "Inactive Person", "inactive@delta-e2e.test", { status: "inactive" }),
    user(P.noTeam, "No Team", "noteam@delta-e2e.test"),
    user(P.oldTeam, "Old Team Member", "oldteam@delta-e2e.test"),
  ]);
  await delta.collection("teams").insertMany([
    { name: "Team Alpha", status: "active", leaders: [P.lead], members: [P.sana, P.sam, P.sid, P.manager, P.excluded, P.admin, P.inactive] },
    { name: "Team Old", status: "inactive", leaders: [], members: [P.oldTeam] },
  ]);
  await delta.collection("commissionsettings").insertOne({ salesManager: P.manager, excludedUsers: [P.excluded] });
  const lead = (assignedTo: Types.ObjectId, payments: unknown[]) => ({ _id: id(), name: "Lead", assignedTo, status: "closed", createdAt: now, payments });
  await delta.collection("leads").insertMany([
    lead(P.lead, [pay(5_000)]),
    lead(P.sana, [pay(60_000), pay(7_000, { paidAt: midMonth(M1) })]),
    lead(P.sam, [pay(55_000)]),
    // A balance payment finance hasn't approved yet doesn't count.
    lead(P.sid, [pay(10_000), pay(50_000, { finance: { externalId: "bp-1", state: "pending", method: "cash", sentAt: now } })]),
    lead(P.manager, [pay(1_000)]),
    lead(P.excluded, [pay(2_000)]),
    lead(P.admin, [pay(3_000)]),
    lead(P.inactive, [pay(4_000)]),
    lead(P.noTeam, [pay(90_000)]),
    lead(P.oldTeam, [pay(80_000)]),
  ]);

  // Draw: Team Beta, led by Lead Beta (who took a gift).
  const D = { lead: id(), dina: id() };
  await draw.collection("roles").insertOne({ _id: id(), roleName: "Super Admin", isSystemRole: true });
  await draw.collection("users").insertMany([
    { _id: D.lead, name: "Lead Beta", email: "lead.beta@draw-e2e.test", status: "active" },
    { _id: D.dina, name: "Dina Draw", email: "dina@draw-e2e.test", status: "active" },
  ]);
  await draw.collection("teams").insertOne({ name: "Team Beta", status: "active", leaders: [D.lead], members: [D.dina] });
  await draw.collection("leads").insertMany([lead(D.dina, [pay(30_000)]), lead(D.lead, [pay(2_500)])]);

  // Remote: Team Gamma; Rex collects AED 1,000 and ₹45,500 at Remote's own rate of 45.5 → AED 1,000.
  const R = { lead: id(), rex: id() };
  await remote.collection("users").insertMany([
    { _id: R.lead, name: "Lead Gamma", email: "lead.gamma@remote-e2e.test", status: "active" },
    { _id: R.rex, name: "Rex Remote", email: "rex@remote-e2e.test", status: "active" },
  ]);
  await remote.collection("teams").insertOne({ name: "Team Gamma", status: "active", leaders: [R.lead], members: [R.rex] });
  await remote.collection("appsettings").insertOne({ key: "app", bangaloreRevenue: { inrPerAed: 45.5 } });
  await remote.collection("leads").insertMany([lead(R.rex, [pay(1_000), pay(45_500, { currency: "INR" })])]);

  // Banglore: somebody with a big month — never in the answer.
  const B = { lead: id(), bala: id() };
  await banglore.collection("users").insertMany([
    { _id: B.lead, name: "Lead Blr", email: "lead@blr-e2e.test", status: "active" },
    { _id: B.bala, name: "Bala Blr", email: "bala@blr-e2e.test", status: "active" },
  ]);
  await banglore.collection("teams").insertOne({ name: "Team Blr", status: "active", leaders: [B.lead], members: [B.bala] });
  await banglore.collection("leads").insertMany([lead(B.bala, [pay(900_000)])]);

  const giftId = id();
  const claim = (portal: string, userId: Types.ObjectId, role: "sales" | "tl", live = true) =>
    ({ portal, month: MONTH, userId: String(userId), userName: "x", role, giftId, giftName: "A gift", live, status: live ? "requested" : "cancelled" });
  await RewardClaim.create([claim("delta", P.sana, "sales"), claim("delta", P.sam, "sales", false), claim("draw", D.lead, "tl")]);

  const targets = emptyTargets();
  for (const role of ["junior_mentor", "senior_mentor", "chief_mentor"] as const) targets[role] = { classes_held: 40 };
  await MentorKpiPlan.create({
    from: M2, status: "approved", categories: DEFAULT_CATEGORIES, targets, overrides: [],
    createdBy: { id: null, email: "root@e2e.test" }, updatedBy: { id: null, email: "root@e2e.test" },
    approvedBy: { id: null, email: "root@e2e.test" }, approvedAt: new Date(),
  });
  check("set up", true);

  step("Case 1 — the door");
  check("no secret → 401", (await ask(MONTH, null)).status === 401);
  check("a wrong secret → 401", (await ask(MONTH, "not-the-secret")).status === 401);
  check("a CRM's or CS Portal's secret doesn't open it → 401", (await ask(MONTH, COMMISSION_SECRET)).status === 401);
  await Organization.updateOne({ code: "hrms" }, { $set: { isActive: false } });
  const off = await ask(MONTH);
  check("HRMS switched off in the registry → 503", off.status === 503, off.body);
  await Organization.updateOne({ code: "hrms" }, { $set: { isActive: true } });

  step("Case 2 — the month");
  check("no month → 400", (await ask(null)).status === 400);
  check("2026-13 → 400", (await ask("2026-13")).status === 400);
  check("not a month → 400", (await ask("november")).status === 400);
  const future = await ask(NEXT);
  check("next month → 400, saying it hasn't started", future.status === 400 && /hasn't started/.test(future.body.message), future.body);

  step(`Case 3 — a whole month (${MONTH})`);
  const res = await ask(MONTH);
  const d = res.body.data;
  check("200, the month and when it was made", res.status === 200 && d.month === MONTH && Number.isFinite(Date.parse(d.generatedAt)), res.body);
  check("nothing in problems", Array.isArray(d.problems) && d.problems.length === 0, d.problems);
  const sale = (email: string, crmCode = "delta") => d.sales.find((r: Json) => r.email === email && r.crm === crmCode);
  check("Sana: AED 60,000 this month (last month's 7,000 not), took a gift", sale("sana@delta-e2e.test")?.salesAed === 60_000 && sale("sana@delta-e2e.test")?.giftClaimed === true, sale("sana@delta-e2e.test"));
  check("Sam: AED 55,000, a cancelled gift isn't a gift", sale("sam@delta-e2e.test")?.salesAed === 55_000 && sale("sam@delta-e2e.test")?.giftClaimed === false, sale("sam@delta-e2e.test"));
  check("Sid: AED 10,000 — the balance payment finance hasn't approved isn't counted", sale("sid@delta-e2e.test")?.salesAed === 10_000, sale("sid@delta-e2e.test"));
  check("each row says its team", sale("sana@delta-e2e.test")?.team === "Team Alpha" && sale("dina@draw-e2e.test", "draw")?.team === "Team Beta");
  const emails = d.sales.map((r: Json) => r.email);
  check("left out as gift rewards leave them out: Sales Manager, commission-excluded, Super Admin, inactive, no team, only an inactive team",
    ["manager@delta-e2e.test", "excluded@delta-e2e.test", "admin@delta-e2e.test", "inactive@delta-e2e.test", "noteam@delta-e2e.test", "oldteam@delta-e2e.test"].every((e) => !emails.includes(e)), emails);
  check("a team leader is never a salesperson row", !emails.includes("lead.alpha@delta-e2e.test") && !emails.includes("lead.beta@draw-e2e.test"), emails);
  check("emails lower-cased and trimmed", d.sales.every((r: Json) => r.email === r.email.trim().toLowerCase()) && d.teams.every((t: Json) => t.leaderEmail === t.leaderEmail.toLowerCase()));
  const team = (crmCode: string) => d.teams.find((t: Json) => t.crm === crmCode);
  check("Team Alpha: the whole team, leader included — 5,000 + 60,000 + 55,000 + 10,000 + 1,000 + 2,000 + 3,000 + 4,000 = 140,000 (as the CRM's closedBy adds its people)",
    team("delta")?.salesAed === 140_000 && team("delta")?.leaderEmail === "lead.alpha@delta-e2e.test" && team("delta")?.leaderName === "Lead Alpha" && team("delta")?.team === "Team Alpha", team("delta"));
  check("…its leader took no gift; Draw's leader did", team("delta")?.leaderGiftClaimed === false && team("draw")?.leaderGiftClaimed === true, d.teams);
  check("Draw: Dina AED 30,000; Team Beta 32,500", sale("dina@draw-e2e.test", "draw")?.salesAed === 30_000 && team("draw")?.salesAed === 32_500, { dina: sale("dina@draw-e2e.test", "draw"), team: team("draw") });
  check("Remote: Rex AED 1,000 + ₹45,500 at its own 45.5 = 2,000", sale("rex@remote-e2e.test", "remote")?.salesAed === 2_000 && team("remote")?.salesAed === 2_000, sale("rex@remote-e2e.test", "remote"));
  check("Banglore left out: no row, no email of its people", !d.sales.some((r: Json) => r.crm === "banglore") && !d.teams.some((t: Json) => t.crm === "banglore")
    && !JSON.stringify(d).includes("blr-e2e.test"));
  check("sales ranked by the month, best first", d.sales.every((r: Json, i: number) => i === 0 || d.sales[i - 1].salesAed >= r.salesAed));

  const cs = (email: string) => d.cs.find((r: Json) => r.email === email);
  check("CS from the real board (real=1), with its email from the overview, lower-cased and trimmed", cs("cara@cs-e2e.test")?.collectedAed === 120_000 && cs("cara@cs-e2e.test")?.role === "cs"
    && cs("cole@cs-e2e.test")?.collectedAed === 80_000 && !JSON.stringify(d.cs).includes("99999"), d.cs);
  check("the board was asked for Dubai, real=1, this month with no month parameter", stand.asked.some((a) => a.startsWith("/commission/api/public/cs-tv") && /location=dubai/.test(a) && /real=1/.test(a) && !/month=/.test(a)), stand.asked);
  check("the Dubai CS Manager, from the overview (own figure 0); not Bangalore's, not a switched-off one", cs("mona@cs-e2e.test")?.role === "cs_manager" && cs("mona@cs-e2e.test")?.collectedAed === 0
    && !cs("blr.manager@cs-e2e.test") && !cs("gone.manager@cs-e2e.test"), d.cs);
  check("csDepartment: the board's Dubai total, 200,000", d.csDepartment?.collectedAed === 200_000, d.csDepartment);
  const range = stand.overviewRanges[0]?.split("|") ?? [];
  check("the overview was asked for the Dubai month", range[0] === new Date(Date.UTC(Number(MONTH.slice(0, 4)), Number(MONTH.slice(5)) - 1, 1) - 4 * 3_600_000).toISOString(), stand.overviewRanges);

  const mentor = (email: string) => d.mentors.find((m: Json) => m.email === email);
  check("mentors: chief, senior and junior with their role", mentor("chief@mentor-e2e.test")?.role === "chief_mentor" && mentor("senior@mentor-e2e.test")?.role === "senior_mentor" && mentor("junior@mentor-e2e.test")?.role === "junior_mentor", d.mentors);
  check("…each with a score (number or null) and coverage 0–100", d.mentors.every((m: Json) => (m.score === null || typeof m.score === "number") && typeof m.coverage === "number" && m.coverage >= 0 && m.coverage <= 100), d.mentors);
  check("…a mentor with no CS Portal role is left out", !mentor("norole@mentor-e2e.test"), d.mentors);

  const again = await ask(MONTH);
  check("asked again: kept, not counted again (same generatedAt)", again.body.data?.generatedAt === d.generatedAt);

  step(`Case 4 — a source down (${M1})`);
  stand.boardDownFor = M1;
  const past = (await ask(M1)).body.data;
  check("CS Portal's board named in problems", past.problems.some((p: string) => /CS: CS Portal's board couldn't be read/.test(p)), past.problems);
  check("…the CS list is empty but the CS Manager still comes from the overview", !past.cs.some((r: Json) => r.role === "cs") && past.cs.some((r: Json) => r.role === "cs_manager"), past.cs);
  check("…sales still answer: Sana's last month 7,000, no gift then", past.sales.find((r: Json) => r.email === "sana@delta-e2e.test")?.salesAed === 7_000
    && past.sales.find((r: Json) => r.email === "sana@delta-e2e.test")?.giftClaimed === false, past.sales);
  check("…mentors still answer", past.mentors.length === 3, past.mentors);
  stand.boardDownFor = "";

  step(`Case 5 — more problems (${M2})`);
  await Organization.updateOne({ code: "draw" }, { $set: { isActive: false } });
  const p2 = (await ask(M2)).body.data;
  check("Draw switched off: named in problems", p2.problems.some((p: string) => /Draw isn't an active sales CRM/.test(p)), p2.problems);
  check("…Delta and Remote still answer, Draw has no row", p2.sales.some((r: Json) => r.crm === "delta") && p2.teams.some((t: Json) => t.crm === "remote") && !p2.sales.some((r: Json) => r.crm === "draw"), p2.sales);
  check("a CS on the board with no email in the overview: named in problems, the row kept with an empty email", p2.problems.some((p: string) => /no email for 1 CS \(Nomail CS\)/.test(p))
    && p2.cs.some((r: Json) => r.name === "Nomail CS" && r.email === ""), { problems: p2.problems, cs: p2.cs });
  check("the past month's board asked with its month", stand.asked.some((a) => a.includes(`month=${M2}`)), stand.asked);
  await Organization.updateOne({ code: "draw" }, { $set: { isActive: true } });

  console.log(`\n${checks - failures}/${checks} checks passed`);
  standin.close();
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  standin.close();
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
