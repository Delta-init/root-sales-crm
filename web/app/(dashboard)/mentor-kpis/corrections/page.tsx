"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/axios";
import { dubaiWhen, monthLabel, type Correction } from "@/components/mentor-kpis/types";

/**
 * Corrections to frozen months (2026-11-09): what was asked — one mentor, one KPI, the right value or leave it out,
 * with the reason and the evidence — for a root admin to approve (the month's next version) or reject (with why).
 * Asked on a mentor's page here, or later from the CS Portal by the mentor or their chief.
 */

const asked = (c: Correction) => (c.action === "leave_out" ? "Leave it out of the month" : `Set it to ${c.value}`);

export default function MentorKpiCorrectionsPage() {
  const qc = useQueryClient();
  const pending = useQuery({
    queryKey: ["mentor-kpis", "corrections", "pending"],
    queryFn: async () => (await api.get("/mentor-kpis/corrections", { params: { status: "pending" } })).data.data as Correction[],
  });
  const decided = useQuery({
    queryKey: ["mentor-kpis", "corrections", "decided"],
    queryFn: async () => (await api.get("/mentor-kpis/corrections", { params: { status: "decided" } })).data.data as Correction[],
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Waiting for a decision</CardTitle>
          <p className="text-sm text-muted-foreground">Approving makes the month&apos;s next version; the one before is kept. Rejecting needs a reason.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {pending.isLoading ? <Skeleton className="h-24 w-full" />
            : pending.isError ? <p className="flex items-center gap-2 text-sm text-red-500"><AlertTriangle className="h-4 w-4" />{apiErrorMessage(pending.error)}</p>
            : !pending.data?.length ? <p className="text-sm text-muted-foreground">Nothing waiting.</p>
            : pending.data.map((c) => <Pending key={c.id} c={c} onDone={() => qc.invalidateQueries({ queryKey: ["mentor-kpis"] })} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Decided</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {decided.isLoading ? <Skeleton className="h-24 w-full" /> : !decided.data?.length ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 font-medium">Month</th><th className="py-1 font-medium">Mentor</th><th className="py-1 font-medium">KPI</th>
                  <th className="py-1 font-medium">Asked</th><th className="py-1 font-medium">Decision</th><th className="py-1 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {decided.data.map((c) => (
                  <tr key={c.id} className="border-t align-top">
                    <td className="py-1.5">{monthLabel(c.month)}</td>
                    <td className="py-1.5"><Link href={`/mentor-kpis/${c.month}/${encodeURIComponent(c.email)}`} className="hover:underline">{c.name}</Link></td>
                    <td className="py-1.5">{c.metricName}</td>
                    <td className="py-1.5">{asked(c)}<p className="text-xs text-muted-foreground">{c.reason}</p></td>
                    <td className="py-1.5">
                      <Badge variant={c.status === "approved" ? "success" : "destructive"}>{c.status === "approved" ? `Approved → v${c.version}` : "Rejected"}</Badge>
                      <p className="text-xs text-muted-foreground">{c.decidedBy} · {dubaiWhen(c.decidedAt)}</p>
                    </td>
                    <td className="py-1.5 text-muted-foreground">{c.decisionNote || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Pending({ c, onDone }: { c: Correction; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const decide = useMutation({
    mutationFn: async (approve: boolean) => (await api.post(`/mentor-kpis/corrections/${c.id}/${approve ? "approve" : "reject"}`, { note })).data.data as Correction,
    onSuccess: (r) => { toast.success(r.status === "approved" ? `Approved — ${monthLabel(r.month)} is now version ${r.version}` : "Rejected"); onDone(); },
    onError: (e) => toast.error(apiErrorMessage(e, "Refused")),
  });
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        <div className="min-w-[200px] flex-1">
          <p className="font-medium">
            <Link href={`/mentor-kpis/${c.month}/${encodeURIComponent(c.email)}`} className="hover:underline">{c.name}</Link>
            <span className="font-normal text-muted-foreground"> · {c.metricName} · {monthLabel(c.month)}</span>
          </p>
          <p className="text-sm">{asked(c)} <span className="text-muted-foreground">(version {c.was.version} shows {c.was.value == null ? "no value" : c.was.value}{c.was.score != null ? `, ${c.was.score} points` : ""})</span></p>
          <p className="text-sm text-muted-foreground">Why: {c.reason}</p>
          {c.evidence && <p className="whitespace-pre-wrap text-sm text-muted-foreground">Evidence: {c.evidence}</p>}
          <p className="text-xs text-muted-foreground">Asked by {c.raisedBy.name || c.raisedBy.email}{c.raisedBy.source === "cs_portal" ? " (CS Portal)" : c.raisedBy.source === "lms" ? " (LMS)" : ""} · {dubaiWhen(c.raisedAt)}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={note} onChange={(e) => { setNote(e.target.value); setErr(""); }} placeholder="Note (needed to reject)" className="h-8 max-w-sm" aria-label="Decision note" />
        <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate(true)}><Check className="mr-1 h-4 w-4" />Approve</Button>
        <Button size="sm" variant="outline" disabled={decide.isPending}
          onClick={() => { if (!note.trim()) { setErr("Say why it's rejected."); return; } decide.mutate(false); }}>
          <X className="mr-1 h-4 w-4" />Reject
        </Button>
        {err && <span className="text-sm text-red-500">{err}</span>}
      </div>
    </div>
  );
}
