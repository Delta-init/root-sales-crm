"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowLeft, Info, Loader2, Pencil, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/axios";
import { cn } from "@/lib/utils";
import { DayPicker, gulfToday } from "@/components/tracker/DayPicker";
import type { OrgTracker, TrackerRow } from "@/lib/types";

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);

const pctTone = (pct: number | null) => {
  if (pct === null || pct === undefined) return "text-muted-foreground";
  if (pct >= 100) return "text-emerald-500";
  if (pct >= 50) return "text-amber-500";
  return "text-rose-500";
};

/** Inline editor for the columns the CRM cannot source. */
function EntryEditor({
  row,
  tracker,
  onClose,
}: {
  row: TrackerRow;
  tracker: OrgTracker;
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
      <td colSpan={99} className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium">
            {row.name}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              entered figures for {tracker.date}
            </span>
          </p>
          <button
            onClick={onClose}
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

  useEffect(() => setEditing(null), [date]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["tracker-org", code, date],
    queryFn: async () =>
      (await api.get(`/tracker/org/${code}?date=${date}`)).data.data as OrgTracker,
  });

  // Columns worth showing for this org: hide calls where the org does not log
  // them, rather than printing a column of zeros that looks like idleness.
  const columns = useMemo(() => {
    if (!data) return [];
    return data.metrics.filter(
      (m) => !m.reliableIn || m.reliableIn.includes(data.org.code)
    );
  }, [data]);

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
            {data?.org.name ?? code} — Daily Tracker
          </h2>
          {data && (
            <p className="mt-1 text-muted-foreground">
              {data.rows.length} active reps · team score{" "}
              <span className="font-semibold text-foreground">{data.teamScore}</span>
              /100 · days cut in {data.org.timezone.replace("Asia/", "")} time
            </p>
          )}
        </div>
        <DayPicker value={date} onChange={setDate} />
      </motion.div>

      {data && data.callsUnattributed > 0 && (
        <Card className="border-border/50 bg-muted/30">
          <CardContent className="flex gap-2 pt-4 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {data.callsUnattributed} call{data.callsUnattributed === 1 ? "" : "s"} logged
              today could not be credited to a rep — the dialer records no operator, so
              calls are credited via the lead they concern and these had none.
            </span>
          </CardContent>
        </Card>
      )}

      {isLoading && <Skeleton className="h-96 w-full rounded-lg" />}

      {isError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6 text-sm text-destructive">
            {apiErrorMessage(error, "Could not load this organisation")}
          </CardContent>
        </Card>
      )}

      {data && (
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Rep breakdown</CardTitle>
            <p className="text-xs text-muted-foreground">
              Columns marked <span className="font-medium">entered</span> are typed in;
              everything else is measured from the CRM and cannot be edited.
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-border/40 text-left">
                    <th className="sticky left-0 bg-card pb-2 pr-3 font-medium text-muted-foreground">
                      Sales Rep
                    </th>
                    {columns.map((m) => (
                      <th
                        key={m.key}
                        className="pb-2 pl-3 text-right font-medium text-muted-foreground"
                        title={m.note ?? undefined}
                      >
                        <span className={cn(m.source === "manual" && "italic")}>
                          {m.label}
                        </span>
                      </th>
                    ))}
                    <th className="pb-2 pl-3 text-right font-medium text-muted-foreground">
                      Score
                    </th>
                    <th className="pb-2 pl-3" />
                  </tr>
                </thead>

                <tbody>
                  {data.rows.map((r) => (
                    <>
                      <tr key={r.userId} className="border-b border-border/20">
                        <td className="sticky left-0 bg-card py-2 pr-3">
                          <Link
                            href={`/tracker/${code}/${r.userId}`}
                            className="font-medium transition-colors hover:text-primary hover:underline"
                          >
                            {r.name}
                          </Link>
                          {r.remarks && (
                            <div className="text-[10px] text-muted-foreground">
                              {r.remarks}
                            </div>
                          )}
                        </td>
                        {columns.map((m) => (
                          <td
                            key={m.key}
                            className={cn(
                              "py-2 pl-3 text-right tabular-nums",
                              !r.values[m.key] && "text-muted-foreground/50"
                            )}
                          >
                            {m.key === "convRate"
                              ? `${r.values[m.key] ?? 0}%`
                              : m.money
                                ? money(r.values[m.key] ?? 0, data.org.currency)
                                : (r.values[m.key] ?? 0)}
                          </td>
                        ))}
                        <td className="py-2 pl-3 text-right font-semibold tabular-nums">
                          {r.score}
                        </td>
                        <td className="py-2 pl-3 text-right">
                          <button
                            onClick={() =>
                              setEditing(editing === r.userId ? null : r.userId)
                            }
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="Enter manual figures"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                      {editing === r.userId && (
                        <EntryEditor
                          key={`${r.userId}-edit`}
                          row={r}
                          tracker={data}
                          onClose={() => setEditing(null)}
                        />
                      )}
                    </>
                  ))}
                </tbody>

                <tfoot>
                  <tr className="border-t-2 border-border/60 font-semibold">
                    <td className="sticky left-0 bg-card py-2 pr-3">TEAM TOTAL</td>
                    {columns.map((m) => (
                      <td key={m.key} className="py-2 pl-3 text-right tabular-nums">
                        {m.key === "convRate"
                          ? `${data.totals[m.key] ?? 0}%`
                          : m.money
                            ? money(data.totals[m.key] ?? 0, data.org.currency)
                            : (data.totals[m.key] ?? 0)}
                      </td>
                    ))}
                    <td className="py-2 pl-3 text-right">{data.teamScore}</td>
                    <td />
                  </tr>
                  <tr className="text-xs text-muted-foreground">
                    <td className="sticky left-0 bg-card py-1.5 pr-3">DAILY TARGET</td>
                    {columns.map((m) => (
                      <td key={m.key} className="py-1.5 pl-3 text-right tabular-nums">
                        {data.targets[m.key]
                          ? m.money
                            ? money(data.targets[m.key], data.org.currency)
                            : data.targets[m.key]
                          : "—"}
                      </td>
                    ))}
                    <td className="py-1.5 pl-3 text-right">—</td>
                    <td />
                  </tr>
                  <tr className="text-xs">
                    <td className="sticky left-0 bg-card py-1.5 pr-3 text-muted-foreground">
                      ACHIEVED %
                    </td>
                    {columns.map((m) => {
                      const pct = data.achieved[m.key];
                      return (
                        <td
                          key={m.key}
                          className={cn(
                            "py-1.5 pl-3 text-right tabular-nums",
                            pctTone(pct ?? null)
                          )}
                        >
                          {pct === null || pct === undefined ? "—" : `${pct}%`}
                        </td>
                      );
                    })}
                    <td />
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
