"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, History, Save, Sparkles, Trash2 } from "lucide-react";
import { AxiosError } from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/axios";
import { PlanEditor, draftMonths, type DraftBody } from "@/components/mentor-kpis/PlanEditor";
import { dubaiWhen, monthLabel, type KpiPlan, type PlansOverview, type PortalSettings } from "@/components/mentor-kpis/types";

/**
 * The mentor KPI plan (the user, 2026-11-09: "edit only from Root"). With no draft: the plan in force, read only,
 * and a way to start one. With a draft: everything editable — weights and targets by slider or typed, categories,
 * subcategories and KPIs added, renamed or removed, targets suggested from the last three months — then approved,
 * from this month or a later one. Earlier months keep the plan they had; every version is kept.
 */

const bodyOf = (p: KpiPlan): DraftBody => ({
  from: p.from, categories: p.categories, targets: p.targets, overrides: p.overrides, note: p.note,
});
const problemsOf = (e: unknown): string[] => {
  if (!(e instanceof AxiosError)) return [];
  const d = e.response?.data as { message?: string; errors?: { problems?: string[] } } | undefined;
  return d?.errors?.problems ?? (d?.message ? [d.message] : []);
};
const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";

export default function MentorKpiPlanPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["mentor-kpis", "plans"],
    queryFn: async () => (await api.get("/mentor-kpis/plans")).data.data as PlansOverview,
  });
  const data = q.data;
  const [body, setBody] = useState<DraftBody | null>(null);
  const [dirty, setDirty] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [startFrom, setStartFrom] = useState(draftMonths()[1]);
  const [startWith, setStartWith] = useState<"in_force" | "default">("in_force");

  // The editor holds its own copy of the draft; a fresh draft from the server replaces it when nothing is unsaved.
  useEffect(() => {
    if (data?.draft && !dirty) setBody(bodyOf(data.draft));
    if (!data?.draft) setBody(null);
  }, [data?.draft, dirty]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["mentor-kpis"] });
  const fail = (e: unknown) => { setProblems(problemsOf(e)); toast.error(apiErrorMessage(e, "Refused")); refresh(); };
  /** Keep the page's copy of the draft what the server holds, so a later refusal can't put an older one back. */
  const keep = (d: KpiPlan) => {
    qc.setQueryData<PlansOverview>(["mentor-kpis", "plans"], (old) => (old ? { ...old, draft: d } : old));
    setBody(bodyOf(d));
    setDirty(false);
  };
  const save = async () => {
    if (!body) return null;
    const r = await api.put("/mentor-kpis/plans/draft", body);
    const saved = r.data.data as KpiPlan;
    keep(saved);
    setProblems([]);
    return saved;
  };

  const start = useMutation({
    mutationFn: async () => (await api.post("/mentor-kpis/plans/draft", { from: startFrom, start: startWith })).data.data as KpiPlan,
    onSuccess: (d) => { keep(d); toast.success(`Draft started, from ${monthLabel(d.from)}`); refresh(); },
    onError: fail,
  });
  const saveM = useMutation({
    mutationFn: save,
    onSuccess: () => { toast.success("Draft saved"); refresh(); },
    onError: fail,
  });
  const suggest = useMutation({
    mutationFn: async () => {
      if (dirty) await save();
      return (await api.post("/mentor-kpis/plans/draft/suggest-targets")).data.data as { draft: KpiPlan; suggested: number; months: string[] };
    },
    onSuccess: (r) => {
      keep(r.draft); setProblems([]);
      toast.success(`${r.suggested} targets suggested from ${r.months.map((m) => monthLabel(m)).join(", ")}`);
      refresh();
    },
    onError: fail,
  });
  const approve = useMutation({
    mutationFn: async () => {
      if (dirty) await save();
      return (await api.post("/mentor-kpis/plans/draft/approve")).data.data as KpiPlan;
    },
    onSuccess: (p) => { setProblems([]); setDirty(false); toast.success(`Plan approved — it applies from ${monthLabel(p.from)}`); refresh(); },
    onError: fail,
  });
  const discard = useMutation({
    mutationFn: async () => (await api.delete("/mentor-kpis/plans/draft")).data,
    onSuccess: () => { setBody(null); setDirty(false); setProblems([]); toast.success("Draft discarded"); refresh(); },
    onError: fail,
  });
  const busy = start.isPending || saveM.isPending || suggest.isPending || approve.isPending || discard.isPending;
  const portal = useQuery({
    queryKey: ["mentor-kpis", "settings"],
    queryFn: async () => (await api.get("/mentor-kpis/settings")).data.data as PortalSettings,
  });
  const togglePortal = useMutation({
    mutationFn: async (open: boolean) => (await api.put("/mentor-kpis/settings", { portalOpen: open })).data.data as PortalSettings,
    onSuccess: (s) => { toast.success(s.open ? "Open to the CS Portal — 60 days' observation started" : "Closed to the CS Portal"); refresh(); },
    onError: fail,
  });

  if (q.isLoading) return <Skeleton className="h-72 w-full" />;
  if (q.isError || !data) {
    return <Card><CardContent className="flex items-center gap-2 pt-6 text-sm text-red-500"><AlertTriangle className="h-4 w-4" />{apiErrorMessage(q.error)}</CardContent></Card>;
  }

  const draft = data.draft;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-4 text-sm">
          <span className="font-medium">CS Portal</span>
          {portal.data?.open ? (
            <>
              <Badge variant="success">Open</Badge>
              <span className="text-muted-foreground">
                Since {dubaiWhen(portal.data.since)}; observation until {dubaiWhen(portal.data.observationUntil)}. Mentors see their own; chiefs, CS Managers and admins their reach.
              </span>
              <span className="flex-1" />
              <Button size="sm" variant="outline" disabled={togglePortal.isPending}
                onClick={() => { if (confirm("Close Mentor KPIs to the CS Portal? Mentors and chiefs stop seeing them.")) togglePortal.mutate(false); }}>Close</Button>
            </>
          ) : (
            <>
              <Badge variant="secondary">Closed</Badge>
              <span className="text-muted-foreground">Only root admins see Mentor KPIs. Opening starts 60 days&apos; observation — not used for pay.</span>
              <span className="flex-1" />
              <Button size="sm" disabled={togglePortal.isPending || !data.inForce}
                title={data.inForce ? "" : "Approve a plan first"}
                onClick={() => { if (confirm("Open Mentor KPIs to the CS Portal for everyone? The 60-day observation starts today.")) togglePortal.mutate(true); }}>Open to the CS Portal</Button>
            </>
          )}
        </CardContent>
      </Card>
      {draft && body ? (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 pt-4">
              <Badge variant="warning">Draft</Badge>
              <span className="text-sm">Applies from</span>
              <select
                value={body.from}
                onChange={(e) => { setBody({ ...body, from: e.target.value }); setDirty(true); }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                aria-label="Applies from"
              >
                {draftMonths().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
              <span className="text-xs text-muted-foreground">
                Started by {draft.createdBy}; last saved {when(draft.updatedAt)}{dirty ? " — unsaved changes" : ""}
              </span>
              <div className="flex-1" />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => suggest.mutate()} title="Each role's typical month over the last three, per KPI Root can measure">
                <Sparkles className="mr-1.5 h-4 w-4" />Suggest targets
              </Button>
              <Button size="sm" variant="outline" disabled={busy || !dirty} onClick={() => saveM.mutate()}>
                <Save className="mr-1.5 h-4 w-4" />Save draft
              </Button>
              <Button size="sm" disabled={busy} onClick={() => approve.mutate()}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" />Approve
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (confirm("Discard this draft? The plan in force stays as it is.")) discard.mutate(); }} aria-label="Discard draft">
                <Trash2 className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
          {problems.length > 0 && (
            <Card className="border-red-500/40">
              <CardContent className="space-y-1 pt-4 text-sm">
                <p className="flex items-center gap-1.5 font-medium text-red-500"><AlertTriangle className="h-4 w-4" />Not yet — {problems.length === 1 ? "one thing" : `${problems.length} things`} to fix</p>
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {problems.slice(0, 12).map((p) => <li key={p}>{p}</li>)}
                  {problems.length > 12 && <li>…and {problems.length - 12} more</li>}
                </ul>
              </CardContent>
            </Card>
          )}
          <PlanEditor
            plan={body}
            metrics={data.metrics}
            roles={data.roles}
            basisMonths={draft.targetsBasis}
            onChange={(next) => { setBody(next); setDirty(true); }}
          />
          <Card>
            <CardContent className="space-y-1.5 pt-4">
              <label htmlFor="kpi-note" className="text-sm font-medium">Note</label>
              <textarea
                id="kpi-note" value={body.note} maxLength={500} rows={2}
                onChange={(e) => { setBody({ ...body, note: e.target.value }); setDirty(true); }}
                placeholder="What changed and why — kept with this version"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Change the plan</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <span className="text-sm">Start a draft that applies from</span>
              <select value={startFrom} onChange={(e) => setStartFrom(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Applies from">
                {draftMonths().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
              <span className="text-sm">starting from</span>
              <select value={startWith} onChange={(e) => setStartWith(e.target.value as typeof startWith)} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Starting from">
                {data.inForce && <option value="in_force">the plan in force</option>}
                <option value="default">the approved structure, no targets</option>
              </select>
              <Button size="sm" disabled={busy} onClick={() => start.mutate()}>Start draft</Button>
              <p className="w-full text-xs text-muted-foreground">Nothing changes until the draft is approved. Earlier months keep the plan they had.</p>
            </CardContent>
          </Card>
          {data.inForce ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="success">In force</Badge>
                From {monthLabel(data.inForce.from)} · approved by {data.inForce.approvedBy} on {when(data.inForce.approvedAt)}
              </div>
              {data.inForce.note && <p className="text-sm text-muted-foreground">{data.inForce.note}</p>}
              <PlanEditor plan={bodyOf(data.inForce)} metrics={data.metrics} roles={data.roles} readOnly />
            </>
          ) : (
            <Card><CardContent className="pt-6 text-sm text-muted-foreground">No plan has been approved yet, so no mentor is scored. Start a draft from the approved structure, suggest its targets, and approve it.</CardContent></Card>
          )}
        </>
      )}

      {data.versions.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" />Versions</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">From</th><th className="py-1 font-medium">State</th><th className="py-1 font-medium">Approved</th><th className="py-1 font-medium">Note</th></tr></thead>
              <tbody>
                {data.versions.map((v) => (
                  <tr key={v.id} className="border-t">
                    <td className="py-1.5">{monthLabel(v.from)}</td>
                    <td className="py-1.5">
                      {v.status === "superseded"
                        ? <Badge variant="secondary">Replaced {when(v.supersededAt)}</Badge>
                        : v.id === data.inForce?.id ? <Badge variant="success">In force</Badge> : <Badge variant="outline">{v.from > data.month ? "Starts later" : "Earlier"}</Badge>}
                    </td>
                    <td className="py-1.5 text-muted-foreground">{v.approvedBy} · {when(v.approvedAt)}</td>
                    <td className="py-1.5 text-muted-foreground">{v.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
