/**
 * DGO KPI facts end to end (routes/serviceRoutes.ts GET /service/dgo/kpi-facts, services/dgoKpiFactsService.ts), by
 * the real backend:
 *
 *   Case 1  the door      no secret 401, a wrong one 401, a CRM's or the LMS's secret 401, HRMS switched off 503
 *   Case 2  the day       missing, malformed, not a real day, tomorrow → 400
 *   Case 3  today         the tracker's rows for Delta, Draw and Remote: each metric against the person's share of the
 *                         target, uncapped; achievedPct their average with each capped at 200; a metric with no target
 *                         left out; score equal to the tracker's own; Banglore left out; emails lower-cased and trimmed;
 *                         somebody with no email named in problems; five-star reviews with words that Dubai day only,
 *                         first names only; kept, not counted again
 *   Case 4  yesterday     the LMS failing and a CRM switched off: each named in problems, the rest still answers
 *
 * Run through scripts/dgo-kpi-facts-check.sh. Scratch databases on 127.0.0.1 only; the LMS is a stand-in.
 */
import http from "node:http";
import mongoose, { Types } from "mongoose";

const uris = ["MONGODB_URI", "DELTA_MONGODB_URI", "DRAW_MONGODB_URI", "REMOTE_MONGODB_URI", "BANGLORE_MONGODB_URI"].map((k) => [k, process.env[k] ?? ""] as const);
for (const [name, value] of uris) {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(value)) {
    console.error(`Refusing to run: ${name} must be a scratch e2e database on 127.0.0.1, got "${value}"`);
    process.exit(1);
  }
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const HRMS_SECRET = process.env.HRMS_SSO_SECRET ?? "";
const LMS_SECRET = process.env.LMS_SSO_SECRET ?? "";

