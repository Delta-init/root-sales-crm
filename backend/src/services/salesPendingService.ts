import { Types } from "mongoose";
import { Organization } from "../models/Organization.js";
import { getSources } from "./crmConnections.js";
import { resolveTarget, callTarget } from "../lib/targetClient.js";
import { targetConfig } from "../config/targets.js";
import { CALL_PORTALS, callsOverview, dubaiToday, periodOf } from "./callsService.js";
import { enrolmentFlow, type FlowClose } from "./enrolmentFlowService.js";

/*
 * Pending → Sales, a tab per sales CRM (the user, 2026-10-17): for each
 * salesperson, and the CRM in total —
 *
 *   inactive       leads the owner has not acted on within the CRM's Settings
 *                  limit — asked of the CRM itself (GET /service/inactive-leads),
 *                  so it is exactly its Inactive leads page. Banglore has none.
 *   reminders      reminders they set, not done and past their time (now)
 *   not connected  leads now "not connected", by owner, marked in the period
 *   lost           leads now lost, by owner, marked in the period, with the
 *                  reason chosen (and the notes)
 *   calls          their calls in the calls period, connected and talk time,
 *                  and each call with its recording (Root's 3CX calls) — the
 *                  Sales CRM and Draw by person; Banglore's recorder only in
 *                  total; Remote has no calls.
 *   sent back      (2026-10-29) enrolments finance sent back that are not sent
 *                  again yet — the CRM's own record of finance's answer
 *                  (financehandovers.approvalState "returned", with the reason),
 *                  against the closer, with the course and the money. Not in a
 *                  period: every one still waiting.
 *
 * And the CRM's enrolment workflow (2026-10-29), as Pending → Enrolments draws
 * it for this CRM alone, each unfinished close with its fee and what came in.
 *
 * "Marked" is when the lead's status last changed to it (its activity log),
 * else when the lead was last updated. Read from the CRM's database as the rest
 * of Pending reads it. Read-only. Dubai days.
 */

/** CRMs with an Inactive leads page. */
const INACTIVE_PORTALS = new Set(["delta", "draw", "remote"]);
const QUERY_MS = 15_000;
const LIST_MAX = 2000;
const UAE_MS = 4 * 3_600_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayStart = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - UAE_MS);
const monthStart = () => `${dubaiToday().slice(0, 7)}-01`;

export interface SalesCounts {
  inactive: number; reminders_overdue: number; not_connected: number; lost: number;
  calls: number; connected: number; talkSeconds: number;
  sent_back: number;
}
const blank = (): SalesCounts => ({ inactive: 0, reminders_overdue: 0, not_connected: 0, lost: 0, calls: 0, connected: 0, talkSeconds: 0, sent_back: 0 });
const pendingTotal = (c: SalesCounts) => c.inactive + c.reminders_overdue + c.not_connected + c.lost + c.sent_back;
const oidOf = (v: unknown) => (/^[a-f0-9]{24}$/i.test(String(v ?? "")) ? new Types.ObjectId(String(v)) : null);
const isoOf = (v: unknown) => (v ? new Date(v as string).toISOString() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const httpError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

function period(fromRaw: unknown, toRaw: unknown, fallbackFrom: string) {
  const from = String(fromRaw ?? "").trim(), to = String(toRaw ?? "").trim();
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) throw httpError("from / to must be dates (YYYY-MM-DD)", 400);
  const p = { from: from || fallbackFrom, to: to || dubaiToday() };
  if (p.from > p.to) throw httpError("from is after to", 400);
  return p;
}

/** The sales CRMs, for the tabs. */
export async function salesPortals() {
  const orgs = await Organization.find({ isActive: true, kind: "crm" }).select("code name accent sortOrder currency").sort({ sortOrder: 1 }).lean();
  return orgs.map((o) => ({
    code: o.code, name: o.name, accent: o.accent ?? "", currency: (o as { currency?: string }).currency ?? "",
    inactive: INACTIVE_PORTALS.has(o.code), calls: CALL_PORTALS[o.code] ?? null,
  }));
}

type Lead = Record<string, any>;
/** When the lead's status last became `status`, and who did it — else its last update. */
export const markedOf = (l: Lead, status: string): { at: string; by: string } => {
  const logs = (Array.isArray(l.activityLogs) ? l.activityLogs : []) as Lead[];
  const last = logs.filter((a) => a?.action === "status_changed" && a?.changes?.status?.to === status)
    .sort((a, b) => String(new Date(b.createdAt).toISOString()).localeCompare(new Date(a.createdAt).toISOString()))[0];
  return last
    ? { at: new Date(last.createdAt).toISOString(), by: String(last.performedBy ?? "") }
    : { at: l.updatedAt ? new Date(l.updatedAt).toISOString() : "", by: "" };
};

