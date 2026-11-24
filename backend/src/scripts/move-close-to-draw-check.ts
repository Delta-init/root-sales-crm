/**
 * move-close-to-draw.ts, end to end against two scratch CRM databases (a Sales CRM's and Draw's), as somebody runs it:
 *
 *   Case 1  dry run      says what it would do; nothing written in either CRM
 *   Case 2  refusals     a Draw lead already closed, an email Draw already has, a missing course — one list, nothing written
 *   Case 3  write        the Sales close kept whole in removed_closes and taken out, its calls kept unlinked; Draw's lead
 *                        closed with the payment, note and entries; the student with the given id and the next number,
 *                        the Sales close's money, receipt, bonus, language and date, Draw's own salesperson and team; the
 *                        finance outbox row sent and approved for the same invoice, its payload Draw's — ids as ids
 *   Case 4  again        refused (nothing left to move); the undo file in the home folder
 *   Case 5  undo         a dry run changes nothing; --write puts both CRMs back exactly, a Draw commission sale made since
 *                        taken off too
 *
 * Run through scripts/move-close-to-draw-check.sh. Scratch databases on 127.0.0.1 only.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import mongoose, { Types } from "mongoose";

for (const name of ["DELTA_MONGODB_URI", "DRAW_MONGODB_URI"]) {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[^/?]*e2e/.test(process.env[name] ?? "")) {
    console.error(`Refusing to run: ${name} must be a scratch e2e database on 127.0.0.1, got "${process.env[name]}"`);
    process.exit(1);
  }
}
type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0, failures = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const show = (v: unknown) => String(JSON.stringify(v)).slice(0, 400);
const HOME = process.env.E2E_HOME!;
function run(...args: string[]) {
  const r = spawnSync("bun", ["--no-env-file", path.join(process.env.E2E_REPO!, "src/scripts/move-close-to-draw.ts"), ...args], {
    cwd: process.env.E2E_WORK, env: { ...process.env, HOME }, encoding: "utf8",
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const isOid = (v: unknown) => v instanceof Types.ObjectId || (v as Doc)?._bsontype === "ObjectId";

async function main() {
  const sales = (await mongoose.createConnection(process.env.DELTA_MONGODB_URI!).asPromise()).db!;
  const draw = (await mongoose.createConnection(process.env.DRAW_MONGODB_URI!).asPromise()).db!;
  for (const db of [sales, draw]) for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});

  // ── The Sales CRM: a referral lead closed by its rep, sent and approved, counted ──
  const ids = { sRep: new Types.ObjectId(), sTL: new Types.ObjectId(), sTeam: new Types.ObjectId(), sCourse: new Types.ObjectId(), sLead: new Types.ObjectId(), sStudent: new Types.ObjectId(),
    dRep: new Types.ObjectId(), dAdmin: new Types.ObjectId(), dTeam: new Types.ObjectId(), dCourse: new Types.ObjectId(), dLead: new Types.ObjectId(), dOther: new Types.ObjectId(), invoice: new Types.ObjectId() };
  const enrolled = new Date("2026-11-18T00:00:00.000Z"), approvedAt = new Date("2026-11-18T14:05:24.296Z"), sentAt = new Date("2026-11-18T13:37:05.061Z");
  const receipt = { name: "receipt.jpeg", url: "https://r2.example/enrolment-receipts/x/receipt.jpeg", key: "enrolment-receipts/x/receipt.jpeg", size: 1234, mimeType: "image/jpeg", uploadedAt: enrolled };
  await sales.collection("users").insertMany([{ _id: ids.sRep, name: "Rep Sales" }, { _id: ids.sTL, name: "Lead Sales" }]);
  await sales.collection("teams").insertOne({ _id: ids.sTeam, name: "TEAM E2E" });
  const sLead = { _id: ids.sLead, name: "Client Test", email: "client.e2e@example.com", phone: "+971 50 000 0001", source: "REFERRAL", status: "closed", assignedTo: ids.sRep, team: ids.sTeam,
    payments: [{ _id: new Types.ObjectId(), amount: 2250, note: "Collected at enrolment — COURSE ONE · Tamara", paidAt: enrolled, addedBy: ids.sRep, method: "tamara", receipt }], createdAt: enrolled };
  const sStudent = { _id: ids.sStudent, enrollmentNumber: "STU-0220", name: "Client Test", phone: "+971 50 000 0001", email: "client.e2e@example.com", course: ids.sCourse, team: ids.sTeam, assignedTo: ids.sRep,
    leadId: ids.sLead, enrollmentDate: enrolled, feeStatus: "paid", totalFee: 2250, paidAmount: 2250, pendingAmount: 0, status: "active", language: "Malayalam", paymentMethod: "tamara", paymentReceipt: receipt,
    payments: [{ method: "tamara", amount: 2250, receipt, paidAt: enrolled }], hasBonus: true, bonusAmount: 500, academy: "dubai", financeInvoiceId: String(ids.invoice), financeInvoiceNumber: "IN-90456", createdAt: enrolled };
  const sHandover = { _id: new Types.ObjectId(), studentId: ids.sStudent, leadId: ids.sLead, academy: "dubai", approvalState: "approved", status: "sent", invoiceId: String(ids.invoice), invoiceNumber: "IN-90456", sentAt, approvedAt, payload: { source: "crm" } };
  const sSale = { _id: new Types.ObjectId(), student: ids.sStudent, closer: ids.sRep, closerName: "Rep Sales", state: "counted", month: "2026-11", invoiceNumber: "IN-90456", approvedAt,
    lines: [{ role: "sales", user: ids.sRep, userName: "Rep Sales", amount: 230 }, { role: "tl", user: ids.sTL, userName: "Lead Sales", amount: 85 }], stepsDoneAt: approvedAt };
  await sales.collection("leads").insertOne(sLead);
  await sales.collection("students").insertOne(sStudent);
  await sales.collection("financehandovers").insertOne(sHandover);
  await sales.collection("commissionsales").insertOne(sSale);
  const callIds = [new Types.ObjectId(), new Types.ObjectId()];
  await sales.collection("threecx_calls").insertMany([{ _id: callIds[0], lead: ids.sLead, direction: "out" }, { _id: callIds[1], lead: ids.sLead, direction: "out" }, { _id: new Types.ObjectId(), lead: new Types.ObjectId(), direction: "in" }]);

  // ── Draw: the client's lead, worked by its own rep; Course 1; the last student STU-0036 ──
  await draw.collection("users").insertMany([{ _id: ids.dRep, name: "Rep Draw", email: "rep.draw@example.com" }, { _id: ids.dAdmin, name: "Super Admin", email: "admin@example.com" }]);
  await draw.collection("teams").insertOne({ _id: ids.dTeam, name: "DRAW E2E" });
  await draw.collection("courses").insertOne({ _id: ids.dCourse, name: "COURSE 1 - E2E (WITH CREDIT)", amount: 2250, financeItemId: "6a97d654a63cd7af4698ee10", lmsCourseSlugs: ["market-break-out-trading-program"] });
  const dLead = { _id: ids.dLead, name: "Client Test", email: "client.e2e@example.com", phone: "+971500000001", source: "FOREX LEADS", status: "pending_response", assignedTo: ids.dRep, team: ids.dTeam, reporter: ids.dAdmin,
    courses: [], payments: [], notes: [{ _id: new Types.ObjectId(), content: "already closed", author: ids.dRep, createdAt: new Date() }], activityLogs: [{ _id: new Types.ObjectId(), action: "lead_created", performedBy: ids.dAdmin, createdAt: new Date() }],
    demoScheduled: false, demoAttended: false, sellingAmount: 0, firstContactTime: null, createdAt: new Date("2026-10-16T06:26:51.269Z") };
  await draw.collection("leads").insertOne(dLead);
  await draw.collection("students").insertOne({ _id: ids.dOther, enrollmentNumber: "STU-0036", email: "someone.else@example.com", leadId: new Types.ObjectId(), createdAt: new Date("2026-11-24T08:26:16.705Z") });
  const before = { sLead: await sales.collection("leads").findOne({ _id: ids.sLead }), sStudent: await sales.collection("students").findOne({ _id: ids.sStudent }), sHandover: await sales.collection("financehandovers").findOne({ _id: sHandover._id }), sSale: await sales.collection("commissionsales").findOne({ _id: sSale._id }), dLead: await draw.collection("leads").findOne({ _id: ids.dLead }) };

  const newId = String(new Types.ObjectId());
  const args = ["--sales-student", String(ids.sStudent), "--draw-lead", String(ids.dLead), "--draw-course", String(ids.dCourse), "--draw-student-id", newId];
  const counts = async () => JSON.stringify([await sales.collection("leads").countDocuments(), await sales.collection("students").countDocuments(), await sales.collection("removed_closes").countDocuments(), await draw.collection("students").countDocuments(), await draw.collection("financehandovers").countDocuments(), (await draw.collection("leads").findOne({ _id: ids.dLead }))?.status]);

  step("Case 1 — dry run");
  const c0 = await counts();
  let r = run(...args);
  check("exits 0 and says it is a dry run", r.code === 0 && /dry run, nothing is written/.test(r.out) && /Nothing was written/.test(r.out), r.out);
  check("names what goes and what comes", /STU-0220/.test(r.out) && /Rep Sales/.test(r.out) && /STU-0037/.test(r.out) && /IN-90456/.test(r.out) && /sales Rep Sales 230, tl Lead Sales 85/.test(r.out), r.out);
  check("nothing written in either CRM", (await counts()) === c0, `${c0} → ${await counts()}`);

  step("Case 2 — refusals");
  await draw.collection("leads").updateOne({ _id: ids.dLead }, { $set: { status: "closed" } });
  await draw.collection("students").updateOne({ _id: ids.dOther }, { $set: { email: "client.e2e@example.com" } });
  r = run(...args.slice(0, 5), String(new Types.ObjectId()), ...args.slice(6));
  check("a closed Draw lead, an email Draw has, a missing course: refused as one list", r.code === 1 && /already closed/.test(r.out) && /already has a student with client\.e2e@example\.com \(STU-0036\)/.test(r.out) && /has no course/.test(r.out), r.out);
  check("…nothing written", (await counts()) === c0.replace('"pending_response"', '"closed"'), await counts());
  await draw.collection("leads").updateOne({ _id: ids.dLead }, { $set: { status: "pending_response" } });
  await draw.collection("students").updateOne({ _id: ids.dOther }, { $set: { email: "someone.else@example.com" } });
  r = run("--sales-student", "nope", ...args.slice(2));
  check("a bad id: refused", r.code === 1 && /not an id/.test(r.out), r.out);

  step("Case 3 — write");
  r = run(...args, "--write");
  check("exits 0, Done, an undo file named", r.code === 0 && /Done\./.test(r.out) && /Undo file: /.test(r.out), r.out);
  const undoFile = r.out.match(/Undo file: (\S+)/)?.[1] ?? "";
  check("the Sales close is gone: lead, student, outbox row, commission sale", !(await sales.collection("leads").findOne({ _id: ids.sLead })) && !(await sales.collection("students").findOne({ _id: ids.sStudent }))
    && !(await sales.collection("financehandovers").findOne({ _id: sHandover._id })) && !(await sales.collection("commissionsales").findOne({ _id: sSale._id })));
  const arch = await sales.collection("removed_closes").findOne({});
  check("…kept whole in removed_closes, saying where it went", JSON.stringify(arch?.lead) === JSON.stringify(before.sLead) && JSON.stringify(arch?.student) === JSON.stringify(before.sStudent)
    && JSON.stringify(arch?.commissionSale) === JSON.stringify(before.sSale) && arch?.movedTo?.crm === "draw" && arch?.movedTo?.enrollmentNumber === "STU-0037" && String(arch?.movedTo?.studentId) === newId, show(arch?.movedTo));
  const calls = await sales.collection("threecx_calls").find({}).toArray();
  check("its calls kept, no longer on the lead; another lead's call untouched", calls.length === 3 && calls.filter((c) => c.lead === null).length === 2 && calls.some((c) => c.lead && String(c.lead) !== String(ids.sLead)));
  const st = await draw.collection("students").findOne({ _id: new Types.ObjectId(newId) });
  check("Draw's student: the given id, the next number, the lead's rep and team, the course", st?.enrollmentNumber === "STU-0037" && String(st?.assignedTo) === String(ids.dRep) && String(st?.team) === String(ids.dTeam)
    && String(st?.leadId) === String(ids.dLead) && st?.courses?.length === 1 && String(st.courses[0]) === String(ids.dCourse), show(st));
  check("…the Sales close's money, receipt, bonus, language, academy and date", st?.totalFee === 2250 && st?.paidAmount === 2250 && st?.pendingAmount === 0 && st?.feeStatus === "paid" && st?.paymentMethod === "tamara"
    && st?.paymentReceipt?.key === receipt.key && st?.payments?.length === 1 && st.payments[0].amount === 2250 && st?.hasBonus === true && st?.bonusAmount === 500 && st?.language === "Malayalam"
    && st?.academy === "dubai" && +new Date(st?.enrollmentDate) === +enrolled && st?.status === "active", show(st));
  check("…ids stored as ids", isOid(st?.assignedTo) && isOid(st?.team) && isOid(st?.leadId) && isOid(st?.courses?.[0]) && st?.enrollmentDate instanceof Date);
  check("…where it came from kept on it", st?.movedFrom?.crm === "delta" && st?.movedFrom?.enrollmentNumber === "STU-0220" && st?.movedFrom?.closerName === "Rep Sales" && st?.movedFrom?.invoiceNumber === "IN-90456", show(st?.movedFrom));
  const h = await draw.collection("financehandovers").findOne({ studentId: new Types.ObjectId(newId) });
  check("Draw's finance outbox row: sent and approved, the same invoice — never sent again", h?.status === "sent" && h?.approvalState === "approved" && h?.invoiceNumber === "IN-90456" && h?.invoiceId === String(ids.invoice)
    && +new Date(h?.approvedAt) === +approvedAt && h?.attempts === 0 && isOid(h?.leadId), show(h));
  check("…its payload Draw's: draw-crm, the new student, the rep, the course mapped, the money in fils, the bonus in USD",
    h?.payload?.source === "draw-crm" && h?.payload?.crm === "draw" && h?.payload?.externalId === newId && h?.payload?.salespersonEmail === "rep.draw@example.com" && h?.payload?.salespersonName === "Rep Draw"
    && h?.payload?.courses?.[0]?.amountMinor === 225000 && h?.payload?.courses?.[0]?.itemId === "6a97d654a63cd7af4698ee10" && h?.payload?.courses?.[0]?.lmsCourseSlug === "market-break-out-trading-program"
    && h?.payload?.declaredPaidMinor === 225000 && h?.payload?.balanceMinor === 0 && h?.payload?.bonus?.amountMinor === 50000 && h?.payload?.bonus?.currency === "USD" && h?.payload?.enrolledOn === "2026-11-18"
    && h?.payload?.payments?.[0]?.paidOn === "2026-11-18" && h?.payload?.payments?.[0]?.method === "tamara", show(h?.payload));
  const dl = await draw.collection("leads").findOne({ _id: ids.dLead });
  const pay = dl?.payments?.[0];
  check("Draw's lead: closed, the payment on it as a close puts it, by its rep", dl?.status === "closed" && dl?.payments?.length === 1 && pay?.amount === 2250 && pay?.method === "tamara" && String(pay?.addedBy) === String(ids.dRep)
    && /Collected at enrolment — COURSE 1 - E2E \(WITH CREDIT\) · Tamara/.test(pay?.note ?? "") && pay?.receipt?.key === receipt.key && isOid(pay?._id), show(pay));
  const lastNote = dl?.notes?.at(-1), acts = (dl?.activityLogs ?? []).slice(-2);
  check("…why, said on the lead: a note and two entries written as its reporter", /moved here from the Sales CRM/.test(lastNote?.content ?? "") && /STU-0220/.test(lastNote?.content ?? "") && /Rep Sales/.test(lastNote?.content ?? "") && /IN-90456/.test(lastNote?.content ?? "")
    && String(lastNote?.author) === String(ids.dAdmin) && acts[0]?.action === "status_changed" && acts[0]?.changes?.status?.from === "pending_response" && acts[0]?.changes?.status?.to === "closed" && acts[1]?.action === "note_added"
    && String(acts[0]?.performedBy) === String(ids.dAdmin), show({ lastNote, acts }));
  check("…the older note and entry kept", dl?.notes?.[0]?.content === "already closed" && dl?.activityLogs?.[0]?.action === "lead_created");

  step("Case 4 — again");
  r = run(...args, "--write");
  check("refused: nothing left to move", r.code === 1 && /No Sales CRM student/.test(r.out), r.out);
  check("the undo file is in the home folder", path.dirname(undoFile) === path.resolve(HOME) && fs.existsSync(undoFile), undoFile);

  step("Case 5 — undo");
  // Draw's sweep counted it in the meantime.
  await draw.collection("commissionsales").insertOne({ student: new Types.ObjectId(newId), closer: ids.dRep, state: "counted" });
  const c3 = await counts();
  r = run("--undo", undoFile);
  check("a dry run says what it would put back, changes nothing", r.code === 0 && /Nothing was written/.test(r.out) && /STU-0037/.test(r.out) && (await counts()) === c3, r.out);
  r = run("--undo", undoFile, "--write");
  check("--write: done", r.code === 0 && /both CRMs are back/.test(r.out), r.out);
  const after = { sLead: await sales.collection("leads").findOne({ _id: ids.sLead }), sStudent: await sales.collection("students").findOne({ _id: ids.sStudent }), sHandover: await sales.collection("financehandovers").findOne({ _id: sHandover._id }), sSale: await sales.collection("commissionsales").findOne({ _id: sSale._id }), dLead: await draw.collection("leads").findOne({ _id: ids.dLead }) };
  check("the Sales close back exactly: lead, student, outbox row, commission sale", JSON.stringify(after.sLead) === JSON.stringify(before.sLead) && JSON.stringify(after.sStudent) === JSON.stringify(before.sStudent)
    && JSON.stringify(after.sHandover) === JSON.stringify(before.sHandover) && JSON.stringify(after.sSale) === JSON.stringify(before.sSale));
  check("…number types kept (fee an integer as it was)", typeof after.sStudent?.totalFee === "number" && after.sStudent?.totalFee === 2250);
  check("…its calls on the lead again, the archive gone", (await sales.collection("threecx_calls").countDocuments({ lead: ids.sLead })) === 2 && (await sales.collection("removed_closes").countDocuments()) === 0);
  check("Draw: the student, its outbox row and the commission sale gone", !(await draw.collection("students").findOne({ _id: new Types.ObjectId(newId) })) && !(await draw.collection("financehandovers").findOne({ studentId: new Types.ObjectId(newId) }))
    && (await draw.collection("commissionsales").countDocuments()) === 0);
  const { updatedAt: _a, ...dNow } = (after.dLead ?? {}) as Doc;
  const { updatedAt: _b, ...dWas } = (before.dLead ?? {}) as Doc;
  check("…the lead back as it was (its own notes and entries, status, no payment)", JSON.stringify(dNow) === JSON.stringify(dWas), show(dNow));

  console.log(`\n${failures ? "\x1b[31m" : "\x1b[32m"}${checks - failures}/${checks} checks passed\x1b[0m`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
