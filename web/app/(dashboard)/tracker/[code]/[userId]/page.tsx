"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, ChevronDown, ChevronUp, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/axios";
import { cn } from "@/lib/utils";
import { gulfToday } from "@/components/tracker/DayPicker";
import type { MetricDef, UserTracker, UserTrackerDay } from "@/lib/types";

const shiftDay = (date: string, days: number) =>
  new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

const WINDOWS = [7, 14, 30];

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

const num = (n: number) => new Intl.NumberFormat("en-AE").format(n);

/** "Fri 22 Aug" reads at a glance; "2026-08-22" wraps and doesn't. */
const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

const isWeekend = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

const scoreTone = (s: number) => {
  if (s >= 75) return "text-emerald-500";
  if (s >= 40) return "text-amber-500";
  if (s > 0) return "text-rose-500";
  return "text-muted-foreground";
};

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", tone)}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function UserTrackerPage() {
  const params = useParams<{ code: string; userId: string }>();
  const [days, setDays] = useState(14);
  const [showAll, setShowAll] = useState(false);

  const to = gulfToday();
  const from = shiftDay(to, -(days - 1));

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["tracker-user", params.code, params.userId, from, to],
    queryFn: async () =>
      (await api.get(`/tracker/user/${params.code}/${params.userId}?from=${from}&to=${to}`))
        .data.data as UserTracker,
  });

  /**
   * Which columns to show.
   *
   * The catalogue has seventeen metrics and most reps only ever move four or
   * five of them, so rendering all of them produces a wall of zeros that hides
   * the numbers that did move. Only columns with something in them are shown,
   * with the rest one click away.
   */
  const { columns, hiddenCount } = useMemo(() => {
    if (!data) return { columns: [] as MetricDef[], hiddenCount: 0 };

    const relevant = data.metrics.filter(
      (m) => !m.reliableIn || m.reliableIn.includes(data.org.code)
    );
    if (showAll) return { columns: relevant, hiddenCount: 0 };

    const used = relevant.filter((m) => (data.totals[m.key] ?? 0) > 0);
    return { columns: used, hiddenCount: relevant.length - used.length };
  }, [data, showAll]);

  const summary = useMemo(() => {
    if (!data?.rows.length) return null;
    const active = data.rows.filter((r) => r.score > 0);
    const best = [...data.rows].sort((a, b) => b.score - a.score)[0];

    // Compare the two halves of the window rather than first vs last day, so
    // one quiet Friday does not read as a collapse.
    const mid = Math.floor(data.rows.length / 2);
    const mean = (rows: UserTrackerDay[]) =>
      rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : 0;
    const delta = mean(data.rows.slice(mid)) - mean(data.rows.slice(0, mid));

    return { active, best, delta };
  }, [data]);

  const chartRows = (data?.rows ?? []).map((r) => ({
    day: dayLabel(r.date).replace(/^\w+ /, ""),
    score: r.score,
  }));

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-wrap items-start justify-between gap-4"
      >
        <div>
          <Link
            href={`/tracker/${params.code}`}
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-3 w-3" />
            {data?.org.name ?? params.code} tracker
          </Link>
          <h2 className="text-2xl font-bold text-foreground">
            {data?.user.name ?? <Skeleton className="inline-block h-7 w-40" />}
          </h2>
          {data && (
            <p className="mt-1 text-sm text-muted-foreground">
              {data.user.email || "no email on file"} · {dayLabel(data.from)} –{" "}
              {dayLabel(data.to)}
            </p>
          )}
        </div>

        <div className="inline-flex rounded-lg border border-border/60 bg-card p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setDays(w)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                days === w
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {w} days
            </button>
          ))}
        </div>
      </motion.div>

      {isLoading && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </>
      )}

      {isError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6 text-sm text-destructive">
            {apiErrorMessage(error, "Could not load this rep")}
          </CardContent>
        </Card>
      )}

      {data && summary && (
        <>
          {/* ── Summary ─────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.35 }}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Stat
              label="Average score"
              value={`${data.averageScore}`}
              sub={`across ${data.activeDays} active day${data.activeDays === 1 ? "" : "s"}`}
              tone={scoreTone(data.averageScore)}
            />
            <Stat
              label="Leads contacted"
              value={num(data.totals.leadsContacted ?? 0)}
              sub={`${num(data.totals.followUpsDone ?? 0)} follow-ups`}
            />
            <Stat
              label="Closings"
              value={num(data.totals.closings ?? 0)}
              sub={`${data.totals.convRate ?? 0}% conversion`}
            />
            <Stat
              label="Revenue collected"
              value={money(data.totals.revenueCollected ?? 0, data.org.currency)}
              sub={
                summary.best.score > 0
                  ? `best day ${dayLabel(summary.best.date)} · ${summary.best.score}`
                  : undefined
              }
            />
          </motion.div>

          {/* ── Trend ───────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.35 }}
          >
            <Card className="border-border/50">
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div>
                  <CardTitle className="text-base font-semibold">Score trend</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Daily score, 0–100, against {data.org.name}&apos;s targets.
                  </p>
                </div>
                <div
                  className={cn(
                    "flex items-center gap-1 text-xs font-medium",
                    summary.delta > 1
                      ? "text-emerald-500"
                      : summary.delta < -1
                        ? "text-rose-500"
                        : "text-muted-foreground"
                  )}
                  title="Second half of the window vs the first"
                >
                  {summary.delta > 1 ? (
                    <TrendingUp className="h-3.5 w-3.5" />
                  ) : summary.delta < -1 ? (
                    <TrendingDown className="h-3.5 w-3.5" />
                  ) : (
                    <Minus className="h-3.5 w-3.5" />
                  )}
                  {summary.delta > 0 ? "+" : ""}
                  {Math.round(summary.delta * 10) / 10}
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartRows} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={data.org.accent} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={data.org.accent} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" vertical={false} />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11 }}
                      className="fill-muted-foreground"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={16}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      className="fill-muted-foreground"
                      tickLine={false}
                      axisLine={false}
                      width={38}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="score"
                      stroke={data.org.accent}
                      strokeWidth={2}
                      fill="url(#scoreFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </motion.div>

          {/* ── Day by day ──────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.35 }}
          >
            <Card className="border-border/50">
              <CardHeader className="flex flex-row items-start justify-between pb-3">
                <div>
                  <CardTitle className="text-base font-semibold">Day by day</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Quiet days are kept — leaving them out would flatter the trend.
                  </p>
                </div>
                {(hiddenCount > 0 || showAll) && (
                  <button
                    onClick={() => setShowAll((v) => !v)}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showAll ? (
                      <>
                        <ChevronUp className="h-3 w-3" />
                        Hide empty
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3" />
                        {hiddenCount} empty column{hiddenCount === 1 ? "" : "s"}
                      </>
                    )}
                  </button>
                )}
              </CardHeader>

              <CardContent className="pt-0">
                {columns.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No recorded activity for {data.user.name} in this period.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/40">
                          <th className="sticky left-0 z-10 bg-card pb-2 pr-4 text-left font-medium text-muted-foreground">
                            Day
                          </th>
                          {columns.map((m) => (
                            <th
                              key={m.key}
                              title={m.note ?? undefined}
                              className="whitespace-nowrap pb-2 pl-4 text-right font-medium text-muted-foreground"
                            >
                              <span className={cn(m.source === "manual" && "italic")}>
                                {m.label}
                              </span>
                            </th>
                          ))}
                          <th className="whitespace-nowrap pb-2 pl-4 text-right font-medium text-muted-foreground">
                            Score
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {data.rows.map((r) => (
                          <tr
                            key={r.date}
                            className={cn(
                              "group border-b border-border/20 transition-colors hover:bg-muted/30",
                              // Weekends explain most zero rows, so dim them
                              // rather than leaving them looking like misses.
                              isWeekend(r.date) && "bg-muted/20"
                            )}
                          >
                            <td className="sticky left-0 z-10 whitespace-nowrap bg-card py-2 pr-4 transition-colors group-hover:bg-muted/30">
                              <span className="font-medium">{dayLabel(r.date)}</span>
                              {r.remarks && (
                                <span className="ml-2 text-[10px] text-muted-foreground">
                                  {r.remarks}
                                </span>
                              )}
                            </td>
                            {columns.map((m) => {
                              const v = r.values[m.key] ?? 0;
                              return (
                                <td
                                  key={m.key}
                                  className={cn(
                                    "py-2 pl-4 text-right tabular-nums",
                                    !v && "text-muted-foreground/70"
                                  )}
                                >
                                  {m.key === "convRate"
                                    ? `${v}%`
                                    : m.money
                                      ? money(v, data.org.currency)
                                      : num(v)}
                                </td>
                              );
                            })}
                            <td className="py-2 pl-4">
                              <div className="flex items-center justify-end gap-2">
                                <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-muted sm:block">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${Math.min(100, r.score)}%`,
                                      backgroundColor: data.org.accent,
                                    }}
                                  />
                                </div>
                                <span
                                  className={cn(
                                    "w-9 text-right font-semibold tabular-nums",
                                    scoreTone(r.score)
                                  )}
                                >
                                  {r.score}
                                </span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>

                      <tfoot>
                        <tr className="border-t-2 border-border/60 font-semibold">
                          <td className="sticky left-0 z-10 bg-card py-2 pr-4 text-left">
                            Period total
                          </td>
                          {columns.map((m) => (
                            <td key={m.key} className="py-2 pl-4 text-right tabular-nums">
                              {m.key === "convRate"
                                ? `${data.totals[m.key] ?? 0}%`
                                : m.money
                                  ? money(data.totals[m.key] ?? 0, data.org.currency)
                                  : num(data.totals[m.key] ?? 0)}
                            </td>
                          ))}
                          <td className="py-2 pl-4 text-right">{data.averageScore}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </>
      )}
    </div>
  );
}
