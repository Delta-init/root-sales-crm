/**
 * Root's commission logic (services/commissionEngine.ts, 2026-11-01 stage 2), end to end — the same October data
 * (commission-engine-fixture.ts) in the Sales CRM, Draw and Remote, the plans copied into Root:
 *
 *   Case 1  who earns    a sale's lines under each portal's rules (a held sale at the amounts it was held at): the Sales CRM pays the TL but not on a team the
 *                        Sales Manager leads nor on their own close; Remote pays both; Draw never pays a TL; a shared
 *                        login earns nothing; a closer in two teams, a team with no leader, no closer, no Sales
 *                        Manager wait; the amounts are Root's (an edited course row is used at once)
 *   Case 2  My Pay       the Sales CRM's October: target = money received on approved sales (AED payments where
 *                        recorded), the level, salary, percent, commission earned (paid in full first) and waiting,
 *                        payable; a team leader on the TL slab here and on Sales Staff's in Draw; the Sales Manager
 *                        counts every sale; a Root slab change moves Root's figures
 *   Case 3  compare      the CRM's My Pay (its /service/pay, a stand-in here) beside Root's, differences marked; each
 *                        decided sale's lines as recorded beside Root's
 *   Case 4  errors       no month, a bad one; a CRM with no plan in Root
 *   Case 5  permission   the CRM routes take only a CRM's own secret (x-org-secret) and give only its own; the
 *                        compare view root admins only
 *   Case 6  apply-from   today's slabs applied to October: a preview of whose pay moves (nothing saved), then the
 *                        change — October's My Pay follows; refused before October 2026, this month, later; root admins
 *
 * Run through scripts/commission-engine-check.sh. Scratch databases on 127.0.0.1 only.
 */
import http from "node:http";
import { spawnSync } from "node:child_process";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { seedCrm } from "./commission-engine-fixture.js";

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
const PASSWORD = "EngineE2e!pass1";
const SECRET = { delta: process.env.DELTA_SSO_SECRET ?? "", draw: process.env.DRAW_SSO_SECRET ?? "", remote: process.env.REMOTE_SSO_SECRET ?? "" };
if (!Object.values(SECRET).every((s) => s.includes("e2e"))) {
  console.error("Refusing to run: the CRMs' secrets must be the check's own e2e values");
  process.exit(1);
}

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
const as = (crm: keyof typeof SECRET) => ({ "x-org-secret": SECRET[crm] });
const lines = (r: Json) => (r?.lines ?? []).map((l: Json) => `${l.role}:${l.userName}:${l.amount}`).join(" ");

/* The CRMs' own My Pay (GET /api/v1/service/pay), as a stand-in: what each answers is set per case. */
const PAY: Record<string, unknown[]> = { delta: [], draw: [], remote: [] };
const crmApi = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const [, crm] = url.pathname.split("/");
  const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (!crm || !(crm in PAY) || url.pathname !== `/${crm}/api/v1/service/pay`) return send(404, { success: false, message: "Route not found" });
  if (req.headers["x-portal-secret"] !== SECRET[crm as keyof typeof SECRET]) return send(401, { success: false, message: "Bad secret" });
  send(200, { success: true, message: "Pay", data: { month: url.searchParams.get("month"), people: PAY[crm] } });
});

