/**
 * Pending's Sales and Finance tabs end to end (services/salesPendingService.ts):
 *
 *   Case 1  happy path   the sales CRMs for the tabs; one CRM's figures per salesperson — inactive leads (asked
 *                        of the CRM), overdue reminders, not connected and lost marked in the period (lost reasons),
 *                        calls with the list behind them — and finance's approvals and old-date entries
 *   Case 2  edge         outside the period, reminders not yet due or done, calls by somebody who is not in the CRM;
 *                        a CRM with no API set (Draw) still gives its database's figures; finance's old server
 *   Case 3  errors       a CRM that can't be read, an unknown one, bad dates
 *   Case 4  permission   no session, an admin who is not a root admin
 *
 * Run through scripts/sales-pending-check.sh. Scratch databases on 127.0.0.1 only.
 */
import mongoose, { Types } from "mongoose";
import { createServer } from "node:http";

const uri = process.env.MONGODB_URI ?? "";
for (const [name, value] of [["MONGODB_URI", uri], ["DELTA_MONGODB_URI", process.env.DELTA_MONGODB_URI ?? ""], ["DRAW_MONGODB_URI", process.env.DRAW_MONGODB_URI ?? ""]] as const) {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(value)) {
    console.error(`Refusing to run: ${name} must be a scratch e2e database on 127.0.0.1, got "${value}"`);
    process.exit(1);
  }
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const PASSWORD = "SalesPendingE2e!pass1";