let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail !== "" ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}\x1b[0m`); }
}
const step = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function ask(date: string | null, secret: string | null = HRMS_SECRET): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${ROOT}/service/dgo/kpi-facts${date === null ? "" : `?date=${date}`}`, { headers: secret === null ? {} : { "x-portal-secret": secret } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const DAY_MS = 86_400_000;
const TODAY = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const YESTERDAY = addDays(TODAY, -1), TOMORROW = addDays(TODAY, 1);
/** An instant inside a Dubai day: its start plus some hours. */
const at = (day: string, hours: number) => new Date(Date.parse(`${day}T00:00:00Z`) - 4 * 3_600_000 + hours * 3_600_000);

/* ── The stand-in LMS ─────────────────────────────────────────────────────────────────────────────────────────── */

const stand = { failFor: "" as string, asked: [] as string[] };
// What an LMS would hold for the day; the stand-in hands all of it back, so Root's own filter is what's checked.
const reviewsFor = (day: string) => [
  { id: "r-good", kind: "mentor_rating", rating: 5, comment: "  Brilliant class, finally understood risk  ", createdAt: at(day, 10), student: { id: "s1", name: "Aisha Rahman Khan" }, class: { id: "c1", title: "Forex basics" }, instructor: { id: "i1", name: "Mentor One", email: " Mentor.One@LMS-e2e.test " }, program: "forex" },
  { id: "r-four", kind: "mentor_rating", rating: 4, comment: "Good", createdAt: at(day, 11), student: { id: "s2", name: "Bilal" }, class: { id: "c1", title: "Forex basics" }, instructor: { id: "i1", name: "Mentor One", email: "mentor.one@lms-e2e.test" }, program: "forex" },
  { id: "r-blank", kind: "mentor_rating", rating: 5, comment: "   ", createdAt: at(day, 12), student: { id: "s3", name: "Chen" }, class: null, instructor: { id: "i2", name: "Mentor Two", email: "mentor.two@lms-e2e.test" }, program: "forex" },
  { id: "r-early", kind: "mentor_rating", rating: 5, comment: "Late-night thanks", createdAt: at(day, -0.5), student: { id: "s4", name: "Dana" }, class: null, instructor: { id: "i2", name: "Mentor Two", email: "mentor.two@lms-e2e.test" }, program: "forex" },
  { id: "cf:x", kind: "class_feedback", rating: 5, comment: "Nice class", createdAt: at(day, 13), student: { id: "s5", name: "Eli" }, class: { id: "c2", title: "Charts" }, instructor: { id: "i2", name: "Mentor Two", email: "mentor.two@lms-e2e.test" }, program: "forex" },
  { id: "r-nomail", kind: "mentor_rating", rating: 5, comment: "Great", createdAt: at(day, 14), student: { id: "s6", name: "Fay" }, class: null, instructor: { id: "i3", name: "No Mail", email: "" }, program: "forex" },
  { id: "r-two", kind: "mentor_rating", rating: 5, comment: "Patient and clear", createdAt: at(day, 15), student: { id: "s7", name: "Gul" }, class: { id: "c3", title: "Psychology" }, instructor: { id: "i2", name: "Mentor Two", email: "MENTOR.TWO@lms-e2e.test" }, program: "forex" },
];

const standin = http.createServer((req, res) => {
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  stand.asked.push(`${u.pathname}${u.search}`);
  if (req.headers["x-portal-secret"] !== LMS_SECRET) return send(401, { success: false, message: "Bad secret" });
  if (u.pathname === "/lms/api/v1/service/instructor-reviews/feed") {
    const day = u.searchParams.get("from") ?? "";
    if (stand.failFor === day) return send(500, { success: false, message: "The feed fell over" });
    const items = reviewsFor(day);
    return send(200, { success: true, data: { reviews: items, total: items.length, page: 1, perPage: 100, stats: {} } });
  }
  send(404, { success: false, message: "Not found" });
});

/* ── The CRMs ─────────────────────────────────────────────────────────────────────────────────────────────────── */

const id = () => new Types.ObjectId();
const log = (by: Types.ObjectId, action: string, when: Date, description = "") => ({ action, description, performedBy: by, createdAt: when });

async function main() {
  mongoose.set("autoIndex", false);
  await new Promise<void>((ok) => standin.listen(Number(process.env.E2E_STANDIN_PORT), "127.0.0.1", ok));
  await mongoose.connect(process.env.MONGODB_URI!);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  await mongoose.connection.db!.dropDatabase();
  const open = async (k: string) => { const c = await mongoose.createConnection(process.env[k]!).asPromise(); await c.dropDatabase(); return c.db!; };
  const delta = await open("DELTA_MONGODB_URI"), draw = await open("DRAW_MONGODB_URI"), remote = await open("REMOTE_MONGODB_URI"), banglore = await open("BANGLORE_MONGODB_URI");

  step("Setting up: the registry, four CRMs' day, Delta's targets and a typed-in figure");
  const { Organization } = await import("../models/Organization.js");
  const { TrackerTarget } = await import("../models/TrackerTarget.js");
  const { DailyEntry } = await import("../models/DailyEntry.js");
  const { orgTracker } = await import("../services/trackerService.js");
  const crm = (code: string, name: string, currency: string, sortOrder: number, timezone = "Asia/Dubai") =>
    ({ code, kind: "crm", name, timezone, currency, fxToBase: currency === "INR" ? 0.044 : 1, isActive: true, sortOrder, accent: "#2563eb" });
  await Organization.create([
    crm("delta", "Dubai Sales", "AED", 1), crm("draw", "Draw", "AED", 2), crm("remote", "Remote", "AED", 3), crm("banglore", "Banglore", "INR", 4, "Asia/Kolkata"),
    { code: "lms", kind: "lms", name: "Delta LMS", timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder: 5, accent: "#7c3aed" },
    { code: "hrms", kind: "hrms", name: "Delta HRMS", timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder: 6, accent: "#0891b2" },
  ]);

  // Delta: three working people (Ali, Bea, Nomail) → each gets a third of the desk's targets; Carl is quiet (dormant),
  // Dave's account is closed. The desk: 6 leads, 3 follow-ups, 3 closings, AED 3,000 a day, 50% conversion (a rate,
  // never divided), and no target for demos — so Ali's typed-in demos is left out.
  const A = { ali: id(), bea: id(), nomail: id(), carl: id(), dave: id() };
  await delta.collection("users").insertMany([
    { _id: A.ali, name: "Ali Alpha", email: "  Ali.Alpha@Delta-e2e.test ", status: "active" },
    { _id: A.bea, name: "Bea Beta", email: "bea@delta-e2e.test", status: "active" },
    { _id: A.nomail, name: "Nomail Rep", email: "", status: "active" },
    { _id: A.carl, name: "Carl Quiet", email: "CARL@delta-e2e.test", status: "active" },
    { _id: A.dave, name: "Dave Gone", email: "", status: "inactive" },
  ]);
  const t = at(TODAY, 2), y = at(YESTERDAY, 2);
  await delta.collection("leads").insertMany([
    { _id: id(), assignedTo: A.ali, activityLogs: [log(A.ali, "note_added", t)], payments: [{ _id: id(), amount: 3_500, paidAt: t, addedBy: A.ali }] },
    { _id: id(), assignedTo: A.ali, activityLogs: [log(A.ali, "status_changed", t, 'Status changed from "new" to "closed"')], payments: [] },
    { _id: id(), assignedTo: A.bea, activityLogs: [log(A.bea, "call_logged", t), log(A.bea, "call_logged", y)], payments: [] },
    { _id: id(), assignedTo: A.nomail, activityLogs: [log(A.nomail, "call_logged", t)], payments: [] },
  ]);
  await TrackerTarget.create({ org: "delta", metrics: { leadsContacted: 6, followUpsDone: 3, closings: 3, convRate: 50, revenueCollected: 3_000, demos: 0 } });
  await DailyEntry.create({ org: "delta", userId: String(A.ali), userName: "Ali Alpha", date: TODAY, metrics: { demos: 3 } });

  // Draw: one person, the default targets (90 leads a day…) — one lead contacted.
  const D = { dina: id() };
  await draw.collection("users").insertMany([{ _id: D.dina, name: "Dina Draw", email: "dina@draw-e2e.test", status: "active" }]);
  await draw.collection("leads").insertMany([{ _id: id(), assignedTo: D.dina, activityLogs: [log(D.dina, "call_logged", t), log(D.dina, "call_logged", y)], payments: [] }]);

  // Remote: one person.
  const R = { rex: id() };
  await remote.collection("users").insertMany([{ _id: R.rex, name: "Rex Remote", email: "rex@remote-e2e.test", status: "active" }]);
  await remote.collection("leads").insertMany([{ _id: id(), assignedTo: R.rex, activityLogs: [log(R.rex, "note_added", t)], payments: [] }]);

  // Banglore: a big day — never in the answer.
  const B = { bala: id() };
  await banglore.collection("users").insertMany([{ _id: B.bala, name: "Bala Blr", email: "bala@blr-e2e.test", status: "active" }]);
  await banglore.collection("leads").insertMany([{ _id: id(), assignedTo: B.bala, activityLogs: [log(B.bala, "note_added", at(TODAY, 3))], payments: [{ _id: id(), amount: 900_000, paidAt: at(TODAY, 3), addedBy: B.bala }] }]);
  check("set up", true);

  step("Case 1 — the door");
  check("no secret → 401", (await ask(TODAY, null)).status === 401);
  check("a wrong secret → 401", (await ask(TODAY, "not-the-secret")).status === 401);
  check("the LMS's secret doesn't open it → 401", (await ask(TODAY, LMS_SECRET)).status === 401);
  await Organization.updateOne({ code: "hrms" }, { $set: { isActive: false } });
  const off = await ask(TODAY);
  check("HRMS switched off in the registry → 503", off.status === 503, off.body);
  await Organization.updateOne({ code: "hrms" }, { $set: { isActive: true } });

  step("Case 2 — the day");
  check("no date → 400", (await ask(null)).status === 400);
  check("2026-13-01 → 400", (await ask("2026-13-01")).status === 400);
  check("2026-02-30 (not a real day) → 400", (await ask("2026-02-30")).status === 400);
  check("not a day → 400", (await ask("today")).status === 400);
  const future = await ask(TOMORROW);
  check("tomorrow → 400, saying it hasn't happened", future.status === 400 && /hasn't happened yet/.test(future.body.message), future.body);

  step(`Case 3 — today (${TODAY})`);
  const res = await ask(TODAY);
  const d = res.body.data;
  check("200, the day and when it was made", res.status === 200 && d.date === TODAY && Number.isFinite(Date.parse(d.generatedAt)), res.body);
  const person = (email: string) => d.people.find((p: Json) => p.email === email);
  const ali = person("ali.alpha@delta-e2e.test");
  const metric = (p: Json, key: string) => p?.metrics.find((m: Json) => m.key === key);
  check("Ali: email lower-cased and trimmed, Delta, his name", ali?.crm === "delta" && ali?.name === "Ali Alpha", ali);
  check("…his share of the targets: 2 leads, 1 follow-up, 1 closing, AED 1,000, conversion 50% (not divided)",
    metric(ali, "leadsContacted")?.target === 2 && metric(ali, "followUpsDone")?.target === 1 && metric(ali, "closings")?.target === 1
    && metric(ali, "revenueCollected")?.target === 1_000 && metric(ali, "convRate")?.target === 50, ali?.metrics);
  check("…each metric uncapped: leads 100, follow-ups 200, closings 100, conversion 100, revenue 350",
    metric(ali, "leadsContacted")?.pct === 100 && metric(ali, "followUpsDone")?.pct === 200 && metric(ali, "closings")?.pct === 100
    && metric(ali, "convRate")?.pct === 100 && metric(ali, "revenueCollected")?.pct === 350 && metric(ali, "revenueCollected")?.actual === 3_500, ali?.metrics);
  check("…his typed-in demos has no target, so it's left out (five metrics)", ali?.metrics.length === 5 && !metric(ali, "demos"), ali?.metrics.map((m: Json) => m.key));
  check("…achievedPct 140: (100 + 200 + 100 + 100 + 200 capped from 350) / 5", ali?.achievedPct === 140, ali?.achievedPct);
  check("…the metrics carry the tracker's labels", metric(ali, "revenueCollected")?.label === "Revenue Collected" && metric(ali, "leadsContacted")?.label === "Leads Count Today");
  const bea = person("bea@delta-e2e.test");
  check("Bea: one lead of two (50%), nothing else — achievedPct 10", bea?.achievedPct === 10 && metric(bea, "leadsContacted")?.pct === 50 && metric(bea, "followUpsDone")?.pct === 0, bea);
  const tracker = await orgTracker("delta", TODAY);
  const rootScore = (email: string) => tracker.rows.find((r) => r.email.trim().toLowerCase() === email)?.score;
  check("score is the tracker's own (each metric capped at 100): Ali 100, Bea 10", ali?.score === 100 && ali?.score === rootScore("ali.alpha@delta-e2e.test") && bea?.score === 10 && bea?.score === rootScore("bea@delta-e2e.test"), { ali: ali?.score, bea: bea?.score });
  const carl = person("carl@delta-e2e.test");
  check("Carl (quiet): there, lower-cased, achievedPct 0", carl?.achievedPct === 0 && carl?.score === 0, carl);
  check("Nomail Rep (active, no email): no row, named in problems", !d.people.some((p: Json) => p.name === "Nomail Rep") && d.problems.some((p: string) => /1 person has no email \(Nomail Rep\)/.test(p)), d.problems);
  check("…a closed account with no email isn't named", !d.problems.some((p: string) => p.includes("Dave Gone")), d.problems);
  const dina = person("dina@draw-e2e.test");
  check("Draw: Dina on the default targets — one lead of 90, achievedPct 0.2", dina?.crm === "draw" && dina?.achievedPct === 0.2 && metric(dina, "leadsContacted")?.target === 90, dina);
  check("Remote: Rex there", person("rex@remote-e2e.test")?.crm === "remote");
  check("Banglore left out: no row, no email of its people", !d.people.some((p: Json) => p.crm === "banglore") && !JSON.stringify(d).includes("blr-e2e.test"));
  check("every email lower-cased and trimmed", d.people.every((p: Json) => p.email === p.email.trim().toLowerCase()));
  check("people best first", d.people.every((p: Json, i: number) => i === 0 || d.people[i - 1].achievedPct >= p.achievedPct));

  const reviewIds = d.reviews.map((r: Json) => r.id);
  check("reviews: only five stars with words, that Dubai day, a mentor's rating (not class feedback), with a mentor email",
    reviewIds.length === 2 && reviewIds.includes("r-good") && reviewIds.includes("r-two"), reviewIds);
  const good = d.reviews.find((r: Json) => r.id === "r-good");
  check("…the mentor's email lower-cased and trimmed, the words trimmed, the class, rating 5",
    good?.mentorEmail === "mentor.one@lms-e2e.test" && good?.mentorName === "Mentor One" && good?.comment === "Brilliant class, finally understood risk" && good?.className === "Forex basics" && good?.rating === 5, good);
  check("…the student's first name only", good?.studentName === "Aisha" && !JSON.stringify(d.reviews).includes("Rahman"), good);
  check("…a review with no mentor email named in problems", d.problems.some((p: string) => /LMS: 1 review has no mentor email/.test(p)), d.problems);
  const asked = stand.asked.find((a) => a.startsWith("/lms/api/v1/service/instructor-reviews/feed")) ?? "";
  check("the LMS was asked for that day, five stars, with words, mentor ratings", asked.includes(`from=${TODAY}`) && asked.includes(`to=${TODAY}`) && asked.includes("rating=5") && asked.includes("withComment=1") && asked.includes("kind=mentor_rating"), asked);
  check("only the two expected problems today", d.problems.length === 2, d.problems);

  const askedBefore = stand.asked.length;
  const again = await ask(TODAY);
  check("asked again: kept, not counted again (same generatedAt, the LMS not asked again)", again.body.data?.generatedAt === d.generatedAt && stand.asked.length === askedBefore);

  step(`Case 4 — yesterday (${YESTERDAY}), with the LMS failing and Remote switched off`);
  stand.failFor = YESTERDAY;
  await Organization.updateOne({ code: "remote" }, { $set: { isActive: false } });
  const past = (await ask(YESTERDAY)).body.data;
  check("the LMS named in problems, no reviews", past.reviews.length === 0 && past.problems.some((p: string) => /LMS: its reviews couldn't be read/.test(p)), past.problems);
  check("Remote switched off: named in problems, no row of it", past.problems.some((p: string) => /Remote isn't an active sales CRM/.test(p)) && !past.people.some((p: Json) => p.crm === "remote"), past.problems);
  check("…Delta and Draw still answer for yesterday: Bea one lead (50%), Ali nothing (0)",
    past.people.find((p: Json) => p.email === "bea@delta-e2e.test")?.metrics.find((m: Json) => m.key === "leadsContacted")?.pct > 0
    && past.people.find((p: Json) => p.email === "ali.alpha@delta-e2e.test")?.achievedPct === 0 && past.people.some((p: Json) => p.crm === "draw"), past.people);
  await Organization.updateOne({ code: "remote" }, { $set: { isActive: true } });
  stand.failFor = "";

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
