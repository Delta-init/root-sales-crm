"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { CrmPerson, TrafficOrg, TrafficRules, TrafficSheetRules } from "@/lib/types";

type TeamDraft = {
  /** Kept for a team already in the split, so it keeps its count; none for one being added. */
  key?: string;
  /** React's key for the row, which a new team does not have yet. */
  row: string;
  name: string;
  org: TrafficOrg;
  percent: string;
  /** A CRM user id, or "" to let the CRM share the leads out. */
  assignToId: string;
};

type Draft = { paused: boolean; segments: Record<string, TeamDraft[]> };

let rows = 0;
const nextRow = () => `new-${++rows}`;

const fromSheet = (sheet: TrafficSheetRules): Draft => ({
  paused: sheet.paused,
  segments: Object.fromEntries(
    sheet.segments.map((seg) => [
      seg.key,
      seg.shares.map((s) => ({
        key: s.key,
        row: s.key,
        name: s.name,
        org: s.org,
        percent: String(s.percent),
        assignToId: s.assignTo?.id ?? "",
      })),
    ]),
  ),
});

/** A percent as typed, in hundredths; null when it is not 0–100 to two decimals. */
const hundredths = (typed: string): number | null => {
  const t = typed.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const n = Math.round(Number(t) * 100);
  return n <= 10_000 ? n : null;
};

/** What is wrong with a segment's teams, or null. */
function problemWith(teams: TeamDraft[]): string | null {
  if (!teams.length) return "Needs at least one team.";
  if (teams.some((t) => !t.name.trim())) return "Every team needs a name.";
  const names = teams.map((t) => t.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) return "Two teams have the same name.";
  if (teams.some((t) => hundredths(t.percent) === null)) return "Percentages are 0 to 100, to two decimals at most.";
  const total = teams.reduce((n, t) => n + (hundredths(t.percent) ?? 0), 0);
  if (total !== 10_000) return `Adds up to ${(total / 100).toFixed(2)}%, not 100%.`;
  return null;
}

/**
 * One sheet's split, edited.
 *
 * Each segment of the sheet is a list of teams: a name, the CRM its leads go
 * into, its percent, and optionally one person in that CRM who takes them
 * all. Two teams can go into the same CRM — Shoaib's sheet has the Delta sales
 * team's pool and the Dilshad team, whose leads go straight to Nusra in Delta
 * until it has a CRM of its own. The percentages have to add up to 100 before
 * it can be saved.
 */