let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const same = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const step = (name: string) => console.log(`\n\x1b[1m${name}\x1b[0m`);
const show = (v: unknown) => JSON.stringify(v).slice(0, 400);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${ROOT}${path}`, { headers: { "content-type": "application/json", ...headers } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const UAE = 4 * 3_600_000;
const today = new Date(Date.now() + UAE).toISOString().slice(0, 10);
const dayOf = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

const asha = new Types.ObjectId(), bina = new Types.ObjectId(), old = new Types.ObjectId();

// ── A stand-in for the Sales CRM's API and finance's ─────────────────────────
let financeOld = false;
const saw: string[] = [];
const stand = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const secret = String(req.headers["x-portal-secret"] ?? "");
  saw.push(url.pathname + url.search);
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname.startsWith("/delta/")) {
    if (secret !== "sales-e2e-delta-secret") return send(401, { success: false, message: "Bad secret" });
    if (url.pathname === "/delta/api/v1/service/inactive-leads") {
      return send(200, { success: true, data: {
        items: [{ id: "l-idle", name: "Idle Ivan", phone: "971500000099", source: "Meta", owner: { id: String(asha), name: "Asha", email: "ASHA@delta-e2e.test", active: true },
          team: { id: "t1", name: "Falcons" }, assignedAt: daysAgo(1).toISOString(), waitingMinutes: 300, moves: 1, calls: { total: 0, answered: 0, lastAt: null } }],
        summary: { total: 1, stuck: 0, movedToday: 0, capped: false }, rule: { limitMinutes: 120 } } });
    }
    if (url.pathname === "/delta/api/v1/service/calls") {
      const callRow = (o: Record<string, unknown>) => ({ id: new Types.ObjectId().toString(), startedAt: new Date().toISOString(), direction: "out", status: "answered", talkSeconds: 100,
        ringSeconds: 5, number: "971500000001", extension: "101", person: String(asha), personName: "Asha", personEmail: "asha@delta-e2e.test", contact: "Lena", contactKind: "lead", recordings: 1, ...o });
      return send(200, { success: true, data: {
        stats: { calls: 7, outgoing: 6, incoming: 1, connected: 4, missed: 1, notAnswered: 2, talkSeconds: 500, recorded: 3 },
        people: [
          { key: String(asha), userId: String(asha), name: "Asha", email: "asha@delta-e2e.test", extension: "101", calls: 5, connected: 3, talkSeconds: 400 },
          { key: "ext:120", userId: "", name: "Stranger", email: "stranger@elsewhere.test", extension: "120", calls: 2, connected: 1, talkSeconds: 100 },
        ],
        calls: [callRow({}), callRow({ person: "ext:120", personName: "Stranger", personEmail: "stranger@elsewhere.test", recordings: 0 })],
        total: 7,
      } });
    }
    return send(404, { success: false, message: "Route not found" });
  }
  if (url.pathname.startsWith("/finance/")) {
    if (secret !== "pending-e2e-finance-secret") return send(401, { success: false, message: "Bad secret" });
    if (financeOld || url.pathname !== "/finance/api/v1/service/finance-watch") return send(404, { success: false, message: "Route not found" });
    return send(200, { success: true, data: {
      rules: { delayMinutes: 30, backdateMinDays: 1, enteredWithinDays: 30 },
      approvals: { total: 2, delayed: 1, byKind: [], unavailable: [], rows: [{ id: "a1", type: "invoice", kind: "Enrolment invoices", waitingMinutes: 90, delayed: true }] },
      backdated: { total: 1, typed: 1, lateWaiting: 0, byKind: [], rows: [{ kind: "expense", number: "EXP-1", daysBack: 4 }] },
    } });
  }
  return send(404, { success: false, message: "Route not found" });
});
await new Promise<void>((ok) => stand.listen(Number(process.env.E2E_STANDIN_PORT), "127.0.0.1", ok));

async function main() {
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  await mongoose.connection.db!.dropDatabase();
  const deltaDb = (await mongoose.createConnection(process.env.DELTA_MONGODB_URI!).asPromise()).db!;
  const drawDb = (await mongoose.createConnection(process.env.DRAW_MONGODB_URI!).asPromise()).db!;
  await deltaDb.dropDatabase();
  await drawDb.dropDatabase();

  step("Setting up: the registry, two admins, a Sales CRM and Draw with people, leads and reminders");
  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  for (const [code, kind, name, sortOrder] of [["delta", "crm", "Delta CRM", 1], ["banglore", "crm", "Banglore CRM", 2], ["draw", "crm", "Draw CRM", 3],
    ["remote", "crm", "Remote CRM", 4], ["finance-hq", "finance", "Finance HQ", 5]] as [string, string, string, number][]) {
    await Organization.create({ code, kind, name, timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder, accent: "#2563eb" });
  }
  await AdminUser.create({ name: "Root E2E", email: "root@sales-pending-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@sales-pending-e2e.test", password: PASSWORD, role: "member", status: "active" });

  await deltaDb.collection("users").insertMany([
    { _id: asha, name: "Asha", email: "asha@delta-e2e.test", status: "active" },
    { _id: bina, name: "Bina", email: "bina@delta-e2e.test", status: "active" },
    { _id: old, name: "Old Hand", email: "old@delta-e2e.test", status: "inactive" },
  ]);
  let n = 0;
  const lead = (o: Record<string, unknown>) => ({ name: `Lead ${++n}`, phone: `97150000${String(n).padStart(4, "0")}`, source: "Meta", reminders: [], activityLogs: [],
    createdAt: daysAgo(30), updatedAt: new Date(), ...o });
  const changed = (to: string, at: Date, by = bina) => ({ action: "status_changed", description: `to ${to}`, performedBy: by, changes: { status: { from: "followup", to } }, createdAt: at });
  await deltaDb.collection("leads").insertMany([
    // Asha: lost 2 days ago (price), lost yesterday with no reason given, lost 10 days ago (outside), an overdue reminder.
    lead({ name: "Priya Price", assignedTo: asha, status: "lost", lostReason: "price", lostNotes: "Too costly", activityLogs: [changed("lost", daysAgo(2))] }),
    lead({ name: "Noah Noreason", assignedTo: asha, status: "lost", activityLogs: [changed("lost", daysAgo(1), asha)] }),
    lead({ name: "Old Lost", assignedTo: asha, status: "lost", lostReason: "trust", activityLogs: [changed("lost", daysAgo(10))] }),
    lead({ name: "Remind Rita", assignedTo: asha, status: "followup", reminders: [
      { title: "Call back", remindAt: daysAgo(1), createdBy: asha, isDone: false },
      { title: "Later", remindAt: new Date(Date.now() + 86_400_000), createdBy: asha, isDone: false }, // not due yet
      { title: "Done", remindAt: daysAgo(3), createdBy: asha, isDone: true },                         // done
    ] }),
    // Bina: not connected yesterday (no log: its last update), not connected 20 days ago (outside).
    lead({ name: "Nina Noanswer", assignedTo: bina, status: "not_connected", updatedAt: daysAgo(1) }),
    lead({ name: "Old Silence", assignedTo: bina, status: "not_connected", updatedAt: daysAgo(20) }),
    // Old Hand (left): an overdue reminder still counts against them.
    lead({ name: "Left Behind", assignedTo: old, status: "followup", reminders: [{ title: "Ring", remindAt: daysAgo(5), createdBy: old, isDone: false }] }),
  ]);
  await drawDb.collection("users").insertOne({ _id: bina, name: "Bina Draw", email: "bina@draw-e2e.test", status: "active" });
  await drawDb.collection("leads").insertOne(lead({ name: "Draw Lost", assignedTo: bina, status: "lost", lostReason: "time", activityLogs: [changed("lost", daysAgo(1))] }));

  const login = async (email: string) => (await (await fetch(`${ROOT}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  })).json())?.data?.accessToken as string;
  const root = { authorization: `Bearer ${await login("root@sales-pending-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@sales-pending-e2e.test")}` };

  step("Case 1 — happy path");
  let r = await call("/pending/sales", root);
  same("the sales CRMs for the tabs, in order, with what each has", (r.body?.data ?? []).map((x: Json) => [x.code, x.inactive, x.calls]),
    [["delta", true, "3cx"], ["banglore", false, "recorder"], ["draw", true, "3cx"], ["remote", true, null]]);

  r = await call(`/pending/sales/delta?from=${dayOf(-7)}&to=${today}`, root);
  const d = r.body?.data ?? {};
  const person = (id: Types.ObjectId) => (d.people ?? []).find((p: Json) => p.id === String(id));
  const a = person(asha)?.counts ?? {}, b = person(bina)?.counts ?? {};
  check("200, the period as asked", r.status === 200 && d.period?.from === dayOf(-7) && d.period?.to === today, show(r.body));
  same("Asha: 1 inactive (from the CRM), 1 overdue reminder, 2 lost, 5 calls / 3 connected / 400s", [a.inactive, a.reminders_overdue, a.lost, a.not_connected, a.calls, a.connected, a.talkSeconds], [1, 1, 2, 0, 5, 3, 400]);
  same("Bina: 1 not connected", [b.not_connected, b.lost, b.inactive], [1, 0, 0]);
  same("Old Hand, who left: the overdue reminder still with them, marked", [person(old)?.counts?.reminders_overdue, person(old)?.active], [1, false]);
  same("totals: inactive 1, reminders 2, not connected 1, lost 2, calls 7, pending 6", [d.totals?.inactive, d.totals?.reminders_overdue, d.totals?.not_connected, d.totals?.lost, d.totals?.calls, d.totals?.total], [1, 2, 1, 2, 7, 6]);
  same("lost reasons, most first, not given after the others", d.lostReasons, [{ reason: "price", count: 1 }, { reason: "not_given", count: 1 }]);
  const priya = (d.items?.lost ?? []).find((x: Json) => x.lead === "Priya Price");
  check("a lost lead: owner, reason, notes, when and by whom it was marked", !!priya && priya.owner === "Asha" && priya.reason === "price" && priya.notes === "Too costly"
    && priya.markedBy === "Bina" && priya.markedAt === daysAgo(2).toISOString().slice(0, 13) + priya.markedAt.slice(13), show(priya));
  const rita = (d.items?.reminders ?? []).find((x: Json) => x.lead === "Remind Rita");
  check("an overdue reminder: lead, title, owner, when", !!rita && rita.title === "Call back" && rita.owner === "Asha" && !!rita.remindAt, show(rita));
  const ivan = (d.items?.inactive ?? [])[0];
  check("an inactive lead: owner (matched by id), waited, moves, team", ivan?.lead === "Idle Ivan" && ivan.ownerId === String(asha) && ivan.waitingMinutes === 300 && ivan.moves === 1 && ivan.team === "Falcons", show(ivan));
  check("calls: the list with recordings, each tied to the CRM's person", d.calls?.available === true && d.calls.list.length === 2 && d.calls.list[0].recordings === 1
    && d.calls.list[0].personId === String(asha) && d.calls.total === 7, show(d.calls));
  check("…asked of the CRM: today's calls by default, inactive leads", saw.some((p) => p.startsWith(`/delta/api/v1/service/calls?from=${today}&to=${today}`)) && saw.includes("/delta/api/v1/service/inactive-leads"), show(saw));
  check("busiest first", (d.people ?? [])[0]?.id === String(asha), show((d.people ?? []).map((p: Json) => p.name)));

  r = await call("/pending/finance", root);
  check("finance: approvals waiting and old-date entries, as finance says", r.status === 200 && r.body?.data?.approvals?.delayed === 1 && r.body.data.backdated.rows[0].number === "EXP-1", show(r.body));

  step("Case 2 — edge");
  check("lost 10 days ago, not connected 20 days ago: outside the period", !(d.items?.lost ?? []).some((x: Json) => x.lead === "Old Lost") && !(d.items?.notConnected ?? []).some((x: Json) => x.lead === "Old Silence"));
  check("a reminder not yet due, and a done one: not counted", !(d.items?.reminders ?? []).some((x: Json) => x.title === "Later" || x.title === "Done"));
  same("calls by somebody not in the CRM: counted in the total, not against anyone", d.calls?.unlinked, 2);
  r = await call(`/pending/sales/delta?from=${dayOf(-30)}&to=${today}`, root);
  same("a wider period takes in the older ones", [r.body?.data?.totals?.lost, r.body?.data?.totals?.not_connected], [3, 2]);
  r = await call("/pending/sales/delta", root);
  same("no period: this month", r.body?.data?.period?.from, `${today.slice(0, 7)}-01`);
  r = await call(`/pending/sales/draw?from=${dayOf(-7)}&to=${today}`, root);
  check("Draw, no API set: its database's figures, inactive leads and calls say why not", r.status === 200 && r.body?.data?.totals?.lost === 1
    && r.body.data.inactive.available === false && !!r.body.data.inactive.error && r.body.data.calls.available === false, show(r.body));
  financeOld = true;
  r = await call("/pending/finance", root);
  check("finance from before this tab: says its server needs updating", r.status === 409 && /needs updating/.test(r.body?.message ?? ""), show(r.body));
  financeOld = false;

  step("Case 3 — errors");
  r = await call("/pending/sales/banglore", root);
  check("a CRM that can't be read: 409 with why", r.status === 409 && !!r.body?.message, show(r.body));
  check("an unknown one: 404", (await call("/pending/sales/nowhere", root)).status === 404);
  check("bad dates, from after to: 400", (await call("/pending/sales/delta?from=yesterday", root)).status === 400
    && (await call(`/pending/sales/delta?from=${today}&to=${dayOf(-1)}`, root)).status === 400);

  step("Case 4 — root admins only");
  check("no session: 401", (await call("/pending/sales")).status === 401 && (await call("/pending/sales/delta")).status === 401 && (await call("/pending/finance")).status === 401);
  check("not a root admin: 403", (await call("/pending/sales", member)).status === 403 && (await call("/pending/finance", member)).status === 403);

  console.log(`\n${checks - failures}/${checks} checks passed`);
}

main()
  .catch((err) => { console.error(err); failures++; })
  .finally(async () => {
    stand.close();
    await mongoose.disconnect().catch(() => {});
    process.exit(failures ? 1 : 0);
  });
