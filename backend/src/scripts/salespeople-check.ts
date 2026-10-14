/**
 * The Salespeople pages' API (services/salespersonService.ts), end to end:
 *
 *   Case 1  happy path   the list's leads, closings and revenue per person; one
 *                        person's statuses, closings (with course names),
 *                        payments, follow-ups, pending now and teams
 *   Case 2  edge         Gulf-time day boundaries (a payment at 01:00 GST on the
 *                        1st counts, one at 00:30 GST the next month does not),
 *                        dropped closings, all time, a status's leads, a CRM
 *                        that cannot be read
 *   Case 3  errors       bad dates, from after to, an unknown CRM or person
 *   Case 4  permission   no session, an admin who is not a root admin
 *
 * Run through scripts/salespeople-check.sh. Scratch databases on 127.0.0.1 only.
 */
import mongoose, { Types } from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
for (const [name, value] of [
  ["MONGODB_URI", uri],
  ["DELTA_MONGODB_URI", process.env.DELTA_MONGODB_URI ?? ""],
  ["DRAW_MONGODB_URI", process.env.DRAW_MONGODB_URI ?? ""],
] as const) {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(value)) {
    console.error(`Refusing to run: ${name} must be a scratch e2e database on 127.0.0.1, got "${value}"`);
    process.exit(1);
  }
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const PASSWORD = "SalesE2e!pass1";

let failures = 0;
let checks = 0;
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
const z = (iso: string) => new Date(iso);

