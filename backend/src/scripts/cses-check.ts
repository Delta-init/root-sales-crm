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
let oldServer = false;
const figures = { students: 3, deposits: { count: 2, usd: 1400 }, commissionUsd: 50, followupsToday: 1, followupsOverdue: 1,
  upcoming: { count: 1, amount: { AED: 3000 } }, overdueDues: { count: 1, amount: { USD: 500 } }, balance: { students: 2, amount: { AED: 3000, USD: 500 } },
  bonus: { clients: 1, usd: 500, needsCall: 0, withFinance: 0, waitingBroker: 1 }, notOnboarded: 1, notOnboardedLate: 1 };
const stand = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  seen.push({ path: url.pathname, search: url.search, secret: String(req.headers["x-portal-secret"] ?? "") });
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
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
  oldServer = false;

  step("Case 3 — errors");
  check("a date that is not one: 400", (await call("GET", "/cses?from=whenever", root)).status === 400);
  check("from after to: 400", (await call("GET", "/cses?from=2026-10-31&to=2026-10-01", root)).status === 400);
  check("an id that is not one: 404, without asking", (await call("GET", "/cses/not-an-id", root)).status === 404);
  r = await call("GET", "/cses/6ac0000000000000000000ff", root);
  check("a CSE Tetra Commission does not know: 404", r.status === 404 && /No such CSE/.test(r.body?.message ?? ""), show(r.body));

  step("Case 4 — root admins only");
  check("no session: 401", (await call("GET", "/cses")).status === 401 && (await call("GET", `/cses/${CS}`)).status === 401);
  check("an admin who is not a root admin: 403", (await call("GET", "/cses", member)).status === 403);

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
