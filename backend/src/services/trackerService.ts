import mongoose from "mongoose";
import { getSources, type CrmSource } from "./crmConnections.js";
import { TrackerTarget } from "../models/TrackerTarget.js";
import { DailyEntry } from "../models/DailyEntry.js";
import {
  METRICS,
  MANUAL_KEYS,
  DEFAULT_TARGETS,
  dailyScore,
  achievedPct,
  scorableKeys,
  reportedManualKeys,
} from "./trackerMetrics.js";
import type { OrgCode } from "../types/index.js";

/** Statuses that count as a closing, across all three vocabularies. */
const WON = new Set(["closed", "booking", "partialbooking"]);

/**
 * The instant window for a calendar day in a given timezone.
 *
 * Both zones are fixed-offset and neither observes DST, so the arithmetic is
 * exact. This avoids toLocaleString({ timeZone }), which silently falls back to
 * the host timezone on a small-icu Node build — the same trap that made
 * Banglore's split scheduler fire 90 minutes out.
 */
const OFFSETS: Record<string, number> = {
  "Asia/Dubai": 4 * 60,
  "Asia/Kolkata": 5.5 * 60,
};

export const dayWindow = (date: string, timezone: string) => {
  const offset = (OFFSETS[timezone] ?? 0) * 60_000;
  const start = new Date(new Date(`${date}T00:00:00.000Z`).getTime() - offset);
  return { start, end: new Date(start.getTime() + 86_400_000) };
};

interface RepRow {
  userId: string;
  name: string;
  email: string;
  /** The account's own state in the CRM, distinct from being merely quiet. */
  accountStatus: string;
  values: Record<string, number>;
  remarks: string;
  actionRequired: string;
  score: number;
  /** Whether anyone filed the manual half for this rep today. */
  reportedManual: boolean;
  lastActiveOn: string | null;
  daysSinceActive: number | null;
  dormant: boolean;
}

