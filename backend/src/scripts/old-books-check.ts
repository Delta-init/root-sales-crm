/**
 * Finance's old books in Root (2026-11-25), on scratch databases, through the services themselves:
 *
 *   Case 1  Root's own revenue figures (bangaloreRevenue.ts OLD_BOOKS_UNION) take each CRM's `oldbookssales` as the
 *           CRM's figures do — Salespeople (list + one person, the payment named "Old books · …"), Reports → Sales,
 *           the group report; a rupee CRM (Banglore) adds nothing; a row with no user counts nowhere.
 *   Case 2  The Manager TV's "Old books — no CRM user" (oldBooksService.ts): finance's old-books money in the month
 *           whose salesperson is no user in any CRM — signed GET checked by the stand-in finance; a CRM user's, a void
 *           invoice, another month and money before OLD_BOOKS_FROM left out; cached; finance away or not configured:
 *           0 with its reason; the Manager TV answer carries it (no invoice number on the open screen).
 *
 * Run through scripts/old-books-check.sh. Scratch databases on 127.0.0.1 only.
 */
import crypto from "node:crypto";
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

/* ── A stand-in finance: the old books' list, signed as finance checks it ── */
const SECRET = "root-old-books-check-secret-long";
const CLIENT = "root-check";
let invoices: any[] = [];
let away = false, asked = 0, badSignatures = 0;
const fin = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    const ts = req.headers.get("x-delta-timestamp") ?? "", nonce = req.headers.get("x-delta-nonce") ?? "";
    const canonical = [req.method, url.pathname + url.search, ts, nonce, crypto.createHash("sha256").update("").digest("hex")].join("\n");
    if (req.headers.get("x-delta-client") !== CLIENT || req.headers.get("x-delta-signature") !== crypto.createHmac("sha256", SECRET).update(canonical).digest("hex")) {
      badSignatures++;
      return Response.json({ error: { message: "Bad signature" } }, { status: 401 });
    }
    if (away) return Response.json({ error: { message: "down" } }, { status: 503 });
    if (url.pathname !== "/api/v1/integrations/old-books/payments") return Response.json({ error: "Not found" }, { status: 404 });
    asked++;
    const from = url.searchParams.get("from") ?? "";
    return Response.json({ data: invoices.filter((i) => i.payments.some((p: any) => p.paidOn >= from)) });
  },
});
Object.assign(process.env, { FINANCE_API_URL: `http://127.0.0.1:${fin.port}/api/v1`, FINANCE_CLIENT_ID: CLIENT, FINANCE_INTEGRATION_SECRET: SECRET, OLD_BOOKS_FROM: "" });

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
const month = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 7);
const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
const ob = (who: Types.ObjectId | null, invoice: string, amount: number, team: Types.ObjectId | null = null) => ({
  financeInvoiceId: id(), invoiceNumber: invoice, customerName: `Client ${invoice}`, course: "Market Break-out Trading Program",
  assignedTo: who, team, fee: amount * 2, currency: "AED", status: "paid", balance: 0,
  payments: [{ financeId: String(id()), amount, paidAt: now, method: "billexpro", note: `Old books · ${invoice}`, oldBooks: true }],
  allPayments: [], paidInFullAt: now,
});

// Delta: Athira has a lead of her own (1,000) and an old-books instalment (600); an old-books row with no user (450).
const athira = id(), ben = id(), ria = id();
await delta.collection("users").insertMany([{ _id: athira, name: "Athira", email: "athira@e2e.test", status: "active" }]);
await delta.collection("leads").insertOne({ _id: id(), name: "L1", assignedTo: athira, status: "closed", createdAt: now, payments: [{ _id: id(), amount: 1000, paidAt: now }] });
await delta.collection("oldbookssales").insertMany([ob(athira, "DMDT006238", 600), ob(null, "DMDT009999", 450)]);
// Remote: Ben, only old books (525). Banglore (rupees): an old-books row is not added to its rupee figures.
await remote.collection("users").insertOne({ _id: ben, name: "Ben", email: "ben@e2e.test", status: "active" });
await remote.collection("oldbookssales").insertOne(ob(ben, "DMDT006965", 525));
await banglore.collection("users").insertOne({ _id: ria, name: "Ria", email: "ria@e2e.test", status: "active" });
await banglore.collection("leads").insertOne({ _id: id(), name: "L9", assignedTo: ria, status: "closed", createdAt: now, payments: [{ _id: id(), amount: 2000, paidAt: now }] });
await banglore.collection("oldbookssales").insertOne(ob(ria, "DMDT000001", 300));

const { listSalespeople, getSalesperson } = await import("../services/salespersonService.js");
const { salesReport } = await import("../services/salesReportService.js");
const { getOverview } = await import("../services/groupReportService.js");