export function SplitDialog({
  open,
  onOpenChange,
  sheet,
  crms,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheet: TrafficSheetRules;
  crms: TrafficRules["crms"];
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => fromSheet(sheet));

  useEffect(() => {
    if (open) setDraft(fromSheet(sheet));
  }, [open, sheet]);

  // Every CRM the portal can send to, with its people — only once they are
  // wanted, and only from a CRM that is set up to be read.
  const ORGS = crms.map((c) => c.code);
  const ready = (org: TrafficOrg) => crms.some((c) => c.code === org && c.active && c.missing.length === 0);
  const peopleQueries = useQueries({
    queries: ORGS.map((org) => ({
      queryKey: ["traffic-people", org],
      queryFn: async () => (await api.get(`/traffic/crm-users/${org}`)).data.data as CrmPerson[],
      enabled: open && ready(org),
      staleTime: 5 * 60_000,
    })),
  });
  const peopleOf = (org: TrafficOrg) => peopleQueries[ORGS.indexOf(org)];

  const nameOf = (org: TrafficOrg) => crms.find((c) => c.code === org)?.name ?? org;
  const valid = sheet.segments.every((seg) => problemWith(draft.segments[seg.key] ?? []) === null);

  const setTeams = (seg: string, fn: (teams: TeamDraft[]) => TeamDraft[]) =>
    setDraft((d) => ({ ...d, segments: { ...d.segments, [seg]: fn(d.segments[seg] ?? []) } }));
  const setTeam = (seg: string, row: string, patch: Partial<TeamDraft>) =>
    setTeams(seg, (teams) => teams.map((t) => (t.row === row ? { ...t, ...patch } : t)));

  const save = useMutation({
    mutationFn: async () => {
      const segments = Object.fromEntries(
        sheet.segments.map((seg) => [
          seg.key,
          (draft.segments[seg.key] ?? []).map((t) => ({
            ...(t.key ? { key: t.key } : {}),
            name: t.name.trim(),
            org: t.org,
            percent: hundredths(t.percent)! / 100,
            assignToId: t.assignToId || null,
          })),
        ]),
      );
      return api.put(`/traffic/rules/${sheet.key}`, { paused: draft.paused, segments });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["traffic-rules"] });
      qc.invalidateQueries({ queryKey: ["traffic-summary"] });
      qc.invalidateQueries({ queryKey: ["traffic-leads"] });
      toast.success("Split saved");
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not save the split")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Split · {sheet.name}</DialogTitle>
          <DialogDescription>
            Each segment is split on its own. Changing a percentage, or adding or removing a team, starts that
            segment&apos;s count again from now. People already in a CRM always go back to it and are not counted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {sheet.segments.map((seg) => {
            const teams = draft.segments[seg.key] ?? [];
            const problem = problemWith(teams);
            const total = teams.reduce((n, t) => n + (hundredths(t.percent) ?? 0), 0);
            const current = (key?: string) => seg.shares.find((s) => s.key === key)?.assignTo ?? null;
            return (
              <div key={seg.key} className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{seg.label}</h3>
                  <span className={cn("text-sm", total === 10_000 ? "text-emerald-500" : "text-rose-500")}>
                    Total {(total / 100).toFixed(2).replace(/\.00$/, "")}%
                  </span>
                </div>

                <div className="space-y-3">
                  {teams.map((t) => {
                    const q = peopleOf(t.org);
                    const kept = current(t.key);
                    return (
                      <div
                        key={t.row}
                        className="grid gap-2 rounded-md bg-muted/40 p-2 sm:grid-cols-[minmax(0,1fr)_7.5rem_6rem_minmax(0,1.3fr)_auto] sm:items-center sm:bg-transparent sm:p-0"
                      >
                        <input
                          aria-label="Team name"
                          value={t.name}
                          maxLength={60}
                          placeholder="Team name"
                          onChange={(e) => setTeam(seg.key, t.row, { name: e.target.value })}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                        />
                        <select
                          aria-label="CRM"
                          value={t.org}
                          // A person belongs to one CRM, so moving the team clears who takes its leads.
                          onChange={(e) => setTeam(seg.key, t.row, { org: e.target.value as TrafficOrg, assignToId: "" })}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                        >
                          {ORGS.map((org) => (
                            <option key={org} value={org}>{nameOf(org)}{ready(org) ? "" : " — not set up"}</option>
                          ))}
                        </select>
                        <div className="flex items-center gap-1">
                          <input
                            aria-label="Percent"
                            inputMode="decimal"
                            value={t.percent}
                            onChange={(e) => setTeam(seg.key, t.row, { percent: e.target.value })}
                            className={cn(
                              "w-full rounded-md border bg-background px-2 py-1.5 text-right text-sm outline-none focus:border-primary",
                              hundredths(t.percent) === null ? "border-rose-500" : "border-border",
                            )}
                          />
                          <span className="text-sm text-muted-foreground">%</span>
                        </div>
                        <select
                          aria-label="Leads go to"
                          value={t.assignToId}
                          disabled={q?.isLoading}
                          onChange={(e) => setTeam(seg.key, t.row, { assignToId: e.target.value })}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                        >
                          <option value="">Shared out by the CRM</option>
                          {/* Keep the current choice visible even before the list arrives. */}
                          {kept && t.assignToId === kept.id && !q?.data?.some((p) => p.id === kept.id) && (
                            <option value={kept.id}>{kept.name || kept.id}</option>
                          )}
                          {(q?.data ?? []).map((p) => (
                            <option key={p.id} value={p.id}>{p.name}{p.email ? ` — ${p.email}` : ""}</option>
                          ))}
                        </select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="justify-self-end sm:justify-self-auto"
                          aria-label={`Remove ${t.name || "team"}`}
                          disabled={teams.length <= 1}
                          onClick={() => setTeams(seg.key, (list) => list.filter((x) => x.row !== t.row))}
                        >
                          <X />
                        </Button>
                        {q?.isError && (
                          <p className="text-xs text-amber-500 sm:col-span-5">Could not load {nameOf(t.org)}&apos;s people just now.</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={teams.length >= 10}
                    onClick={() => setTeams(seg.key, (list) => [
                      ...list,
                      { row: nextRow(), name: "", org: "delta", percent: "0", assignToId: "" },
                    ])}
                  >
                    <Plus /> Add team
                  </Button>
                  {problem && <p className="text-xs text-rose-500">{problem}</p>}
                </div>
                <p className="text-xs text-muted-foreground">Each CRM records these leads&apos; source as {seg.source}.</p>
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
              <span className="font-medium">Pause routing for this sheet</span>
              <span className="block text-muted-foreground">
                New leads are still taken from the sheet and decided, but wait here until routing is resumed.
                Other sheets carry on.
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
