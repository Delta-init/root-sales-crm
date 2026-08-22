"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  MoonStar,
  Pencil,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/axios";
import { cn } from "@/lib/utils";
import { DayPicker, gulfToday } from "@/components/tracker/DayPicker";
import { TargetProgress } from "@/components/tracker/TargetProgress";
import type { MetricDef, OrgTracker, TrackerRow } from "@/lib/types";

// Standard notation throughout: compact with maximumFractionDigits:0 renders
// 1,490,000 as "AED 1M", a 33% understatement, and switching notation partway
// down a column defeats tabular-nums alignment.
const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);

const num = (n: number) => new Intl.NumberFormat("en-AE").format(n);

/** "Fri 22 Aug" reads at a glance; "2026-08-22" wraps and doesn't. */
const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

// replace("Asia/","") is a no-op on Europe/London and leaves underscores in
// Asia/Kuala_Lumpur; take the last segment instead.
const tzLabel = (tz: string) => tz.split("/").pop()!.replace(/_/g, " ");

const scoreTone = (s: number) => {
  if (s >= 75) return "text-emerald-500";
  if (s >= 40) return "text-amber-500";
  if (s > 0) return "text-rose-500";
  return "text-muted-foreground";
};

type Filter = "all" | "working" | "dormant";

function Stat({
  label,
  value,
  suffix,
  sub,
  tone,
}: {
  label: string;
  value: string;
  /** The group page shows org score as "12.9 / 100"; the drill-down has to
   *  agree on the denominator or the click loses its thread. */
  suffix?: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", tone)}>
        {value}
        {suffix && (
          <span className="ml-1 text-sm font-normal text-muted-foreground">{suffix}</span>
        )}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function EntryEditor({
  row,
  tracker,
  colSpan,
  onClose,
}: {
  row: TrackerRow;
  tracker: OrgTracker;
  colSpan: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const manual = tracker.metrics.filter((m) => m.source === "manual");

  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(manual.map((m) => [m.key, row.values[m.key] ?? 0]))
  );
  const [remarks, setRemarks] = useState(row.remarks);
  const [action, setAction] = useState(row.actionRequired);

  const save = useMutation({
    mutationFn: async () =>
      api.put("/tracker/entry", {
        org: tracker.org.code,
        userId: row.userId,
        userName: row.name,
        date: tracker.date,
        metrics: values,
        remarks,
        actionRequired: action,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracker-org", tracker.org.code, tracker.date] });
      toast.success(`Saved ${row.name}`);
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not save")),
  });

  return (
    <tr className="bg-muted/30">
      <td colSpan={colSpan} className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium">
            {row.name}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              entered figures for {dayLabel(tracker.date)}
            </span>
          </p>
          <button
            onClick={onClose}
            aria-label="Close editor"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {manual.map((m) => (
            <label key={m.key} className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                {m.label}
              </span>
              <input
                type="number"
                min={0}
                value={values[m.key] ?? 0}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [m.key]: Math.max(0, Number(e.target.value) || 0) }))
                }
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
              />
            </label>
          ))}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
              Manager remarks
            </span>
            <input
              value={remarks}
              maxLength={500}
              onChange={(e) => setRemarks(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
              Action required
            </span>
            <input
              value={action}
              maxLength={500}
              onChange={(e) => setAction(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
            />
          </label>
        </div>

        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
        >
          {save.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          Save
        </button>
      </td>
    </tr>
  );
}

export default function OrgTrackerPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;

  const [date, setDate] = useState(gulfToday());
  const [editing, setEditing] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  // filter too: a hidden row's editor would keep unsaved state alive offscreen
  useEffect(() => setEditing(null), [date, filter]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["tracker-org", code, date],
    queryFn: async () =>
      (await api.get(`/tracker/org/${code}?date=${date}`)).data.data as OrgTracker,
  });

  /**
   * Nineteen metrics against twenty-five reps is 475 cells, and on a normal day
   * most of them are zero because nobody entered the manual half. Only columns
   * with something in them are shown; the rest stay one click away.
   */
  const { columns, scorable, hiddenCount } = useMemo(() => {
    if (!data) return { columns: [] as MetricDef[], scorable: [] as MetricDef[], hiddenCount: 0 };

    const relevant = data.metrics.filter(
      (m) => !m.reliableIn || m.reliableIn.includes(data.org.code)
    );
    if (showAll) return { columns: relevant, scorable: relevant, hiddenCount: 0 };

    const shown = relevant.filter(
      (m) => m.source === "auto" || (data.totals[m.key] ?? 0) > 0
    );
    return { columns: shown, scorable: relevant, hiddenCount: relevant.length - shown.length };
  }, [data, showAll]);

  const rows = useMemo(() => {
    if (!data) return [];
    const isWorking = (r: TrackerRow) => !r.dormant && r.accountStatus === "active";
    const filtered = data.rows.filter((r) =>
      filter === "working" ? isWorking(r) : filter === "dormant" ? r.dormant : true
    );
    // Highest score first: alphabetical buries both the top and the bottom of
    // the team, which are the two groups a manager is looking for.
    return [...filtered].sort(
      (a, b) =>
        Number(a.dormant) - Number(b.dormant) ||
        b.score - a.score ||
        a.name.localeCompare(b.name)
    );
  }, [data, filter]);

  const currency = data?.org.currency || "AED";
  // name + score + metric columns + edit
  const colSpan = columns.length + 3;

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
            href="/tracker"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-3 w-3" />
            All organisations
          </Link>
          <h2 className="text-2xl font-bold text-foreground">
            {data?.org.name ?? <Skeleton className="inline-block h-7 w-44 align-middle" />} — Daily Tracker
          </h2>
          {data && (
            <p className="mt-1 text-sm text-muted-foreground">
              {data.counts.working} working · {data.counts.dormant} dormant
              {data.counts.deactivated > 0 && ` · ${data.counts.deactivated} deactivated`}
              {" · "}
              {dayLabel(date)} in {tzLabel(data.org.timezone)} time
            </p>
          )}
        </div>
        <DayPicker value={date} timezone={data?.org.timezone} onChange={setDate} />
      </motion.div>

      {isLoading && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-72 w-full rounded-lg" />
        </>
      )}

      {isError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6 text-sm text-destructive">
            {apiErrorMessage(error, "Could not load this organisation")}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* ── Summary ─────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.35 }}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Stat
              label="Team score"
              value={`${data.teamScore}`}
              suffix="/100"
              sub={`${data.counts.reported} of ${data.counts.total} reps filed figures`}
              tone={scoreTone(data.teamScore)}
            />
            <Stat
              label="Working today"
              value={`${data.counts.working}`}
              sub={`of ${data.counts.total} reps · ${data.counts.dormant} dormant`}
            />
            <Stat
              label="Leads contacted"
              value={num(data.totals.leadsContacted ?? 0)}
              sub={`${num(data.totals.followUpsDone ?? 0)} follow-ups`}
            />
            <Stat
              label="Closings"
              value={num(data.totals.closings ?? 0)}
              sub={`${data.totals.convRate ?? 0}% · ${money(data.totals.revenueCollected ?? 0, currency)} collected`}
            />
          </motion.div>

          {/* ── Targets ─────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.35 }}
          >
            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">
                  Team total vs daily target
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Targets are set per organisation — {data.org.name} is measured
                  against its own numbers, in {currency}.
                </p>
              </CardHeader>
              <CardContent className="pt-0">
                {/* scorable, not columns: columns drops anything with a zero
                    total, which would delete every 100%-missed target from the
                    card whose whole job is showing misses. */}
                <TargetProgress
                  metrics={scorable}
                  totals={data.totals}
                  targets={data.targets}
                  achieved={data.achieved}
                  currency={currency}
                />
              </CardContent>
            </Card>
          </motion.div>

          {data.callsUnattributed > 0 && (
            <div className="flex gap-2 rounded-lg border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {data.callsUnattributed} call
                {data.callsUnattributed === 1 ? "" : "s"} could not be credited to a
                rep — the dialer records no operator, so calls are credited via the
                lead they concern and these had none.
              </span>
            </div>
          )}

          {/* ── Rep table ───────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.16, duration: 0.35 }}
          >
            <Card className="border-border/50">
              <CardHeader className="gap-3 pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base font-semibold">Rep breakdown</CardTitle>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Italic columns are typed in; the rest are measured from the CRM.
                      Dormant means no lead activity for {data.dormantAfterDays}+ days.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-lg border border-border/60 bg-card p-0.5">
                      {(
                        [
                          ["all", `All ${data.counts.total}`],
                          ["working", `Working ${data.counts.working}`],
                          ["dormant", `Dormant ${data.counts.dormant}`],
                        ] as [Filter, string][]
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          onClick={() => setFilter(key)}
                          className={cn(
                            "whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                            filter === key
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {(hiddenCount > 0 || showAll) && (
                      <button
                        onClick={() => setShowAll((v) => !v)}
                        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {showAll ? (
                          <>
                            <ChevronUp className="h-3 w-3" /> Hide empty
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3 w-3" /> {hiddenCount} empty
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                {rows.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No reps match this filter.
                  </p>
                ) : (
                  <div
                    // Firefox and Safari cannot scroll an overflow container by
                    // keyboard unless it is focusable, and with every column
                    // shown the middle ones hold nothing focusable at all.
                    tabIndex={0}
                    role="region"
                    aria-label="Rep breakdown, scrolls horizontally"
                    className="overflow-x-auto overscroll-x-contain focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <table className="w-full border-separate border-spacing-0 text-sm">
                      <thead>
                        <tr>
                          {/* Name and Score are both pinned: they are what the
                              table is scanned by, and Score previously sat past
                              the right edge where it was never seen. */}
                          <th
                            scope="col"
                            className="sticky left-0 z-20 w-44 max-w-44 border-b border-border/40 bg-card pb-2 pr-3 text-left font-medium text-muted-foreground"
                          >
                            Sales Rep
                          </th>
                          <th
                            scope="col"
                            className="sticky left-44 z-20 w-20 border-b border-r border-border/40 bg-card pb-2 pl-3 pr-3 text-right font-medium text-muted-foreground"
                          >
                            Score
                          </th>
                          {columns.map((m) => (
                            <th
                              key={m.key}
                              scope="col"
                              title={m.note ?? undefined}
                              className="whitespace-nowrap border-b border-border/40 pb-2 pl-4 text-right font-medium text-muted-foreground"
                            >
                              <span className={cn(m.source === "manual" && "italic")}>
                                {m.label}
                              </span>
                            </th>
                          ))}
                          {/* relative matters: sr-only is position:absolute, and
                              with no positioned ancestor it escapes the scroll
                              container and stretches the document's scrollWidth,
                              giving the whole page a horizontal scrollbar. */}
                          <th
                            scope="col"
                            className="relative border-b border-border/40 pb-2 pl-3"
                          >
                            <span className="sr-only">Edit</span>
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {rows.map((r) => (
                          <Fragment key={r.userId}>
                            <tr
                            className={cn(
                              "group transition-colors hover:bg-muted/30",
                              // No opacity here: it multiplies with every
                              // per-cell alpha, so the reps most worth noticing
                              // become the least legible. The amber rule on the
                              // name cell carries the signal instead.
                              r.dormant && "bg-amber-500/[0.03]"
                            )}
                          >
                            <th
                              scope="row"
                              className={cn(
                                // max-w matters: the table is auto-layout, so a
                                // long name's min-content would push this cell
                                // past 176px and slide under the pinned Score.
                                "sticky left-0 z-10 w-44 max-w-44 border-b border-border/20 bg-card py-2 pr-3 text-left font-normal transition-colors group-hover:bg-muted/30",
                                r.dormant && "border-l-2 border-l-amber-500/40"
                              )}
                            >
                              <Link
                                href={`/tracker/${code}/${r.userId}`}
                                className="block truncate font-medium transition-colors hover:text-primary hover:underline"
                                title={r.name}
                              >
                                {r.name}
                              </Link>
                              {r.dormant && (
                                <span
                                  className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-500"
                                  title={
                                    r.lastActiveOn
                                      ? `Last lead activity ${r.lastActiveOn}`
                                      : "No lead activity in the last 90 days"
                                  }
                                >
                                  <MoonStar className="h-2.5 w-2.5 shrink-0" />
                                  {r.daysSinceActive === null
                                    ? "inactive 90+d"
                                    : `inactive ${r.daysSinceActive}d`}
                                </span>
                              )}

                              {r.accountStatus !== "active" && (
                                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                                  deactivated
                                </span>
                              )}

                              {/* Shown for dormant reps too — a rep who went
                                  quiet is exactly who has a note worth reading,
                                  and actionRequired was being captured at 500
                                  characters and rendered nowhere at all. */}
                              {r.remarks && (
                                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground" title={r.remarks}>
                                  {r.remarks}
                                </span>
                              )}
                              {r.actionRequired && (
                                <span
                                  className="mt-0.5 block truncate text-[10px] text-amber-600 dark:text-amber-500"
                                  title={r.actionRequired}
                                >
                                  ⚑ {r.actionRequired}
                                </span>
                              )}
                            </th>

                            <td className="sticky left-44 z-10 w-20 border-b border-r border-border/20 bg-card py-2 pl-3 pr-3 text-right transition-colors group-hover:bg-muted/30">
                              <span
                                className={cn(
                                  "font-semibold tabular-nums",
                                  scoreTone(r.score)
                                )}
                              >
                                {r.score}
                              </span>
                            </td>

                            {columns.map((m) => {
                              const v = r.values[m.key] ?? 0;
                              return (
                                <td
                                  key={m.key}
                                  className={cn(
                                    "whitespace-nowrap border-b border-border/20 py-2 pl-4 text-right tabular-nums",
                                    !v && "text-muted-foreground/70"
                                  )}
                                >
                                  {m.key === "convRate"
                                    ? `${v}%`
                                    : m.money
                                      ? money(v, currency)
                                      : num(v)}
                                </td>
                              );
                            })}

                            <td className="border-b border-border/20 py-2 pl-3 text-right">
                              <button
                                onClick={() =>
                                  setEditing(editing === r.userId ? null : r.userId)
                                }
                                aria-label={`Enter manual figures for ${r.name}`}
                                aria-expanded={editing === r.userId}
                                className="rounded p-1 text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                            {editing === r.userId && (
                              <EntryEditor
                                row={r}
                                tracker={data}
                                colSpan={colSpan}
                                onClose={() => setEditing(null)}
                              />
                            )}
                          </Fragment>
                        ))}
                      </tbody>
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
