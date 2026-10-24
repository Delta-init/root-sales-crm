/**
 * The CSEs pages' API (services/cseService.ts), end to end against a stand-in
 * Tetra Commission:
 *
 *   Case 1  happy path   the list and one CSE's page, as Tetra Commission says,
 *                        asked with its portal secret; each student's link
 *   Case 2  edge         the period cut in Gulf time and passed as instants;
 *                        none — none passed; a Tetra Commission without the route
 *   Case 3  errors       bad dates, an id that is not one, a CSE it does not know
 *   Case 4  permission   no session, an admin who is not a root admin
 *
 * And Reports → CS portal (GET /portal-reports/cs, 2026-10-17): the period as
 * Gulf days to Tetra Commission's /service/cs-report, the filters passed on.
 *
 * And Pending → CS portal (GET /pending/cs): what waits on each CS, as Tetra
 * Commission's /service/cs-pending says, with the student link (2026-10-17).
 *
 * And Reports → CS portal → Student workflow (GET /portal-reports/cs/workflow and
 * /cs/workflow/students, 2026-10-20): the filters as Gulf days and ids to Tetra
 * Commission's /service/student-workflow, a box or stage checked, its being
 * down said plainly.
 *
 * Run through scripts/cses-check.sh. Scratch database on 127.0.0.1 only.
 */
