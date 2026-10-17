/**
 * Reports → Sales end to end (services/salesReportService.ts):
 *
 *   Case 1  happy path   a CRM's period per salesperson, team and month: leads received (untouched, by source),
 *                        follow-ups logged and leads contacted, status changes, closings (conversion), revenue, lost
 *                        (with reasons) and not connected, calls (with the list), commission counted
 *   Case 2  edge         outside the period left out; dropped closings, uncounted commission left out; the team and
 *                        person filters; a CRM with no calls system
 *   Case 3  errors       a CRM that can't be read, an unknown one, bad dates
 *   Case 4  permission   no session, an admin who is not a root admin
 *
 * Run through scripts/sales-report-check.sh. Scratch databases on 127.0.0.1 only.
 */
import mongoose, { Types } from "mongoose";
import { createServer } from "node:http";

const uri = process.env.MONGODB_URI ?? "";
for (const [name, value] of [["MONGODB_URI", uri], ["DELTA_MONGODB_URI", process.env.DELTA_MONGODB_URI ?? ""], ["DRAW_MONGODB_URI", process.env.DRAW_MONGODB_URI ?? ""]] as const) {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(value)) { console.error(`Refusing: ${name} must be a scratch e2e database on 127.0.0.1, got "${value}"`); process.exit(1); }
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const PASSWORD = "SalesReportE2e!pass1";
let failures = 0, checks = 0;
const check = (label: string, ok: boolean, detail = "") => { checks++; if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`); else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); } };
const same = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const call = async (path: string, headers: Record<string, string> = {}) => { const r = await fetch(`${ROOT}${path}`, { headers }); return { status: r.status, body: (await r.json().catch(() => ({}))) as Json }; };

const days = (n: number) => new Date(Date.now() - n * 86_400_000);
const FROM = days(10).toISOString(), TO = new Date().toISOString();
const P = `?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`;
const asha = new Types.ObjectId(), bina = new Types.ObjectId();

// The Sales CRM's calls, as its /service/calls answers.
const stand = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.headers["x-portal-secret"] !== "sales-e2e-delta-secret") return send(401, { success: false });
  if (url.pathname === "/delta/api/v1/service/calls") {
    const row = (o: Record<string, unknown>) => ({ id: new Types.ObjectId().toString(), startedAt: days(1).toISOString(), direction: "out", status: "answered", talkSeconds: 90, ringSeconds: 3,
      number: "9715", extension: "101", person: String(asha), personName: "Asha", personEmail: "asha@delta-e2e.test", userName: "Asha", userEmail: "asha@delta-e2e.test", contact: "Lead", contactKind: "lead", recordings: 1, ...o });
    return send(200, { success: true, data: { stats: { calls: 3, connected: 2, talkSeconds: 180 }, people: [
      { key: String(asha), userId: String(asha), name: "Asha", email: "asha@delta-e2e.test", calls: 2, connected: 2, talkSeconds: 180 },
      { key: String(bina), userId: String(bina), name: "Bina", email: "bina@delta-e2e.test", calls: 1, connected: 0, talkSeconds: 0 },
    ], calls: [row({}), row({}), row({ person: String(bina), personEmail: "bina@delta-e2e.test", userName: "Bina", userEmail: "bina@delta-e2e.test", status: "no_answer", talkSeconds: 0, recordings: 0 })], total: 3 } });
  }
  return send(404, { success: false, message: "Route not found" });
});
await new Promise<void>((ok) => stand.listen(Number(process.env.E2E_STANDIN_PORT), "127.0.0.1", ok));

async function main() {
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  await mongoose.connect(uri);
  await mongoose.connection.db!.dropDatabase();
  const deltaDb = (await mongoose.createConnection(process.env.DELTA_MONGODB_URI!).asPromise()).db!;
  const drawDb = (await mongoose.createConnection(process.env.DRAW_MONGODB_URI!).asPromise()).db!;
  await deltaDb.dropDatabase(); await drawDb.dropDatabase();

  step("Setting up: the registry, two admins, a Sales CRM with two people in two teams");
  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  for (const [code, name, sortOrder] of [["delta", "Delta CRM", 1], ["banglore", "Banglore CRM", 2], ["draw", "Draw CRM", 3]] as [string, string, number][]) {
    await Organization.create({ code, kind: "crm", name, timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder, accent: "#2563eb" });
  }
  await AdminUser.create({ name: "Root", email: "root@sales-report-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member", email: "member@sales-report-e2e.test", password: PASSWORD, role: "member", status: "active" });
  await deltaDb.collection("users").insertMany([
    { _id: asha, name: "Asha", email: "asha@delta-e2e.test", status: "active" },
    { _id: bina, name: "Bina", email: "bina@delta-e2e.test", status: "active" },
  ]);
  const falcons = new Types.ObjectId(), eagles = new Types.ObjectId();
  await deltaDb.collection("teams").insertMany([{ _id: falcons, name: "Falcons", leaders: [], members: [asha] }, { _id: eagles, name: "Eagles", leaders: [bina], members: [] }]);
  const lead = (o: Record<string, unknown>) => ({ _id: new Types.ObjectId(), name: "L", phone: "9715", source: "Meta", status: "assigned", reminders: [], followUps: [], payments: [], activityLogs: [], createdAt: days(2), updatedAt: days(1), ...o });
  const won = lead({ name: "Won Wes", assignedTo: asha, status: "closed", source: "Google",
    followUps: [{ note: "Called", followedUpAt: days(2), followedUpBy: asha }, { note: "Again", followedUpAt: days(1), followedUpBy: asha }],
    payments: [{ amount: 3000, paidAt: days(1), note: "First" }, { amount: 999, paidAt: days(40) }],
    activityLogs: [{ action: "status_changed", performedBy: asha, changes: { status: { from: "assigned", to: "closed" } }, createdAt: days(1) }] });
  await deltaDb.collection("leads").insertMany([
    won,
    lead({ name: "New Nora", assignedTo: asha }),                                           // untouched
    lead({ name: "Old Olga", assignedTo: asha, createdAt: days(40) }),                      // outside
    lead({ name: "Lost Lou", assignedTo: bina, status: "lost", lostReason: "price", lostNotes: "Too much",
      followUps: [{ note: "No", followedUpAt: days(3), followedUpBy: bina }],
      activityLogs: [{ action: "status_changed", performedBy: bina, changes: { status: { from: "assigned", to: "lost" } }, createdAt: days(3) }] }),
    lead({ name: "Silent Sam", assignedTo: bina, status: "not_connected", updatedAt: days(2) }),
  ]);
  await deltaDb.collection("courses").insertOne({ _id: new Types.ObjectId("6ad000000000000000000001"), name: "MBT" });
  await deltaDb.collection("students").insertMany([
    { name: "Won Wes", assignedTo: asha, course: new Types.ObjectId("6ad000000000000000000001"), totalFee: 5000, paidAmount: 3000, enrollmentDate: days(1), status: "active" },
    { name: "Dropped Dan", assignedTo: asha, totalFee: 1000, paidAmount: 0, enrollmentDate: days(1), status: "dropped" },
  ]);
  await deltaDb.collection("commissionsales").insertMany([
    { studentName: "Won Wes", courseName: "MBT", saleDate: days(1), state: "counted", lines: [{ role: "sales", user: asha, amount: 300 }, { role: "tl", user: bina, amount: 50 }] },
    { studentName: "Not yet", saleDate: days(1), state: "progress", lines: [{ role: "sales", user: asha, amount: 999 }] },
  ]);

  const login = async (email: string) => (await (await fetch(`${ROOT}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) })).json())?.data?.accessToken as string;
  const root = { authorization: `Bearer ${await login("root@sales-report-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@sales-report-e2e.test")}` };

  step("Case 1 — happy path");
  const r = await call(`/portal-reports/sales/delta${P}`, root);
  const d = r.body?.data ?? {};
  const row = (sec: string, id: Types.ObjectId) => (d[sec]?.people ?? []).find((p: Json) => p.id === String(id)) ?? {};
  same("200, the CRM and its currency", [r.status, d.name, d.currency], [200, "Delta CRM", "AED"]);
  same("leads: Asha 2 received (1 untouched), Bina 2 — Olga outside", [row("leads", asha).received, row("leads", asha).untouched, row("leads", bina).received, d.leads?.total?.received], [2, 1, 2, 4]);
  check("leads by source", (d.leads?.sources ?? []).some((s: Json) => s.source === "Meta" && s.count === 3) && d.leads.sources.some((s: Json) => s.source === "Google"));
  same("follow-ups: Asha 2 on 1 lead, Bina 1", [row("followups", asha).followups, row("followups", asha).leads_contacted, row("followups", bina).followups], [2, 1, 1]);
  same("status changes: Asha 1, Bina 1", [row("followups", asha).status_changes, row("followups", bina).status_changes], [1, 1]);
  same("closings: Asha 1 (dropped left out), fee 5000, collected 3000, conversion 50%", [row("closings", asha).closings, row("closings", asha).fee, row("closings", asha).collected, row("closings", asha).conversion], [1, 5000, 3000, 50]);
  same("closing row: the course name", d.closings?.rows?.[0]?.course, "MBT");
  same("revenue: Asha 3000 in the period (999 outside)", [row("revenue", asha).revenue, d.revenue?.total?.payments], [3000, 1]);
  same("lost: Bina 1 lost (price), 1 not connected", [row("lost", bina).lost, row("lost", bina).not_connected, d.lost?.reasons], [1, 1, [{ reason: "price", count: 1 }]]);
  check("lost row: reason, notes, marked by", (d.lost?.rows ?? []).some((x: Json) => x.lead === "Lost Lou" && x.reason === "price" && x.notes === "Too much" && x.marked_by === "Bina"));
  same("calls: Asha 2 (2 connected, 180s), Bina 1", [row("calls", asha).calls, row("calls", asha).connected, row("calls", asha).talk_seconds, row("calls", bina).calls], [2, 2, 180, 1]);
  check("call rows with recordings and owners", d.calls?.available === true && d.calls.rows.length === 3 && d.calls.rows[0].owner === "Asha" && d.calls.rows[0].recordings === 1, JSON.stringify(d.calls).slice(0, 300));
  same("commission counted: Asha 300, Bina 50 (in progress left out)", [row("commission", asha).commission, row("commission", bina).commission, d.commission?.total?.commission], [300, 50, 350]);
  check("teams and months", (d.leads?.teams ?? []).some((t: Json) => t.team === "Falcons") && (d.leads?.months ?? []).length >= 1);
  check("filters: teams and people", (d.filters?.teams ?? []).length === 2 && (d.filters?.people ?? []).length === 2);

  step("Case 2 — filters, edges");
  const team = (await call(`/portal-reports/sales/delta${P}&team=${eagles}`, root)).body.data;
  same("one team (Eagles): only Bina", [team?.leads?.total?.received, team?.commission?.total?.commission], [2, 50]);
  const one = (await call(`/portal-reports/sales/delta${P}&person=${asha}`, root)).body.data;
  same("one person (Asha): her leads and calls", [one?.leads?.total?.received, one?.calls?.rows?.length], [2, 2]);
  const all = (await call("/portal-reports/sales/delta", root)).body.data;
  same("no period: all time — Olga and the old payment in", [all?.leads?.total?.received, all?.revenue?.total?.revenue], [5, 3999]);
  const draw = await call(`/portal-reports/sales/draw${P}`, root);
  check("Draw, no API set: its database's figures, calls say why not", draw.status === 200 && draw.body.data.calls.available === false && !!draw.body.data.calls.message, JSON.stringify(draw.body).slice(0, 300));

  step("Case 3 — errors");
  check("a CRM that can't be read: 409", (await call("/portal-reports/sales/banglore", root)).status === 409);
  check("an unknown one: 404", (await call("/portal-reports/sales/nowhere", root)).status === 404);
  check("bad dates: 400", (await call("/portal-reports/sales/delta?from=yesterday", root)).status === 400);

  step("Case 4 — root admins only");
  check("no session: 401", (await call("/portal-reports/sales/delta")).status === 401);
  check("not a root admin: 403", (await call("/portal-reports/sales/delta", member)).status === 403);
  console.log(`\n${checks - failures}/${checks} checks passed`);
}

main().catch((e) => { console.error(e); failures++; }).finally(async () => { stand.close(); await mongoose.disconnect().catch(() => {}); process.exit(failures ? 1 : 0); });
