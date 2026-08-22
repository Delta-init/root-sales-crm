"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, Info, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import { RangePicker, rangeFrom, type RangeKey } from "@/components/reports/RangePicker";
import { LeadsTimeline } from "@/components/reports/LeadsTimeline";
import type { GroupOverview, GroupSources, GroupTimeline, ReportFailure } from "@/lib/types";

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);

function Failures({ failures }: { failures: ReportFailure[] }) {
  if (!failures.length) return null;
  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="flex gap-3 pt-6 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div>
          <p className="font-medium">Some organisations could not be reached</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {failures.map((f) => (
              <li key={f.code}>
                {f.name} — {f.error}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-muted-foreground">
            The figures below exclude them entirely.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ReportsPage() {
  // 90 days by default: Banglore has data from mid-July and Draw from June, so
  // a 12-month default would render both as flat lines next to Delta's 13
  // months and read as underperformance rather than a shorter history.
  const [range, setRange] = useState<RangeKey>("90d");
  const from = rangeFrom(range);
  const qs = from ? `?from=${from}` : "";

  const overview = useQuery({
    queryKey: ["report-overview", range],
    queryFn: async () => (await api.get(`/reports/overview${qs}`)).data.data as GroupOverview,
  });

  const timeline = useQuery({
    queryKey: ["report-timeline", range],
    queryFn: async () =>
      (
        await api.get(
          `/reports/timeline${qs}${qs ? "&" : "?"}granularity=${range === "30d" ? "day" : "month"}`
        )
      ).data.data as GroupTimeline,
  });

  const sources = useQuery({
    queryKey: ["report-sources", range],
    queryFn: async () => (await api.get(`/reports/sources${qs}`)).data.data as GroupSources,
  });

  const d = overview.data;

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-wrap items-start justify-between gap-4"
      >
        <div>
          <Link
            href="/dashboard"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-3 w-3" />
            Dashboard
          </Link>
          <h2 className="text-2xl font-bold text-foreground">Group Report</h2>
          <p className="mt-1 text-muted-foreground">
            Delta, Banglore and Draw together
            {d ? ` — money shown in ${d.baseCurrency}` : ""}.
          </p>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </motion.div>

      {d && <Failures failures={d.failures} />}

      {/* Totals */}
      {overview.isLoading ? (
        <Skeleton className="h-28 w-full rounded-lg" />
      ) : d ? (
        <Card className="border-border/50">
          <CardContent className="grid grid-cols-2 gap-6 pt-6 md:grid-cols-4">
            {[
              { label: "Leads", value: d.totals.leads.toLocaleString() },
              { label: "Won", value: d.totals.won.toLocaleString() },
              { label: "Conversion", value: `${d.totals.conversionRate}%` },
              {
                label: `Revenue (${d.baseCurrency})`,
                value: money(d.totals.revenueBase, d.baseCurrency),
              },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="mt-1 text-2xl font-bold text-foreground">{s.value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Per-org */}
      {overview.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52 w-full rounded-lg" />
          ))}
        </div>
      ) : d ? (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {d.orgs.map((o) => {
            const startsAfterRange =
              !!from && !!o.dataStartsAt && new Date(o.dataStartsAt) > new Date(from);

            return (
              <motion.div key={o.org.code} variants={itemVariants}>
                <Card className="h-full border-border/50">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {o.org.name}
                    </CardTitle>
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: o.org.accent }}
                    />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-3xl font-bold text-foreground">
                        {o.leads.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">leads</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Won</p>
                        <p className="font-semibold">
                          {o.won} <span className="text-xs font-normal text-muted-foreground">({o.conversionRate}%)</span>
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Revenue</p>
                        <p className="font-semibold">{money(o.revenue.base, d.baseCurrency)}</p>
                        {o.currency !== d.baseCurrency && (
                          <p className="text-[11px] text-muted-foreground">
                            {money(o.revenue.native, o.currency)} native
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Stage bar */}
                    <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                      {(["won", "working", "new", "unreachable", "lost"] as const).map((st) => {
                        const pct = o.leads > 0 ? (o.byStage[st] / o.leads) * 100 : 0;
                        const tone = {
                          won: "bg-green-500",
                          working: "bg-blue-500",
                          new: "bg-sky-300",
                          unreachable: "bg-amber-500",
                          lost: "bg-rose-500",
                        }[st];
                        return pct > 0 ? (
                          <div key={st} className={cn(tone)} style={{ width: `${pct}%` }} title={`${st}: ${o.byStage[st]}`} />
                        ) : null;
                      })}
                    </div>

                    {startsAfterRange && (
                      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                        <Info className="mt-0.5 h-3 w-3 shrink-0" />
                        Data only starts{" "}
                        {new Date(o.dataStartsAt!).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                        {" "}— shorter history than this range.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      ) : null}

      {/* Timeline */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Leads over time</CardTitle>
          <p className="text-xs text-muted-foreground">
            Bucketed in each organisation&apos;s own timezone.
          </p>
        </CardHeader>
        <CardContent>
          {timeline.isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : timeline.data ? (
            <LeadsTimeline data={timeline.data} />
          ) : null}
        </CardContent>
      </Card>

      {/* Sources */}
      <div className="grid gap-4 lg:grid-cols-3">
        {sources.isLoading
          ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-64 w-full rounded-lg" />)
          : sources.data?.orgs.map((o) => (
              <Card key={o.org.code} className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">{o.org.name}</CardTitle>
                  {o.unattributedPct >= 20 && (
                    <p className="flex items-start gap-1.5 text-[11px] text-amber-500">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      {o.unattributedPct}% of leads have no source recorded — treat
                      this breakdown as partial.
                    </p>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  {o.rows.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No leads in this period.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {o.rows.slice(0, 6).map((r) => (
                        <div
                          key={r.source}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border/40 px-3 py-2 text-sm"
                        >
                          <span className="min-w-0 flex-1 truncate" title={r.source}>
                            {r.source}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {r.leads.toLocaleString()} · {r.conversionRate}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
      </div>
    </div>
  );
}
