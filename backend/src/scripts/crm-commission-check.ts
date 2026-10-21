/**
 * GET /api/v1/service/crm-commission (services/crmCommissionService.ts), end to end — finance asking each sales CRM's
 * counted commission for a month (2026-10-21):
 *
 *   Case 1  happy path   per CRM, per person: their salesperson / team leader / sales manager lines added up, the
 *                        sales behind them, the CRM's currency; only counted sales of that month; in-progress and
 *                        waiting ones counted, not listed
 *   Case 2  edge         a person with lines in two roles of one sale counts the sale once; a zero line is left out;
 *                        a CRM that cannot be read says so and the rest still answer
 *   Case 3  errors       no month, a bad month → 400
 *   Case 4  permission   no secret, a wrong one, a CRM's secret → 401; finance switched off in the registry → 503
 *
 * Run through scripts/crm-commission-check.sh. Scratch databases on 127.0.0.1 only.
 */
import mongoose, { Types } from "mongoose";

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
const SECRET = process.env.FINANCE_HQ_SSO_SECRET ?? "";
if (!SECRET.includes("e2e")) {
  console.error("Refusing to run: FINANCE_HQ_SSO_SECRET must be the check's own e2e value");
  process.exit(1);
}
const ROOT = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;

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
async function ask(month: string | null, secret: string | null = SECRET): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = {};
  if (secret !== null) headers["x-portal-secret"] = secret;
  const r = await fetch(`${ROOT}/service/crm-commission${month === null ? "" : `?month=${encodeURIComponent(month)}`}`, { headers });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function main() {
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await mongoose.connect(uri);
  if (mongoose.connection.host !== "127.0.0.1") throw new Error("not a local database");
  const open = async (u: string) => (await mongoose.createConnection(u).asPromise()).db!;
  const deltaDb = await open(process.env.DELTA_MONGODB_URI!);
  const drawDb = await open(process.env.DRAW_MONGODB_URI!);
  const remoteDb = await open(process.env.REMOTE_MONGODB_URI!);
  for (const db of [mongoose.connection.db!, deltaDb, drawDb, remoteDb]) await db.dropDatabase();

  step("Setting up: the registry (four CRMs and finance), commission in two CRM databases");
  const { Organization } = await import("../models/Organization.js");
  for (const [code, name, sortOrder] of [["delta", "Delta CRM", 1], ["banglore", "Banglore CRM", 2], ["draw", "Draw CRM", 3], ["remote", "Remote CRM", 4]] as const) {
    await Organization.create({ code, kind: "crm", name, timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder, accent: "#2563eb" });
  }
  await Organization.create({ code: "finance-hq", kind: "finance", name: "Finance", timezone: "Asia/Dubai", currency: "AED", fxToBase: 1, isActive: true, sortOrder: 9, accent: "#2563eb" });

  const ria = new Types.ObjectId(), abrar = new Types.ObjectId(), lena = new Types.ObjectId(), irfana = new Types.ObjectId(), maneesh = new Types.ObjectId();
  const sale = (o: { date: string; month: string; state: string; student: string; lines: Array<[string, Types.ObjectId, string, number]> }) => ({
    _id: new Types.ObjectId(), student: new Types.ObjectId(), studentName: o.student, courseName: "Delta Wave Theory", invoiceNumber: `IN-${o.student}`,
    saleDate: new Date(o.date), month: o.month, state: o.state,
    lines: o.lines.map(([role, user, userName, amount]) => ({ role, user, userName, amount })),
  });
  await deltaDb.collection("commissionsales").insertMany([
    sale({ date: "2026-10-03T08:00:00Z", month: "2026-10", state: "counted", student: "S1", lines: [["sales", ria, "Ria", 500], ["tl", lena, "Lena", 100], ["sm", abrar, "Abrar", 50]] }),
    sale({ date: "2026-10-09T08:00:00Z", month: "2026-10", state: "counted", student: "S2", lines: [["sales", ria, "Ria", 700], ["tl", lena, "Lena", 0], ["sm", abrar, "Abrar", 70]] }),
    // Lena closed this one herself and leads the team: two lines, one sale.
    sale({ date: "2026-10-12T08:00:00Z", month: "2026-10", state: "counted", student: "S3", lines: [["sales", lena, "Lena", 400], ["tl", lena, "Lena", 100]] }),
    sale({ date: "2026-10-15T08:00:00Z", month: "2026-10", state: "progress", student: "S4", lines: [] }),
    sale({ date: "2026-10-16T08:00:00Z", month: "2026-10", state: "waiting", student: "S5", lines: [] }),
    sale({ date: "2026-10-17T08:00:00Z", month: "2026-10", state: "reversed", student: "S6", lines: [["sales", ria, "Ria", 900]] }),
    sale({ date: "2026-09-28T08:00:00Z", month: "2026-09", state: "counted", student: "S7", lines: [["sales", ria, "Ria", 300]] }),
  ]);
  await drawDb.collection("commissionsales").insertOne(
    sale({ date: "2026-10-05T08:00:00Z", month: "2026-10", state: "counted", student: "D1", lines: [["sales", irfana, "Irfana", 250], ["sm", maneesh, "Maneesh", 25]] }),
  );

  step("Case 1 — a month's commission, per CRM and person");
  let r = await ask("2026-10");
  check("200 with every CRM", r.status === 200 && (r.body?.data?.crms ?? []).length === 4, show(r.body));
  const crm = (code: string) => (r.body?.data?.crms ?? []).find((c: Json) => c.code === code) ?? {};
  const delta = crm("delta");
  check("Sales CRM: Ria 1,200 (2 sales), Lena 600 (2 sales), Abrar 120 (2 sales) — highest first",
    JSON.stringify(delta.people?.map((p: Json) => [p.name, p.amount, p.sales])) === JSON.stringify([["Ria", 1200, 2], ["Lena", 600, 2], ["Abrar", 120, 2]]), show(delta.people));
  const lenaRow = delta.people?.find((p: Json) => p.name === "Lena");
  check("Lena: both her roles, her own sale counted once, the zero line left out", JSON.stringify(lenaRow?.roles?.sort()) === JSON.stringify(["sales", "tl"]) && lenaRow?.lines?.length === 3, show(lenaRow));
  check("each line: the sale, student, course, invoice, role, amount", lenaRow?.lines?.some((l: Json) => l.student === "S3" && l.role === "sales" && l.amount === 400 && l.invoiceNumber === "IN-S3" && l.course === "Delta Wave Theory"), show(lenaRow?.lines));
  check("the total, the currency, and what is still on its way", delta.total === 1920 && delta.currency === "AED" && delta.pending?.progress === 1 && delta.pending?.waiting === 1, show(delta));
  check("not reversed, not September's", !delta.people?.some((p: Json) => p.lines.some((l: Json) => ["S6", "S7"].includes(l.student))));
  check("Draw: Irfana 250, Maneesh 25", JSON.stringify(crm("draw").people?.map((p: Json) => [p.name, p.amount])) === JSON.stringify([["Irfana", 250], ["Maneesh", 25]]), show(crm("draw")));
  check("Remote: nothing this month, no error", (crm("remote").people ?? []).length === 0 && crm("remote").error === null, show(crm("remote")));

  step("Case 2 — a CRM that cannot be read");
  check("Banglore: says it cannot be read, the others still answered", typeof crm("banglore").error === "string" && crm("banglore").error.length > 0 && delta.people?.length === 3, show(crm("banglore")));

  step("Case 3 — errors");
  check("no month: 400", (await ask(null)).status === 400);
  check("a bad month: 400", (await ask("2026-13")).status === 400);

  step("Case 4 — permission");
  check("no secret: 401", (await ask("2026-10", null)).status === 401);
  check("a wrong one: 401", (await ask("2026-10", "nope")).status === 401);
  check("a CRM's secret: 401", (await ask("2026-10", process.env.DELTA_SSO_SECRET ?? "x")).status === 401);
  await Organization.updateOne({ code: "finance-hq" }, { $set: { isActive: false } });
  check("finance switched off in the registry: 503", (await ask("2026-10")).status === 503);

  console.log(`\n${checks - failures}/${checks} checks passed`);
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
