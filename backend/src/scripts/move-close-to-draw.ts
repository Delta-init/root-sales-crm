/**
 * A close made in the Sales CRM that was Draw's sale, moved to Draw (the user, 2026-11-24: "this student enrolment by
 * Aparna from Draw, so change it on the finance" — a Draw lead, worked in Draw, closed again as a new referral lead in
 * the Sales CRM by somebody else; yes to taking that close out of the Sales CRM completely, Draw's team leader and
 * Sales Manager paid as on any Draw close, a one-off).
 *
 * The Sales CRM: the student's lead, student, finance outbox row and commission sale are copied whole into
 * removed_closes, then taken out — no list, count, leaderboard, report, TV or commission there sees the sale again.
 * The 3CX calls on that lead stay, every detail kept, no longer pointing at it.
 *
 * Draw: the given lead is closed as a close in Draw would have closed it — the payment on the lead, the student (its
 * own salesperson and team, the course given, the fee, payments, receipt, bonus, language and date of the Sales close),
 * and a finance outbox row already sent and approved for the invoice finance has, so it is never sent again. Its
 * commission is counted by Draw's own sweep once finance answers for the new student — after finance's
 * move-enrolment-crm.ts points the invoice at it (the student's id is given here, so both name the same one).
 *
 * Nothing is written without --write; the undo file goes to your home folder first and puts both CRMs back.
 *
 *   cd backend
 *   bun src/scripts/move-close-to-draw.ts --sales-student <id> --draw-lead <id> --draw-course <id> --draw-student-id <id>
 *   bun src/scripts/move-close-to-draw.ts … --write
 *   bun src/scripts/move-close-to-draw.ts --undo <file> [--write]
 *
 * Reads DELTA_MONGODB_URI (the Sales CRM) and DRAW_MONGODB_URI, as Root's backend/.env has them.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose, { Types } from "mongoose";

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const { EJSON } = mongoose.mongo.BSON;

const write = process.argv.includes("--write");
const arg = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? String(process.argv[at + 1] ?? "").trim() : "";
};
const oid = (v: string, what: string) => {
  if (!Types.ObjectId.isValid(v) || String(new Types.ObjectId(v)) !== v.toLowerCase()) throw new Error(`${what}: "${v}" is not an id`);
  return new Types.ObjectId(v);
};
const hostOf = (uri: string) => uri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const day = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : "");
const METHOD_LABELS: Record<string, string> = {
  cash: "Cash", card: "Card", bank_transfer: "Bank transfer", tabby: "Tabby", tamara: "Tamara", tamara_ksa: "Tamara KSA",
  tabby_dgo: "Tabby DGO", billexpro: "BillExPro", pos: "POS", razorpay: "Razorpay", inr_transfer: "INR Transfer",
};
const methodLabel = (m: unknown) => METHOD_LABELS[String(m ?? "")] ?? String(m ?? "");
const statusWords = (s: unknown) => String(s ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

async function open(name: "DELTA_MONGODB_URI" | "DRAW_MONGODB_URI") {
  const uri = process.env[name] ?? "";
  if (!uri) throw new Error(`${name} is not set — run this from Root's backend folder`);
  const conn = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 20_000 }).asPromise();
  return { db: conn.db!, conn, host: hostOf(uri) };
}

/** What the move would write, worked out without writing — every refusal first, as one list. */
async function plan(sales: mongoose.mongo.Db, draw: mongoose.mongo.Db) {
  const refused: string[] = [];
  const salesStudentId = oid(arg("sales-student"), "--sales-student");
  const drawLeadId = oid(arg("draw-lead"), "--draw-lead");
  const drawCourseId = oid(arg("draw-course"), "--draw-course");
  const drawStudentId = oid(arg("draw-student-id"), "--draw-student-id");

  // ── The Sales CRM's close ──
  const student = await sales.collection("students").findOne({ _id: salesStudentId });
  if (!student) throw new Error(`No Sales CRM student ${salesStudentId}`);
  const lead = student.leadId ? await sales.collection("leads").findOne({ _id: student.leadId }) : null;
  if (!lead) refused.push(`the Sales CRM student ${student.enrollmentNumber} has no lead`);
  const handover = await sales.collection("financehandovers").findOne({ studentId: student._id });
  if (!handover) refused.push("the Sales CRM has no finance outbox row for it");
  else if (handover.status !== "sent" || handover.approvalState !== "approved") refused.push(`its finance outbox row is ${handover.status} / ${handover.approvalState}, not sent and approved`);
  const sale = await sales.collection("commissionsales").findOne({ student: student._id });
  if (sale && !["counted", "progress"].includes(String(sale.state))) refused.push(`its commission sale is ${sale.state}`);
  if ((student.courseChanges ?? []).some((c: Doc) => c.status === "pending")) refused.push("a course change for it is still waiting for finance");
  const calls = lead ? await sales.collection("threecx_calls").find({ lead: lead._id }).project({ _id: 1, lead: 1 }).toArray() : [];
  const closer = student.assignedTo ? await sales.collection("users").findOne({ _id: student.assignedTo }, { projection: { name: 1 } }) : null;
  const salesTeam = student.team ? await sales.collection("teams").findOne({ _id: student.team }, { projection: { name: 1 } }) : null;

  // ── Draw's lead, and what it becomes ──
  const drawLead = await draw.collection("leads").findOne({ _id: drawLeadId });
  if (!drawLead) throw new Error(`No Draw lead ${drawLeadId}`);
  if (drawLead.status === "closed") refused.push("the Draw lead is already closed");
  if (await draw.collection("students").findOne({ leadId: drawLead._id })) refused.push("the Draw lead already has a student");
  if (await draw.collection("students").findOne({ _id: drawStudentId })) refused.push(`Draw already has a student ${drawStudentId}`);
  if (await draw.collection("financehandovers").findOne({ leadId: drawLead._id })) refused.push("the Draw lead already has a finance outbox row");
  const email = String(student.email ?? "").trim().toLowerCase();
  const sameEmail = email ? await draw.collection("students").findOne({ email }) : null;
  if (sameEmail) refused.push(`Draw already has a student with ${email} (${sameEmail.enrollmentNumber})`);
  const course = await draw.collection("courses").findOne({ _id: drawCourseId });
  if (!course) refused.push(`Draw has no course ${drawCourseId}`);
  const rep = drawLead.assignedTo ? await draw.collection("users").findOne({ _id: drawLead.assignedTo }, { projection: { name: 1, email: 1 } }) : null;
  if (!rep) refused.push("the Draw lead is not assigned to anybody");
  const drawTeam = drawLead.team ? await draw.collection("teams").findOne({ _id: drawLead.team }, { projection: { name: 1 } }) : null;
  const by = drawLead.reporter ?? drawLead.assignedTo; // who the lead's entries are written as — its reporter (Super Admin)

  if (refused.length || !lead || !handover || !course || !rep) return { refused };

  // Draw's next enrolment number, as Draw itself gives one (studentService nextEnrollmentNumber).
  const last = await draw.collection("students").find({}).sort({ createdAt: -1 }).limit(1).project({ enrollmentNumber: 1 }).next();
  const n = last?.enrollmentNumber?.match(/\d+$/);
  const enrollmentNumber = `STU-${String(n ? parseInt(n[0], 10) + 1 : 1).padStart(4, "0")}`;

  const now = new Date();
  const run = `move-close-to-draw-${now.toISOString()}`;
  const academy = student.academy === "bangalore" ? "bangalore" : "dubai";
  const movedFrom = {
    crm: "delta", studentId: student._id, enrollmentNumber: student.enrollmentNumber, leadId: lead._id,
    closerName: closer?.name ?? "", teamName: salesTeam?.name ?? "", invoiceNumber: handover.invoiceNumber, at: now, run,
  };
  const payments: Doc[] = (student.payments ?? []).length
    ? student.payments
    : [{ method: student.paymentMethod, amount: student.paidAmount, receipt: student.paymentReceipt, paidAt: student.enrollmentDate }];

  const drawStudent: Doc = {
    _id: drawStudentId,
    enrollmentNumber,
    name: drawLead.name ?? student.name,
    phone: drawLead.phone ?? student.phone,
    email,
    courses: [course._id],
    team: drawLead.team ?? null,
    assignedTo: drawLead.assignedTo,
    leadId: drawLead._id,
    initialLeadResponse: drawLead.initialLeadResponse ?? null,
    primaryConcern: drawLead.primaryConcern ?? null,
    followupStrategyType: drawLead.followupStrategyType ?? null,
    demoScheduled: drawLead.demoScheduled ?? false,
    demoAttended: drawLead.demoAttended ?? false,
    firstContactTime: drawLead.firstContactTime ?? null,
    lastFollowupDate: drawLead.lastFollowupDate ?? null,
    enrollmentDate: student.enrollmentDate,
    feeStatus: student.feeStatus,
    totalFee: student.totalFee,
    paidAmount: student.paidAmount,
    pendingAmount: student.pendingAmount,
    status: "active",
    language: student.language,
    paymentMethod: student.paymentMethod,
    ...(student.paymentReceipt ? { paymentReceipt: student.paymentReceipt } : {}),
    payments,
    ...(student.mentorMeeting ? { mentorMeeting: student.mentorMeeting } : {}),
    hasBonus: student.hasBonus,
    bonusAmount: student.bonusAmount ?? 0,
    academy,
    movedFrom,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  };

  // The finance outbox row Draw's own close would have made, already delivered and approved (the snapshot as Draw's
  // buildHandoverPayload builds it), for the invoice finance already has.
  const listed = (course.lmsCourseSlugs ?? []).map((s: string) => s.trim()).filter(Boolean);
  const lms = listed.length ? listed : course.lmsCourseSlug ? [String(course.lmsCourseSlug).trim()] : [];
  const receiptOf = (r: Doc | undefined) => (r ? { name: r.name, url: r.url, key: r.key, size: r.size, mimeType: r.mimeType } : undefined);
  const drawHandover: Doc = {
    _id: new Types.ObjectId(),
    studentId: drawStudentId,
    leadId: drawLead._id,
    academy,
    approvalState: "approved",
    attempts: 0,
    flags: [],
    payload: {
      externalId: String(drawStudentId),
      source: "draw-crm",
      crm: "draw",
      academy,
      customer: { name: drawStudent.name, email, phone: drawStudent.phone ?? "" },
      courses: [{
        name: course.name, amountMinor: Math.round((student.totalFee ?? 0) * 100),
        ...(course.financeItemId ? { itemId: String(course.financeItemId) } : {}),
        ...(lms.length ? { lmsCourseSlug: lms[0], lmsCourseSlugs: lms } : {}),
      }],
      salespersonEmail: rep.email,
      salespersonName: rep.name,
      enrolledOn: day(student.enrollmentDate),
      declaredPaidMinor: Math.round((student.paidAmount ?? 0) * 100),
      balanceMinor: Math.max(0, Math.round((student.totalFee ?? 0) * 100) - Math.round((student.paidAmount ?? 0) * 100)),
      ...(typeof student.hasBonus === "boolean" ? { bonus: { given: student.hasBonus, amountMinor: Math.round((student.bonusAmount ?? 0) * 100), currency: "USD" } } : {}),
      modeOfStudy: "online",
      language: student.language,
      salesNote: "",
      declaredPaymentMethod: student.paymentMethod,
      ...(student.paymentReceipt ? { receipt: receiptOf(student.paymentReceipt) } : {}),
      payments: payments.map((p) => ({ method: p.method, amountMinor: Math.round((p.amount ?? 0) * 100), paidOn: day(p.paidAt), ...(p.receipt ? { receipt: receiptOf(p.receipt) } : {}) })),
    },
    resends: 0,
    returnedReason: "",
    salesNotePending: false,
    status: "sent",
    invoiceId: handover.invoiceId,
    invoiceNumber: handover.invoiceNumber,
    sentAt: handover.sentAt ?? now,
    checkedAt: now,
    approvedAt: handover.approvedAt ?? sale?.approvedAt ?? now,
    nextAttemptAt: handover.sentAt ?? now,
    movedFrom,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  };

  // The lead: closed, the money on it as a close puts it there, and why — said on the lead.
  const leadPayments: Doc[] = payments.map((p) => ({
    _id: new Types.ObjectId(),
    amount: p.amount,
    note: `Collected at enrolment — ${course.name} · ${methodLabel(p.method)}`,
    paidAt: p.paidAt ?? student.enrollmentDate,
    addedBy: drawLead.assignedTo,
    ...(p.method ? { method: p.method } : {}),
    ...(p.receipt ? { receipt: p.receipt } : {}),
    createdAt: now,
    updatedAt: now,
  }));
  const why = `Enrolment moved here from the Sales CRM on ${day(now)}: it was closed there on ${day(student.enrollmentDate)} by ${closer?.name ?? "?"}`
    + `${salesTeam?.name ? ` (${salesTeam.name})` : ""} as ${student.enrollmentNumber}, a new lead of the same client. Finance ${handover.invoiceNumber} is this close now — ${rep.name}'s.`;
  const note = { _id: new Types.ObjectId(), content: why, author: by, createdAt: now, updatedAt: now };
  const activity = [
    { _id: new Types.ObjectId(), action: "status_changed", description: `Status changed from "${drawLead.status}" to "closed"`, performedBy: by, changes: { status: { from: drawLead.status, to: "closed" } }, createdAt: now },
    { _id: new Types.ObjectId(), action: "note_added", description: "A note was added", performedBy: by, changes: { note: { from: null, to: why } }, createdAt: now },
  ];

  const archive: Doc = {
    _id: new Types.ObjectId(),
    run,
    at: now,
    reason: `Moved to Draw — ${rep.name}'s close (Draw lead ${drawLead._id}, student ${enrollmentNumber})`,
    movedTo: { crm: "draw", leadId: drawLead._id, studentId: drawStudentId, enrollmentNumber, salesperson: rep.name, team: drawTeam?.name ?? "" },
    lead, student, handover, commissionSale: sale ?? null,
    calls: calls.map((c) => ({ _id: c._id, lead: c.lead })),
  };

  return {
    refused,
    run, now, student, lead, handover, sale, calls, closer, salesTeam, drawLead, drawTeam, rep, course,
    drawStudent, drawHandover, leadPayments, note, activity, archive,
  };
}

