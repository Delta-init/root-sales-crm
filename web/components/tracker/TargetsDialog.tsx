"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, apiErrorMessage } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { MetricDef, TargetsDetail } from "@/lib/types";

/**
 * Per-org daily target editor.
 *
 * Targets are what ACHIEVED % and the daily score are measured against, so
 * until an org sets its own it is being judged by the source sheet's numbers —
 * an 18-rep Dubai desk billing in AED. That is why Banglore reported 753% of a
 * leads target nobody chose for it, and why this dialog leads with whether the
 * numbers on screen are the org's own or inherited.
 */
export function TargetsDialog({
  open,
  onOpenChange,
  orgCode,
  orgName,
  currency,
  workingReps,
  metrics,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgCode: string;
  orgName: string;
  currency: string;
  /** Used to show the per-rep share, which is what a rep is actually scored on. */
  workingReps: number;
  metrics: MetricDef[];
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["tracker-targets", orgCode],
    queryFn: async () =>
      (await api.get(`/tracker/targets/${orgCode}`)).data.data as TargetsDetail,
    enabled: open,
  });

  // Seed the form once the server answers, and re-seed whenever the dialog is
  // reopened so a cancelled edit does not persist into the next visit.
  useEffect(() => {
    if (data && open) {
      setDraft(Object.fromEntries(Object.entries(data.metrics).map(([k, v]) => [k, String(v)])));
    }
  }, [data, open]);

  const save = useMutation({
    mutationFn: async () => {
      const parsed: Record<string, number> = {};
      for (const [k, v] of Object.entries(draft)) {
        const n = Number(v);
        // A blank field means "no target", which the scorer already treats as
        // "not measured" — so store 0 rather than refusing to save.
        parsed[k] = Number.isFinite(n) && n > 0 ? n : 0;
      }
      return api.put(`/tracker/targets/${orgCode}`, { metrics: parsed });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracker-targets", orgCode] });
      qc.invalidateQueries({ queryKey: ["tracker-org", orgCode] });
      qc.invalidateQueries({ queryKey: ["tracker-group"] });
      qc.invalidateQueries({ queryKey: ["tracker-user"] });
      toast.success(`Targets saved for ${orgName}`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not save targets")),
  });

  const groups = useMemo(() => {
    const out = new Map<string, MetricDef[]>();
    for (const m of metrics) {
      // convRate is derived from closings and contacts; pendingPayments is a
      // running balance rather than a day's output. Neither is something a
      // team sets out to hit.
      if (m.computed || m.snapshot) continue;
      out.set(m.group, [...(out.get(m.group) ?? []), m]);
    }
    return Array.from(out.entries());
  }, [metrics]) as [string, MetricDef[]][];

  const dirty =
    data && Object.entries(draft).some(([k, v]) => Number(v || 0) !== (data.metrics[k] ?? 0));

  const perRep = (v: string, key: string) => {
    const n = Number(v || 0);
    if (!n) return null;
    // A rate is not divisible across people; everything else is.
    if (key === "convRate") return `${n}% each`;
    const share = n / Math.max(1, workingReps);
    return `${share % 1 === 0 ? share : share.toFixed(1)} per rep`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Daily targets — {orgName}</DialogTitle>
          <DialogDescription>
            The whole desk&apos;s target for one day. Each rep is scored against
            their share of it, split across the {workingReps} currently working.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {data && !data.isCustom && (
              <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span className="text-muted-foreground">
                  {orgName} has never set its own targets and is being measured
                  against the source spreadsheet&apos;s numbers — an 18-rep Dubai
                  desk billing in AED. Saving here replaces them.
                </span>
              </div>
            )}

            <div className="space-y-5">
              {groups.map(([group, items]) => (
                <div key={group}>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {group}
                  </p>
                  <div className="space-y-2">
                    {items.map((m) => {
                      const value = draft[m.key] ?? "";
                      const share = perRep(value, m.key);
                      const def = data?.defaults[m.key];
                      return (
                        <div key={m.key} className="flex items-center gap-3">
                          <label
                            htmlFor={`target-${m.key}`}
                            className="flex-1 text-sm"
                            title={m.note ?? undefined}
                          >
                            <span className={cn(m.source === "manual" && "italic")}>
                              {m.label}
                            </span>
                            {m.money && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                ({currency})
                              </span>
                            )}
                            {m.source === "manual" && (
                              <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                                entered
                              </span>
                            )}
                          </label>

                          <span className="hidden w-28 shrink-0 text-right text-[11px] text-muted-foreground sm:block">
                            {share}
                          </span>

                          <input
                            id={`target-${m.key}`}
                            type="number"
                            min={0}
                            step={m.money ? 1000 : 1}
                            value={value}
                            placeholder={def !== undefined ? String(def) : "0"}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, [m.key]: e.target.value }))
                            }
                            className="w-28 shrink-0 rounded-md border border-border bg-background px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-primary"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <button
            type="button"
            onClick={() =>
              data &&
              setDraft(
                Object.fromEntries(
                  Object.entries(data.defaults).map(([k, v]) => [k, String(v)])
                )
              )
            }
            disabled={!data}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to sheet defaults
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending || !dirty}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {save.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              {dirty ? "Save targets" : "No changes"}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