/** Per-rep auto metrics for one org on one day, in that org's timezone. */
const autoMetricsFor = async (src: CrmSource, date: string) => {
  const { conn, org } = src;
  const { start, end } = dayWindow(date, org.timezone);
  const leads = conn.collection("leads");

  const out = new Map<string, Record<string, number>>();
  const bump = (uid: string, key: string, by = 1) => {
    const row = out.get(uid) ?? {};
    row[key] = (row[key] ?? 0) + by;
    out.set(uid, row);
  };

  // ── Activity: one pass over the day's activity log entries ────────────
  const activity = await leads
    .aggregate([
      { $unwind: "$activityLogs" },
      {
        $match: {
          "activityLogs.createdAt": { $gte: start, $lt: end },
          "activityLogs.performedBy": { $ne: null },
        },
      },
      {
        $group: {
          _id: {
            user: "$activityLogs.performedBy",
            action: "$activityLogs.action",
            // Distinct leads per user need the lead id in the key, then a
            // second grouping — counting rows would count one lead touched
            // five times as five leads contacted.
            lead: "$_id",
          },
          desc: { $first: "$activityLogs.description" },
        },
      },
      {
        $group: {
          _id: { user: "$_id.user", action: "$_id.action" },
          leads: { $addToSet: "$_id.lead" },
          rows: { $sum: 1 },
          descs: { $push: "$desc" },
        },
      },
    ])
    .toArray();

  const touched = new Map<string, Set<string>>();

  for (const a of activity) {
    const uid = String(a._id.user);
    const action = a._id.action as string;

    // Leads Contacted = distinct leads this rep touched in any way today.
    const set = touched.get(uid) ?? new Set<string>();
    a.leads.forEach((l: unknown) => set.add(String(l)));
    touched.set(uid, set);

    if (action === "note_added" || action === "status_changed") {
      bump(uid, "followUpsDone", a.rows);
    }

    if (action === "status_changed") {
      // Descriptions read: Status changed from "x" to "y"
      for (const d of a.descs as string[]) {
        const to = /to\s+"([^"]+)"/.exec(d ?? "")?.[1];
        if (to && WON.has(to)) bump(uid, "closings", 1);
      }
    }
  }

  for (const [uid, set] of touched) bump(uid, "leadsContacted", set.size);

  // ── Revenue collected: payments stamped with paidAt on this day ───────
  const payments = await leads
    .aggregate([
      { $unwind: "$payments" },
      { $match: { "payments.paidAt": { $gte: start, $lt: end } } },
      { $group: { _id: "$payments.addedBy", total: { $sum: "$payments.amount" } } },
    ])
    .toArray();
  for (const p of payments) if (p._id) bump(String(p._id), "revenueCollected", p.total);

  // ── Pending: outstanding across leads currently assigned to the rep ───
  const pending = await leads
    .aggregate([
      { $match: { sellingAmount: { $gt: 0 }, assignedTo: { $ne: null } } },
      {
        $project: {
          assignedTo: 1,
          due: {
            $max: [
              0,
              { $subtract: ["$sellingAmount", { $sum: "$payments.amount" }] },
            ],
          },
        },
      },
      { $group: { _id: "$assignedTo", total: { $sum: "$due" } } },
    ])
    .toArray();
  for (const p of pending) if (p._id) bump(String(p._id), "pendingPayments", p.total);

  // ── Calls ─────────────────────────────────────────────────────────────
  // The dialer records no operator: agentExtension is empty on every one of
  // Banglore's 21k logs, agentName and initiatedBy on 98.8% of them, and one
  // user in twenty-four has an extension set. So a call cannot be traced to
  // whoever placed it.
  //
  // What most logs do carry is leadId, so a call is credited to the owner of
  // the lead it concerns. That is an approximation — a colleague covering
  // someone's lead is credited to the owner — and the calls with no leadId at
  // all are reported separately rather than silently dropped, so the per-rep
  // column is never mistaken for the full count.
  let callsUnattributed = 0;
  if (conn.db && (await conn.db.listCollections({ name: "calllogs" }).toArray()).length) {
    const dayMatch = {
      $expr: {
        $let: {
          // callDate is when the call happened; createdAt is when the Android
          // app synced it, which can be hours later and would file the call
          // under the wrong day.
          vars: { at: { $ifNull: ["$callDate", "$createdAt"] } },
          in: { $and: [{ $gte: ["$$at", start] }, { $lt: ["$$at", end] }] },
        },
      },
    };

    const attributed = await conn
      .collection("calllogs")
      .aggregate([
        { $match: { ...dayMatch, leadId: { $ne: null } } },
        {
          $lookup: {
            from: "leads",
            localField: "leadId",
            foreignField: "_id",
            as: "lead",
            pipeline: [{ $project: { assignedTo: 1 } }],
          },
        },
        { $unwind: "$lead" },
        { $match: { "lead.assignedTo": { $ne: null } } },
        { $group: { _id: "$lead.assignedTo", n: { $sum: 1 } } },
      ])
      .toArray();
    for (const c of attributed) bump(String(c._id), "callsMade", c.n);

    const total = await conn.collection("calllogs").countDocuments(dayMatch);
    const credited = attributed.reduce((sum, c) => sum + c.n, 0);
    callsUnattributed = Math.max(0, total - credited);
  }

  return { perUser: out, callsUnattributed };
};

/**
 * Everyone in the org, not only the people who did something today.
 *
 * Deactivated accounts are kept rather than filtered out: a rep who stopped
 * appearing is exactly what a manager needs to see, and silently dropping them
 * makes the team look smaller and healthier than it is.
 */
const allUsers = async (src: CrmSource) => {
  const users = await src.conn
    .collection("users")
    .find({}, { projection: { name: 1, email: 1, status: 1 } })
    .sort({ name: 1 })
    .toArray();
  return users.map((u) => ({
    userId: String(u._id),
    name: (u.name as string) ?? "(unnamed)",
    email: (u.email as string) ?? "",
    accountStatus: (u.status as string) ?? "active",
  }));
};

/** A rep with no lead activity for this many days is treated as dormant. */
export const DORMANT_AFTER_DAYS = 7;

/**
 * When each rep last touched a lead, as of the day being viewed.
 *
 * Bounded to a 90-day lookback: the question is "are they still working", and
 * unwinding every activity log ever written to answer it would scan the whole
 * collection. Anyone quiet for longer than the window is simply reported as
 * beyond it, which is the same conclusion.
 */
const LOOKBACK_DAYS = 90;

const lastActivityByUser = async (src: CrmSource, asOf: Date) => {
  const since = new Date(asOf.getTime() - LOOKBACK_DAYS * 86_400_000);

  const rows = await src.conn
    .collection("leads")
    .aggregate([
      { $unwind: "$activityLogs" },
      {
        $match: {
          "activityLogs.performedBy": { $ne: null },
          "activityLogs.createdAt": { $gte: since, $lt: asOf },
        },
      },
      {
        $group: {
          _id: "$activityLogs.performedBy",
          last: { $max: "$activityLogs.createdAt" },
        },
      },
    ])
    .toArray();

  return new Map(rows.map((r) => [String(r._id), r.last as Date]));
};