async function doUndo(sales: mongoose.mongo.Db, draw: mongoose.mongo.Db, file: string) {
  const u = EJSON.parse(fs.readFileSync(file, "utf8"), { relaxed: false }) as Doc;
  const a = u.archive as Doc;
  console.log(`Undo of ${u.run}:`);
  console.log(`  Draw: take off student ${u.drawStudentId} (${u.enrollmentNumber}), its finance outbox row, its commission sale; the lead back to "${u.drawLeadBefore.status}", its ${u.leadEntryIds.payments.length} payment(s), note and 2 entries taken off`);
  console.log(`  Sales CRM: put back lead ${a.lead._id}, student ${a.student.enrollmentNumber}, its finance outbox row${a.commissionSale ? ", its commission sale" : ""}; ${a.calls.length} call(s) pointed at the lead again`);
  if (!write) { console.log("\nNothing was written. Add --write to undo it."); return; }
  // Sales first: back as it was, whatever Draw does next.
  for (const [col, doc] of [["leads", a.lead], ["students", a.student], ["financehandovers", a.handover], ["commissionsales", a.commissionSale]] as const) {
    if (doc) await sales.collection(col).replaceOne({ _id: doc._id }, doc, { upsert: true });
  }
  for (const c of a.calls) await sales.collection("threecx_calls").updateOne({ _id: c._id, lead: null }, { $set: { lead: c.lead } });
  await sales.collection("removed_closes").deleteOne({ _id: a._id });
  // Draw: everything this run made, by its ids.
  await draw.collection("commissionsales").deleteMany({ student: u.drawStudentId });
  await draw.collection("financehandovers").deleteOne({ _id: u.drawHandoverId, "movedFrom.run": u.run });
  await draw.collection("students").deleteOne({ _id: u.drawStudentId, "movedFrom.run": u.run });
  await draw.collection("leads").updateOne({ _id: u.drawLeadBefore._id }, {
    $set: { status: u.drawLeadBefore.status, updatedAt: new Date() },
    $pull: {
      payments: { _id: { $in: u.leadEntryIds.payments } },
      notes: { _id: u.leadEntryIds.note },
      activityLogs: { _id: { $in: u.leadEntryIds.activity } },
    },
  } as Doc);
  console.log("\nDone — both CRMs are back as they were.");
}

