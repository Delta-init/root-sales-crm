import { Types } from "mongoose";
import { getSources, type CrmSource } from "./crmConnections.js";

/*
 * A salesperson, from Root (the user, 2026-10-11): everyone in the sales CRMs —
 * Delta, Banglore, Draw and Remote — and each one's page: the leads that reached
 * them, where those leads stand, their closings and revenue, the follow-ups
 * they logged and what is waiting on them now, over a period cut in Gulf time.
 *
 * Read straight from each CRM's database, read-only, as the group report and
 * Pending read them. The same rules as the CRMs' own Leaderboard, so the
 * numbers agree with what each CRM shows:
 *   - Leads    — leads held by them that reached them in the period (createdAt,
 *                which a hand-over resets to the hand-over);
 *   - Closings — enrolments credited to them in the period, dropped ones not;
 *   - Revenue  — payments dated in the period on the leads they hold, in the
 *                CRM's own currency;
 *   - Follow-ups — the ones they logged in the period.
 */

export interface Period { from?: Date; to?: Date }

const QUERY_MS = 15_000;
const LIST_LIMIT = 300;

const STATUS_LABELS: Record<string, string> = {
  new: "New", assigned: "Assigned", pending_response: "Pending response", followup: "Follow-up", closed: "Closed",
  lost: "Lost", not_connected: "Not connected", mia: "MIA", repeated: "Repeated", callback: "Callback", cnc: "CNC",
};
export const statusLabel = (s: string) => STATUS_LABELS[s] ?? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const within = (field: string, { from, to }: Period) => {
  if (!from && !to) return {};
  return { [field]: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } };
};

const oid = (id: string) => (Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null);
const httpError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

async function sourceFor(code: string): Promise<CrmSource> {
  const { sources, failures } = await getSources();
  const src = sources.find((s) => s.org.code === code);
  if (src) return src;
  const failed = failures.find((f) => f.code === code);
  if (failed) throw httpError(`${failed.name} could not be read — ${failed.error}`, 503);
  throw httpError(`No sales CRM called ${code}`, 404);
}

/** The teams someone leads or is in, by name. */
async function teamsOf(src: CrmSource, ids: Types.ObjectId[]): Promise<Map<string, string[]>> {
  const teams = await src.conn.collection("teams")
    .find({ $or: [{ leaders: { $in: ids } }, { members: { $in: ids } }] }, { projection: { name: 1, leaders: 1, members: 1 }, maxTimeMS: QUERY_MS })
    .toArray();
  const out = new Map<string, string[]>();
  for (const t of teams) {
    for (const id of [...(t.leaders ?? []), ...(t.members ?? [])].map(String)) {
      out.set(id, [...new Set([...(out.get(id) ?? []), String(t.name ?? "")])].filter(Boolean));
    }
  }
  return out;
}

const byId = (rows: { _id: unknown; n: number }[]) => new Map(rows.filter((r) => r._id).map((r) => [String(r._id), r.n]));

/**
 * Everyone in every sales CRM, with the period's leads, closings and revenue
 * beside them. A CRM that cannot be read says why and leaves the rest.
 */
export async function listSalespeople(period: Period) {
  const { sources, failures } = await getSources();
  const crms = await Promise.all(sources.map(async (src) => {
    const leads = src.conn.collection("leads");
    const [users, leadRows, closingRows, revenueRows] = await Promise.all([
      src.conn.collection("users").find({}, { projection: { name: 1, email: 1, status: 1 }, maxTimeMS: QUERY_MS }).toArray(),
      leads.aggregate<{ _id: unknown; n: number }>([
        { $match: { assignedTo: { $ne: null }, ...within("createdAt", period) } },
        { $group: { _id: "$assignedTo", n: { $sum: 1 } } },
      ], { maxTimeMS: QUERY_MS }).toArray(),
      src.conn.collection("students").aggregate<{ _id: unknown; n: number }>([
        { $match: { status: { $ne: "dropped" }, ...within("enrollmentDate", period) } },
        { $group: { _id: "$assignedTo", n: { $sum: 1 } } },
      ], { maxTimeMS: QUERY_MS }).toArray(),
      leads.aggregate<{ _id: unknown; n: number }>([
        { $match: { assignedTo: { $ne: null }, ...within("payments.paidAt", period) } },
        { $unwind: "$payments" },
        { $match: within("payments.paidAt", period) },
        { $group: { _id: "$assignedTo", n: { $sum: "$payments.amount" } } },
      ], { maxTimeMS: QUERY_MS }).toArray(),
    ]);
    const teams = await teamsOf(src, users.map((u) => u._id as Types.ObjectId));
    const l = byId(leadRows), c = byId(closingRows), r = byId(revenueRows);
    return {
      code: src.org.code,
      name: src.org.name,
      currency: src.org.currency || "AED",
      people: users.map((u) => {
        const id = String(u._id);
        return {
          id,
          name: String(u.name ?? "") || "Unknown user",
          email: String(u.email ?? "").toLowerCase(),
          active: u.status !== "inactive",
          teams: teams.get(id) ?? [],
          leads: l.get(id) ?? 0,
          closings: c.get(id) ?? 0,
          revenue: Math.round((r.get(id) ?? 0) * 100) / 100,
        };
      }),
    };
  }));
  return { crms, failures };
}