import { createServer } from "node:http";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(uri)) {
  console.error(`Refusing to run: MONGODB_URI must be a scratch e2e database on 127.0.0.1, got "${uri}"`);
  process.exit(1);
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const PASSWORD = "CsesE2e!pass1";
const CS = "6ac000000000000000000001";

let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);
const show = (v: unknown) => JSON.stringify(v).slice(0, 400);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${ROOT}${path}`, { method, headers: { "content-type": "application/json", ...headers } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// ── A stand-in Tetra Commission ──────────────────────────────────────────────
const seen: { path: string; search: string; secret: string }[] = [];
let oldServer = false, down = false;
const figures = { students: 3, deposits: { count: 2, usd: 1400 }, commissionUsd: 50, followupsToday: 1, followupsOverdue: 1,
  upcoming: { count: 1, amount: { AED: 3000 } }, overdueDues: { count: 1, amount: { USD: 500 } }, balance: { students: 2, amount: { AED: 3000, USD: 500 } },
  bonus: { clients: 1, usd: 500, needsCall: 0, withFinance: 0, waitingBroker: 1 }, notOnboarded: 1, notOnboardedLate: 1 };
const stand = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  seen.push({ path: url.pathname, search: url.search, secret: String(req.headers["x-portal-secret"] ?? "") });
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  // Down: the connection dropped without an answer.
  if (down) { req.socket.destroy(); return; }
  if (req.headers["x-portal-secret"] !== "cses-e2e-commission-secret") return send(401, { success: false, error: { message: "Bad secret" } });
  if (oldServer) return send(404, { success: false, message: "Route not found" });
  if (url.pathname === "/commission/api/v1/service/cs-overview") {
    return send(200, { success: true, data: { today: "2026-10-11", upcomingDays: 7, period: {}, rows: [{ id: CS, name: "Cee One", email: "cs1@tetra.test", role: "cs", active: true, team: "Falcons", ...figures }] } });
  }
  if (url.pathname === `/commission/api/v1/service/cs-overview/${CS}`) {
    return send(200, { success: true, data: { person: { id: CS, name: "Cee One", email: "cs1@tetra.test", role: "cs", active: true, team: "Falcons" }, today: "2026-10-11", upcomingDays: 7,
      summary: figures, followups: [{ studentId: "s1", student: "Asha", code: "STU-1", stage: "Interested", title: "Call", due: "2026-10-11", overdue: false }],
      dues: [], bonus: [], notOnboarded: [], deposits: [], commission: [] } });
  }
  if (url.pathname === "/commission/api/v1/service/cs-report") {
    return send(200, { success: true, data: { period: url.searchParams.get("period"), revenue: { total: { deposit_usd: 1500 }, people: [], teams: [], months: [], rows: [] } } });
  }
  if (url.pathname === "/commission/api/v1/service/student-workflow") {
    const totals = { came: 300, assigned: 300, pool: 0, onboarded: 286, waiting: 1, late: 13, enrolled: 226, contacted: 167, deposited: 1, moved: 13, moved_inactivity: 2 };
    return send(200, { success: true, data: { period: url.searchParams.get("period") ?? "custom", since: url.searchParams.get("from"), until: url.searchParams.get("to"), scope: {},
      generated_at: "2026-10-20T08:00:00.000Z", wait_hours: 6, totals, stages: [{ stage: "No follow-up", count: 163 }, { stage: "Contacted", count: 119 }],
      sources: [{ source: "finance", count: 71 }, { source: "lms", count: 123 }, { source: "sheet", count: 106 }],
      teams: [{ id: "6ac000000000000000000009", name: "Falcons", location: "dubai", ...totals }], people: [{ id: CS, name: "Cee One", team: "Falcons", location: "dubai", ...totals }],
      timeline: [{ day: "2026-10-01", came: 12 }] } });
  }
  if (url.pathname === "/commission/api/v1/service/student-workflow/students") {
    return send(200, { success: true, data: { total: 1, students: [{ id: "s1", name: "Asha", code: "STU-1", came_at: "2026-10-02T06:00:00.000Z", source: "lms", location: "dubai",
      cs: { id: CS, name: "Cee One", team: "Falcons" }, onboarded_at: null, stage: "New", late: true, contacted: false, deposited: false, enrolled: true, moved: false }] } });
  }
  if (url.pathname === "/commission/api/v1/service/mentor-report") {
    return send(200, { success: true, data: { from: url.searchParams.get("from"), to: url.searchParams.get("to"), everyone: true, lms: { available: true },
      mentors: [{ id: "u1", name: "Chief Ann", email: "ann@tetra.test", role: "chief_mentor", in_lms: true, lms_id: "a".repeat(24),
        total: { classes: 3, held: 2, bookings: 9, reviews: 2, avgRating: 4.5, commission_usd: 52.5 }, days: [{ day: "2026-10-21", held: 1, commission_usd: 52.5 }] }] } });
  }
  if (url.pathname === "/commission/api/v1/service/mentor-reviews") {
    return send(200, { success: true, data: { reviews: [{ _id: "r1", rating: 5, comment: "Great" }], total: 1, page: Number(url.searchParams.get("page")), perPage: 50 } });
  }
  if (url.pathname === "/commission/api/v1/service/cs-pending") {
    return send(200, { success: true, data: { today: "2026-10-17", totals: { onboarding: 2, onboarding_late: 1, bonus: 1, total: 3 },
      people: [{ id: CS, name: "Cee One", email: "cs1@tetra.test", role: "cs", active: true, location: "dubai", counts: { onboarding: 2, onboarding_late: 1, bonus: 1 }, total: 3 }],
      noCs: null, tickets: { available: true }, items: { onboarding: [{ studentId: "s1", student: "Asha", code: "STU-1", late: true }], bonus: [], tickets: [], followups: [], completions: [] } } });
  }
  return send(404, { success: false, error: { code: "NOT_FOUND", message: "No such person here" } });
});
await new Promise<void>((ok) => stand.listen(Number(process.env.E2E_STANDIN_PORT), "127.0.0.1", ok));

async function main() {
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  await mongoose.connection.db!.dropDatabase();
  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  await Organization.create({ code: "commission", kind: "commission", name: "Tetra Commission", timezone: "Asia/Dubai", currency: "USD", fxToBase: 1, isActive: true, sortOrder: 5, accent: "#0d9488" });
  await AdminUser.create({ name: "Root E2E", email: "root@cses-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@cses-e2e.test", password: PASSWORD, role: "member", status: "active" });
  const login = async (email: string) => (await (await fetch(`${ROOT}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  })).json())?.data?.accessToken as string;
  const root = { authorization: `Bearer ${await login("root@cses-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@cses-e2e.test")}` };

  step("Case 1 — happy path: the list and one CSE, as Tetra Commission says");
  let r = await call("GET", "/cses?from=2026-10-01&to=2026-10-31", root);
  const row = r.body?.data?.rows?.[0];
  check("the list: Cee One with students, deposits, commission, dues, bonus, not onboarded", r.status === 200 && row?.name === "Cee One" && row.students === 3
    && row.deposits.usd === 1400 && row.commissionUsd === 50 && row.balance.amount.USD === 500 && row.bonus.clients === 1 && row.notOnboardedLate === 1, show(r.body));
  check("…asked of Tetra Commission with its portal secret", seen.at(-1)?.path === "/commission/api/v1/service/cs-overview" && seen.at(-1)?.secret === "cses-e2e-commission-secret", show(seen.at(-1)));
  check("…with each student's link into Tetra Commission", r.body?.data?.studentLink === "https://tetra.example.test/StudentDetail?id=", show(r.body?.data?.studentLink));
  r = await call("GET", "/pending/cs", root);
  check("Pending → CS portal: each CS's counts and the students, as Tetra Commission says", r.status === 200 && r.body?.data?.people?.[0]?.counts?.onboarding === 2
    && r.body.data.items.onboarding[0].student === "Asha" && r.body.data.totals.total === 3, show(r.body));
  check("…asked of its /service/cs-pending with the portal secret, with the student link", seen.at(-1)?.path === "/commission/api/v1/service/cs-pending"
    && seen.at(-1)?.secret === "cses-e2e-commission-secret" && r.body?.data?.studentLink === "https://tetra.example.test/StudentDetail?id=", show(seen.at(-1)));

  r = await call("GET", "/portal-reports/cs?from=2026-09-30T20:00:00.000Z&to=2026-10-31T19:59:59.999Z&location=bangalore&team=6ac000000000000000000009&cs=nope", root);
  const rp = new URLSearchParams(seen.at(-1)?.search ?? "");
  check("Reports → CS portal: Tetra Commission's report, with the student link", r.status === 200 && r.body?.data?.revenue?.total?.deposit_usd === 1500
    && r.body.data.studentLink === "https://tetra.example.test/StudentDetail?id=" && seen.at(-1)?.path === "/commission/api/v1/service/cs-report", show(r.body));
  check("…the period as Gulf days, location and team passed, a bad cs id dropped", rp.get("period") === "custom" && rp.get("from") === "2026-10-01" && rp.get("to") === "2026-10-31"
    && rp.get("location") === "bangalore" && rp.get("team") === "6ac000000000000000000009" && !rp.has("cs"), seen.at(-1)?.search);
  await call("GET", "/portal-reports/cs", root);
  check("…no period: all time", new URLSearchParams(seen.at(-1)?.search ?? "").get("period") === "all", seen.at(-1)?.search);
  check("…a date that is not one: 400", (await call("GET", "/portal-reports/cs?from=whenever", root)).status === 400);

  r = await call("GET", "/portal-reports/cs/workflow?from=2026-09-30T20:00:00.000Z&to=2026-10-31T19:59:59.999Z&location=dubai&team=6ac000000000000000000009&cs=" + CS, root);
  let wp = new URLSearchParams(seen.at(-1)?.search ?? "");
  check("Student workflow: Tetra Commission's totals, stages, sources, teams, people, with the student link", r.status === 200 && r.body?.data?.totals?.came === 300
    && r.body.data.totals.late === 13 && r.body.data.stages[0].stage === "No follow-up" && r.body.data.sources.length === 3 && r.body.data.people[0].name === "Cee One"
    && r.body.data.wait_hours === 6 && r.body.data.studentLink === "https://tetra.example.test/StudentDetail?id=", show(r.body));
  check("…asked of its /service/student-workflow with the portal secret", seen.at(-1)?.path === "/commission/api/v1/service/student-workflow"
    && seen.at(-1)?.secret === "cses-e2e-commission-secret", show(seen.at(-1)));
  check("…the period as Gulf days, location, team and cs passed on", wp.get("from") === "2026-10-01" && wp.get("to") === "2026-10-31" && !wp.has("period")
    && wp.get("location") === "dubai" && wp.get("team") === "6ac000000000000000000009" && wp.get("cs") === CS, seen.at(-1)?.search);
  await call("GET", "/portal-reports/cs/workflow?from=2026-10-05&to=2026-10-06", root);
  wp = new URLSearchParams(seen.at(-1)?.search ?? "");
  check("…days given as days are passed as they are", wp.get("from") === "2026-10-05" && wp.get("to") === "2026-10-06", seen.at(-1)?.search);
  await call("GET", "/portal-reports/cs/workflow", root);
  check("…no period: all time", new URLSearchParams(seen.at(-1)?.search ?? "").get("period") === "all", seen.at(-1)?.search);
  let asked = seen.length;
  check("…a date that is not one, from after to, a bad location or team id: 400, without asking",
    (await call("GET", "/portal-reports/cs/workflow?from=whenever", root)).status === 400
    && (await call("GET", "/portal-reports/cs/workflow?from=2026-10-31&to=2026-10-01", root)).status === 400
    && (await call("GET", "/portal-reports/cs/workflow?location=mars", root)).status === 400
    && (await call("GET", "/portal-reports/cs/workflow?team=nope", root)).status === 400 && seen.length === asked);

  r = await call("GET", `/portal-reports/cs/workflow/students?from=2026-10-01&to=2026-10-31&location=bangalore&box=late&csId=${CS}`, root);
  wp = new URLSearchParams(seen.at(-1)?.search ?? "");
  check("A box's students: Tetra Commission's list, with the student link", r.status === 200 && r.body?.data?.total === 1 && r.body.data.students[0].name === "Asha"
    && r.body.data.students[0].late === true && r.body.data.studentLink === "https://tetra.example.test/StudentDetail?id=", show(r.body));
  check("…asked of /service/student-workflow/students with the secret, the box, csId and filters passed on", seen.at(-1)?.path === "/commission/api/v1/service/student-workflow/students"
    && seen.at(-1)?.secret === "cses-e2e-commission-secret" && wp.get("box") === "late" && wp.get("csId") === CS && wp.get("location") === "bangalore"
    && wp.get("from") === "2026-10-01" && !wp.has("teamId"), seen.at(-1)?.search);
  await call("GET", "/portal-reports/cs/workflow/students?box=came&teamId=", root);
  wp = new URLSearchParams(seen.at(-1)?.search ?? "");
  check("…the open pool's row: teamId passed on empty", wp.has("teamId") && wp.get("teamId") === "" && wp.get("box") === "came", seen.at(-1)?.search);
  await call("GET", "/portal-reports/cs/workflow/students?stage=Session%20with%20CM&teamId=6ac000000000000000000009", root);
  wp = new URLSearchParams(seen.at(-1)?.search ?? "");
  check("…a stage of the legend: passed on, with the team", wp.get("stage") === "Session with CM" && wp.get("teamId") === "6ac000000000000000000009" && !wp.has("box"), seen.at(-1)?.search);
  asked = seen.length;
  for (const box of ["bonus_pending", "bonus_sent_back", "bonus_after_payment", "bonus_needs_call", "bonus_with_finance", "bonus_waiting_broker"]) {
    await call("GET", `/portal-reports/cs/workflow/students?box=${box}`, root);
    wp = new URLSearchParams(seen.at(-1)?.search ?? "");
    check(`…bonus pending's ${box}: accepted and passed on`, wp.get("box") === box, seen.at(-1)?.search);
  }
  asked = seen.length;
  r = await call("GET", "/portal-reports/cs/workflow/students?box=everything", root);
  check("…a box that is not one: 400 naming the boxes, without asking", r.status === 400 && /came, assigned, pool/.test(r.body?.message ?? "") && seen.length === asked, show(r.body));
  check("…no box and no stage, a bad teamId or csId: 400, without asking", (await call("GET", "/portal-reports/cs/workflow/students", root)).status === 400
    && (await call("GET", "/portal-reports/cs/workflow/students?box=came&teamId=x", root)).status === 400
    && (await call("GET", "/portal-reports/cs/workflow/students?box=came&csId=x", root)).status === 400 && seen.length === asked);

  down = true;
  r = await call("GET", "/portal-reports/cs/workflow", root);
  check("Tetra Commission down: 502 saying it could not be reached", r.status === 502 && /Tetra Commission could not be reached/.test(r.body?.message ?? ""), show(r.body));
  r = await call("GET", "/portal-reports/cs/workflow/students?box=came", root);
  check("…for a box's students too", r.status === 502 && /could not be reached/.test(r.body?.message ?? ""), show(r.body));
  down = false;

  r = await call("GET", `/cses/${CS}?from=2026-10-01&to=2026-10-31`, root);
  check("one CSE's page: the figures and the lists", r.status === 200 && r.body?.data?.person?.name === "Cee One" && r.body.data.followups[0].student === "Asha"
    && r.body.data.summary.followupsToday === 1, show(r.body));

  step("Case 2 — edges");
  const params = new URLSearchParams(seen.at(-1)?.search ?? "");
  check("the period cut in Gulf time, passed as instants: 1 Oct 00:00 GST to 31 Oct 23:59:59.999 GST",
    params.get("from") === "2026-09-30T20:00:00.000Z" && params.get("to") === "2026-10-31T19:59:59.999Z", seen.at(-1)?.search);
  await call("GET", "/cses", root);
  check("no period: none passed (all time)", seen.at(-1)?.search === "", show(seen.at(-1)));
  oldServer = true;
  r = await call("GET", "/cses", root);
  check("a Tetra Commission from before this page: says its server needs updating", r.status === 409 && /needs updating/.test(r.body?.message ?? ""), show(r.body));
  r = await call("GET", "/portal-reports/cs", root);
  check("…and the Reports tab says so too", r.status === 409 && /no CS report yet/.test(r.body?.message ?? ""), show(r.body));
  r = await call("GET", "/portal-reports/cs/workflow", root);
  check("…and the student workflow says so too", r.status === 409 && /needs updating — it has no student workflow yet/.test(r.body?.message ?? ""), show(r.body));
  r = await call("GET", "/portal-reports/cs/workflow/students?box=came", root);
  check("…and a box's students say so too", r.status === 409 && /needs updating — it can't list a workflow box's students yet/.test(r.body?.message ?? ""), show(r.body));
  r = await call("GET", "/pending/cs", root);
  check("…and the CS portal tab says so too", r.status === 409 && /needs updating — it has no CS pending list yet/.test(r.body?.message ?? ""), show(r.body));
  oldServer = false;

  step("Case 3 — errors");
  check("a date that is not one: 400", (await call("GET", "/cses?from=whenever", root)).status === 400);
  check("from after to: 400", (await call("GET", "/cses?from=2026-10-31&to=2026-10-01", root)).status === 400);
  check("an id that is not one: 404, without asking", (await call("GET", "/cses/not-an-id", root)).status === 404);
  r = await call("GET", "/cses/6ac0000000000000000000ff", root);
  check("a CSE Tetra Commission does not know: 404", r.status === 404 && /No such CSE/.test(r.body?.message ?? ""), show(r.body));

  step("Reports → Mentors (2026-10-24): Tetra Commission's Mentor Report");
  r = await call("GET", "/portal-reports/mentors?from=2026-10-20&to=2026-10-22", root);
  check("every mentor, as Tetra Commission says", r.status === 200 && r.body?.data?.mentors?.[0]?.name === "Chief Ann" && r.body.data.mentors[0].total.commission_usd === 52.5
    && r.body.data.everyone === true, show(r.body));
  check("…asked of its /service/mentor-report with the portal secret and the days", seen.at(-1)?.path === "/commission/api/v1/service/mentor-report"
    && seen.at(-1)?.secret === "cses-e2e-commission-secret" && seen.at(-1)?.search === "?from=2026-10-20&to=2026-10-22", show(seen.at(-1)));
  const asks = seen.length;
  check("bad dates: 400 without asking — missing, not days, upside down, over three months",
    (await call("GET", "/portal-reports/mentors?from=2026-10-20", root)).status === 400 && (await call("GET", "/portal-reports/mentors?from=20-10-2026&to=2026-10-22", root)).status === 400
    && (await call("GET", "/portal-reports/mentors?from=2026-10-22&to=2026-10-20", root)).status === 400 && (await call("GET", "/portal-reports/mentors?from=2026-01-01&to=2026-10-22", root)).status === 400
    && seen.length === asks);
  r = await call("GET", `/portal-reports/mentors/reviews?instructorId=${"a".repeat(24)}&from=2026-10-20&to=2026-10-22&page=2`, root);
  const rv = new URLSearchParams(seen.at(-1)?.search ?? "");
  check("a mentor's reviews, with the instructor, page and dates passed on", r.status === 200 && r.body?.data?.reviews?.[0]?.comment === "Great"
    && seen.at(-1)?.path === "/commission/api/v1/service/mentor-reviews" && rv.get("instructorId") === "a".repeat(24) && rv.get("page") === "2" && rv.get("from") === "2026-10-20", show(seen.at(-1)));
  check("…no instructor id: 400", (await call("GET", "/portal-reports/mentors/reviews?instructorId=x", root)).status === 400);
  oldServer = true;
  r = await call("GET", "/portal-reports/mentors?from=2026-10-20&to=2026-10-22", root);
  check("Tetra Commission's server from before: 409, it needs updating", r.status === 409 && /needs updating — it has no mentors' report yet/.test(r.body?.message ?? ""), show(r.body));
  oldServer = false;
  check("root admins only: 401 with no session, 403 for a non-root admin", (await call("GET", "/portal-reports/mentors?from=2026-10-20&to=2026-10-22")).status === 401
    && (await call("GET", "/portal-reports/mentors?from=2026-10-20&to=2026-10-22", member)).status === 403
    && (await call("GET", `/portal-reports/mentors/reviews?instructorId=${"a".repeat(24)}`, member)).status === 403);

  step("Case 4 — root admins only");
  check("no session: 401", (await call("GET", "/cses")).status === 401 && (await call("GET", `/cses/${CS}`)).status === 401);
  check("an admin who is not a root admin: 403", (await call("GET", "/cses", member)).status === 403);
  check("Reports too: 401 with no session, 403 for a non-root admin", (await call("GET", "/portal-reports/cs")).status === 401 && (await call("GET", "/portal-reports/cs", member)).status === 403);
  check("the student workflow too: 401 with no session, 403 for a non-root admin", (await call("GET", "/portal-reports/cs/workflow")).status === 401
    && (await call("GET", "/portal-reports/cs/workflow", member)).status === 403 && (await call("GET", "/portal-reports/cs/workflow/students?box=came")).status === 401
    && (await call("GET", "/portal-reports/cs/workflow/students?box=came", member)).status === 403);
  check("the CS portal tab too: 401 with no session, 403 for a non-root admin", (await call("GET", "/pending/cs")).status === 401 && (await call("GET", "/pending/cs", member)).status === 403);

  console.log(`\n${checks - failures}/${checks} checks passed`);
  stand.close();
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  stand.close();
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
