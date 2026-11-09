/**
 * Mentor KPIs (2026-11-09), end to end — services/mentorKpiScoring.ts, mentorKpiService.ts and /api/v1/mentor-kpis:
 *
 *   Case 1  the points   a KPI against its target both ways, a worked mentor by hand, pro-rating a count by the month
 *                        gone and leave, a source down or too little data spread over the rest (never a zero), a
 *                        mentor's own target, no CS Portal role
 *   Case 2  checks       what a draft and an approval refuse: weights, a metric twice or unknown, missing targets
 *                        (only for metrics Root can measure), a mentor's own target with no reason
 *   Case 3  the plan     start a draft (the approved structure), one at a time, save, targets suggested from the last
 *                        three months (median, leave taken out), approve — recorded; nothing before this month
 *   Case 4  scores       a month scored with the version in force for it, ranking, sources, one mentor with a trend;
 *                        a newer version from the same month replaces the older; a month before any plan has none
 *   Case 5  permission   no session → 401, an admin who is not a root admin → 403
 *
 * Run through scripts/mentor-kpi-check.sh. Scratch database on 127.0.0.1 only; CS Portal is a fake served here.
 */
import http from "node:http";
import mongoose from "mongoose";
import {
  kpiScore, monthElapsed, planProblems, planShares, scoreMentor, targetsFromHistory, type ScoreContext,
} from "../services/mentorKpiScoring.js";
import { DEFAULT_CATEGORIES, emptyTargets, type FeedRow, type PlanCategory } from "../services/mentorKpiMetrics.js";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(uri)) {
  console.error(`Refusing to run: MONGODB_URI must be a scratch e2e database on 127.0.0.1, got "${uri}"`);
  process.exit(1);
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const PASSWORD = "KpiE2e!pass1";

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);
const show = (v: unknown) => JSON.stringify(v).slice(0, 600);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(method: string, p: string, headers: Record<string, string> = {}, body?: unknown): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${ROOT}${p}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const dubaiToday = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1 + n, 1)).toISOString().slice(0, 7);
};
const MONTH = dubaiToday().slice(0, 7);
const M1 = addMonths(MONTH, -1), M2 = addMonths(MONTH, -2), M3 = addMonths(MONTH, -3), M4 = addMonths(MONTH, -4);

/* ── The fake CS Portal: its mentor report, a month at a time ─────────────────────────────────────────────────── */

const row = (id: string, name: string, email: string, role: string, t: Record<string, number | null>, lms = true, hrms = true): FeedRow =>
  ({ id, name, email, role, in_lms: lms, in_hrms: hrms, total: t });
const tot = (held: number, extra: Record<string, number | null> = {}) => ({
  classes: held, held, classesCancelled: 0, bookings: 0, bookingsCancelled: 0, attended: 0, missed: 0, meetings: 0, meetingsCancelled: 0,
  lateJoins: 0, lateMinutes: 0, notJoined: 0, reviews: 0, lowRatings: 0, avgRating: null, commission_usd: 0,
  lateClockIns: 0, lateClockInMinutes: 0, daysPresent: 0, daysAbsent: 0, daysLeave: 0, workedMinutes: 0, ...extra,
});

/*
 * History, for the suggested targets. Juniors' classes held, a full month's each: Bilal 40, 44 (34 in a month with 5
 * of 22 days on leave → 34 ÷ 17/22 = 44), 50; Chen 30, 36, 60 → median 42. Ratings with at least 5 reviews: 4.6, 4.4,
 * 4.0, 4.2, 4.5 → 4.4 (Bilal's 4.8 from 3 reviews doesn't count). Days present: Bilal only (Chen isn't in the HRMS).
 */
