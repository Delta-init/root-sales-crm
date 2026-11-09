"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ArrowDown, ArrowUp, Lock, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/axios";
import { cn } from "@/lib/utils";
import {
  CATEGORY_COLOURS, QUALITY_LABEL, SOURCE_SHORT, dubaiWhen, fmtScore, fmtValue, monthLabel, pct1, scoreBar, scoreMonths, scoreTone,
  type KpiResult, type KpiSource, type MentorDetail,
} from "@/components/mentor-kpis/types";

/**
 * One mentor's month (2026-11-09): every KPI's value against its target and the points it earned, up through the
 * subcategories and categories to the total; which systems knew them; and their last three months.
 */

const SOURCES: KpiSource[] = ["lms", "cs_portal", "hrms"];

export default function MentorKpiDetailPage() {
  const params = useParams<{ month: string; email: string }>();
  const router = useRouter();
  const month = params.month;
  const email = decodeURIComponent(params.email);
  const q = useQuery({
    queryKey: ["mentor-kpis", "mentor", email, month],
    queryFn: async () => (await api.get("/mentor-kpis/scores/mentor", { params: { email, month } })).data.data as MentorDetail,
  });
  const d = q.data;
  const [fixing, setFixing] = useState<KpiResult | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/mentor-kpis" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All mentors
        </Link>
        <div className="flex-1" />
        <select
          value={month}
          onChange={(e) => router.push(`/mentor-kpis/${e.target.value}/${encodeURIComponent(email)}`)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Month"
        >
          {scoreMonths().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : q.isError || !d ? (
        <Card><CardContent className="flex items-center gap-2 pt-6 text-sm text-red-500"><AlertTriangle className="h-4 w-4" />{apiErrorMessage(q.error, "Could not load this mentor")}</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardContent className="flex flex-wrap items-center gap-6 pt-5">
                <div>
                  <p className="text-lg font-semibold">{d.mentor.name}</p>
                  <p className="text-sm text-muted-foreground">{d.mentor.roleLabel} · {d.mentor.email}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {SOURCES.map((s) => (
                      <Badge key={s} variant={d.mentor.quality[s] === "complete" ? "success" : "warning"}>
                        {SOURCE_SHORT[s]}: {QUALITY_LABEL[d.mentor.quality[s]]}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex-1" />
                <div className="text-right">
                  <p className={cn("text-4xl font-semibold tabular-nums", scoreTone(d.mentor.score))}>{fmtScore(d.mentor.score)}</p>
                  <p className="text-xs text-muted-foreground">
                    {monthLabel(month)} · {d.mentor.coverage}% of the plan scored{d.elapsed < 100 ? ` · ${d.elapsed}% of the month gone` : ""}
                  </p>
                  <p className="mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                    {d.snapshot ? <><Lock className="h-3 w-3" />Frozen, version {d.snapshot.version}</> : "Live — not frozen"}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-2 pt-5">
                <p className="text-xs text-muted-foreground">Last three months</p>
                <div className="flex h-24 items-end gap-3">
                  {d.trend.map((t) => (
                    <div key={t.month} className="flex flex-1 flex-col items-center gap-1">
                      <span className={cn("text-xs tabular-nums", scoreTone(t.score))}>{fmtScore(t.score)}</span>
                      <div className="flex h-16 w-full items-end rounded bg-muted/50">
                        <div className={cn("w-full rounded", scoreBar(t.score))} style={{ height: `${t.score ?? 0}%` }} />
                      </div>
                      <span className="text-[11px] text-muted-foreground">{monthLabel(t.month).split(" ")[0].slice(0, 3)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">Each month with the plan approved for it; — where no plan covered it.</p>
              </CardContent>
            </Card>
          </div>

          {d.mentor.categories.map((c, ci) => (
            <Card key={c.key}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLOURS[ci % CATEGORY_COLOURS.length] }} />
                  {c.name}
                  <span className="text-sm font-normal text-muted-foreground">{c.weight}% of the score</span>
                  <span className="flex-1" />
                  <span className={cn("tabular-nums", scoreTone(c.score))}>{fmtScore(c.score)}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {c.subs.map((s) => (
                  <div key={s.key} className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-xs text-muted-foreground">{pct1(s.share)} of the score</span>
                      <span className="flex-1" />
                      <span className={cn("tabular-nums", scoreTone(s.score))}>{fmtScore(s.score)}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="py-1 pr-2 font-medium">KPI</th>
                            <th className="py-1 pr-2 font-medium">Actual</th>
                            <th className="py-1 pr-2 font-medium">Target</th>
                            <th className="py-1 pr-2 font-medium">Points</th>
                            <th className="py-1 pr-2 font-medium">Share</th>
                            <th className="py-1 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.kpis.map((k) => (
                            <KpiRow key={k.metric} k={k} labels={d.statusLabels} onCorrect={d.snapshot && k.status !== "not_available" ? () => setFixing(k) : undefined} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Corrections for {monthLabel(month)}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!d.snapshot && <p className="text-muted-foreground">This month is still live — its figures follow the systems. Corrections are for a frozen month.</p>}
              {d.snapshot && !d.corrections.length && <p className="text-muted-foreground">None asked. Use &ldquo;Correct&rdquo; on a KPI to ask for one.</p>}
              {d.corrections.map((c) => (
                <div key={c.id} className="flex flex-wrap items-start gap-2 border-t pt-2">
                  <Badge variant={c.status === "approved" ? "success" : c.status === "rejected" ? "destructive" : "warning"}>
                    {c.status === "approved" ? `Approved → v${c.version}` : c.status === "rejected" ? "Rejected" : "Waiting"}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p>{c.metricName}: {c.action === "leave_out" ? "leave it out of the month" : `set to ${c.value}`} <span className="text-muted-foreground">(was {c.was.value ?? "—"})</span></p>
                    <p className="text-xs text-muted-foreground">{c.reason} · asked by {c.raisedBy.name || c.raisedBy.email}, {dubaiWhen(c.raisedAt)}</p>
                    {c.decisionNote && <p className="text-xs text-muted-foreground">{c.decidedBy}: {c.decisionNote}</p>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          {fixing && <CorrectDialog k={fixing} month={month} email={email} onClose={() => setFixing(null)} />}
        </>
      )}
    </div>
  );
}

/** Ask for a correction to one KPI of a frozen month: the right value, or leave it out — with why and the evidence. */
function CorrectDialog({ k, month, email, onClose }: { k: KpiResult; month: string; email: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [action, setAction] = useState<"set_value" | "leave_out">("set_value");
  const [value, setValue] = useState(k.value == null ? "" : String(k.value));
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [err, setErr] = useState("");
  const send = useMutation({
    mutationFn: async () => (await api.post("/mentor-kpis/corrections", {
      month, email, metric: k.metric, action, value: action === "set_value" ? Number(value) : null, reason, evidence,
    })).data.data,
    onSuccess: () => { toast.success("Correction asked for — it waits on the Corrections tab"); qc.invalidateQueries({ queryKey: ["mentor-kpis"] }); onClose(); },
    onError: (e) => setErr(apiErrorMessage(e, "Refused")),
  });
  const submit = () => {
    if (action === "set_value" && (value.trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0)) return setErr("Enter the right value (0 or more).");
    if (!reason.trim()) return setErr("Say why it's wrong.");
    send.mutate();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct {k.name}</DialogTitle>
          <DialogDescription>
            {monthLabel(month)} shows {fmtValue(k.value, k.unit)}. A root admin approves or rejects it; approving makes the month&apos;s next version.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <select value={action} onChange={(e) => { setAction(e.target.value as typeof action); setErr(""); }} className="h-9 w-full rounded-md border border-input bg-background px-3" aria-label="Correction">
            <option value="set_value">The right value is…</option>
            <option value="leave_out">Leave this KPI out of the month for them</option>
          </select>
          {action === "set_value" && (
            <div className="flex items-center gap-2">
              <Input type="number" min={0} value={value} onChange={(e) => { setValue(e.target.value); setErr(""); }} aria-label="The right value" className="w-40" />
              <span className="text-muted-foreground">{k.unit}</span>
            </div>
          )}
          <Input value={reason} onChange={(e) => { setReason(e.target.value); setErr(""); }} placeholder="Why it's wrong" aria-label="Why" maxLength={500} />
          <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Evidence: what to check, links" aria-label="Evidence" maxLength={2000} rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2" />
          {err && <p className="text-red-500">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={send.isPending} onClick={submit}>Ask for it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KpiRow({ k, labels, onCorrect }: { k: KpiResult; labels: MentorDetail["statusLabels"]; onCorrect?: () => void }) {
  const prorated = k.effectiveTarget != null && k.target != null && k.effectiveTarget !== k.target;
  return (
    <tr className="border-t align-top">
      <td className="py-1.5 pr-2">
        <p>{k.name}</p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {SOURCE_SHORT[k.source]} · {k.direction === "up" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {k.direction === "up" ? "more is better" : "fewer is better"}
          {k.sample > 0 && k.sampleOf && !k.corrected ? ` · ${Math.round(k.sample)} ${k.sampleOf}` : ""}
        </p>
      </td>
      <td className="py-1.5 pr-2 tabular-nums">{fmtValue(k.value, k.unit)}</td>
      <td className="py-1.5 pr-2 tabular-nums">
        {k.target == null ? "—" : fmtValue(k.target, k.unit)}
        {k.targetFrom === "mentor" && <span className="ml-1 text-xs text-primary">own</span>}
        {prorated && <p className="text-xs text-muted-foreground">{fmtValue(k.effectiveTarget, k.unit)} so far</p>}
      </td>
      <td className={cn("py-1.5 pr-2 tabular-nums", scoreTone(k.score))}>{fmtScore(k.score)}</td>
      <td className="py-1.5 pr-2 tabular-nums text-muted-foreground">{k.mode === "scored" ? pct1(k.share) : "—"}</td>
      <td className="py-1.5">
        <Badge variant={k.status === "scored" ? "success" : k.status === "monitoring" ? "secondary" : "warning"}>{labels[k.status] ?? k.status}</Badge>
        {k.corrected && (
          <p className="mt-0.5 max-w-[260px] text-xs text-primary">
            Corrected{k.corrected.action === "set_value" ? ` from ${k.corrected.was ?? "—"}` : ""}: {k.corrected.reason}
          </p>
        )}
        {k.note && k.status !== "scored" && !k.corrected && <p className="mt-0.5 max-w-[260px] text-xs text-muted-foreground">{k.note}</p>}
        {onCorrect && (
          <button type="button" onClick={onCorrect} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Wrench className="h-3 w-3" />Correct
          </button>
        )}
      </td>
    </tr>
  );
}