section("Case 1 — Root's own revenue figures take the CRMs' old books");
const list = await listSalespeople({});
const rev = (code: string, name: string) => list.crms.find((c) => c.code === code)?.people.find((p) => p.name === name)?.revenue;
check("Delta Athira 1,600 (her lead 1,000 + old books 600)", rev("delta", "Athira") === 1600, rev("delta", "Athira"));
check("Remote Ben 525 (old books only)", rev("remote", "Ben") === 525, rev("remote", "Ben"));
check("Banglore Ria 2,000 (a rupee CRM: nothing added)", rev("banglore", "Ria") === 2000, rev("banglore", "Ria"));
const one = await getSalesperson("delta", String(athira), {});
check("Athira's page: revenue 1,600, the payment named 'Old books · DMDT006238'", one.summary.revenue === 1600 && one.payments.some((p: { note?: string; amount?: number }) => p.note === "Old books · DMDT006238" && p.amount === 600), one.payments);
const rep = await salesReport("delta", {});
check("Delta report total 1,600 (the row with no user counts nowhere)", rep.revenue.total.revenue === 1600, rep.revenue.total);
const ov = await getOverview({});
const native = (code: string) => (ov as { orgs?: Array<{ org: { code: string }; revenue: { native: number } }> }).orgs?.find((o) => o.org.code === code)?.revenue.native;
check("group report: Delta 1,600, Remote 525, Banglore 2,000", native("delta") === 1600 && native("remote") === 525 && native("banglore") === 2000, { d: native("delta"), r: native("remote"), b: native("banglore") });

section("Case 2 — the Manager TV's 'Old books — no CRM user'");
const { oldBooksNoCrmUser, resetOldBooksForTests } = await import("../services/oldBooksService.js");
const inv = (n: string, who: string, email: string, pays: [string, number][], status = "paid", currency = "AED") => ({
  invoiceId: String(id()), invoiceNumber: n, customerName: `Client ${n}`, salespersonName: who, salespersonEmail: email, course: "MBT",
  currency, status, payments: pays.map(([d, a]) => ({ id: String(id()), paidOn: d, amountMinor: a * 100, method: "billexpro" })),
});
invoices = [
  inv("DMDT005211", "Arya Krishnan", "arya@e2e.test", [["2025-12-31", 1500], ["2026-11-04", 1000]]),
  inv("DMDT006238", "Athira", "ATHIRA@e2e.test", [["2026-11-11", 600]]),          // a Delta user (any case): the CRM counts it
  inv("DMDT006965", "Ben", "ben@e2e.test", [["2026-11-24", 525]]),                // a Remote user
  inv("DMDT007777", "Gone", "gone@e2e.test", [["2026-11-05", 800]], "void"),      // void: nowhere
  inv("DMDT008888", "Nobody", "", [["2026-10-20", 300], ["2026-11-20", 200]]),    // no salesperson email: here; October not
];
let line = await oldBooksNoCrmUser("2026-11");
check("signed as finance checks it, from 1 Nov", badSignatures === 0 && asked === 1, { badSignatures, asked });
check("November: Arya 1,000 + no-email 200 = 1,200", line.status === "ok" && line.monthAed === 1200 && line.rows.length === 2, line);
check("CRM users' (Athira, Ben), the void one and October money left out", !line.rows.some((r) => ["Athira", "Ben", "Gone"].includes(r.salesperson)) && !line.rows.some((r) => r.paidOn < "2026-11-01"), line.rows);
check("each row: salesperson, amount, invoice", line.rows.some((r) => r.salesperson === "Arya Krishnan" && r.amount === 1000 && r.invoiceNumber === "DMDT005211"), line.rows);
await oldBooksNoCrmUser("2026-11");
check("asked again within 5 minutes: from the cache", asked === 1, asked);
const oct = await oldBooksNoCrmUser("2026-10");
check("October (before OLD_BOOKS_FROM): nothing", oct.monthAed === 0 && oct.status === "ok", oct);
resetOldBooksForTests();
away = true;
line = await oldBooksNoCrmUser("2026-11");
check("finance away: 0, with its reason", line.monthAed === 0 && line.status === "error" && /503/.test(line.error ?? ""), line);
away = false;
resetOldBooksForTests();
const secret = process.env.FINANCE_INTEGRATION_SECRET;
delete process.env.FINANCE_INTEGRATION_SECRET;
line = await oldBooksNoCrmUser("2026-11");
check("not configured: 0, says what to set", line.status === "off" && line.monthAed === 0 && /FINANCE_INTEGRATION_SECRET/.test(line.error ?? ""), line);
process.env.FINANCE_INTEGRATION_SECRET = secret;
resetOldBooksForTests();

invoices.push(inv("DMDT009000", "Arya Krishnan", "arya@e2e.test", [[today, 700]]));
const { managerTv } = await import("../services/managerTvService.js");
const signedIn = await managerTv({}) as { oldBooks?: { name: string; monthAed: number; rows: Array<Record<string, unknown>> } };
const thisMonth = month === "2026-11" ? 1900 : 700;
check(`the Manager TV answer carries it: ${thisMonth} this month, with invoices`, signedIn.oldBooks?.name === "Old books — no CRM user" && signedIn.oldBooks.monthAed === thisMonth && signedIn.oldBooks.rows.every((r) => typeof r.invoiceNumber === "string"), signedIn.oldBooks);
const pub = await managerTv({ publicView: true }) as { oldBooks?: { rows: Array<Record<string, unknown>> } };
check("the open screen: no invoice numbers", Boolean(pub.oldBooks) && pub.oldBooks!.rows.length > 0 && pub.oldBooks!.rows.every((r) => !("invoiceNumber" in r)), pub.oldBooks);

console.log(`\n${checks - failures}/${checks} passed`);
fin.stop(true);
await mongoose.disconnect();
process.exit(failures ? 1 : 0);
