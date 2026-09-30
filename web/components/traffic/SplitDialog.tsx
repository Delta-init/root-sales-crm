"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api, apiErrorMessage } from "@/lib/axios";
import type { CrmPerson, TrafficOrg, TrafficRules, TrafficSegmentKey } from "@/lib/types";

const ORGS: TrafficOrg[] = ["delta", "draw"];
const SEGMENTS: TrafficSegmentKey[] = ["uk", "gcc", "hindi"];

type Draft = {
  paused: boolean;
  /** Delta's percent per segment; Draw has the rest. */
  delta: Record<TrafficSegmentKey, string>;
  /** Who takes each share's leads: a CRM user id, or "" to let the CRM share them out. */
  assign: Record<TrafficSegmentKey, Record<TrafficOrg, string>>;
};

const fromRules = (rules: TrafficRules): Draft => {
  const share = (seg: TrafficSegmentKey, org: TrafficOrg) =>
    rules.segments.find((s) => s.key === seg)?.shares.find((s) => s.org === org);
  return {
    paused: rules.paused,
    delta: Object.fromEntries(SEGMENTS.map((seg) => [seg, String(share(seg, "delta")?.percent ?? 50)])) as Draft["delta"],
    assign: Object.fromEntries(
      SEGMENTS.map((seg) => [seg, { delta: share(seg, "delta")?.assignTo?.id ?? "", draw: share(seg, "draw")?.assignTo?.id ?? "" }]),
    ) as Draft["assign"],
  };
};

/**
 * The split, edited.
 *
 * One number per segment — Delta's percent, with Draw taking the rest — so a
 * split that does not add up to 100 cannot be typed at all. Each share can
 * name one person in that CRM to take its leads; left empty, the CRM shares
 * them out across its teams as it always has.
 */
export function SplitDialog({
  open,
  onOpenChange,
  rules,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rules: TrafficRules;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => fromRules(rules));

  useEffect(() => {
    if (open) setDraft(fromRules(rules));
  }, [open, rules]);

  const peopleQuery = (org: TrafficOrg) => ({
    queryKey: ["traffic-people", org],
    queryFn: async () => (await api.get(`/traffic/crm-users/${org}`)).data.data as CrmPerson[],
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const deltaPeople = useQuery(peopleQuery("delta"));
  const drawPeople = useQuery(peopleQuery("draw"));
  const peopleOf = { delta: deltaPeople, draw: drawPeople };

  const pct = (seg: TrafficSegmentKey) => {
    const n = Number(draft.delta[seg]);
    return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
  };
  const valid = SEGMENTS.every((seg) => pct(seg) !== null);

  const save = useMutation({
    mutationFn: async () => {
      const segments = Object.fromEntries(
        SEGMENTS.map((seg) => [
          seg,
          ORGS.map((org) => ({
            org,
            percent: org === "delta" ? pct(seg)! : 100 - pct(seg)!,
            assignToId: draft.assign[seg][org] || null,
          })),
        ]),
      );
      return api.put("/traffic/rules", { paused: draft.paused, segments });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["traffic-rules"] });
      qc.invalidateQueries({ queryKey: ["traffic-summary"] });
      toast.success("Split saved");
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not save the split")),
  });

  const nameOf = (org: TrafficOrg) => rules.crms.find((c) => c.code === org)?.name ?? org;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Split between the CRMs</DialogTitle>
          <DialogDescription>
            Each segment of the lead sheet is split on its own. Changing a percentage starts a fresh count from
            now; people already in a CRM always go back to it and are not counted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {rules.segments.map((seg) => {
            const deltaPct = pct(seg.key);
            return (
              <div key={seg.key} className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold">{seg.label}</h3>
                  <div className="flex items-center gap-2 text-sm">
                    <label htmlFor={`pct-${seg.key}`} className="text-muted-foreground">{nameOf("delta")}</label>
                    <input
                      id={`pct-${seg.key}`}
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={draft.delta[seg.key]}
                      onChange={(e) => setDraft((d) => ({ ...d, delta: { ...d.delta, [seg.key]: e.target.value } }))}
                      className="w-20 rounded-md border border-border bg-background px-2 py-1 text-right outline-none focus:border-primary"
                    />
                    <span className="text-muted-foreground">%</span>
                    <span className="mx-1 text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{nameOf("draw")}</span>
                    <span className="w-12 text-right font-medium">{deltaPct === null ? "—" : `${100 - deltaPct}%`}</span>
                  </div>
                </div>
                {deltaPct === null && <p className="text-xs text-rose-500">A whole number from 0 to 100.</p>}

                <div className="grid gap-3 sm:grid-cols-2">
                  {ORGS.map((org) => {
                    const q = peopleOf[org];
                    const current = seg.shares.find((s) => s.org === org)?.assignTo;
                    return (
                      <div key={org} className="space-y-1">
                        <label htmlFor={`to-${seg.key}-${org}`} className="text-xs text-muted-foreground">
                          {nameOf(org)} leads go to
                        </label>
                        <select
                          id={`to-${seg.key}-${org}`}
                          value={draft.assign[seg.key][org]}
                          disabled={q.isLoading}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, assign: { ...d.assign, [seg.key]: { ...d.assign[seg.key], [org]: e.target.value } } }))
                          }
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                        >
                          <option value="">Shared out by {nameOf(org)}&apos;s teams</option>
                          {/* Keep the current choice visible even before the list arrives. */}
                          {current && !q.data?.some((p) => p.id === current.id) && (
                            <option value={current.id}>{current.name || current.id}</option>
                          )}
                          {(q.data ?? []).map((p) => (
                            <option key={p.id} value={p.id}>{p.name}{p.email ? ` — ${p.email}` : ""}</option>
                          ))}
                        </select>
                        {q.isError && <p className="text-xs text-amber-500">Could not load {nameOf(org)}&apos;s people just now.</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <label className="flex items-start gap-3 rounded-lg border border-border p-4 text-sm">
            <input
              type="checkbox"
              checked={draft.paused}
              onChange={(e) => setDraft((d) => ({ ...d, paused: e.target.checked }))}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-medium">Pause routing</span>
              <span className="block text-muted-foreground">
                New leads are still taken from the sheet and decided, but wait here until routing is resumed.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Save split
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
