/**
 * Checks Root's enrolment workflow (GET /pending/enrolments, 2026-10-14) against a scratch database, with the sales
 * CRMs as a stand-in in this check answering /api/v1/service/enrolment-flow:
 *   - root admins only;
 *   - each CRM's and all CRMs' counts: closed, finished, unfinished, stopped at each step (waiting / failed), by role;
 *   - who holds the most, put together across CRMs: a salesperson by email, a CS by name, finance as one desk;
 *   - the closes, the oldest waiting first, with their CRM;
 *   - a CRM on an older server: "needs updating", the rest stand; one not configured says so.
 * Run by enrolment-flow-check.sh. Scratch database only.
 */
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(uri)) {
  console.error(`Refusing to run: MONGODB_URI must be a scratch e2e database on 127.0.0.1, got "${uri}"`);
  process.exit(1);
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const PASSWORD = "FlowE2e!pass1";
let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const show = (v: unknown) => JSON.stringify(v).slice(0, 400);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const close = (id: string, stage: string, stageState: string, role: string, name: string, o: Record<string, unknown> = {}) => ({
  id, name: `Client ${id}`, enrollmentNumber: `ENR-${id}`, course: "MBT", academy: "dubai", closedBy: { id: "u1", name: "Sally", email: "sally@crm.test" },
  team: "Falcons", closedAt: "2026-10-01T08:00:00.000Z", invoiceNumber: `IN-${id}`, stage, stageState, detail: `${stage} ${stageState}`,
  waitingOn: { role, name }, cs: "", since: "2026-10-05T08:00:00.000Z", steps: [], ...o,
});

async function main() {
  await mongoose.connect(uri);
  const ANSWERS: Record<string, Json> = {
    delta: { financeAnswered: true, total: 7, finished: 2, open: [
      close("d1", "finance", "waiting", "finance", ""),
      close("d2", "finance", "failed", "salesperson", "Sally", { since: "2026-10-02T08:00:00.000Z" }),
      close("d3", "onboarded", "waiting", "cs", "Cee One"),
      close("d4", "bonus", "waiting", "broker_admin", "", { cs: "Cee One" }),
      close("d5", "bonus", "waiting", "cs", "Cee One"),
    ] },
    draw: { financeAnswered: true, total: 3, finished: 1, open: [
      close("w1", "finance", "failed", "salesperson", "Sally Draw", { closedBy: { id: "u9", name: "Sally Draw", email: "sally@crm.test" } }),
      close("w2", "cs", "waiting", "cs_manager", ""),
    ] },
  };
  const { createServer } = await import("node:http");
  const SECRETS: Record<string, string> = { delta: "flow-e2e-delta", draw: "flow-e2e-draw", remote: "flow-e2e-remote" };
  const standin = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const crm = url.pathname.split("/")[1] ?? "";
    const send = (st: number, b: unknown) => { res.writeHead(st, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
    if (req.headers["x-portal-secret"] !== SECRETS[crm]) return send(401, { message: "Bad secret" });
    if (url.pathname === `/${crm}/api/v1/service/enrolment-flow` && ANSWERS[crm]) return send(200, { success: true, data: ANSWERS[crm] });
    return send(404, { success: false, message: "Route not found" });
  });
  await new Promise<void>((ok) => standin.listen(Number(process.env.E2E_STANDIN_PORT), "127.0.0.1", ok));

  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  for (const [code, kind, name, sortOrder] of [["delta", "crm", "Sales CRM", 1], ["banglore", "crm", "Banglore CRM", 2], ["draw", "crm", "Draw CRM", 3], ["remote", "crm", "Remote CRM", 4], ["commission", "commission", "Tetra Commission", 5]] as [string, string, string, number][]) {
    await Organization.create({ code, kind, name, timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder, accent: "#2563eb" });
  }
  await AdminUser.create({ name: "Root E2E", email: "root@flow-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@flow-e2e.test", password: PASSWORD, role: "member", status: "active" });
  const login = async (email: string) => (await (await fetch(`${ROOT}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  })).json())?.data?.accessToken as string;
  const root = { authorization: `Bearer ${await login("root@flow-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@flow-e2e.test")}` };
  const get = async (h: Record<string, string>) => { const r = await fetch(`${ROOT}/pending/enrolments`, { headers: h }); return { status: r.status, body: await r.json().catch(() => ({})) as Json }; };

  check("no session 401, a member 403", (await get({})).status === 401 && (await get(member)).status === 403);
  const r = await get(root);
  const d = r.body.data;
  const p = (code: string) => d.portals.find((x: Json) => x.code === code);
  check("the four CRMs, not Tetra Commission", r.status === 200 && d.portals.map((x: Json) => x.code).join() === "delta,banglore,draw,remote", show(d?.portals?.map((x: Json) => x.code)));
  check("Draw's and the Sales CRM's counts", p("delta").counts.total === 7 && p("delta").counts.finished === 2 && p("delta").counts.open === 5
    && p("draw").counts.open === 2 && p("delta").counts.atStep.finance.waiting === 1 && p("delta").counts.atStep.finance.failed === 1 && p("delta").counts.atStep.bonus.waiting === 2, show(p("delta").counts));
  check("all together: 10 closed, 3 finished, 7 unfinished; finance 1 waiting + 2 sent back; by role", d.all.total === 10 && d.all.finished === 3 && d.all.open === 7
    && d.all.atStep.finance.waiting === 1 && d.all.atStep.finance.failed === 2 && d.all.byRole.salesperson === 2 && d.all.byRole.cs === 2
    && d.all.byRole.broker_admin === 1 && d.all.byRole.cs_manager === 1 && d.all.byRole.finance === 1, show(d.all));
  const w = new Map<string, Json>(d.waitingOn.map((x: Json) => [x.key, x]));
  check("who holds the most, across CRMs: Sally by email (one in each), Cee One by name, finance one desk", w.get("salesperson:sally@crm.test")?.count === 2
    && w.get("salesperson:sally@crm.test")?.portals?.delta === 1 && w.get("salesperson:sally@crm.test")?.portals?.draw === 1
    && w.get("cs:cee one")?.count === 2 && w.get("finance")?.count === 1 && d.waitingOn[0].count === 2, show(d.waitingOn));
  check("the closes, the oldest waiting first, with their CRM", d.open.length === 7 && d.open[0].id === "d2" && d.open[0].portalName === "Sales CRM"
    && d.open.some((x: Json) => x.id === "w2" && x.portal === "draw"), show(d.open.map((x: Json) => x.id)));
  check("Remote on an older server: needs updating; Banglore not configured: says so", p("remote").available === false && /needs updating/.test(p("remote").error)
    && p("banglore").available === false && /not configured/.test(p("banglore").error), show([p("remote").error, p("banglore").error]));
}

main()
  .then(async () => { console.log(`\n${checks - failures}/${checks} checks passed`); await mongoose.disconnect(); process.exit(failures ? 1 : 0); })
  .catch(async (err) => { console.error(err); await mongoose.disconnect().catch(() => {}); process.exit(1); });
