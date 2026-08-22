"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import { DayPicker, gulfToday } from "@/components/tracker/DayPicker";
import type { GroupTracker } from "@/lib/types";

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

const fmt = (n: number, money?: boolean, currency = "AED") =>
  money
    ? new Intl.NumberFormat("en-AE", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(n)
    : new Intl.NumberFormat("en-AE").format(n);

/** Green once a target is met, amber past halfway, red below. */
const pctTone = (pct: number | null) => {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 100) return "text-emerald-500";
  if (pct >= 50) return "text-amber-500";
  return "text-rose-500";
};

export default function TrackerPage() {
  const [date, setDate] = useState(gulfToday());

  const { data, isLoading, isError } = useQuery({
    queryKey: ["tracker-group", date],
    queryFn: async () =>
      (await api.get(`/tracker/group?date=${date}`)).data.data as GroupTracker,
  });

  // Calls are credited via lead ownership and only Banglore logs them at all,
  // so a side-by-side calls column would read as Delta and Draw not calling.
  const metrics = (data?.metrics ?? []).filter((m) => m.key !== "callsMade");

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-wrap items-start justify-between gap-4"
      >
        <div>
          <h2 className="text-2xl font-bold text-foreground">Daily Tracker</h2>
          <p className="mt-1 text-muted-foreground">
            All three organisations for one day. Each is scored against its own
            targets.
          </p>
        </div>
        <DayPicker value={date} onChange={setDate} />
      </motion.div>

      {data?.failures?.length ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium">Some organisations could not be reached</p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {data.failures.map((f) => (
                  <li key={f.code}>
                    {f.name} — {f.error}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      )}

      {isError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6 text-sm text-destructive">
            Could not load the tracker.
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Per-org score cards */}
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            {data.orgs.map((o) => (
              <motion.div key={o.org.code} variants={itemVariants}>
                <Card className="h-full border-border/50 transition-colors hover:border-border">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {o.org.name}
                    </CardTitle>
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: o.org.accent }}
                    />
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-foreground">
                      {o.teamScore}
                      <span className="ml-1 text-base font-normal text-muted-foreground">
                        / 100
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Daily score · {o.repCount} active reps
                    </p>

                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, o.teamScore)}%`,
                          backgroundColor: o.org.accent,
                        }}
                      />
                    </div>

                    <Link
                      href={`/tracker/${o.org.code}`}
                      className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
                    >
                      Rep breakdown
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>

          {/* Metric-by-metric comparison */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.22, duration: 0.4 }}
          >
            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">
                  Metric comparison
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Each cell shows the team total, with achievement against that
                  org&apos;s own target beneath. Money stays in each org&apos;s
                  own currency — these are targets, not a group sum.
                </p>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-border/40 text-left">
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">
                          Metric
                        </th>
                        {data.orgs.map((o) => (
                          <th
                            key={o.org.code}
                            className="pb-2 pl-4 text-right font-medium text-muted-foreground"
                          >
                            {o.org.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.map((m) => (
                        <tr
                          key={m.key}
                          className="border-b border-border/20 last:border-0"
                        >
                          <td className="py-2 pr-4">
                            <span>{m.label}</span>
                            {m.source === "manual" && (
                              <span className="ml-2 rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                                entered
                              </span>
                            )}
                          </td>
                          {data.orgs.map((o) => {
                            const v = o.totals[m.key] ?? 0;
                            const pct = o.achieved[m.key];
                            return (
                              <td key={o.org.code} className="py-2 pl-4 text-right">
                                <div className="font-medium">
                                  {m.key === "convRate"
                                    ? `${v}%`
                                    : fmt(v, m.money, o.org.currency)}
                                </div>
                                {pct !== null && pct !== undefined && (
                                  <div className={cn("text-[10px]", pctTone(pct))}>
                                    {pct}% of {fmt(o.targets[m.key] ?? 0, m.money, o.org.currency)}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </>
      )}
    </div>
  );
}