async function main() {
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  const deltaDb = (await mongoose.createConnection(process.env.DELTA_MONGODB_URI!).asPromise()).db!;
  const drawDb = (await mongoose.createConnection(process.env.DRAW_MONGODB_URI!).asPromise()).db!;
  for (const db of [mongoose.connection.db!, deltaDb, drawDb]) await db.dropDatabase();

  step("Setting up: the registry, two admins, two CRMs with people, teams, leads, students and payments");
  const { AdminUser } = await import("../models/AdminUser.js");
  const { Organization } = await import("../models/Organization.js");
  for (const [code, name, sortOrder, currency] of [["delta", "Delta CRM", 1, "AED"], ["banglore", "Banglore CRM", 2, "INR"], ["draw", "Draw CRM", 3, "AED"]] as const) {
    await Organization.create({ code, kind: "crm", name, timezone: "Asia/Dubai", currency, fxToBase: 1, isActive: true, sortOrder, accent: "#2563eb" });
  }
  await AdminUser.create({ name: "Root E2E", email: "root@sales-e2e.test", password: PASSWORD, role: "root_admin", status: "active" });
  await AdminUser.create({ name: "Member E2E", email: "member@sales-e2e.test", password: PASSWORD, role: "member", status: "active" });

  const ria = new Types.ObjectId(), gopika = new Types.ObjectId(), gone = new Types.ObjectId(), irfana = new Types.ObjectId();
  await deltaDb.collection("users").insertMany([
    { _id: ria, name: "Ria", email: "RIA@delta-e2e.test", status: "active", designation: "Sales Executive" },
    { _id: gopika, name: "Gopika", email: "gopika@delta-e2e.test", status: "active" },
    { _id: gone, name: "Gone", email: "gone@delta-e2e.test", status: "inactive" },
  ]);
  await deltaDb.collection("teams").insertOne({ name: "Team Gladiators", leaders: [gopika], members: [ria] });
  const course = new Types.ObjectId(), course2 = new Types.ObjectId();
  await deltaDb.collection("courses").insertMany([{ _id: course, name: "MBT" }, { _id: course2, name: "DWT" }]);
  const now = new Date();
  // Ria's leads: three in October (Gulf), one in September; statuses spread.
  const leadIds = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
  await deltaDb.collection("leads").insertMany([
    { _id: leadIds[0], name: "Asha", phone: "+971500000001", source: "Meta", status: "closed", assignedTo: ria, createdAt: z("2026-10-02T08:00:00Z"), updatedAt: z("2026-10-03T08:00:00Z"),
      // 01:00 GST on 1 Oct — October's in Gulf time; and 00:30 GST on 1 Nov — not.
      payments: [{ amount: 2000, paidAt: z("2026-09-30T21:00:00Z"), note: "Card" }, { amount: 500, paidAt: z("2026-10-31T20:30:00Z") }],
      followUps: [{ followedUpBy: ria, followedUpAt: z("2026-10-05T10:00:00Z") }, { followedUpBy: gopika, followedUpAt: z("2026-10-05T11:00:00Z") }] },
    { _id: leadIds[1], name: "Bilal", phone: "+971500000002", source: "Google", status: "followup", assignedTo: ria, createdAt: z("2026-10-10T08:00:00Z"),
      followUps: [{ followedUpBy: ria, followedUpAt: z("2026-10-11T10:00:00Z") }, { followedUpBy: ria, followedUpAt: z("2026-09-11T10:00:00Z") }],
      reminders: [{ createdBy: ria, isDone: false, remindAt: z("2026-01-01T00:00:00Z") }, { createdBy: ria, isDone: false, remindAt: new Date(now.getTime() + 3_600_000) }] },
    { _id: leadIds[2], name: "Chen", phone: "+971500000003", source: "Meta", status: "assigned", assignedTo: ria, createdAt: z("2026-10-20T08:00:00Z") },
    { _id: leadIds[3], name: "Old Dan", phone: "+971500000004", source: "Meta", status: "lost", assignedTo: ria, createdAt: z("2026-09-15T08:00:00Z"),
      payments: [{ amount: 300, paidAt: z("2026-09-15T09:00:00Z") }] },
    { name: "Gopika's", phone: "+971500000005", status: "assigned", assignedTo: gopika, createdAt: z("2026-10-03T08:00:00Z") },
  ]);
  await deltaDb.collection("students").insertMany([
    { name: "Asha", leadId: leadIds[0], assignedTo: ria, course, totalFee: 5000, paidAmount: 2000, pendingAmount: 3000, enrollmentDate: z("2026-10-03T08:00:00Z"), status: "active" },
    { name: "Dropped Dee", leadId: new Types.ObjectId(), assignedTo: ria, course, totalFee: 1000, paidAmount: 0, enrollmentDate: z("2026-10-04T08:00:00Z"), status: "dropped" },
    { name: "September Sam", leadId: new Types.ObjectId(), assignedTo: ria, courses: [course, course2], totalFee: 3000, paidAmount: 3000, enrollmentDate: z("2026-09-20T08:00:00Z"), status: "active" },
  ]);
  await drawDb.collection("users").insertOne({ _id: irfana, name: "Irfana", email: "irfana@draw-e2e.test", status: "active" });
  await drawDb.collection("leads").insertOne({ name: "Draw lead", status: "assigned", assignedTo: irfana, createdAt: z("2026-10-08T08:00:00Z") });

  const login = async (email: string) => {
    const r = await fetch(`${ROOT}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
    const b: Json = await r.json().catch(() => ({}));
    return b?.data?.accessToken ?? b?.data?.token ?? b?.accessToken;
  };
  const root = { authorization: `Bearer ${await login("root@sales-e2e.test")}` };
  const member = { authorization: `Bearer ${await login("member@sales-e2e.test")}` };
  const OCT = "from=2026-10-01&to=2026-10-31";

  step("Case 1 — happy path: the list, and Ria's page for October (Gulf time)");
  let r = await call("GET", `/salespeople?${OCT}`, root);
  const delta = (r.body?.data?.crms ?? []).find((c: Json) => c.code === "delta");
  const riaRow = delta?.people?.find((p: Json) => p.id === String(ria));
  check("the list: Ria with 3 leads, 1 closing, AED 2,000 revenue, her team", r.status === 200 && riaRow?.leads === 3 && riaRow?.closings === 1
    && riaRow?.revenue === 2000 && riaRow?.teams?.[0] === "Team Gladiators" && riaRow?.email === "ria@delta-e2e.test", show(riaRow));
  check("…the CRM's currency beside it; Draw listed too", delta?.currency === "AED" && (r.body?.data?.crms ?? []).some((c: Json) => c.code === "draw" && c.people.some((p: Json) => p.name === "Irfana" && p.leads === 1)), show(r.body?.data?.crms?.map((c: Json) => c.code)));
  check("…someone who left is there, marked so", delta?.people?.find((p: Json) => p.id === String(gone))?.active === false);
  r = await call("GET", `/salespeople/delta/${ria}?${OCT}`, root);
  const d = r.body?.data;
  check("her page: 3 leads, 1 closing, AED 2,000, 2 follow-ups logged by her, 33.3% converted", r.status === 200 && d?.summary?.leads === 3 && d.summary.closings === 1
    && d.summary.revenue === 2000 && d.summary.followUps === 2 && d.summary.conversion === 33.3, show(d?.summary));
  check("…leads by status: closed, follow-up, assigned — 1 each, 33.3%", show((d?.statuses ?? []).map((s: Json) => [s.status, s.count]).sort())
    === show([["assigned", 1], ["closed", 1], ["followup", 1]]) && d.statuses.every((s: Json) => s.percent === 33.3) && d.statuses.some((s: Json) => s.label === "Follow-up"), show(d?.statuses));
  check("…the closing with its course, fee, collected and balance", d?.closings?.length === 1 && d.closings[0].name === "Asha" && d.closings[0].course === "MBT"
    && d.closings[0].fee === 5000 && d.closings[0].paid === 2000 && d.closings[0].balance === 3000, show(d?.closings));
  check("…the payment, with its note", d?.payments?.length === 1 && d.payments[0].amount === 2000 && d.payments[0].note === "Card" && d.payments[0].name === "Asha", show(d?.payments));
  check("…pending now: 1 new lead, 2 reminders, 1 overdue — whatever the period", d?.pendingNow?.newLeads === 1 && d.pendingNow.reminders === 2 && d.pendingNow.overdue === 1, show(d?.pendingNow));
  check("…who she is: name, lower-case email, designation, team, CRM", d?.person?.name === "Ria" && d.person.email === "ria@delta-e2e.test" && d.person.designation === "Sales Executive"
    && d.person.teams[0] === "Team Gladiators" && d.crm.code === "delta" && d.crm.currency === "AED", show(d?.person));

  step("Case 2 — edges");
  check("Gulf-time days: 01:00 GST on 1 Oct is October's; 00:30 GST on 1 Nov is not", d?.payments?.length === 1 && d.payments[0].amount === 2000);
  check("…the period runs from Gulf midnight to Gulf midnight", d?.period?.from === "2026-09-30T20:00:00.000Z" && d.period.to === "2026-10-31T19:59:59.999Z", show(d?.period));
  check("a dropped closing never counts", !(d?.closings ?? []).some((c: Json) => c.name === "Dropped Dee"));
  r = await call("GET", `/salespeople/delta/${ria}`, root);
  check("all time: 4 leads, 2 closings (one on two courses), AED 2,800", r.body?.data?.summary?.leads === 4 && r.body.data.summary.closings === 2 && r.body.data.summary.revenue === 2800
    && r.body.data.closings.some((c: Json) => c.course === "MBT, DWT") && r.body.data.period.from === null, show(r.body?.data?.summary));
  r = await call("GET", `/salespeople/delta/${ria}/leads?${OCT}&status=followup`, root);
  check("a status's leads: Bilal, with his phone and source", r.status === 200 && r.body?.data?.length === 1 && r.body.data[0].name === "Bilal" && r.body.data[0].phone === "+971500000002"
    && r.body.data[0].statusLabel === "Follow-up", show(r.body?.data));
  r = await call("GET", `/salespeople/delta/${gopika}?${OCT}`, root);
  check("someone with nothing closed: zeros, not errors", r.status === 200 && r.body?.data?.summary?.closings === 0 && r.body.data.summary.revenue === 0 && r.body.data.summary.leads === 1);
  r = await call("GET", `/salespeople?${OCT}`, root);
  check("Banglore not answering: listed as a failure, the rest stand", (r.body?.data?.failures ?? []).some((f: Json) => f.code === "banglore") && (r.body?.data?.crms ?? []).length === 2, show(r.body?.data?.failures));
  r = await call("GET", `/salespeople/banglore/${ria}`, root);
  check("…and its people's pages say so (503)", r.status === 503, show(r.body));

  step("Case 3 — errors");
  check("a date that is not one: 400", (await call("GET", "/salespeople?from=yesterday-ish", root)).status === 400);
  check("from after to: 400", (await call("GET", "/salespeople?from=2026-10-31&to=2026-10-01", root)).status === 400);
  check("an unknown CRM: 404", (await call("GET", `/salespeople/nope/${ria}`, root)).status === 404);
  check("a person who is not one: 404", (await call("GET", "/salespeople/delta/not-an-id", root)).status === 404
    && (await call("GET", `/salespeople/delta/${new Types.ObjectId()}`, root)).status === 404);

  step("Case 4 — root admins only");
  check("no session: 401", (await call("GET", "/salespeople")).status === 401 && (await call("GET", `/salespeople/delta/${ria}`)).status === 401);
  check("an admin who is not a root admin: 403", (await call("GET", "/salespeople", member)).status === 403 && (await call("GET", `/salespeople/delta/${ria}`, member)).status === 403);

  step("Case 5 — a stat card's breakdown (2026-10-14)");
  r = await call("GET", `/salespeople/delta/${ria}/breakdown/leads?${OCT}`, root);
  let b = r.body?.data;
  check("leads: by source (Meta 2, Google 1), by status, by Gulf day, and the leads", r.status === 200
    && show(b?.bySource?.map((x: Json) => [x.label, x.count])) === show([["Meta", 2], ["Google", 1]])
    && b.byStatus.length === 3 && b.byDay.map((x: Json) => x.key).join() === "2026-10-02,2026-10-10,2026-10-20"
    && b.rows.length === 3 && b.rows[0].name === "Chen" && b.rows[0].source === "Meta", show(b));
  r = await call("GET", `/salespeople/delta/${ria}/breakdown/followups?${OCT}`, root);
  b = r.body?.data;
  check("follow-ups: hers in October only (not Gopika's, not September's), by day, each with its lead", r.status === 200
    && b?.rows?.length === 2 && b.rows[0].name === "Bilal" && b.rows[1].name === "Asha" && b.byDay.length === 2 && b.byStatus.length === 2, show(b));
  r = await call("GET", `/salespeople/delta/${ria}/breakdown/pending`, root);
  b = r.body?.data;
  check("pending: her new lead, and her two reminders — the overdue one first, marked", r.status === 200
    && b?.newLeads?.length === 1 && b.newLeads[0].name === "Chen" && b.reminders?.length === 2 && b.reminders[0].overdue === true && b.reminders[1].overdue === false
    && b.reminders[0].name === "Bilal", show(b));
  check("an unknown breakdown: 400; a member: 403", (await call("GET", `/salespeople/delta/${ria}/breakdown/nope`, root)).status === 400
    && (await call("GET", `/salespeople/delta/${ria}/breakdown/leads`, member)).status === 403);

  console.log(`\n${checks - failures}/${checks} checks passed`);
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
