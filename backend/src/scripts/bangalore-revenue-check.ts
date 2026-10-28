/**
 * Root's revenue figures with a Bangalore enrolment's money (services/bangaloreRevenue.ts, 2026-10-28), on scratch
 * databases, through the services themselves: Salespeople (list + one person), Reports → Sales and the group
 * report's revenue, for Delta (AED cash kept as `original`), Remote (its AED cash is on the lead — counted once) and
 * Banglore (rupees throughout — nothing added). Also: a rupee balance payment in AED once approved, a waiting balance
 * payment not counted, a dropped enrolment not counted, the CRM's own rate.
 *
 * Run through scripts/bangalore-revenue-check.sh. Scratch databases on 127.0.0.1 only.
 */
import mongoose, { Types } from "mongoose";

const uris = ["MONGODB_URI", "DELTA_MONGODB_URI", "REMOTE_MONGODB_URI", "BANGLORE_MONGODB_URI"].map((k) => [k, process.env[k] ?? ""] as const);
for (const [name, value] of uris) {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(value)) {
    console.error(`Refusing to run: ${name} must be a scratch e2e database on 127.0.0.1, got "${value}"`);
    process.exit(1);
  }
}

let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail !== "" ? ` — ${JSON.stringify(detail)}` : ""}\x1b[0m`); }
}
const section = (s: string) => console.log(`\n${s}`);

await mongoose.connect(process.env.MONGODB_URI!);
await mongoose.connection.dropDatabase();
const open = async (k: string) => { const c = await mongoose.createConnection(process.env[k]!).asPromise(); await c.dropDatabase(); return c.db!; };
const delta = await open("DELTA_MONGODB_URI"), remote = await open("REMOTE_MONGODB_URI"), banglore = await open("BANGLORE_MONGODB_URI");

const { Organization } = await import("../models/Organization.js");
for (const [code, name, currency, sortOrder] of [["delta", "Delta", "AED", 1], ["remote", "Remote", "AED", 2], ["banglore", "Banglore", "INR", 3]] as const) {
  await Organization.create({ code, kind: "crm", name, timezone: "Asia/Dubai", currency, fxToBase: currency === "INR" ? 0.044 : 1, isActive: true, sortOrder, accent: "#2563eb" });
}

const id = () => new Types.ObjectId();
const now = new Date(Date.now() - 60_000);
const approved = (ext: string) => ({ externalId: ext, method: "upi", sentAt: now, state: "approved" });

/** One CRM: Ria (a Bangalore close, a rupee balance payment, a waiting one) and Ben (a Dubai close, a dropped Bangalore one). */
async function seed(db: mongoose.mongo.Db, aedCash: Record<string, unknown>, aedCashOnLead: boolean, rate?: number) {
  const ria = id(), ben = id(), l1 = id(), l2 = id(), l3 = id();
  await db.collection("users").insertMany([{ _id: ria, name: "Ria", email: "ria@e2e.test", status: "active" }, { _id: ben, name: "Ben", email: "ben@e2e.test", status: "active" }]);
  if (rate) await db.collection("appsettings").insertOne({ key: "app", bangaloreRevenue: { inrPerAed: rate } });
  await db.collection("leads").insertMany([
    { _id: l1, name: "L1", assignedTo: ria, status: "closed", createdAt: now, payments: [
      { _id: id(), amount: 200, paidAt: now, note: "Advance" },
      ...(aedCashOnLead ? [{ _id: id(), amount: 100, paidAt: now, note: "Collected at enrolment · Cash · Bangalore" }] : []),
      { _id: id(), amount: 4550, paidAt: now, currency: "INR", finance: approved("bp-1") },
      { _id: id(), amount: 9100, paidAt: now, currency: "INR", finance: { ...approved("bp-2"), state: "pending" } },
    ] },
    { _id: l2, name: "L2", assignedTo: ben, status: "closed", createdAt: now, payments: [{ _id: id(), amount: 1000, paidAt: now }] },
    { _id: l3, name: "L3", assignedTo: ben, status: "closed", createdAt: now, payments: [] },
  ]);
  await db.collection("students").insertMany([
    { leadId: l1, assignedTo: ria, academy: "bangalore", status: "active", enrollmentDate: now, payments: [
      { method: "inr_bank_account", amount: 45500, paidAt: now },
      { method: "cash", amount: 2275, paidAt: now, ...aedCash },
      { method: "cash", amount: 4550, paidAt: now, collectedBefore: true },
    ] },
    { leadId: l2, assignedTo: ben, status: "active", enrollmentDate: now, payments: [{ method: "cash", amount: 1000, paidAt: now }] },
    { leadId: l3, assignedTo: ben, academy: "bangalore", status: "dropped", enrollmentDate: now, payments: [{ method: "upi", amount: 22750, paidAt: now }] },
  ]);
  return { ria: String(ria), ben: String(ben) };
}
// Delta at the default 22.75: Ria 200 + ₹45,500 → 2,000 + AED 100 cash + approved ₹4,550 → 200 = 2,500
const d = await seed(delta, { original: { currency: "AED", amount: 100, rate: 22.75 } }, false);
// Remote at 45.5: Ria 200 + 100 (AED cash, on the lead) + ₹45,500 → 1,000 + ₹4,550 → 100 = 1,400
const r = await seed(remote, { currency: "AED", amountInCurrency: 100, exchangeRate: 22.75 }, true, 45.5);
// Banglore: rupees throughout — the lead's own 1,000 only (its leads carry no rupee mark; nothing is added)
const b = await seed(banglore, { currency: "AED", amountInCurrency: 100, exchangeRate: 22.75 }, false);

const { listSalespeople, getSalesperson } = await import("../services/salespersonService.js");
const { salesReport } = await import("../services/salesReportService.js");
const { getOverview } = await import("../services/groupReportService.js");

section("Salespeople list");
const list = await listSalespeople({});
const rev = (code: string, name: string) => list.crms.find((c) => c.code === code)?.people.find((p) => p.name === name)?.revenue;
check("Delta Ria 2,500 (rupees at 22.75, AED cash at its AED, approved balance payment ₹4,550 → 200, waiting one not)", rev("delta", "Ria") === 2500, rev("delta", "Ria"));
check("Delta Ben 1,000 (dropped Bangalore enrolment not counted)", rev("delta", "Ben") === 1000, rev("delta", "Ben"));
check("Remote Ria 1,400 at its own rate 45.5, the AED cash on the lead counted once", rev("remote", "Ria") === 1400, rev("remote", "Ria"));
check("Banglore Ria: only her lead's AED-free sums — 200 (nothing added, no rupee payment counted as AED)", rev("banglore", "Ria") === 200, rev("banglore", "Ria"));

section("One salesperson");
const one = await getSalesperson("delta", d.ria, {});
check("Delta Ria's page revenue 2,500", one.summary.revenue === 2500, one.summary.revenue);
check("Her payments list names the Bangalore money", one.payments.some((p: { note?: string }) => /Bangalore enrolment/.test(String(p.note))) && one.payments.some((p: { note?: string }) => /Bangalore balance payment/.test(String(p.note))), one.payments);
const oneR = await getSalesperson("remote", r.ria, {});
check("Remote Ria's page revenue 1,400", oneR.summary.revenue === 1400, oneR.summary.revenue);

section("Reports → Sales");
const rep = await salesReport("delta", {});
const ria = rep.revenue.people.find((p: { name: string }) => p.name === "Ria") as { revenue?: number } | undefined;
check("Delta report: Ria 2,500, total 3,500", ria?.revenue === 2500 && rep.revenue.total.revenue === 3500, { ria, total: rep.revenue.total });
const repR = await salesReport("remote", {});
check("Remote report total 2,400", repR.revenue.total.revenue === 2400, repR.revenue.total);

section("Group report");
const ov = await getOverview({});
const native = (code: string) => (ov as { orgs?: Array<{ org: { code: string }; revenue: { native: number } }> }).orgs?.find((o) => o.org.code === code)?.revenue.native;
check("Delta revenue 3,500, Remote 2,400", native("delta") === 3500 && native("remote") === 2400, { delta: native("delta"), remote: native("remote"), keys: Object.keys(ov) });
check("Banglore revenue 1,200 (its own lead payments, nothing added)", native("banglore") === 1200, native("banglore"));
void b;

console.log(`\n${checks - failures}/${checks} passed`);
await mongoose.disconnect();
process.exit(failures ? 1 : 0);