async function main() {
  await new Promise<void>((ok) => crmApi.listen(Number(process.env.E2E_CRM_PORT), "127.0.0.1", ok));
  mongoose.set("autoIndex", false);
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  const open = async (u: string) => (await mongoose.createConnection(u).asPromise()).db!;
  const dbs = { delta: await open(process.env.DELTA_MONGODB_URI!), draw: await open(process.env.DRAW_MONGODB_URI!), remote: await open(process.env.REMOTE_MONGODB_URI!) };
  for (const db of [mongoose.connection.db!, ...Object.values(dbs)]) await db.dropDatabase();

  step("Setting up: the registry, two admins, October's data in each CRM, the plans copied into Root");
  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  for (const [code, name, sortOrder] of [["delta", "Delta CRM", 1], ["banglore", "Banglore CRM", 2], ["draw", "Draw CRM", 3], ["remote", "Remote CRM", 4]] as const) {
    await Organization.create({ code, kind: "crm", name, timezone: "Asia/Dubai", currency: code === "banglore" ? "INR" : "AED", fxToBase: 1, isActive: true, sortOrder, accent: "#2563eb" });
  }
  await Organization.create({ code: "hrms", kind: "hrms", name: "HRMS", timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder: 9, accent: "#2563eb" });
  await Organization.create({ code: "finance-hq", kind: "finance", name: "Finance", timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder: 10, accent: "#2563eb" });
  await AdminUser.create({ name: "Root E2E", email: "root@engine-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@engine-e2e.test", password: PASSWORD, role: "member", status: "active" });
  const seeded = { delta: await seedCrm(dbs.delta), draw: await seedCrm(dbs.draw), remote: await seedCrm(dbs.remote) };
  const copied = spawnSync("bun", ["--no-env-file", path.join(process.env.E2E_REPO!, "src/scripts/commission-plan-copy.ts"), "--write"], { cwd: process.env.E2E_WORK, env: process.env, encoding: "utf8" });
  check("the three plans copied into Root", copied.status === 0 && (copied.stdout.match(/copied to Root/g) ?? []).length === 3, `${copied.stdout}${copied.stderr}`.slice(-400));
  const kept = await mongoose.connection.db!.collection("commissionplans").find().toArray();
  check("…each with its fixed rule for a team leader's own close: the Sales CRM and Remote pay the TL line", kept.find((p) => p.portal === "delta")?.tlPaidOnOwnClose === true
    && kept.find((p) => p.portal === "remote")?.tlPaidOnOwnClose === true && kept.find((p) => p.portal === "draw")?.tlRule === "never", show(kept.map((p) => [p.portal, p.tlRule, p.tlPaidOnOwnClose])));

  const login = async (email: string) => {
    const r = await fetch(`${ROOT}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
    const b: Json = await r.json().catch(() => ({}));
    return b?.data?.accessToken ?? b?.data?.token ?? b?.accessToken;
  };
  const root = { authorization: `Bearer ${await login("root@engine-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@engine-e2e.test")}` };
  const D = seeded.delta, R = seeded.remote, W = seeded.draw;
  const resolve = async (crm: keyof typeof SECRET, body: object) => (await call("POST", "/service/commission/resolve", as(crm), body)).body?.data;

  step("Case 1 — who earns what on a sale");
  let r = await resolve("delta", { closer: String(D.users.ria), team: null, course: String(D.courses.mbt) });
  check("Sales CRM: Ria's MBT, no team on the sale — her one team's: 230 / Lena 85 / Abrar 100", r?.state === "counted" && r.teamName === "Gladiators"
    && lines(r) === "sales:Ria:230 tl:Lena:85 sm:Abrar:100", show(r));
  r = await resolve("delta", { closer: String(D.users.lena), team: String(D.teams.glad), course: String(D.courses.mbt) });
  check("…Lena closing in her own team: Sales Staff and TL (2026-11-01), the SM his", lines(r) === "sales:Lena:230 tl:Lena:85 sm:Abrar:100" && !r.lines[1].note, show(r));
  await mongoose.connection.db!.collection("commissionplans").updateOne({ portal: "delta" }, { $set: { tlPaidOnOwnClose: false } });
  r = await resolve("delta", { closer: String(D.users.lena), team: String(D.teams.glad), course: String(D.courses.mbt) });
  check("…the portal's rule, not what a plan copied earlier stored", lines(r) === "sales:Lena:230 tl:Lena:85 sm:Abrar:100", show(r));
  r = await resolve("remote", { closer: String(R.users.lena), team: String(R.teams.glad), course: String(R.courses.mbt) });
  check("Remote: Lena closing in her own team is paid the TL line too", lines(r) === "sales:Lena:230 tl:Lena:85 sm:Abrar:100", show(r));
  r = await resolve("delta", { closer: String(D.users.nina), team: String(D.teams.managers), course: String(D.courses.mbt) });
  check("Sales CRM: a team the Sales Manager leads — no TL line, paid as SM", lines(r) === "sales:Nina:230 tl:Abrar:0 sm:Abrar:100", show(r));
  r = await resolve("remote", { closer: String(R.users.nina), team: String(R.teams.managers), course: String(R.courses.mbt) });
  check("Remote: the same sale pays the Sales Manager the TL line as well", lines(r) === "sales:Nina:230 tl:Abrar:85 sm:Abrar:100", show(r));
  r = await resolve("draw", { closer: String(W.users.zed), team: null, course: String(W.courses.dwt) });
  check("Draw: no TL line ever, and a closer in two teams still counts", r?.state === "counted" && lines(r) === "sales:Zed:500 sm:Abrar:300", show(r));
  r = await resolve("delta", { closer: String(D.users.zed), team: null, course: String(D.courses.mbt) });
  check("Sales CRM: a closer in two teams, the sale with none, waits", r?.state === "waiting" && /in 2 teams/.test(r.reason), show(r));
  r = await resolve("delta", { closer: String(D.users.zed), team: String(D.teams.spartans), course: String(D.courses.mbt) });
  check("…a team with no leader waits", r?.state === "waiting" && /no leader/.test(r.reason), show(r));
  r = await resolve("delta", { closer: String(D.users.shared), team: String(D.teams.glad), course: String(D.courses.mbt) });
  check("…a shared login earns nothing", r?.state === "excluded" && lines(r) === "", show(r));
  r = await resolve("delta", { closer: null, team: null, course: String(D.courses.mbt) });
  check("…no closer waits", r?.state === "waiting" && /closer/.test(r.reason), show(r));
  r = await resolve("delta", { closer: String(D.users.ria), team: String(D.teams.glad), course: String(new Types.ObjectId()) });
  check("…a course with no row: counted at 0", r?.state === "counted" && lines(r) === "sales:Ria:0 tl:Lena:0 sm:Abrar:0", show(r));
  r = await resolve("delta", { closer: String(D.users.ria), team: String(D.teams.glad), course: String(D.courses.mbt), amounts: { sales: 200, tl: 70, sm: 90 } });
  check("a held sale settled at the amounts it was held at (200 / 70 / 90), not the course's row", lines(r) === "sales:Ria:200 tl:Lena:70 sm:Abrar:90" && r.plan.sales === 200, show(r));
  r = await resolve("draw", { closer: String(W.users.ria), team: null, courses: [String(W.courses.mbt), String(W.courses.dwt)] });
  check("Draw: a bundle of MBT + DWT pays both rows added up (730 / SM 400)", r?.state === "counted" && lines(r) === "sales:Ria:730 sm:Abrar:400" && r.plan.creditUsd === 1500, show(r));
  r = await call("POST", "/service/commission/resolve", as("delta"), { closer: String(D.users.ria), amounts: { sales: -1, tl: 0, sm: 0 } });
  check("…a negative held amount → 400", r.status === 400, show(r.body));
  let put = await call("PUT", `/commission-plans/delta/courses/${D.courses.mbt}`, root, { sales: 250, tl: 90, sm: 100, creditUsd: 500 });
  r = await resolve("delta", { closer: String(D.users.ria), team: String(D.teams.glad), course: String(D.courses.mbt) });
  check("a course row edited in Root is used at once: 250 / 90", put.status === 200 && lines(r) === "sales:Ria:250 tl:Lena:90 sm:Abrar:100", show(r));
  await call("PUT", `/commission-plans/delta/courses/${D.courses.mbt}`, root, { sales: 230, tl: 85, sm: 100, creditUsd: 500 });
  put = await call("PUT", "/commission-plans/draw/settings", root, { salesManager: null, excluded: [] });
  r = await resolve("draw", { closer: String(W.users.ria), team: null, course: String(W.courses.mbt) });
  check("Draw with no Sales Manager in Root's plan: waits", put.status === 200 && r?.state === "waiting" && /Sales Manager/.test(r.reason), show(r));
  await call("PUT", "/commission-plans/draw/settings", root, { salesManager: String(W.users.abrar), excluded: [String(W.users.shared)] });

  step("Case 2 — My Pay, October");
  let pay = (await call("GET", "/service/commission/pay?month=2026-10", as("delta"))).body?.data;
  const row = (p: Json, n: string) => p?.people?.find((x: Json) => x.name === n);
  const fig = (x: Json) => x && [x.role, x.sales.value, x.level.name, x.salary, x.percent, x.commission.earned, x.commission.balance, x.commission.payable, x.total].join(" ");
  check("Ria: 22,000 received (s1 15,000, s2 5,000, s5's October 2,000) → C, 3,000 + 100%; 460 earned, 230 waiting",
    fig(row(pay, "Ria")) === "sales 22000 C 3000 100 460 230 460 3460" && row(pay, "Ria").sales.count === 3, fig(row(pay, "Ria")));
  check("Lena on the TL slab: her team's 23,000 → Base 4,000 + 50%; 485 earned (her own close in it, TL line too), 85 waiting",
    fig(row(pay, "Lena")) === "tl 23000 Base 4000 50 485 85 242.5 4242.5" && row(pay, "Lena").teams.join() === "Gladiators", fig(row(pay, "Lena")));
  check("Abrar on the SM slab counts every sale, the shared login's too: 28,250 → Base 5,000 + 50%; 400 earned",
    fig(row(pay, "Abrar")) === "sm 28250 Base 5000 50 400 100 200 5200" && row(pay, "Abrar").awaitingFinance.count === 1, fig(row(pay, "Abrar")));
  check("Mo: his payment in AED counts (2,250) → Base, 0%: 200 earned, nothing payable", fig(row(pay, "Mo")) === "sales 2250 Base 2000 0 200 0 0 2000", fig(row(pay, "Mo")));
  check("Gopika: her sale waits for finance — awaiting 1, not counted yet", row(pay, "Gopika")?.awaitingFinance?.count === 1 && row(pay, "Gopika").commission.notCountedYet === 1
    && row(pay, "Gopika").sales.value === 0, show(row(pay, "Gopika")));
  check("the shared login and the inactive leader with nothing are not listed; Nina and Zed are, at base",
    !row(pay, "Shared login") && !row(pay, "Old") && row(pay, "Nina")?.total === 2000 && row(pay, "Zed")?.total === 2000, show(pay?.people?.map((p: Json) => p.name)));
  check("the SM first, then team leaders, then the rest", pay?.people?.[0]?.name === "Abrar" && ["tl", "tl"].join() === pay.people.slice(1, 3).map((p: Json) => p.role).join(), show(pay?.people?.map((p: Json) => p.role)));
  const drawPay = (await call("GET", "/service/commission/pay?month=2026-10", as("draw"))).body?.data;
  check("Draw: Lena on the Sales Staff slab, her own close only: 1,000 → Base", fig(row(drawPay, "Lena")) === "sales 1000 Base 2000 0 485 85 0 2000", fig(row(drawPay, "Lena")));
  check("…Draw's Sales Manager slab (Base 5,000 + 50%)", fig(row(drawPay, "Abrar")) === "sm 28250 Base 5000 50 400 100 200 5200", fig(row(drawPay, "Abrar")));
  const month = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 7);
  put = await call("PUT", "/commission-plans/delta/slabs/sales", root, { rows: [{ name: "Base", target: 0, salary: 2500, percent: 10 }] });
  const thisMonth = (await call("GET", `/service/commission/pay?month=${month}`, as("delta"))).body?.data;
  const october = (await call("GET", "/service/commission/pay?month=2026-10", as("delta"))).body?.data;
  check(`a Sales Staff slab changed in Root counts from ${month}; October keeps its slabs`, put.status === 200 && thisMonth?.slabs?.sales?.[0]?.salary === 2500
    && thisMonth.slabsFrom === month && row(october, "Mo")?.salary === 2000, show({ now: thisMonth?.slabs?.sales, oct: row(october, "Mo")?.salary }));
  const plan = (await call("GET", "/service/commission/plan?month=2026-10", as("remote"))).body?.data;
  check("the plan as a CRM reads it: its rules, courses, people and the month's slabs", plan?.portal === "remote" && plan.tlRule === "always" && plan.tlPaidOnOwnClose === true
    && plan.courses.length === 2 && plan.salesManager?.name === "Abrar" && plan.slabs.sm.length === 3 && !("tl" in plan.slabs && plan.tlSlab), show(plan));
  const sept = (await call("GET", "/service/commission/pay?month=2026-09", as("delta"))).body?.data;
  check("before October 2026: nobody on the slabs", Array.isArray(sept?.people) && sept.people.length === 0, show(sept));

  step("Case 3 — compare: the CRM's figures beside Root's");
  PAY.delta = [
    { user: String(D.users.ria), name: "Ria", role: "sales", level: "C", percent: 100, earned: 460, balance: 230, payable: 460 },
    { user: String(D.users.lena), name: "Lena", role: "tl", level: "Base", percent: 50, earned: 400, balance: 85, payable: 210 },
  ];
  let cmp = await call("GET", "/commission-plans/delta/compare?month=2026-10", root);
  const pp = (n: string) => cmp.body?.data?.pay?.people?.find((p: Json) => p.name === n);
  check("Ria the same in both", cmp.status === 200 && pp("Ria")?.same === true && pp("Ria").root.target === 22000, show(pp("Ria")));
  check("Lena differs: the CRM pays 210, Root 242.50", pp("Lena")?.same === false && pp("Lena").crm.payable === 210 && pp("Lena").root.payable === 242.5, show(pp("Lena")));
  check("someone only Root lists (Abrar) differs, counted", pp("Abrar")?.crm === null && cmp.body?.data?.pay?.differ >= 2 && cmp.body.data.pay.crmError === null, show(cmp.body?.data?.pay?.differ));
  const sales = cmp.body?.data?.sales;
  const sl = (k: string) => sales?.list?.find((s: Json) => s.student === `Student ${k}`);
  check("October's decided sales: s1, s2, s4, s7, s8 — s3 (finance) and s5 (September) not", sales?.list?.map((s: Json) => s.student.slice(-2)).sort().join() === "s1,s2,s4,s7,s8", show(sales?.list?.map((s: Json) => s.student)));
  check("…s1 and Lena's own s8 the same; s7 excluded in both", sl("s1")?.same && sl("s8")?.same && sl("s7")?.same && sl("s7").root.state === "excluded", show([sl("s1"), sl("s8")]));
  check("…s4 recorded at an older plan (Mo 200) differs from Root's 230", sl("s4")?.same === false && sales.differ === 1 && sl("s4").root.lines[0].amount === 230, show(sl("s4")));
  PAY.remote = [];
  cmp = await call("GET", "/commission-plans/banglore/compare?month=2026-10", root);
  check("Banglore has no plan → 404", cmp.status === 404, show(cmp.body));

  step("Case 4 — errors");
  check("no month → 400", (await call("GET", "/service/commission/pay", as("delta"))).status === 400);
  check("a bad month → 400 (the CRM route and the compare)", (await call("GET", "/service/commission/pay?month=2026-13", as("delta"))).status === 400
    && (await call("GET", "/commission-plans/delta/compare?month=oct", root)).status === 400);
  await mongoose.connection.db!.collection("commissionplans").deleteOne({ portal: "remote" });
  r = await call("POST", "/service/commission/resolve", as("remote"), { closer: String(R.users.ria) });
  check("a CRM whose plan isn't in Root → 409", r.status === 409, show(r.body));

  step("Case 5 — permission");
  check("no secret → 401", (await call("GET", "/service/commission/pay?month=2026-10")).status === 401);
  check("a wrong secret → 401", (await call("GET", "/service/commission/pay?month=2026-10", { "x-org-secret": "nope-e2e" })).status === 401);
  const asDraw = (await call("GET", "/service/commission/plan?month=2026-10", as("draw"))).body?.data;
  check("Draw's secret gets Draw's plan, whatever it asks", asDraw?.portal === "draw", show(asDraw?.portal));
  check("the compare view: not a root admin → 403, no session → 401", (await call("GET", "/commission-plans/delta/compare?month=2026-10", member)).status === 403
    && (await call("GET", "/commission-plans/delta/compare?month=2026-10")).status === 401);

  step("Case 7 — finance asking the salary on the slabs, for payroll (2026-11-01)");
  const asFinance = { "x-portal-secret": process.env.FINANCE_HQ_SSO_SECRET ?? "" };
  let sp = await call("GET", "/service/finance/slab-pay?month=2026-10", asFinance);
  const spRow = (crm: string, n: string) => sp.body?.data?.people?.find((p: Json) => p.crm === crm && p.name === n);
  check("each CRM's people on the slabs, by email: Ria (Sales CRM) C 3,000 AED; Abrar the SM on 5,000; Draw's Lena on Sales Staff",
    sp.status === 200 && spRow("delta", "Ria")?.salary === 3000 && spRow("delta", "Ria")?.level === "C" && spRow("delta", "Ria")?.currency === "AED" && spRow("delta", "Abrar")?.role === "sm"
    && spRow("delta", "Abrar")?.salary === 5000 && spRow("draw", "Lena")?.role === "sales" && typeof spRow("delta", "Ria")?.email === "string", show(sp.body?.data?.people?.slice(0, 3)));
  check("…the commission payable with it (Ria 460)", spRow("delta", "Ria")?.payable === 460, show(spRow("delta", "Ria")));
  check("…a CRM with no plan in Root left out, not an error (Remote's was taken away above)", !sp.body?.data?.people?.some((p: Json) => p.crm === "remote"));
  check("no secret, a CRM's secret, HRMS's: refused", (await call("GET", "/service/finance/slab-pay?month=2026-10")).status === 401
    && (await call("GET", "/service/finance/slab-pay?month=2026-10", { "x-portal-secret": SECRET.delta })).status === 401
    && (await call("GET", "/service/finance/slab-pay?month=2026-10", { "x-portal-secret": process.env.HRMS_SSO_SECRET ?? "" })).status === 401);
  check("HRMS's old door gone", (await call("GET", "/service/hrms/slab-pay?month=2026-10", { "x-portal-secret": process.env.HRMS_SSO_SECRET ?? "" })).status !== 200);
  check("a bad month → 400", (await call("GET", "/service/finance/slab-pay?month=2026-13", asFinance)).status === 400);

  step("Case 6 — today's slabs applied to October (2026-11-01)");
  // Case 2 changed the Sales Staff slab from this month (Base 2,500 at 10%); October still has the built-in ones.
  let pv = await call("GET", "/commission-plans/delta/slabs/apply-from?month=2026-10", root);
  const pr = (n: string) => pv.body?.data?.people?.find((p: Json) => p.name === n);
  check("the preview: the Sales Staff whose October moves — Ria C 3,000 + 100% → Base 2,500 + 10%, Mo 2,000 → 2,520",
    pv.status === 200 && pr("Ria")?.before?.level === "C" && pr("Ria")?.after?.level === "Base" && pr("Ria")?.after?.payable === 46 && pr("Mo")?.after?.total === 2520
    && pv.body.data.people.length === 5 && pv.body.data.unchanged === 3 && pv.body.data.from === month, show(pv.body?.data));
  check("…team leaders and the Sales Manager, their slabs the same, not listed", !pr("Lena") && !pr("Abrar"));
  check("…nothing saved by the preview", row((await call("GET", "/service/commission/pay?month=2026-10", as("delta"))).body?.data, "Mo")?.salary === 2000);
  check("not a root admin: no preview, no change", (await call("GET", "/commission-plans/delta/slabs/apply-from?month=2026-10", member)).status === 403
    && (await call("POST", "/commission-plans/delta/slabs/apply-from", member, { month: "2026-10" })).status === 403);
  for (const [label, m] of [["before October 2026", "2026-09"], ["this month", month], ["a month to come", "2099-01"], ["not a month", "2026-13"]] as const) {
    check(`${label}: refused`, (await call("POST", "/commission-plans/delta/slabs/apply-from", root, { month: m })).status === 400
      && (await call("GET", `/commission-plans/delta/slabs/apply-from?month=${m}`, root)).status === 400);
  }
  r = await call("POST", "/commission-plans/delta/slabs/apply-from", root, { month: "2026-10" });
  const kept2 = await mongoose.connection.db!.collection("commissionplans").findOne({ portal: "delta" });
  check("applied: one version from October with today's rows, this month's folded into it", r.status === 200
    && kept2?.slabs?.map((v: Json) => v.from).join() === "2000-01,2026-10" && kept2.slabs[1].sales[0].salary === 2500, show(kept2?.slabs?.map((v: Json) => v.from)));
  const octNow = (await call("GET", "/service/commission/pay?month=2026-10", as("delta"))).body?.data;
  check("…October's My Pay follows at once: Mo 2,500 + 10% of 200 = 2,520; Lena (TL slab) as she was",
    row(octNow, "Mo")?.total === 2520 && row(octNow, "Lena")?.total === 4242.5 && octNow?.slabsFrom === "2026-10", show(row(octNow, "Mo")));
  const ch = r.body?.data?.find((p: Json) => p.code === "delta")?.root?.changes?.[0];
  check("…in the change list, by whom, with what October had before", /now in force from October 2026/.test(ch?.detail ?? "") && /October 2026 had: Sales Staff Base 0 → 2,000 \+ 0%, E 10,000/.test(ch?.detail ?? "")
    && ch.by === "root@engine-e2e.test", show(ch));
  check("…again: in force from October already, refused", (await call("POST", "/commission-plans/delta/slabs/apply-from", root, { month: "2026-10" })).status === 400);
  check("Banglore (no plan) → 404; Remote (plan taken away above) → 409", (await call("POST", "/commission-plans/banglore/slabs/apply-from", root, { month: "2026-10" })).status === 404
    && (await call("POST", "/commission-plans/remote/slabs/apply-from", root, { month: "2026-10" })).status === 409);

  console.log(`\n${checks - failures}/${checks} checks passed`);
  crmApi.close();
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  crmApi.close();
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