const HISTORY: Record<string, FeedRow[]> = {
  [M3]: [
    row("p-bilal", "Bilal Test", "bilal@kpi-e2e.test", "junior_mentor", tot(40, { reviews: 10, avgRating: 4.6, daysPresent: 20, daysAbsent: 2 })),
    row("p-chen", "Chen Test", "chen@kpi-e2e.test", "junior_mentor", tot(30, { reviews: 6, avgRating: 4.0 }), true, false),
    row("p-aisha", "Aisha Test", "aisha@kpi-e2e.test", "senior_mentor", tot(60, { reviews: 20, avgRating: 4.8, daysPresent: 21, daysAbsent: 1 })),
  ],
  [M2]: [
    row("p-bilal", "Bilal Test", "bilal@kpi-e2e.test", "junior_mentor", tot(50, { reviews: 8, avgRating: 4.4, daysPresent: 22 })),
    row("p-chen", "Chen Test", "chen@kpi-e2e.test", "junior_mentor", tot(36, { reviews: 5, avgRating: 4.2 }), true, false),
    row("p-aisha", "Aisha Test", "aisha@kpi-e2e.test", "senior_mentor", tot(64, { reviews: 18, avgRating: 4.7, daysPresent: 22 })),
  ],
  [M1]: [
    row("p-bilal", "Bilal Test", "bilal@kpi-e2e.test", "junior_mentor", tot(34, { reviews: 3, avgRating: 4.8, daysPresent: 17, daysLeave: 5 })),
    row("p-chen", "Chen Test", "chen@kpi-e2e.test", "junior_mentor", tot(60, { reviews: 12, avgRating: 4.5 }), true, false),
    row("p-aisha", "Aisha Test", "aisha@kpi-e2e.test", "senior_mentor", tot(68, { reviews: 25, avgRating: 4.9, daysPresent: 20, daysAbsent: 2 })),
    row("", "Eve Instructor", "eve@kpi-e2e.test", "", tot(12, { reviews: 6, avgRating: 4.9 }), true, false),
  ],
};
let fakeCalls = 0;
let lmsDown = false;
const fake = http.createServer((req, res) => {
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.headers["x-portal-secret"] !== "mentor-kpi-e2e-portal-secret") return send(401, { success: false, message: "bad secret" });
  if (u.pathname !== "/api/v1/service/mentor-report") return send(404, { success: false, message: "Not found" });
  fakeCalls++;
  const month = String(u.searchParams.get("from")).slice(0, 7);
  const rows = HISTORY[month] ?? HISTORY[M1]!.map((r) => ({ ...r, total: { ...r.total } }));
  send(200, {
    success: true,
    data: {
      from: u.searchParams.get("from"), to: u.searchParams.get("to"), everyone: true, mentors: rows,
      lms: lmsDown ? { available: false, message: "The LMS did not answer" } : { available: true }, hrms: { available: true },
    },
  });
});

/* ── A small plan for the hand-worked cases ───────────────────────────────────────────────────────────────────── */

const SMALL: PlanCategory[] = [
  {
    key: "a", name: "A", weight: 60, subs: [
      { key: "a1", name: "A1", weight: 50, kpis: [{ metric: "classes_held", weight: 50, mode: "scored" }, { metric: "on_time_start", weight: 50, mode: "scored" }] },
      { key: "a2", name: "A2", weight: 50, kpis: [{ metric: "student_rating", weight: 100, mode: "scored" }, { metric: "hours_worked", weight: 0, mode: "monitoring" }] },
    ],
  },
  { key: "b", name: "B", weight: 40, subs: [{ key: "b1", name: "B1", weight: 100, kpis: [{ metric: "days_present", weight: 60, mode: "scored" }, { metric: "late_clockins", weight: 40, mode: "scored" }] }] },
];
const T = emptyTargets();
T.junior_mentor = { classes_held: 40, on_time_start: 90, student_rating: 4.5, days_present: 95, late_clockins: 2 };
const ok = { available: true };
const ctx = (patch: Partial<ScoreContext> = {}): ScoreContext => ({
  categories: SMALL, targets: T, overrides: [], sources: { lms: ok, hrms: ok, cs_portal: ok }, elapsed: 1, ...patch,
});
// 30 held, 3 of 30 joined late → 90% on time; 10 reviews at 4.5; 19 of 20 days present; 4 late clock-ins.
const worked = row("p1", "Worked Example", "worked@kpi-e2e.test", "junior_mentor",
  tot(30, { lateJoins: 3, reviews: 10, avgRating: 4.5, daysPresent: 19, daysAbsent: 1, lateClockIns: 4, workedMinutes: 9000 }));
