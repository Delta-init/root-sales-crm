import { env } from "../config/env.js";
import { getSources, type CrmSource } from "./crmConnections.js";
import { STAGES, stageSwitchExpr, type Stage } from "./statusMap.js";

export interface DateRange {
  from?: Date;
  to?: Date;
}

const toBase = (native: number, fx: number) => Math.round(native * fx * 100) / 100;

const rangeMatch = (field: string, { from, to }: DateRange) => {
  if (!from && !to) return {};
  const c: Record<string, Date> = {};
  if (from) c.$gte = from;
  if (to) c.$lte = to;
  return { [field]: c };
};

/** Raw collection handle. Models are not registered on these connections —
 *  the report only aggregates, and defining models would invite writes. */
const leads = (s: CrmSource) => s.conn.collection("leads");

// ─── Overview ─────────────────────────────────────────────────────────────────
export const getOverview = async (range: DateRange) => {
  const { sources, failures } = await getSources();

  const perOrg = await Promise.all(
    sources.map(async (s) => {
      const match = rangeMatch("createdAt", range);

      const [stageRows, revenueRow, firstLead] = await Promise.all([
        leads(s)
          .aggregate([
            { $match: match },
            { $group: { _id: stageSwitchExpr(), n: { $sum: 1 } } },
          ])
          .toArray(),

        // Revenue is filtered on the PAYMENT date, not the lead's createdAt: a
        // lead created in June that pays in August is August's revenue. Using
        // createdAt here would quietly credit the wrong month.
        leads(s)
          .aggregate([
            { $unwind: "$payments" },
            { $match: rangeMatch("payments.paidAt", range) },
            { $group: { _id: null, total: { $sum: "$payments.amount" }, n: { $sum: 1 } } },
          ])
          .toArray(),

        leads(s).find({}, { projection: { createdAt: 1 } }).sort({ createdAt: 1 }).limit(1).toArray(),
      ]);

      const byStage = Object.fromEntries(STAGES.map((st) => [st, 0])) as Record<Stage, number>;
      for (const r of stageRows) byStage[r._id as Stage] = r.n;

      const total = Object.values(byStage).reduce((a, b) => a + b, 0);
      const nativeRevenue = revenueRow[0]?.total ?? 0;

      return {
        org: { code: s.org.code, name: s.org.name, accent: s.org.accent },
        currency: s.org.currency,
        timezone: s.org.timezone,
        dataStartsAt: firstLead[0]?.createdAt ?? null,
        leads: total,
        byStage,
        won: byStage.won,
        // Guard the divide: an org with no leads in range must read 0%, not NaN.
        conversionRate: total > 0 ? Math.round((byStage.won / total) * 1000) / 10 : 0,
        revenue: {
          native: Math.round(nativeRevenue * 100) / 100,
          base: toBase(nativeRevenue, s.org.fxToBase),
          payments: revenueRow[0]?.n ?? 0,
        },
      };
    })
  );

  const leadsTotal = perOrg.reduce((a, o) => a + o.leads, 0);
  const wonTotal = perOrg.reduce((a, o) => a + o.won, 0);

  return {
    baseCurrency: env.BASE_CURRENCY,
    orgs: perOrg,
    totals: {
      leads: leadsTotal,
      won: wonTotal,
      conversionRate: leadsTotal > 0 ? Math.round((wonTotal / leadsTotal) * 1000) / 10 : 0,
      // Only the base figure is summed. Adding AED to INR would be meaningless,
      // so there is deliberately no `native` total here.
      revenueBase: Math.round(perOrg.reduce((a, o) => a + o.revenue.base, 0) * 100) / 100,
    },
    failures,
  };
};

// ─── Timeline ─────────────────────────────────────────────────────────────────
export const getTimeline = async (range: DateRange, granularity: "day" | "month") => {
  const { sources, failures } = await getSources();
  const fmt = granularity === "month" ? "%Y-%m" : "%Y-%m-%d";

  const series = await Promise.all(
    sources.map(async (s) => {
      // Bucketing happens in the ORG's timezone, not the server's. Dubai and
      // Kolkata are 1h30 apart, so a shared UTC bucket would push Banglore's
      // late-evening leads into the wrong day relative to Delta's.
      const rows = await leads(s)
        .aggregate([
          { $match: rangeMatch("createdAt", range) },
          {
            $group: {
              _id: {
                $dateToString: { format: fmt, date: "$createdAt", timezone: s.org.timezone },
              },
              leads: { $sum: 1 },
              won: {
                $sum: { $cond: [{ $eq: [stageSwitchExpr(), "won"] }, 1, 0] },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      return {
        org: { code: s.org.code, name: s.org.name, accent: s.org.accent },
        timezone: s.org.timezone,
        points: rows.map((r) => ({ bucket: r._id as string, leads: r.leads, won: r.won })),
      };
    })
  );

  // Union of buckets across orgs, so a day where only one org had activity
  // still appears with zeroes for the others rather than shifting the axis.
  const buckets = [...new Set(series.flatMap((s) => s.points.map((p) => p.bucket)))].sort();

  return { granularity, buckets, series, failures };
};

// ─── Sources ──────────────────────────────────────────────────────────────────
export const getSourcePerformance = async (range: DateRange, limit = 12) => {
  const { sources, failures } = await getSources();

  const perOrg = await Promise.all(
    sources.map(async (s) => {
      const rows = await leads(s)
        .aggregate([
          { $match: rangeMatch("createdAt", range) },
          {
            $group: {
              _id: { $ifNull: ["$source", null] },
              leads: { $sum: 1 },
              won: { $sum: { $cond: [{ $eq: [stageSwitchExpr(), "won"] }, 1, 0] } },
            },
          },
          { $sort: { leads: -1 } },
          { $limit: limit },
        ])
        .toArray();

      const total = rows.reduce((a, r) => a + r.leads, 0);
      const unattributed = rows.find((r) => !r._id)?.leads ?? 0;

      return {
        org: { code: s.org.code, name: s.org.name, accent: s.org.accent },
        // Draw currently has no source on ~94% of leads. Surfacing this lets
        // the UI caveat the panel instead of implying "(none)" is a channel.
        unattributedPct: total > 0 ? Math.round((unattributed / total) * 1000) / 10 : 0,
        rows: rows.map((r) => ({
          source: (r._id as string | null) ?? "(not set)",
          leads: r.leads,
          won: r.won,
          conversionRate: r.leads > 0 ? Math.round((r.won / r.leads) * 1000) / 10 : 0,
        })),
      };
    })
  );

  return { orgs: perOrg, failures };
};