export async function salesPending(code: string, q: { from?: unknown; to?: unknown; callsFrom?: unknown; callsTo?: unknown }) {
  const org = await Organization.findOne({ code, isActive: true, kind: "crm" }).select("code name accent currency").lean();
  if (!org) throw httpError("No such sales CRM", 404);
  const p = period(q.from, q.to, monthStart());
  const callsPeriod = periodOf({ from: String(q.callsFrom ?? "") || dubaiToday(), to: String(q.callsTo ?? "") || dubaiToday() });
  const now = new Date();
  const from = dayStart(p.from), to = new Date(dayStart(p.to).getTime() + 86_400_000);

  const { sources, failures } = await getSources();
  const src = sources.find((s) => s.org.code === code);
  if (!src) throw httpError(failures.find((f) => f.code === code)?.error ?? `${org.name} could not be read`, 409);
  const leads = src.conn.collection("leads");

  const [overdue, closedOut, inactive, calls, returned, flow] = await Promise.all([
    leads.aggregate<Lead>([
      { $match: { reminders: { $elemMatch: { isDone: { $ne: true }, remindAt: { $lt: now } } } } },
      { $unwind: "$reminders" },
      { $match: { "reminders.isDone": { $ne: true }, "reminders.remindAt": { $lt: now }, "reminders.createdBy": { $ne: null } } },
      { $sort: { "reminders.remindAt": 1 } },
      { $limit: LIST_MAX * 5 },
      { $project: { name: 1, phone: 1, status: 1, source: 1, reminder: "$reminders" } },
    ], { maxTimeMS: QUERY_MS }).toArray(),
    // Lost and not connected now, last touched since the period began (the status change can't be later than that).
    leads.find({ status: { $in: ["lost", "not_connected"] }, updatedAt: { $gte: from } },
      { projection: { name: 1, phone: 1, source: 1, status: 1, lostReason: 1, lostNotes: 1, assignedTo: 1, updatedAt: 1, activityLogs: 1 }, maxTimeMS: QUERY_MS })
      .limit(LIST_MAX * 5).toArray(),
    inactiveOf(code, org.name),
    CALL_PORTALS[code]
      ? callsOverview({ portal: code, from: callsPeriod.from, to: callsPeriod.to, page: "1", limit: "200" })
        // callsOverview keeps going past a portal it can't read and says so on it: here that is the whole answer.
        .then((c) => {
          const mine = c.portals.find((x) => x.code === code);
          return mine && !mine.available
            ? { available: false as const, kind: CALL_PORTALS[code]!, error: mine.error ?? "Could not be read", data: null }
            : { available: true as const, kind: CALL_PORTALS[code]!, error: "", data: c };
        })
        .catch((e) => ({ available: false as const, kind: CALL_PORTALS[code]!, error: e instanceof Error ? e.message : "Could not be read", data: null }))
      : Promise.resolve(null),
    // Sent back and not sent again: sending it again sets it back to "pending".
    src.conn.collection("financehandovers").find({ approvalState: "returned" },
      { projection: { studentId: 1, returnedReason: 1, returnedAt: 1, resends: 1, resentAt: 1, invoiceNumber: 1 }, maxTimeMS: QUERY_MS }).toArray()
      .then((rows) => ({ available: true, error: "", rows: rows as Lead[] }))
      .catch((e) => ({ available: false, error: e instanceof Error ? e.message : "Could not be read", rows: [] as Lead[] })),
    // The CRM's own enrolment workflow; this tab still shows the rest when it can't be had.
    enrolmentFlow(code)
      .then((f) => ({ ...f, error: "" }))
      .catch((e) => ({ portals: [], open: [] as FlowClose[], error: e instanceof Error ? e.message : "Could not be read" })),
  ]);

  // The enrolments behind both, with their money, course and closer — one read.
  const flowPortal = flow.portals[0];
  const flowOpen = flowPortal?.available ? flow.open : [];
  const enrolIds = [...returned.rows.map((h) => oidOf(h.studentId)), ...flowOpen.map((x) => oidOf(x.id))].filter((x): x is Types.ObjectId => !!x);
  const students = enrolIds.length
    ? await src.conn.collection("students").find({ _id: { $in: enrolIds } }, {
      projection: { name: 1, phone: 1, enrollmentNumber: 1, course: 1, courses: 1, academy: 1, totalFee: 1, paidAmount: 1, pendingAmount: 1, assignedTo: 1, team: 1, enrollmentDate: 1 },
      maxTimeMS: QUERY_MS,
    }).toArray()
    : [];
  const studentById = new Map(students.map((x) => [String(x._id), x as Lead]));
  const courseIds = students.flatMap((x) => [x.course, ...(Array.isArray(x.courses) ? x.courses : [])]).map(oidOf).filter((x): x is Types.ObjectId => !!x);
  const teamIds = students.map((x) => oidOf(x.team)).filter((x): x is Types.ObjectId => !!x);
  const [courseDocs, teamDocs] = await Promise.all([
    courseIds.length ? src.conn.collection("courses").find({ _id: { $in: courseIds } }, { projection: { name: 1 }, maxTimeMS: QUERY_MS }).toArray() : [],
    teamIds.length ? src.conn.collection("teams").find({ _id: { $in: teamIds } }, { projection: { name: 1 }, maxTimeMS: QUERY_MS }).toArray() : [],
  ]);
  const courseName = new Map(courseDocs.map((x) => [String(x._id), String(x.name ?? "")]));
  const teamName = new Map(teamDocs.map((x) => [String(x._id), String(x.name ?? "")]));
  // The Banglore CRM is in rupees; elsewhere a Bangalore-academy close is kept in rupees too.
  const currencyOf = (x: Lead | undefined) => ((org as { currency?: string }).currency === "INR" || x?.academy === "bangalore" ? "INR" : "AED");
  const money = (x: Lead | undefined) => ({
    currency: currencyOf(x), fee: num(x?.totalFee), collected: num(x?.paidAmount),
    balance: x?.pendingAmount != null ? num(x.pendingAmount) : Math.max(0, num(x?.totalFee) - num(x?.paidAmount)),
  });

  // Lost / not connected marked inside the period.
  const marked = closedOut.map((l) => ({ l, m: markedOf(l, String(l.status)) }))
    .filter(({ m }) => m.at && new Date(m.at) >= from && new Date(m.at) < to);

  // Everybody named, once.
  const ids = new Set<string>();
  for (const r of overdue) ids.add(String(r.reminder?.createdBy ?? ""));
  for (const { l, m } of marked) { ids.add(String(l.assignedTo ?? "")); if (m.by) ids.add(m.by); }
  for (const h of returned.rows) ids.add(String(studentById.get(String(h.studentId))?.assignedTo ?? ""));
  const oids = [...ids].filter((id) => /^[a-f0-9]{24}$/i.test(id)).map((id) => new Types.ObjectId(id));
  const users = await src.conn.collection("users").find(
    { $or: [{ _id: { $in: oids } }, { status: { $ne: "inactive" } }] },
    { projection: { name: 1, email: 1, status: 1 }, maxTimeMS: QUERY_MS },
  ).toArray();
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const idByEmail = new Map(users.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), String(u._id)]));
  const nameOf = (id: string) => String(userById.get(id)?.name ?? "") || (id ? "Unknown user" : "Nobody");

  const counts = new Map<string, SalesCounts>();
  const c = (id: string) => counts.get(id) ?? counts.set(id, blank()).get(id)!;
  const totals = blank();
  const lead = (l: Lead) => ({ leadId: String(l._id), lead: String(l.name ?? "") || "No name", phone: String(l.phone ?? ""), source: String(l.source ?? "") });

  const reminderRows = overdue.slice(0, LIST_MAX).map((r) => {
    const owner = String(r.reminder?.createdBy ?? "");
    c(owner).reminders_overdue++; totals.reminders_overdue++;
    return { ...lead(r), status: String(r.status ?? ""), ownerId: owner, owner: nameOf(owner), title: String(r.reminder?.title ?? ""), note: String(r.reminder?.note ?? ""),
      remindAt: r.reminder?.remindAt ? new Date(r.reminder.remindAt).toISOString() : "" };
  });
  // Counts past the list's length still counted.
  for (const r of overdue.slice(LIST_MAX)) { c(String(r.reminder?.createdBy ?? "")).reminders_overdue++; totals.reminders_overdue++; }

  const reasons = new Map<string, number>();
  const notConnected: any[] = [], lost: any[] = [];
  for (const { l, m } of marked.sort((a, b) => b.m.at.localeCompare(a.m.at))) {
    const owner = String(l.assignedTo ?? "");
    const row = { ...lead(l), ownerId: owner, owner: nameOf(owner), markedAt: m.at, markedBy: m.by ? nameOf(m.by) : "" };
    if (l.status === "lost") {
      const reason = String(l.lostReason ?? "") || "not_given";
      c(owner).lost++; totals.lost++;
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      if (lost.length < LIST_MAX) lost.push({ ...row, reason, notes: String(l.lostNotes ?? "") });
    } else {
      c(owner).not_connected++; totals.not_connected++;
      if (notConnected.length < LIST_MAX) notConnected.push(row);
    }
  }

  const inactiveRows = (inactive.items ?? []).map((x: any) => {
    const owner = String(x.owner?.id ?? "") || idByEmail.get(String(x.owner?.email ?? "").toLowerCase()) || "";
    c(owner).inactive++; totals.inactive++;
    return {
      leadId: String(x.id ?? ""), lead: String(x.name ?? "") || "No name", phone: String(x.phone ?? ""), source: String(x.source ?? ""),
      ownerId: owner, owner: String(x.owner?.name ?? "") || nameOf(owner), team: String(x.team?.name ?? ""), assignedAt: String(x.assignedAt ?? ""),
      waitingMinutes: Number(x.waitingMinutes) || 0, moves: Number(x.moves) || 0,
      calls: x.calls ? { total: Number(x.calls.total) || 0, answered: Number(x.calls.answered) || 0 } : null,
    };
  });

  // Sent back, the longest waiting first, against whoever closed it. An enrolment since deleted is left out.
  const sentBack = returned.rows
    .map((h) => ({ h, x: studentById.get(String(h.studentId)) }))
    .filter((r): r is { h: Lead; x: Lead } => !!r.x)
    .map(({ h, x }) => {
      const owner = String(x.assignedTo ?? "");
      c(owner).sent_back++; totals.sent_back++;
      const names = [x.course, ...(Array.isArray(x.courses) ? x.courses : [])].map((id) => courseName.get(String(id ?? "")) ?? "").filter(Boolean);
      return {
        studentId: String(x._id), client: String(x.name ?? "") || "No name", phone: String(x.phone ?? ""), enrollmentNumber: String(x.enrollmentNumber ?? ""),
        course: [...new Set(names)].join(", "), academy: x.academy === "bangalore" ? "bangalore" : "dubai", ...money(x),
        ownerId: owner, owner: nameOf(owner), team: teamName.get(String(x.team ?? "")) ?? "",
        reason: String(h.returnedReason ?? ""), returnedAt: isoOf(h.returnedAt), closedAt: isoOf(x.enrollmentDate),
        invoiceNumber: String(h.invoiceNumber ?? ""), resends: num(h.resends), resentAt: isoOf(h.resentAt),
      };
    })
    .sort((a, b) => (a.returnedAt || "9").localeCompare(b.returnedAt || "9"));
  const sentBackAmount: Record<string, number> = {};
  for (const x of sentBack) sentBackAmount[x.currency] = (sentBackAmount[x.currency] ?? 0) + x.fee;

  // Calls by person: the CRM's own user id where it is one, else by email.
  let unlinkedCalls = 0;
  if (calls?.data) {
    for (const person of calls.data.people) {
      const pc = person.portals.find((x) => x.code === code);
      if (!pc) continue;
      const id = (userById.has(pc.person) ? pc.person : "") || (person.email ? idByEmail.get(person.email) ?? "" : "");
      if (!id) { unlinkedCalls += pc.calls; continue; }
      const x = c(id); x.calls += pc.calls; x.connected += pc.connected; x.talkSeconds += pc.talkSeconds;
    }
    totals.calls = calls.data.stats.calls; totals.connected = calls.data.stats.connected; totals.talkSeconds = calls.data.stats.talkSeconds;
  }

  const people = [...counts]
    .filter(([id]) => id && userById.has(id))
    .map(([id, x]) => {
      const u = userById.get(id)!;
      return { id, name: nameOf(id), email: String(u.email ?? "").toLowerCase(), active: u.status !== "inactive", counts: x, total: pendingTotal(x) };
    })
    .sort((a, b) => b.total - a.total || b.counts.calls - a.counts.calls || a.name.localeCompare(b.name));

  return {
    code: org.code, name: org.name, accent: org.accent ?? "", currency: (org as { currency?: string }).currency ?? "",
    generatedAt: now.toISOString(),
    period: p,
    callsPeriod,
    totals: { ...totals, total: pendingTotal(totals) },
    people,
    // Most first; "not given" after the others it ties with, then A to Z.
    lostReasons: [...reasons].map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || Number(a.reason === "not_given") - Number(b.reason === "not_given") || a.reason.localeCompare(b.reason)),
    inactive: { supported: INACTIVE_PORTALS.has(code), available: inactive.available, error: inactive.error, capped: inactive.capped, limitMinutes: inactive.limitMinutes },
    calls: calls
      ? { supported: true, kind: calls.kind, available: calls.available, error: calls.error, unlinked: unlinkedCalls,
          list: (calls.data?.calls ?? []).map((x) => ({ ...x, personId: (userById.has(x.person) ? x.person : idByEmail.get(x.personEmail) ?? "") })),
          total: calls.data?.total ?? 0 }
      : { supported: false, kind: null, available: false, error: "", unlinked: 0, list: [], total: 0 },
    sentBack: { available: returned.available, error: returned.error, amount: sentBackAmount },
    workflow: flowPortal
      ? { available: flowPortal.available, error: flowPortal.error, financeAnswered: flowPortal.financeAnswered, counts: flowPortal.counts,
          open: flowOpen.map((x) => ({ ...x, ...money(studentById.get(x.id)) })) }
      : { available: false, error: flow.error || "Could not be read", financeAnswered: false, counts: null, open: [] },
    items: { inactive: inactiveRows, reminders: reminderRows, notConnected, lost, sentBack },
  };
}

