/**
 * GET /api/v1/service/crm-commission (services/crmCommissionService.ts), end to end — finance asking each sales CRM's
 * counted commission for a month (2026-10-21):
 *
 *   Case 1  happy path   per CRM, per person: their salesperson / team leader / sales manager lines added up, the
 *                        sales behind them, the CRM's currency; only counted sales of that month; in-progress and
 *                        waiting ones counted, not listed
 *   Case 2  edge         a person with lines in two roles of one sale counts the sale once; a team leader's or sales
 *                        manager's zero line is left out, a salesperson's zero sale kept (2026-10-31, as My Pay counts it);
 *                        a CRM that cannot be read says so and the rest still answer
 *   Case 5  payable      each person's My Pay figures from the CRM's API (2026-10-21): payable, percent, level; a
 *                        CRM whose API is not set up says why, with no payable
 *   Case 6  rupees       each CRM's rupees-per-dirham rate (its Settings', 22.75 when unset) and each line's student, for
 *                        finance's Collected column (2026-10-31)
 *   Case 7  full payment paid in full first (2026-10-31): a part-paid sale earns nothing, all of it waiting; a sale
 *                        finished next month earns there, not here; an older sale finished this month earns here
 *   Case 3  errors       no month, a bad month → 400
 *   Case 4  permission   no secret, a wrong one, a CRM's secret → 401; finance switched off in the registry → 503
 *
 * Run through scripts/crm-commission-check.sh. Scratch databases on 127.0.0.1 only.
 */
import http from "node:http";
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

/* A stand-in for the CRMs' APIs: GET /api/v1/service/pay?month= behind each CRM's secret. */
const payHits: Array<{ crm: string; month: string | null; secretOk: boolean }> = [];
const PAY: Record<string, { secret: string; people: unknown[] }> = {};
const crmApi = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const [, crm] = url.pathname.split("/");
  const cfg = PAY[crm ?? ""];
  const secretOk = !!cfg && req.headers["x-portal-secret"] === cfg.secret;
  payHits.push({ crm: crm ?? "", month: url.searchParams.get("month"), secretOk });
  const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (!cfg || url.pathname !== `/${crm}/api/v1/service/pay`) return send(404, { success: false, message: "Route not found" });
  if (!secretOk) return send(401, { success: false, message: "Bad secret" });
  send(200, { success: true, message: "Pay", data: { month: url.searchParams.get("month"), people: cfg.people } });
});