/** One salesperson in one CRM, over a period (none: all time). */
export async function getSalesperson(code: string, userId: string, period: Period) {
  const src = await sourceFor(code);
  const uid = oid(userId);
  if (!uid) throw httpError("Not a person in that CRM", 404);
  const user = await src.conn.collection("users").findOne({ _id: uid }, { projection: { name: 1, email: 1, status: 1, designation: 1 }, maxTimeMS: QUERY_MS });
  if (!user) throw httpError("Not a person in that CRM", 404);

  const leads = src.conn.collection("leads");
  const students = src.conn.collection("students");
  const now = new Date();
  const [statusRows, closings, payments, followUps, pendingLeads, reminders, teams] = await Promise.all([
    leads.aggregate<{ _id: string | null; n: number }>([
      { $match: { assignedTo: uid, ...within("createdAt", period) } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ], { maxTimeMS: QUERY_MS }).toArray(),
    students.find({ assignedTo: uid, status: { $ne: "dropped" }, ...within("enrollmentDate", period) },
      { projection: { name: 1, course: 1, courses: 1, totalFee: 1, paidAmount: 1, pendingAmount: 1, enrollmentDate: 1, status: 1 }, maxTimeMS: QUERY_MS })
      .sort({ enrollmentDate: -1 }).limit(LIST_LIMIT).toArray(),
    leads.aggregate<{ leadId: unknown; name?: string; amount: number; paidAt: Date; note?: string }>([
      { $match: { assignedTo: uid, ...within("payments.paidAt", period) } },
      { $unwind: "$payments" },
      { $match: within("payments.paidAt", period) },
      { $project: { _id: 0, leadId: "$_id", name: 1, amount: "$payments.amount", paidAt: "$payments.paidAt", note: "$payments.note" } },
      { $sort: { paidAt: -1 } },
    ], { maxTimeMS: QUERY_MS }).toArray(),
    leads.aggregate<{ n: number }>([
      { $match: { "followUps.followedUpBy": uid, ...within("followUps.followedUpAt", period) } },
      { $unwind: "$followUps" },
      { $match: { "followUps.followedUpBy": uid, ...within("followUps.followedUpAt", period) } },
      { $count: "n" },
    ], { maxTimeMS: QUERY_MS }).toArray(),
    leads.countDocuments({ assignedTo: uid, status: "assigned" }, { maxTimeMS: QUERY_MS }),
    leads.aggregate<{ n: number; overdue: number }>([
      { $match: { reminders: { $elemMatch: { createdBy: uid, isDone: { $ne: true } } } } },
      { $unwind: "$reminders" },
      { $match: { "reminders.createdBy": uid, "reminders.isDone": { $ne: true } } },
      { $group: { _id: null, n: { $sum: 1 }, overdue: { $sum: { $cond: [{ $lt: ["$reminders.remindAt", now] }, 1, 0] } } } },
    ], { maxTimeMS: QUERY_MS }).toArray(),
    teamsOf(src, [uid]),
  ]);

  // Course names for the closings — one course, or several on an older Draw enrolment.
  const courseIds = [...new Set(closings.flatMap((s) => [s.course, ...(Array.isArray(s.courses) ? s.courses : [])]).filter(Boolean).map(String))];
  const courses = courseIds.length
    ? await src.conn.collection("courses").find({ _id: { $in: courseIds.map((id) => new Types.ObjectId(id)) } }, { projection: { name: 1 } }).toArray()
    : [];
  const courseName = new Map(courses.map((c) => [String(c._id), String(c.name ?? "")]));

  const statuses = statusRows
    .map((r) => ({ status: String(r._id ?? "unknown"), label: statusLabel(String(r._id ?? "unknown")), count: r.n }))
    .sort((a, b) => b.count - a.count);
  const totalLeads = statuses.reduce((n, s) => n + s.count, 0);
  const revenue = Math.round(payments.reduce((n, p) => n + (Number(p.amount) || 0), 0) * 100) / 100;

  return {
    crm: { code: src.org.code, name: src.org.name, currency: src.org.currency || "AED" },
    person: {
      id: String(user._id),
      name: String(user.name ?? "") || "Unknown user",
      email: String(user.email ?? "").toLowerCase(),
      designation: String(user.designation ?? ""),
      active: user.status !== "inactive",
      teams: teams.get(String(user._id)) ?? [],
    },
    period: { from: period.from?.toISOString() ?? null, to: period.to?.toISOString() ?? null },
    summary: {
      leads: totalLeads,
      closings: closings.length,
      revenue,
      followUps: followUps[0]?.n ?? 0,
      conversion: totalLeads ? Math.round((closings.length / totalLeads) * 1000) / 10 : 0,
    },
    pendingNow: { newLeads: pendingLeads, reminders: reminders[0]?.n ?? 0, overdue: reminders[0]?.overdue ?? 0 },
    statuses: statuses.map((s) => ({ ...s, percent: totalLeads ? Math.round((s.count / totalLeads) * 1000) / 10 : 0 })),
    closings: closings.map((s) => ({
      id: String(s._id),
      name: String(s.name ?? ""),
      course: [s.course, ...(Array.isArray(s.courses) ? s.courses : [])].filter(Boolean).map((c) => courseName.get(String(c)) ?? "").filter(Boolean).join(", "),
      fee: Number(s.totalFee) || 0,
      paid: Number(s.paidAmount) || 0,
      balance: Number(s.pendingAmount) || Math.max(0, (Number(s.totalFee) || 0) - (Number(s.paidAmount) || 0)),
      date: s.enrollmentDate ? new Date(s.enrollmentDate).toISOString() : null,
      status: String(s.status ?? ""),
    })),
    payments: payments.slice(0, LIST_LIMIT).map((p) => ({
      leadId: String(p.leadId), name: String(p.name ?? ""), amount: Number(p.amount) || 0,
      date: p.paidAt ? new Date(p.paidAt).toISOString() : null, note: String(p.note ?? ""),
    })),
    truncated: { closings: closings.length >= LIST_LIMIT, payments: payments.length > LIST_LIMIT },
  };
}

/** Their leads in one status, over the period — the list a status opens. */
export async function salespersonLeads(code: string, userId: string, status: string, period: Period) {
  const src = await sourceFor(code);
  const uid = oid(userId);
  if (!uid) throw httpError("Not a person in that CRM", 404);
  const rows = await src.conn.collection("leads")
    .find({ assignedTo: uid, ...(status ? { status } : {}), ...within("createdAt", period) },
      { projection: { name: 1, phone: 1, email: 1, source: 1, status: 1, createdAt: 1, updatedAt: 1 }, maxTimeMS: QUERY_MS })
    .sort({ createdAt: -1 }).limit(LIST_LIMIT).toArray();
  return rows.map((l) => ({
    id: String(l._id), name: String(l.name ?? ""), phone: String(l.phone ?? ""), email: String(l.email ?? ""), source: String(l.source ?? ""),
    status: String(l.status ?? ""), statusLabel: statusLabel(String(l.status ?? "")),
    createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : null, updatedAt: l.updatedAt ? new Date(l.updatedAt).toISOString() : null,
  }));
}

/* ── A stat card's breakdown (the user, 2026-10-14: "when click on the stats card it need to show the breakdown") ── */

const BREAKDOWN_LIMIT = 1000;
/** A Gulf day, YYYY-MM-DD, for grouping. */
const gstDay = { $dateToString: { format: "%Y-%m-%d", date: "$_d", timezone: "+04:00" } };

/**
 * What one of the salesperson page's cards is made of:
 *   leads      the period's leads by status, source and the day they reached them, and the leads themselves;
 *   followups  the follow-ups they logged in the period, by day, each with its lead and note;
 *   pending    what waits on them now: their new leads nobody has worked, and their open reminders (overdue first).
 * Closings and revenue are broken down on the page from what it already has. Read only.
 */
export async function salespersonBreakdown(code: string, userId: string, kind: string, period: Period) {
  const src = await sourceFor(code);
  const uid = oid(userId);
  if (!uid) throw httpError("Not a person in that CRM", 404);
  const leads = src.conn.collection("leads");
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  const group = (rows: { _id: unknown; n: number }[], label = (k: string) => k) =>
    rows.map((r) => ({ key: String(r._id ?? ""), label: label(String(r._id ?? "")) || "—", count: r.n })).sort((a, b) => b.count - a.count);

  if (kind === "leads") {
    const match = { assignedTo: uid, ...within("createdAt", period) };
    const [bySource, byDay, byStatus, rows] = await Promise.all([
      leads.aggregate<{ _id: unknown; n: number }>([{ $match: match }, { $group: { _id: { $ifNull: ["$source", ""] }, n: { $sum: 1 } } }], { maxTimeMS: QUERY_MS }).toArray(),
      leads.aggregate<{ _id: unknown; n: number }>([{ $match: match }, { $set: { _d: "$createdAt" } }, { $group: { _id: gstDay, n: { $sum: 1 } } }], { maxTimeMS: QUERY_MS }).toArray(),
      leads.aggregate<{ _id: unknown; n: number }>([{ $match: match }, { $group: { _id: "$status", n: { $sum: 1 } } }], { maxTimeMS: QUERY_MS }).toArray(),
      leads.find(match, { projection: { name: 1, phone: 1, source: 1, status: 1, createdAt: 1, updatedAt: 1 }, maxTimeMS: QUERY_MS })
        .sort({ createdAt: -1 }).limit(BREAKDOWN_LIMIT).toArray(),
    ]);
    return {
      kind,
      bySource: group(bySource, (k) => k || "No source"),
      byStatus: group(byStatus, statusLabel),
      byDay: group(byDay).sort((a, b) => a.key.localeCompare(b.key)),
      rows: rows.map((l) => ({
        id: String(l._id), name: String(l.name ?? ""), phone: String(l.phone ?? ""), source: String(l.source ?? ""),
        status: String(l.status ?? ""), statusLabel: statusLabel(String(l.status ?? "")), at: iso(l.createdAt), updatedAt: iso(l.updatedAt),
      })),
      truncated: rows.length >= BREAKDOWN_LIMIT,
    };
  }

  if (kind === "followups") {
    const pipeline = [
      { $match: { "followUps.followedUpBy": uid, ...within("followUps.followedUpAt", period) } },
      { $unwind: "$followUps" },
      { $match: { "followUps.followedUpBy": uid, ...within("followUps.followedUpAt", period) } },
    ];
    const [byDay, byStatus, rows] = await Promise.all([
      leads.aggregate<{ _id: unknown; n: number }>([...pipeline, { $set: { _d: "$followUps.followedUpAt" } }, { $group: { _id: gstDay, n: { $sum: 1 } } }], { maxTimeMS: QUERY_MS }).toArray(),
      leads.aggregate<{ _id: unknown; n: number }>([...pipeline, { $group: { _id: "$status", n: { $sum: 1 } } }], { maxTimeMS: QUERY_MS }).toArray(),
      leads.aggregate<Record<string, any>>([
        ...pipeline,
        { $project: { _id: 0, leadId: "$_id", name: 1, phone: 1, status: 1, at: "$followUps.followedUpAt", note: "$followUps.note", next: "$followUps.nextFollowUpAt" } },
        { $sort: { at: -1 } },
        { $limit: BREAKDOWN_LIMIT },
      ], { maxTimeMS: QUERY_MS }).toArray(),
    ]);
    return {
      kind,
      byDay: group(byDay).sort((a, b) => a.key.localeCompare(b.key)),
      byStatus: group(byStatus, statusLabel),
      rows: rows.map((f) => ({
        id: `${f.leadId}:${iso(f.at)}`, leadId: String(f.leadId), name: String(f.name ?? ""), phone: String(f.phone ?? ""),
        status: String(f.status ?? ""), statusLabel: statusLabel(String(f.status ?? "")), at: iso(f.at), note: String(f.note ?? ""), next: iso(f.next),
      })),
      truncated: rows.length >= BREAKDOWN_LIMIT,
    };
  }

  if (kind === "pending") {
    const now = new Date();
    const [newLeads, reminders] = await Promise.all([
      leads.find({ assignedTo: uid, status: "assigned" }, { projection: { name: 1, phone: 1, source: 1, createdAt: 1 }, maxTimeMS: QUERY_MS })
        .sort({ createdAt: 1 }).limit(BREAKDOWN_LIMIT).toArray(),
      leads.aggregate<Record<string, any>>([
        { $match: { reminders: { $elemMatch: { createdBy: uid, isDone: { $ne: true } } } } },
        { $unwind: "$reminders" },
        { $match: { "reminders.createdBy": uid, "reminders.isDone": { $ne: true } } },
        { $project: { _id: 0, leadId: "$_id", name: 1, phone: 1, status: 1, title: "$reminders.title", note: "$reminders.note", at: "$reminders.remindAt" } },
        { $sort: { at: 1 } },
        { $limit: BREAKDOWN_LIMIT },
      ], { maxTimeMS: QUERY_MS }).toArray(),
    ]);
    return {
      kind,
      newLeads: newLeads.map((l) => ({ id: String(l._id), name: String(l.name ?? ""), phone: String(l.phone ?? ""), source: String(l.source ?? ""), at: iso(l.createdAt) })),
      reminders: reminders.map((r) => ({
        id: `${r.leadId}:${iso(r.at)}`, leadId: String(r.leadId), name: String(r.name ?? ""), phone: String(r.phone ?? ""),
        statusLabel: statusLabel(String(r.status ?? "")), title: String(r.title ?? ""), note: String(r.note ?? ""), at: iso(r.at),
        overdue: !!r.at && new Date(r.at) < now,
      })),
    };
  }

  throw httpError("Unknown breakdown — leads, followups or pending", 400);
}