const kpiOf = (r: ReturnType<typeof scoreMentor>, metric: string) => r.categories.flatMap((c) => c.subs.flatMap((s) => s.kpis)).find((k) => k.metric === metric)!;

async function main() {
  mongoose.set("autoIndex", false);
  await new Promise<void>((ok) => fake.listen(Number(process.env.E2E_FAKE_PORT), "127.0.0.1", ok));
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  await mongoose.connection.db!.dropDatabase();

  step("Case 1 — the points");
  check("more is better: actual ÷ target, capped at 100", kpiScore("up", 30, 40) === 75 && kpiScore("up", 50, 40) === 100 && kpiScore("up", 5, 0) === null);
  check("fewer is better: 100 at or under the target, 0 at double, 50 half way", kpiScore("down", 2, 2) === 100 && kpiScore("down", 4, 2) === 0
    && kpiScore("down", 3, 2) === 50 && kpiScore("down", 0, 0) === 100 && kpiScore("down", 1, 0) === 0);
  check("the month gone: a finished month 1, half of a 30-day month 0.5, a future month 0",
    monthElapsed("2026-10", "2026-11-09") === 1 && monthElapsed("2026-11", "2026-11-15") === 0.5 && monthElapsed("2026-12", "2026-11-09") === 0);
  const sh = planShares(SMALL);
  check("each KPI's share of the score: 60 × ½ × ½ = 15, rating 30, days 24, late 16 — and they add to 100",
    sh[0]!.subs[0]!.kpis[0] === 15 && sh[0]!.subs[1]!.kpis[0] === 30 && sh[0]!.subs[1]!.kpis[1] === 0 && sh[1]!.subs[0]!.kpis[0] === 24
    && Math.abs(sh.flatMap((c) => c.subs.flatMap((s) => s.kpis)).reduce((a, b) => a + b, 0) - 100) < 1e-9, show(sh));
  let r = scoreMentor(worked, ctx());
  check("a worked mentor: classes 75, on time 100, A1 87.5, rating 100, A 93.8, days 100, late 0, B 60 → 80.3 overall",
    kpiOf(r, "classes_held").score === 75 && kpiOf(r, "on_time_start").score === 100 && r.categories[0]!.subs[0]!.score === 87.5
    && r.categories[0]!.score === 93.8 && kpiOf(r, "late_clockins").score === 0 && r.categories[1]!.score === 60 && r.score === 80.3 && r.coverage === 100, show(r));
  check("…a monitoring KPI shows its value, no score, no weight", kpiOf(r, "hours_worked").status === "monitoring" && kpiOf(r, "hours_worked").value === 150 && kpiOf(r, "hours_worked").score === null);
  r = scoreMentor(worked, ctx({ sources: { lms: ok, hrms: { available: false, message: "HRMS down" }, cs_portal: ok } }));
  check("the HRMS doesn't answer: Discipline is left out, not zero — the total is A's 93.8, 60% of the plan scored",
    r.score === 93.8 && r.coverage === 60 && kpiOf(r, "days_present").status === "source_down" && r.quality.hrms === "unavailable", show({ s: r.score, c: r.coverage }));
  r = scoreMentor({ ...worked, total: { ...worked.total, reviews: 3 } }, ctx());
  check("3 reviews is too few to judge the rating: left out → 76.5, 70% scored", kpiOf(r, "student_rating").status === "not_enough" && r.score === 76.5 && r.coverage === 70, show({ s: r.score, c: r.coverage }));
  r = scoreMentor({ ...worked, in_hrms: false }, ctx());
  check("a mentor the HRMS doesn't know by address: not found there, Discipline left out", kpiOf(r, "late_clockins").status === "not_matched" && r.quality.hrms === "not_matched" && r.score === 93.8);
  r = scoreMentor(worked, ctx({ overrides: [{ email: "worked@kpi-e2e.test", name: "Worked", metric: "classes_held", value: 30, reason: "Fewer classes scheduled" }] }));
  check("a mentor's own target (30 classes) wins over the role's: classes 100 → 84 overall", kpiOf(r, "classes_held").targetFrom === "mentor" && kpiOf(r, "classes_held").score === 100 && r.score === 84, show(r.score));
  r = scoreMentor({ ...worked, role: "" }, ctx());
  check("no CS Portal role: values shown, nothing scored, no total", r.score === null && kpiOf(r, "classes_held").status === "no_role" && kpiOf(r, "classes_held").value === 30 && r.roleLabel === "No CS Portal role");
  r = scoreMentor({ ...worked, total: { ...worked.total, held: 10, daysPresent: 9, daysAbsent: 1, daysLeave: 2, lateClockIns: 1 } }, ctx({ elapsed: 0.5 }));
  check("half way through the month with 2 of 12 days on leave: 40 classes becomes 40 × ½ × 10/12 = 16.7; a rate isn't pro-rated",
    kpiOf(r, "classes_held").effectiveTarget === 16.7 && kpiOf(r, "classes_held").score === 59.9 && kpiOf(r, "on_time_start").effectiveTarget === 90
    && kpiOf(r, "late_clockins").effectiveTarget === 0.8, show(kpiOf(r, "classes_held")));
  r = scoreMentor(worked, { ...ctx(), categories: DEFAULT_CATEGORIES });
  check("the approved structure: what no system sends yet (assignments, meetings by who booked, verified payments) is 'not available yet', and the rest still scores",
    kpiOf(r, "verified_collections").status === "not_available" && kpiOf(r, "assignments_reviewed").status === "not_available" && r.score !== null && r.coverage > 0 && r.coverage < 100, show({ s: r.score, c: r.coverage }));

  step("Case 2 — what a plan refuses");
  check("a draft may be unfinished: weights off 100 and no targets are fine", planProblems(DEFAULT_CATEGORIES, emptyTargets(), [], false).length === 0);
  let p = planProblems(DEFAULT_CATEGORIES, emptyTargets(), [], true);
  check("approval wants every role's target for each scored metric Root can measure — not for those it can't yet",
    p.some((x) => x === "Classes held has no junior mentor target") && !p.some((x) => /Meeting-linked|Assignments reviewed/.test(x)), show(p));
  const off100 = structuredClone(SMALL); off100[1]!.weight = 30;
  const full = emptyTargets(); for (const role of ["junior_mentor", "senior_mentor", "chief_mentor"] as const) full[role] = { ...T.junior_mentor };
  check("approval wants the categories to total 100%", planProblems(off100, full, [], true).includes("The categories total 90%, not 100%"));
  check("…and approves a complete plan", planProblems(SMALL, full, [], true).length === 0, show(planProblems(SMALL, full, [], true)));
  const twice = structuredClone(SMALL); twice[1]!.subs[0]!.kpis.push({ metric: "classes_held", weight: 10, mode: "scored" });
  check("a metric twice, or one Root doesn't know, is refused even in a draft",
    planProblems(twice, full, [], false).includes("Classes held is in the plan twice")
    && planProblems([{ ...SMALL[0]!, subs: [{ key: "x", name: "X", weight: 10, kpis: [{ metric: "made_up", weight: 1, mode: "scored" }] }] }], full, [], false).some((x) => /made_up/.test(x)));
  const noScored = structuredClone(SMALL); noScored[1]!.subs[0]!.kpis.forEach((k) => (k.mode = "monitoring"));
  check("a category with weight and nothing scored in it", planProblems(noScored, full, [], true).includes("B has weight but nothing scored in it"));
  check("a mentor's own target needs a reason to be approved",
    planProblems(SMALL, full, [{ email: "x@kpi-e2e.test", name: "X", metric: "classes_held", value: 30, reason: "" }], true).some((x) => /say why/.test(x)));

  step("Setting up: two admins, CS Portal in the registry");
  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  await Organization.create({ code: "commission", kind: "commission", name: "CS Portal", timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder: 9, accent: "#2563eb" });
  await AdminUser.create({ name: "Root E2E", email: "root@kpi-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@kpi-e2e.test", password: PASSWORD, role: "member", status: "active" });
  await mongoose.connection.db!.collection("mentorkpiplans").createIndex({ status: 1 }, { unique: true, partialFilterExpression: { status: "draft" } });
  const login = async (email: string) => {
    const res = await fetch(`${ROOT}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
    const b: Json = await res.json().catch(() => ({}));
    return b?.data?.accessToken ?? b?.data?.token ?? b?.accessToken;
  };
  const root = { authorization: `Bearer ${await login("root@kpi-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@kpi-e2e.test")}` };

  step("Case 5 — permission");
  check("no session → 401", (await call("GET", "/mentor-kpis/plans")).status === 401);
  check("an admin who is not a root admin → 403, on the plan and the scores",
    (await call("GET", "/mentor-kpis/plans", member)).status === 403 && (await call("GET", `/mentor-kpis/scores?month=${M1}`, member)).status === 403
    && (await call("POST", "/mentor-kpis/plans/draft", member, {})).status === 403);

  step("Case 3 — the plan");
  let res = await call("GET", "/mentor-kpis/plans", root);
  check("nothing yet: no plan in force, no draft, the measurable metrics listed",
    res.status === 200 && res.body.data.inForce === null && res.body.data.draft === null && res.body.data.metrics.find((m: Json) => m.key === "classes_held")?.available === true
    && res.body.data.metrics.find((m: Json) => m.key === "verified_collections")?.available === false, show(res.body));
  res = await call("GET", `/mentor-kpis/scores?month=${M1}`, root);
  check("scores with no plan: none, and nothing asked of CS Portal", res.status === 200 && res.body.data.plan === null && fakeCalls === 0, show(res.body));
  check("a draft can't start in a month that has begun before this one", (await call("POST", "/mentor-kpis/plans/draft", root, { from: M1 })).status === 400);
  res = await call("POST", "/mentor-kpis/plans/draft", root, { from: MONTH });
  const draft0 = res.body.data;
  check("a draft from this month starts from the approved structure (5 categories, 35/15/20/20/10), no targets",
    res.status === 201 && draft0.status === "draft" && draft0.categories.map((c: Json) => c.weight).join() === "35,15,20,20,10"
    && Object.keys(draft0.targets.junior_mentor).length === 0, show(draft0));
  check("one draft at a time", (await call("POST", "/mentor-kpis/plans/draft", root, { from: MONTH })).status === 409);
  res = await call("POST", "/mentor-kpis/plans/draft/approve", root);
  check("approving it as it is: refused, every missing target listed", res.status === 400 && /no junior mentor target/.test(res.body.message) && res.body.errors?.problems?.length > 3, show(res.body));
  const bad = structuredClone(draft0); bad.categories[0].weight = 101;
  res = await call("PUT", "/mentor-kpis/plans/draft", root, { ...bad, overrides: [] });
  check("a weight over 100 is refused", res.status === 400, show(res.body));
  res = await call("POST", "/mentor-kpis/plans/draft/suggest-targets", root);
  const sug = res.body.data;
  check("targets suggested from the last three months, asked of CS Portal once a month", res.status === 200 && sug.months.join() === [M3, M2, M1].join() && fakeCalls === 3, show(sug?.months));
  check("…juniors' classes held: the median full month, leave taken out → 42", sug?.draft.targets.junior_mentor.classes_held === 42, show(sug?.draft.targets.junior_mentor));
  check("…juniors' rating: the median of months with 5 reviews or more → 4.4", sug?.draft.targets.junior_mentor.student_rating === 4.4);
  check("…seniors' from their own months; chiefs have none to go on", sug?.draft.targets.senior_mentor.classes_held === 64 && sug?.draft.targets.chief_mentor.classes_held === undefined
    && sug?.draft.targetsBasis.counts.junior_mentor.classes_held === 6, show(sug?.draft.targetsBasis));
  check("…nothing suggested for what can't be measured yet", sug?.draft.targets.junior_mentor.verified_collections === undefined);
  // A root admin fills the chiefs' targets and trims the plan to what is measurable, then approves.
  const edited = structuredClone(sug.draft);
  edited.targets.chief_mentor = { ...edited.targets.senior_mentor };
  // No bookings in the history, so nothing to suggest class attendance from: typed in.
  for (const role of ["junior_mentor", "senior_mentor", "chief_mentor"]) edited.targets[role].class_attendance = 80;
  edited.overrides = [{ email: "chen@kpi-e2e.test", name: "Chen Test", metric: "classes_held", value: 30, reason: "Half-time this month" }];
  res = await call("PUT", "/mentor-kpis/plans/draft", root, edited);
  check("the draft saved with the chiefs' targets and a mentor's own target", res.status === 200 && res.body.data.overrides.length === 1 && res.body.data.targets.chief_mentor.classes_held === 64, show(res.body));
  res = await call("POST", "/mentor-kpis/plans/draft/approve", root);
  check("approved from this month — every role has a target for every measurable scored metric", res.status === 200 && res.body.data.status === "approved" && res.body.data.approvedBy === "root@kpi-e2e.test", show(res.body));
  const audit = await mongoose.connection.db!.collection("auditlogs").find({ action: { $in: ["mentor_kpi_plan_changed", "mentor_kpi_plan_approved"] } }).toArray();
  check("each step recorded against the root admin (the refused save is not)", audit.length === 4 && audit.every((a) => a.adminEmail === "root@kpi-e2e.test") && audit.some((a) => a.action === "mentor_kpi_plan_approved"), show(audit.map((a) => a.detail)));

  step("Case 4 — scores");
  res = await call("GET", `/mentor-kpis/scores?month=${M1}`, root);
  check("last month began before the plan: no plan covers it", res.status === 200 && res.body.data.plan === null);
  res = await call("GET", `/mentor-kpis/scores?month=${MONTH}`, root);
  const s = res.body.data;
  check("this month scored with the plan approved for it", res.status === 200 && s.plan?.from === MONTH && s.mentors.length === 4 && s.sources.lms.available === true, show(s));
  const eve = s.mentors.find((m: Json) => m.email === "eve@kpi-e2e.test");
  check("an LMS instructor with no CS Portal role is listed, not ranked", eve && eve.score === null && eve.rank === null && s.mentors[s.mentors.length - 1].email === "eve@kpi-e2e.test", show(eve));
  check("the ranked come first, highest score first", s.mentors.filter((m: Json) => m.rank).every((m: Json, i: number, a: Json[]) => i === 0 || a[i - 1].score >= m.score));
  res = await call("GET", `/mentor-kpis/scores/mentor?email=chen@kpi-e2e.test&month=${MONTH}`, root);
  const chen = res.body.data;
  const chenClasses = chen?.mentor.categories.flatMap((c: Json) => c.subs.flatMap((x: Json) => x.kpis)).find((k: Json) => k.metric === "classes_held");
  check("one mentor: their own target used, Discipline 'not found in HRMS', a three-month trend",
    res.status === 200 && chenClasses?.targetFrom === "mentor" && chen.mentor.quality.hrms === "not_matched" && chen.trend.length === 3
    && chen.trend[2].month === MONTH && chen.trend[0].plan === null, show(chen?.trend));
  check("a mentor not in the report → 404", (await call("GET", `/mentor-kpis/scores/mentor?email=nobody@kpi-e2e.test&month=${MONTH}`, root)).status === 404);
  check("a month that hasn't started, or a bad one → 400", (await call("GET", `/mentor-kpis/scores?month=${addMonths(MONTH, 1)}`, root)).status === 400
    && (await call("GET", "/mentor-kpis/scores?month=2026-13", root)).status === 400);

  // A second version from the same month: the junior targets for classes held halved.
  res = await call("POST", "/mentor-kpis/plans/draft", root, { from: MONTH });
  check("a new draft starts as a copy of the plan in force", res.status === 201 && res.body.data.targets.junior_mentor.classes_held === 42 && res.body.data.overrides.length === 1);
  const v2 = structuredClone(res.body.data); v2.targets.junior_mentor.classes_held = 21;
  await call("PUT", "/mentor-kpis/plans/draft", root, v2);
  res = await call("POST", "/mentor-kpis/plans/draft/approve", root);
  const plans = (await call("GET", "/mentor-kpis/plans", root)).body.data;
  check("approving it replaces the version from the same month — the old one kept as superseded",
    res.status === 200 && plans.inForce.id === res.body.data.id && plans.versions.length === 2 && plans.versions.some((v: Json) => v.status === "superseded"), show(plans.versions.map((v: Json) => [v.from, v.status])));
  res = await call("POST", "/mentor-kpis/plans/draft", root, { from: addMonths(MONTH, 1) });
  check("a draft can be discarded", res.status === 201 && (await call("DELETE", "/mentor-kpis/plans/draft", root)).status === 200
    && (await call("GET", "/mentor-kpis/plans", root)).body.data.draft === null);
  check("…and with none, saving or approving says so (404)", (await call("POST", "/mentor-kpis/plans/draft/approve", root)).status === 404);

  // A plan approved four months ago (inserted as if then), to score a finished month and see the LMS go down.
  await mongoose.connection.db!.collection("mentorkpiplans").insertOne({
    from: M4, status: "approved", categories: SMALL, targets: { junior_mentor: T.junior_mentor, senior_mentor: T.junior_mentor, chief_mentor: T.junior_mentor },
    overrides: [], note: "", targetsBasis: null, createdBy: { id: null, email: "x" }, updatedBy: { id: null, email: "x" },
    approvedBy: { id: null, email: "x" }, approvedAt: new Date(Date.now() - 30 * 86_400_000), supersededAt: null, createdAt: new Date(), updatedAt: new Date(),
  });
  res = await call("GET", `/mentor-kpis/scores?month=${M1}`, root);
  const bilal = res.body.data.mentors.find((m: Json) => m.email === "bilal@kpi-e2e.test");
  // Bilal last month: 34 held against 40 × 17/22 (5 days' leave) = 30.9 → 100; rating 3 reviews → too few; days 100%; 0 late → 100.
  check("a finished month: leave pro-rates the count target, the rating left out on 3 reviews → 100",
    res.body.data.plan.from === M4 && bilal?.score === 100 && bilal.coverage === 70, show(bilal));
  // The LMS down, asked of a month the server hasn't read yet (its fake rows are last month's).
  lmsDown = true;
  res = await call("GET", `/mentor-kpis/scores?month=${M4}`, root);
  const b2 = res.body.data.mentors?.find((m: Json) => m.email === "bilal@kpi-e2e.test");
  check("the LMS down: its KPIs left out, the HRMS ones still score", res.body.data.sources?.lms?.available === false && b2?.quality.lms === "unavailable" && b2.score === 100 && b2.coverage === 40, show(b2));

  fake.close();
  await mongoose.disconnect();
  console.log(`\n${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  fake.close();
  process.exit(1);
});