async function main() {
  await new Promise<void>((ok) => crmApi.listen(Number(process.env.E2E_CRM_PORT), "127.0.0.1", ok));
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
  PAY.delta = { secret: process.env.DELTA_SSO_SECRET ?? "", people: [
    { user: String(ria), name: "Ria", role: "sales", level: "Level 2", percent: 50, earned: 1200, payable: 600, notCountedYet: 0 },
    { user: String(lena), name: "Lena", role: "tl", level: "Base", percent: 0, earned: 600, payable: 0, notCountedYet: 0 },
    { user: String(abrar), name: "Abrar", role: "sm", level: "Level 1", percent: 100, earned: 120, payable: 120, notCountedYet: 0 },
  ] };
  PAY.draw = { secret: process.env.DRAW_SSO_SECRET ?? "", people: [
    { user: String(irfana), name: "Irfana", role: "sales", level: "Level 1", percent: 40, earned: 250, payable: 100, notCountedYet: 0 },
  ] };
  await drawDb.collection("commissionsales").insertMany([
    sale({ date: "2026-10-05T08:00:00Z", month: "2026-10", state: "counted", student: "D1", lines: [["sales", irfana, "Irfana", 250], ["sm", maneesh, "Maneesh", 25]] }),
    // A course with no commission on the plan: Irfana's sale still counts (at 0), Maneesh's 0 doesn't.
    sale({ date: "2026-10-06T08:00:00Z", month: "2026-10", state: "counted", student: "D2", lines: [["sales", irfana, "Irfana", 0], ["sm", maneesh, "Maneesh", 0]] }),
  ]);

  await deltaDb.collection("appsettings").insertOne({ key: "app", bangaloreRevenue: { inrPerAed: 24 } });

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

  const irf = crm("draw").people?.find((p: Json) => p.name === "Irfana"), man = crm("draw").people?.find((p: Json) => p.name === "Maneesh");
  check("a salesperson's sale with no commission: listed at 0, counted as a sale — not the sales manager's 0",
    irf?.sales === 2 && irf?.lines?.some((l: Json) => l.student === "D2" && l.amount === 0) && man?.sales === 1 && !man?.lines?.some((l: Json) => l.student === "D2"), show(crm("draw").people));

  step("Case 2 — a CRM that cannot be read");
  check("Banglore: says it cannot be read, the others still answered", typeof crm("banglore").error === "string" && crm("banglore").error.length > 0 && delta.people?.length === 3, show(crm("banglore")));

  step("Case 5 — what is payable, from each CRM's My Pay (2026-10-21)");
  check("Sales CRM: Ria 600 payable at 50% (Level 2), Lena 0 at the base level, Abrar 120 at 100%",
    JSON.stringify(delta.people?.map((p: Json) => [p.name, p.amount, p.payable, p.percent, p.level])) === JSON.stringify([["Ria", 1200, 600, 50, "Level 2"], ["Lena", 600, 0, 0, "Base"], ["Abrar", 120, 120, 100, "Level 1"]]), show(delta.people));
  check("…the CRM's payable total, no pay error", delta.payableTotal === 720 && delta.payError === null, show({ t: delta.payableTotal, e: delta.payError }));
  check("Draw: Irfana 100 payable of 250", crm("draw").people?.[0]?.payable === 100 && crm("draw").payableTotal === 100, show(crm("draw").people));
  check("asked each CRM's API with its own secret, for the month", payHits.some((h) => h.crm === "delta" && h.secretOk && h.month === "2026-10") && payHits.some((h) => h.crm === "draw" && h.secretOk), show(payHits));
  check("Remote: its API isn't set up — says why, no payable", typeof crm("remote").payError === "string" && /not configured/.test(crm("remote").payError) && crm("remote").payableTotal === null, show(crm("remote")));

  step("Case 6 — the rate and the student, for finance's Collected (2026-10-31)");
  check("Sales CRM: its Settings rate, 24", delta.inrPerAed === 24, show(delta.inrPerAed));
  check("Draw: none set — 22.75", crm("draw").inrPerAed === 22.75, show(crm("draw").inrPerAed));
  const s1 = (await deltaDb.collection("commissionsales").findOne({ studentName: "S1" }))!;
  const riaLines = delta.people?.find((p: Json) => p.name === "Ria")?.lines ?? [];
  check("each line carries its sale's student", riaLines.find((l: Json) => l.student === "S1")?.studentId === String(s1.student) && riaLines.every((l: Json) => /^[a-f0-9]{24}$/.test(l.studentId)), show(riaLines));

  step("Case 7 — paid in full first (2026-10-31)");
  const nadia = new Types.ObjectId(), dilshad = new Types.ObjectId();
  const owing = (o: { date: string; month: string; student: string; owed: number; paid: Array<[string, number]> }) => ({
    ...sale({ date: o.date, month: o.month, state: "counted", student: o.student, lines: [["sales", nadia, "Nadia", 230], ["sm", dilshad, "dilshad", 85]] }),
    owedShare: o.owed, paidShare: 1 - o.owed, collections: o.paid.map(([at, share]) => ({ paidAt: new Date(at), share })),
  });
  await remoteDb.collection("commissionsales").insertMany([
    owing({ date: "2026-10-10T08:00:00Z", month: "2026-10", student: "P1", owed: 0.5, paid: [["2026-10-10T00:00:00Z", 0.5]] }),            // still owing
    owing({ date: "2026-10-12T08:00:00Z", month: "2026-10", student: "P2", owed: 0, paid: [["2026-10-12T00:00:00Z", 0.5], ["2026-11-03T00:00:00Z", 0.5]] }), // finished in November
    owing({ date: "2026-09-25T08:00:00Z", month: "2026-09", student: "P3", owed: 0, paid: [["2026-09-25T00:00:00Z", 0.5], ["2026-10-20T00:00:00Z", 0.5]] }), // September's, finished in October
    owing({ date: "2026-09-26T08:00:00Z", month: "2026-09", student: "P4", owed: 0.5, paid: [["2026-09-26T00:00:00Z", 0.5]] }),              // September's, still owing
  ]);
  const oct7 = (await ask("2026-10")).body?.data?.crms?.find((c: Json) => c.code === "remote") ?? {};
  const nadiaOct = oct7.people?.find((p: Json) => p.name === "Nadia");
  check("October: Nadia earns only the sale finished in October (230), the part-paid one all waiting (230)",
    nadiaOct?.amount === 230 && nadiaOct?.waiting === 230 && nadiaOct?.sales === 2, show(nadiaOct));
  check("…its lines: P1 earns 0, 230 waiting; P3 earns 230, paid in full 20 Oct; P2 and P4 not here",
    JSON.stringify(nadiaOct?.lines?.map((l: Json) => [l.student, l.amount, l.waiting, (l.paidInFullAt ?? "").slice(0, 10)])) === JSON.stringify([["P3", 230, 0, "2026-10-20"], ["P1", 0, 230, ""]]), show(nadiaOct?.lines));
  check("…the CRM: 315 earned, 315 waiting (the sales manager's too)", oct7.total === 315 && oct7.waitingTotal === 315, show({ t: oct7.total, w: oct7.waitingTotal }));
  const nov7 = (await ask("2026-11")).body?.data?.crms?.find((c: Json) => c.code === "remote") ?? {};
  const nadiaNov = nov7.people?.find((p: Json) => p.name === "Nadia");
  check("November: the October sale finished on 3 Nov earns all 230 there; nothing waiting", nadiaNov?.amount === 230 && nadiaNov?.waiting === 0
    && JSON.stringify(nadiaNov?.lines?.map((l: Json) => l.student)) === JSON.stringify(["P2"]), show(nadiaNov));
  check("a sale with no payments followed (older ones) earns in its sale month, as before", delta.people?.find((p: Json) => p.name === "Ria")?.lines?.every((l: Json) => l.waiting === 0 && l.paidInFullAt), show(delta.people?.[0]?.lines));

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
  crmApi.close();
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