/** The CRM's own Inactive leads page — every lead on it. Not every CRM has one. */
async function inactiveOf(code: string, name: string): Promise<{ available: boolean; error: string; capped: boolean; limitMinutes: number; items: any[] }> {
  if (!INACTIVE_PORTALS.has(code)) return { available: false, error: "", capped: false, limitMinutes: 0, items: [] };
  try {
    const target = await resolveTarget(code);
    const a = await callTarget<{ items?: any[]; summary?: { capped?: boolean }; rule?: { limitMinutes?: number } }>(target, "/inactive-leads", { method: "GET", verb: "share its inactive leads" });
    return { available: true, error: "", capped: !!a?.summary?.capped, limitMinutes: Number(a?.rule?.limitMinutes) || 0, items: Array.isArray(a?.items) ? a.items : [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not be read";
    return { available: false, error: /404|not found/i.test(message) ? `${name}'s server needs updating — it has no inactive leads endpoint yet` : message, capped: false, limitMinutes: 0, items: [] };
  }
}

/** Finance's approvals waiting and entries typed with an old date (GET /service/finance-watch). */
export async function financeWatch() {
  const org = await Organization.findOne({ isActive: true, $or: [{ kind: "finance" }, { code: /^finance/ }] }).select("code name").sort({ sortOrder: 1 }).lean();
  if (!org) throw httpError("Finance is not set up in Root", 404);
  const target = await resolveTarget(org.code);
  try {
    const data = await callTarget<Record<string, unknown>>(target, "/finance-watch", { method: "GET", verb: "share its approvals" });
    // Where finance's pages are, for the links ("" when its address is not set).
    return { ...data, appUrl: targetConfig(org.code).appUrl.replace(/\/+$/, "") };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not be read";
    if (/404|not found/i.test(message)) throw httpError("Finance's server needs updating — it has no finance-watch endpoint yet", 409);
    throw error;
  }
}

/**
 * A portal that answers its own Pending tab (GET /service/<path>) — HRMS's
 * hrms-watch, Media ERP's media-watch (2026-10-17). Its old server says so.
 */
async function watchOf(kind: string, codes: RegExp, path: string, label: string) {
  const org = await Organization.findOne({ isActive: true, $or: [{ kind }, { code: codes }] }).select("code name").sort({ sortOrder: 1 }).lean();
  if (!org) throw httpError(`${label} is not set up in Root`, 404);
  const target = await resolveTarget(org.code);
  try {
    const data = await callTarget<Record<string, unknown>>(target, `/${path}`, { method: "GET", verb: "share what is waiting" });
    return { ...data, appUrl: targetConfig(org.code).appUrl.replace(/\/+$/, "") };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not be read";
    if (/404|not found/i.test(message)) throw httpError(`${label}'s server needs updating — it has no ${path} endpoint yet`, 409);
    throw error;
  }
}

/** HRMS: leave, regularization, hiring, office keeping, procurement waiting, and who is on leave today — with departments. */
export const hrmsWatch = () => watchOf("hrms", /^hrms/, "hrms-watch", "HRMS");
/** Media ERP: Media Schedule, tasks and the Leader Desk waiting, and on whom. */
export const mediaWatch = () => watchOf("erp", /media/, "media-watch", "Media ERP");