/**
 * A rep's share of the desk's daily target.
 *
 * Ratios are passed through untouched: dividing a conversion rate by headcount
 * would ask each rep to convert at a twenty-fifth of the team's rate.
 */
const repTargetsFor = (
  targets: Record<string, number>,
  working: number
): Record<string, number> =>
  Object.fromEntries(
    Object.entries(targets).map(([k, v]) => [
      k,
      k === "convRate" ? v : v / Math.max(1, working),
    ])
  );

export const getTargets = async (org: OrgCode): Promise<Record<string, number>> => {
  const doc = await TrackerTarget.findOne({ org });
  if (!doc) return { ...DEFAULT_TARGETS };
  return Object.fromEntries(doc.metrics);
};

export const saveTargets = async (
  org: OrgCode,
  metrics: Record<string, number>,
  adminId: string
) => {
  const doc = await TrackerTarget.findOneAndUpdate(
    { org },
    { $set: { metrics, updatedBy: adminId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return Object.fromEntries(doc!.metrics);
};

/** One org's full rep grid for a day: auto metrics merged with manual entries. */
export const orgTracker = async (code: string, date: string) => {
  const { sources, failures } = await getSources();
  const src = sources.find((s) => s.org.code === code);

  if (!src) {
    const failure = failures.find((f) => f.code === code);
    throw Object.assign(
      new Error(failure ? `${failure.name}: ${failure.error}` : `Unknown organisation: ${code}`),
      { statusCode: failure ? 503 : 404 }
    );
  }

  // Dormancy is judged as of the day being viewed, not today: opening the
  // 10th of last month should show who was quiet then, not who is quiet now.
  const asOf = dayWindow(date, src.org.timezone).end;

  const [autoResult, users, targets, entries, lastActive] = await Promise.all([
    autoMetricsFor(src, date),
    allUsers(src),
    getTargets(code as OrgCode),
    DailyEntry.find({ org: code, date }),
    lastActivityByUser(src, asOf),
  ]);

  const entryBy = new Map(entries.map((e) => [e.userId, e]));

  const base = users.map((u) => {
    const entry = entryBy.get(u.userId);
    const manual = entry ? Object.fromEntries(entry.metrics) : {};

    const values: Record<string, number> = {
      ...Object.fromEntries(MANUAL_KEYS.map((k) => [k, manual[k] ?? 0])),
      ...(autoResult.perUser.get(u.userId) ?? {}),
    };

    for (const m of METRICS) values[m.key] = values[m.key] ?? 0;
    values.convRate = values.leadsContacted
      ? Math.round((values.closings / values.leadsContacted) * 1000) / 10
      : 0;

    const last = lastActive.get(u.userId) ?? null;
    const daysSinceActive = last
      ? Math.floor((asOf.getTime() - last.getTime()) / 86_400_000)
      : null;

    return {
      ...u,
      values,
      entry,
      lastActiveOn: last ? last.toISOString().slice(0, 10) : null,
      daysSinceActive,
      // null means nothing in the whole 90-day lookback, which is dormant by
      // any reading — not "unknown".
      dormant: daysSinceActive === null || daysSinceActive >= DORMANT_AFTER_DAYS,
    };
  });

  const working = base.filter((r) => !r.dormant && r.accountStatus === "active").length;
  const orgScorable = scorableKeys(code);

  const repTargets = repTargetsFor(targets, working);

  const rows: RepRow[] = base.map((r) => {
    const keys = [...orgScorable, ...reportedManualKeys(r.values)];
    return {
      userId: r.userId,
      name: r.name,
      email: r.email,
      accountStatus: r.accountStatus,
      values: r.values,
      remarks: r.entry?.remarks ?? "",
      actionRequired: r.entry?.actionRequired ?? "",
      score: dailyScore(r.values, repTargets, keys),
      reportedManual: reportedManualKeys(r.values).length > 0 || Boolean(r.entry),
      lastActiveOn: r.lastActiveOn,
      daysSinceActive: r.daysSinceActive,
      dormant: r.dormant,
    };
  });

  // Team total sums every metric, except the ones where a sum is nonsense:
  // a conversion rate must be recomputed from the totals, not averaged.
  const totals: Record<string, number> = {};
  for (const m of METRICS) {
    totals[m.key] = rows.reduce((sum, r) => sum + (r.values[m.key] ?? 0), 0);
  }
  totals.convRate = totals.leadsContacted
    ? Math.round((totals.closings / totals.leadsContacted) * 1000) / 10
    : 0;

  const achieved: Record<string, number | null> = {};
  for (const m of METRICS) achieved[m.key] = achievedPct(totals[m.key], targets[m.key]);

  return {
    org: {
      code: src.org.code,
      name: src.org.name,
      accent: src.org.accent,
      currency: src.org.currency,
      timezone: src.org.timezone,
    },
    date,
    metrics: METRICS,
    targets,
    rows,
    totals,
    achieved,
    teamScore: dailyScore(totals, targets, orgScorable),
    repTargets,
    callsUnattributed: autoResult.callsUnattributed,
    dormantAfterDays: DORMANT_AFTER_DAYS,
    counts: {
      total: rows.length,
      working,
      dormant: rows.filter((r) => r.dormant && r.accountStatus === "active").length,
      reported: rows.filter((r) => r.reportedManual).length,
      deactivated: rows.filter((r) => r.accountStatus !== "active").length,
    },
  };
};

/** All orgs side by side for one day. */
export const groupTracker = async (date: string) => {
  const { sources, failures } = await getSources();

  const orgs = await Promise.all(
    sources.map(async (src) => {
      try {
        const t = await orgTracker(src.org.code, date);
        return {
          org: t.org,
          targets: t.targets,
          totals: t.totals,
          achieved: t.achieved,
          teamScore: t.teamScore,
          repCount: t.rows.length,
          callsUnattributed: t.callsUnattributed,
          counts: t.counts,
        };
      } catch (error) {
        failures.push({
          code: src.org.code,
          name: src.org.name,
          error: error instanceof Error ? error.message : "Failed",
        });
        return null;
      }
    })
  );

  return {
    date,
    metrics: METRICS,
    orgs: orgs.filter(Boolean),
    failures,
  };
};

/**
 * One rep, day by day, across a range.
 *
 * Buckets with $dateToString's timezone argument rather than the fixed-offset
 * arithmetic used elsewhere: that runs inside mongod, which carries a full
 * timezone database, so it is safe here in a way the Node-side small-icu
 * fallback is not.
 */
export const userTracker = async (
  code: string,
  userId: string,
  from: string,
  to: string
) => {
  const { sources, failures } = await getSources();
  const src = sources.find((s) => s.org.code === code);
  if (!src) {
    const f = failures.find((x) => x.code === code);
    throw Object.assign(new Error(f ? `${f.name}: ${f.error}` : `Unknown organisation: ${code}`), {
      statusCode: f ? 503 : 404,
    });
  }

  const tz = src.org.timezone;
  const start = dayWindow(from, tz).start;
  const end = dayWindow(to, tz).end;
  const leads = src.conn.collection("leads");
  const oid = new mongoose.Types.ObjectId(userId);

  const byDay = new Map<string, Record<string, number>>();
  const bump = (day: string, key: string, by = 1) => {
    const row = byDay.get(day) ?? {};
    row[key] = (row[key] ?? 0) + by;
    byDay.set(day, row);
  };

  const activity = await leads
    .aggregate([
      { $unwind: "$activityLogs" },
      {
        $match: {
          "activityLogs.performedBy": oid,
          "activityLogs.createdAt": { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: "%Y-%m-%d", date: "$activityLogs.createdAt", timezone: tz } },
            action: "$activityLogs.action",
            lead: "$_id",
          },
          descs: { $push: "$activityLogs.description" },
          rows: { $sum: 1 },
        },
      },
    ])
    .toArray();

  const touched = new Map<string, Set<string>>();
  for (const a of activity) {
    const day = a._id.day as string;
    const set = touched.get(day) ?? new Set<string>();
    set.add(String(a._id.lead));
    touched.set(day, set);

    if (a._id.action === "note_added" || a._id.action === "status_changed") {
      bump(day, "followUpsDone", a.rows);
    }
    if (a._id.action === "status_changed") {
      for (const d of a.descs as string[]) {
        const t = /to\s+"([^"]+)"/.exec(d ?? "")?.[1];
        if (t && WON.has(t)) bump(day, "closings", 1);
      }
    }
  }
  for (const [day, set] of touched) bump(day, "leadsContacted", set.size);

  const payments = await leads
    .aggregate([
      { $unwind: "$payments" },
      { $match: { "payments.addedBy": oid, "payments.paidAt": { $gte: start, $lt: end } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$payments.paidAt", timezone: tz } },
          total: { $sum: "$payments.amount" },
        },
      },
    ])
    .toArray();
  for (const p of payments) bump(String(p._id), "revenueCollected", p.total);

  const orgScorable = scorableKeys(code);

  const [targets, entries, user, roster, lastActive] = await Promise.all([
    getTargets(code as OrgCode),
    DailyEntry.find({ org: code, userId, date: { $gte: from, $lte: to } }),
    src.conn.collection("users").findOne({ _id: oid }, { projection: { name: 1, email: 1, status: 1 } }),
    allUsers(src),
    lastActivityByUser(src, end),
  ]);

  // Same denominator the org grid uses, so one rep's score means the same
  // number on both pages.
  const workingCount = roster.filter((u) => {
    const la = lastActive.get(u.userId);
    if (!la || u.accountStatus !== "active") return false;
    return (end.getTime() - la.getTime()) / 86_400_000 < DORMANT_AFTER_DAYS;
  }).length;

  const repTargets = repTargetsFor(targets, workingCount);

  const entryBy = new Map(entries.map((e) => [e.date, e]));

  // Every day in the range appears, including empty ones — a gap in the table
  // is the point, and omitting quiet days would flatter the trend.
  const days: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    days.push(d.toISOString().slice(0, 10));
  }

  const rows = days.map((day) => {
    const entry = entryBy.get(day);
    const manual = entry ? Object.fromEntries(entry.metrics) : {};
    const values: Record<string, number> = {
      ...Object.fromEntries(MANUAL_KEYS.map((k) => [k, manual[k] ?? 0])),
      ...(byDay.get(day) ?? {}),
    };
    for (const m of METRICS) values[m.key] = values[m.key] ?? 0;
    values.convRate = values.leadsContacted
      ? Math.round((values.closings / values.leadsContacted) * 1000) / 10
      : 0;
    return {
      date: day,
      values,
      remarks: entry?.remarks ?? "",
      actionRequired: entry?.actionRequired ?? "",
      // Same basis as the org grid: this rep's share of the desk's target,
      // over the metrics that actually apply to them. Scored against the raw
      // team target the two pages would disagree about the same person.
      score: dailyScore(values, repTargets, [
        ...orgScorable,
        ...reportedManualKeys(values),
      ]),
    };
  });

  const totals: Record<string, number> = {};
  for (const m of METRICS) totals[m.key] = rows.reduce((s, r) => s + (r.values[m.key] ?? 0), 0);
  totals.convRate = totals.leadsContacted
    ? Math.round((totals.closings / totals.leadsContacted) * 1000) / 10
    : 0;

  const active = rows.filter((r) => r.score > 0).length;

  return {
    org: { code: src.org.code, name: src.org.name, accent: src.org.accent, currency: src.org.currency, timezone: tz },
    user: {
      userId,
      name: (user?.name as string) ?? "(unknown)",
      email: (user?.email as string) ?? "",
      status: (user?.status as string) ?? "",
    },
    from,
    to,
    metrics: METRICS,
    targets,
    rows,
    totals,
    // Mean over days with any activity, not the whole range — a rep who worked
    // five of seven days should not be scored as if they missed two.
    averageScore: active ? Math.round((rows.reduce((s, r) => s + r.score, 0) / active) * 10) / 10 : 0,
    activeDays: active,
  };
};

export const saveEntry = async (input: {
  org: OrgCode;
  userId: string;
  userName?: string;
  date: string;
  metrics: Record<string, number>;
  remarks?: string;
  actionRequired?: string;
  adminId: string;
}) => {
  // Only manual keys are persisted. Accepting an auto key here would let a
  // typed number silently replace a measured one on the next read.
  const metrics: Record<string, number> = {};
  for (const k of MANUAL_KEYS) {
    const v = Number(input.metrics?.[k]);
    if (Number.isFinite(v) && v >= 0) metrics[k] = v;
  }

  const doc = await DailyEntry.findOneAndUpdate(
    { org: input.org, userId: input.userId, date: input.date },
    {
      $set: {
        metrics,
        userName: input.userName ?? "",
        remarks: input.remarks ?? "",
        actionRequired: input.actionRequired ?? "",
        updatedBy: input.adminId,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return {
    userId: doc!.userId,
    date: doc!.date,
    metrics: Object.fromEntries(doc!.metrics),
    remarks: doc!.remarks,
    actionRequired: doc!.actionRequired,
  };
};