const main = async () => {
  const salesDb = await open("DELTA_MONGODB_URI");
  const drawDb = await open("DRAW_MONGODB_URI");
  const sales = salesDb.db, draw = drawDb.db;
  console.log(`Sales CRM "${sales.databaseName}" on ${salesDb.host} · Draw "${draw.databaseName}" on ${drawDb.host}${write ? "" : "  — dry run, nothing is written"}\n`);
  try {
    const undo = arg("undo");
    if (undo) return await doUndo(sales, draw, undo);

    const p = await plan(sales, draw);
    if (p.refused.length) {
      console.log("Refused — nothing is written:");
      for (const r of p.refused) console.log(`   ✗ ${r}`);
      process.exitCode = 1;
      return;
    }
    const { student, lead, handover, sale, calls, closer, salesTeam, drawLead, drawTeam, rep, course, drawStudent, drawHandover, leadPayments, note, activity, archive, run } = p as Required<typeof p> & Doc;
    console.log(`Sales CRM — taken out (kept whole in removed_closes):`);
    console.log(`   lead ${lead._id} (${lead.source ?? ""}, ${statusWords(lead.status)}), student ${student.enrollmentNumber} ${student.name} · closed by ${closer?.name ?? "?"} (${salesTeam?.name ?? "?"}) on ${day(student.enrollmentDate)}`);
    console.log(`   finance outbox row ${handover.invoiceNumber} (${handover.status}, ${handover.approvalState})`);
    console.log(`   commission sale: ${sale ? `${sale.state} ${sale.month} — ${(sale.lines ?? []).map((l: Doc) => `${l.role} ${l.userName} ${l.amount}`).join(", ") || "no lines"}` : "none"}`);
    console.log(`   ${calls.length} 3CX call(s) on the lead: kept, no longer pointing at it`);
    console.log(`\nDraw — the lead ${drawLead._id} (${drawLead.name}, ${rep.name}, ${drawTeam?.name ?? "?"}): ${statusWords(drawLead.status)} → Closed`);
    for (const lp of leadPayments) console.log(`   payment on the lead: ${lp.amount} · ${methodLabel(lp.method)} · ${day(lp.paidAt)}`);
    console.log(`   student ${drawStudent.enrollmentNumber} (${drawStudent._id}): ${course.name} · fee ${drawStudent.totalFee}, paid ${drawStudent.paidAmount}, ${drawStudent.feeStatus} · ${drawStudent.language} · bonus ${drawStudent.hasBonus ? `USD ${drawStudent.bonusAmount}` : "no"} · ${drawStudent.academy} · enrolled ${day(drawStudent.enrollmentDate)}`);
    console.log(`   finance outbox row: ${drawHandover.invoiceNumber}, sent and approved — not sent again`);
    console.log(`   note: ${note.content}`);
    console.log(`\nDraw's commission counts it for ${rep.name} once finance's invoice names this student (move-enrolment-crm.ts).`);
    if (!write) { console.log("\nNothing was written. Run again with --write to do it."); return; }

    // The undo file first, read back whole before anything changes.
    const file = path.join(os.homedir(), `move-close-to-draw-undo-${run.slice(-24).replace(/[:.]/g, "-")}.json`);
    const undoDoc = {
      run, archive,
      drawStudentId: drawStudent._id, enrollmentNumber: drawStudent.enrollmentNumber, drawHandoverId: drawHandover._id,
      drawLeadBefore: { _id: drawLead._id, status: drawLead.status },
      leadEntryIds: { payments: leadPayments.map((x: Doc) => x._id), note: note._id, activity: activity.map((x: Doc) => x._id) },
    };
    // Canonical, so every number goes back with the type it had.
    fs.writeFileSync(file, EJSON.stringify(undoDoc, { relaxed: false }));
    const back = EJSON.parse(fs.readFileSync(file, "utf8"), { relaxed: false }) as Doc;
    if (String(back.archive?.student?._id) !== String(student._id) || String(back.drawStudentId) !== String(drawStudent._id)) {
      throw new Error(`The undo file ${file} didn't read back whole — nothing changed`);
    }

    // 1. The Sales CRM's copy, kept before anything is taken out.
    await sales.collection("removed_closes").insertOne(archive);
    // 2. Draw: the student, its outbox row, the lead closed.
    await draw.collection("students").insertOne(drawStudent);
    await draw.collection("financehandovers").insertOne(drawHandover);
    await draw.collection("leads").updateOne({ _id: drawLead._id, status: drawLead.status }, {
      $set: { status: "closed", updatedAt: new Date(), ...(drawLead.email ? {} : { email: drawStudent.email }) },
      $push: { payments: { $each: leadPayments }, notes: note, activityLogs: { $each: activity } },
    } as Doc);
    // 3. The Sales CRM: taken out.
    await sales.collection("threecx_calls").updateMany({ _id: { $in: calls.map((c: Doc) => c._id) }, lead: lead._id }, { $set: { lead: null } });
    if (sale) await sales.collection("commissionsales").deleteOne({ _id: sale._id });
    await sales.collection("financehandovers").deleteOne({ _id: handover._id });
    await sales.collection("students").deleteOne({ _id: student._id });
    await sales.collection("leads").deleteOne({ _id: lead._id });
    console.log(`\nDone.\nUndo file: ${file}\n  bun src/scripts/move-close-to-draw.ts --undo ${file} --write`);
  } finally {
    await salesDb.conn.close();
    await drawDb.conn.close();
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
