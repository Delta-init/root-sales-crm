"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, ClipboardList, Clock, Loader2, Paperclip, Plus, RotateCcw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { api, apiErrorMessage } from "@/lib/axios";
import { cn } from "@/lib/utils";

/**
 * Work raised in Media ERP, and what has come back for you to check.
 *
 * Two lists, because raising something and judging the result are the two ends
 * of one errand: you ask for a banner, somebody makes it, you say whether it is
 * the banner you wanted. Keeping them apart made the second half easy to
 * forget, which is how work sits in review for a week.
 *
 * Verifying is not approving. A leader signs work off; whoever asked for it
 * says whether it is what they asked for. Media ERP draws that line itself and
 * this screen respects it — there is no approve button here, deliberately.
 */

interface Member { id: string; name: string; email: string; role: string }
interface Team { id: string; name: string; color: string; members: Member[] }

interface TaskRow {
  id?: string;
  _id?: string;
  title?: string;
  status?: string;
  priority?: string;
  due_date?: string;
  assigned_to_name?: string;
  teamName?: string;
}

interface HistoryEntry {
  at?: string;
  event?: string;
  actor_name?: string;
  team_name?: string;
  note?: string;
}

interface TaskDetail extends TaskRow {
  description?: string;
  attachments?: { url: string; filename: string }[];
  history?: HistoryEntry[];
  team_flow?: { team_name?: string; outcome?: string | null }[];
  created_at?: string;
}

const idOf = (t: TaskRow) => t.id ?? t._id ?? "";

/** Media ERP's own words, tidied for a sentence rather than a field. */
const STATUS_LABEL: Record<string, string> = {
  pending: "Not started",
  upcoming: "Upcoming",
  currently_working: "In progress",
  updation_needed: "Needs changes",
  pending_review: "Waiting to be checked",
  approved: "Approved",
  reedit: "Sent back",
};

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString(undefined, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }) : "";

export default function TasksPage() {
  const qc = useQueryClient();

  const teams = useQuery({
    queryKey: ["tasks", "teams"],
    retry: false,
    queryFn: async () => (await api.get<{ data: { teams: Team[] } }>("/tasks/teams")).data.data.teams,
  });

  /*
   * Media ERP refuses this for somebody with no account there, which is most of
   * the portal until they raise their first task. That is the ordinary state
   * rather than a fault, so it is explained rather than coloured red.
   */
  const verifications = useQuery({
    queryKey: ["tasks", "verifications"],
    retry: false,
    queryFn: async () => (await api.get<{ data: unknown }>("/tasks/verifications")).data.data,
  });

  const raised = useQuery({
    queryKey: ["tasks", "raised"],
    retry: false,
    queryFn: async () => (await api.get<{ data: { tasks: TaskRow[] } }>("/tasks/raised")).data.data.tasks,
  });

  /* The verification feed is a list in some shapes and a wrapper in others;
     read both rather than depend on which. */
  const toCheck: TaskRow[] = useMemo(() => {
    const d = verifications.data as unknown;
    if (Array.isArray(d)) return d as TaskRow[];
    const o = (d ?? {}) as Record<string, unknown>;
    return (o.tasks ?? o.items ?? o.pending ?? []) as TaskRow[];
  }, [verifications.data]);

  // ── Raising something ──────────────────────────────────────────────────────
  const [raising, setRaising] = useState(false);
  const [form, setForm] = useState({
    teamId: "", assignedTo: "", title: "", description: "", priority: "medium", dueDate: "",
  });
  const team = useMemo(
    () => (teams.data ?? []).find((t) => t.id === form.teamId),
    [teams.data, form.teamId],
  );

  const create = useMutation({
    mutationFn: async () =>
      (await api.post<{ data: { createdAs: string; verifierNote: string } }>("/tasks", form)).data.data,
    onSuccess: (d) => {
      /* The note is only there when something did not go to plan — normally
         being made a verifier is silent, because it is the expected thing. */
      toast.success(d.verifierNote || "Raised — it comes back to you to check");
      setRaising(false);
      setForm({ teamId: "", assignedTo: "", title: "", description: "", priority: "medium", dueDate: "" });
      void qc.invalidateQueries({ queryKey: ["tasks", "raised"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not raise that")),
  });

  // ── Looking at one ─────────────────────────────────────────────────────────
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const detail = useQuery({
    queryKey: ["tasks", "detail", openTask],
    enabled: Boolean(openTask),
    retry: false,
    queryFn: async () =>
      (await api.get<{ data: TaskDetail }>(`/tasks/${openTask}`)).data.data,
  });

  const verify = useMutation({
    mutationFn: async (v: { taskId: string; passed: boolean }) =>
      api.post(`/tasks/verifications/${v.taskId}`, { passed: v.passed, reason }),
    onSuccess: (_d, v) => {
      toast.success(v.passed ? "Passed" : "Sent back with your note");
      setOpenTask(null);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["tasks", "verifications"] });
      void qc.invalidateQueries({ queryKey: ["tasks", "raised"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "That did not go through")),
  });

  const canSubmit = form.teamId && form.assignedTo && form.title.trim() && form.dueDate;
  const isMine = (id: string) => toCheck.some((t) => idOf(t) === id);

  const Row = ({ t }: { t: TaskRow }) => (
    <button
      type="button"
      onClick={() => setOpenTask(idOf(t))}
      className="w-full rounded-lg border border-border/60 p-3 text-left transition-colors hover:bg-accent/40"
    >
      <div className="flex items-start gap-2">
        <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{t.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {t.teamName}
            {t.assigned_to_name ? ` · ${t.assigned_to_name}` : ""}
            {t.due_date ? ` · due ${t.due_date}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {t.status && (
            <Badge variant="outline" className="text-[10px]">
              {STATUS_LABEL[t.status] ?? t.status}
            </Badge>
          )}
          {t.priority && <span className="text-[10px] text-muted-foreground">{t.priority}</span>}
        </div>
      </div>
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold text-foreground">Tasks</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Raise work for the Media ERP team. Whatever you raise comes back to you to check.
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => setRaising(true)}>
          <Plus className="h-4 w-4" /> Raise work
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-2 pt-5">
            <p className="text-sm font-semibold text-foreground">Waiting on you to check</p>

            {verifications.isPending && <Skeleton className="h-20 w-full" />}
            {verifications.isError && (
              <p className="py-6 text-sm text-muted-foreground">
                {apiErrorMessage(verifications.error, "Nothing to show yet.")}
              </p>
            )}
            {verifications.isSuccess && toCheck.length === 0 && (
              <div className="py-10 text-center">
                <CheckCircle2 className="mx-auto h-7 w-7 text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">Nothing waiting on you</p>
              </div>
            )}
            {toCheck.map((t) => <Row key={idOf(t)} t={t} />)}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 pt-5">
            <p className="text-sm font-semibold text-foreground">Raised by me</p>

            {raised.isPending && <Skeleton className="h-20 w-full" />}
            {raised.isError && (
              <p className="py-6 text-sm text-muted-foreground">
                {apiErrorMessage(raised.error, "Nothing to show yet.")}
              </p>
            )}
            {raised.data?.length === 0 && (
              <div className="py-10 text-center">
                <ClipboardList className="mx-auto h-7 w-7 text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">You have not raised anything yet</p>
              </div>
            )}
            {(raised.data ?? []).map((t) => <Row key={idOf(t)} t={t} />)}
          </CardContent>
        </Card>
      </div>

      {/* ── Raise work ─────────────────────────────────────────────────────── */}
      <Dialog open={raising} onOpenChange={setRaising}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Raise work</DialogTitle>
            <DialogDescription>
              They are notified in Media ERP. It comes back to you to check before it can be approved.
            </DialogDescription>
          </DialogHeader>

          {teams.isError ? (
            <p className="text-sm text-destructive">
              {apiErrorMessage(teams.error, "Media ERP could not be reached, so there are no teams to choose.")}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="team">Team</Label>
                <select
                  id="team" value={form.teamId}
                  onChange={(e) => setForm((f) => ({ ...f, teamId: e.target.value, assignedTo: "" }))}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="">Choose a team…</option>
                  {(teams.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="who">Who it is for</Label>
                <select
                  id="who" value={form.assignedTo} disabled={!team}
                  onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
                >
                  <option value="">{team ? "Choose somebody…" : "Pick a team first"}</option>
                  {(team?.members ?? []).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}{m.role === "leader" ? " · leader" : ""}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="title">What needs doing</Label>
                <Input
                  id="title" value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Banner set for the October campaign"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="due">Due</Label>
                <Input
                  id="due" type="date" value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pri">Priority</Label>
                <select
                  id="pri" value={form.priority}
                  onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="desc">Anything else</Label>
                <Input
                  id="desc" value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setRaising(false)}>Cancel</Button>
            <Button disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Raise it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── One task, in full ──────────────────────────────────────────────── */}
      <Dialog open={Boolean(openTask)} onOpenChange={(o) => { if (!o) { setOpenTask(null); setReason(""); } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {detail.isPending && <Skeleton className="h-52 w-full" />}
          {detail.isError && (
            <p className="py-6 text-sm text-muted-foreground">
              {apiErrorMessage(detail.error, "That task could not be opened.")}
            </p>
          )}

          {detail.data && (() => {
            const d = detail.data;
            const mine = isMine(idOf(d));
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{d.title}</DialogTitle>
                  <DialogDescription>
                    {d.teamName}
                    {d.assigned_to_name ? ` · ${d.assigned_to_name}` : ""}
                    {d.due_date ? ` · due ${d.due_date}` : ""}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{STATUS_LABEL[d.status ?? ""] ?? d.status}</Badge>
                    {d.priority && <Badge variant="outline">{d.priority}</Badge>}
                  </div>

                  {d.description && (
                    <div>
                      <p className="text-xs text-muted-foreground">Description</p>
                      <p className="whitespace-pre-wrap text-foreground">{d.description}</p>
                    </div>
                  )}

                  {/* Where it has been. The stops in order, which answers
                      "where is it now" faster than any status field. */}
                  {(d.team_flow ?? []).length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground">Where it has been</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                        {(d.team_flow ?? []).map((f, i) => (
                          <span key={i} className="flex items-center gap-1">
                            {i > 0 && <span className="text-muted-foreground/50">→</span>}
                            <span className="rounded border border-border/60 px-1.5 py-0.5 text-foreground">
                              {f.team_name}{f.outcome ? ` (${f.outcome})` : ""}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {(d.attachments ?? []).length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground">Attachments</p>
                      {(d.attachments ?? []).map((a, i) => (
                        <a key={i} href={a.url} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1.5 text-primary hover:underline">
                          <Paperclip className="h-3 w-3" /> {a.filename}
                        </a>
                      ))}
                    </div>
                  )}

                  {(d.history ?? []).length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground">History</p>
                      <div className="mt-1 space-y-1.5">
                        {(d.history ?? []).map((h, i) => (
                          <div key={i} className="flex gap-2 text-xs">
                            <Clock className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60" />
                            <div className="min-w-0">
                              <span className="text-foreground">{h.event}</span>
                              {h.actor_name && <span className="text-muted-foreground"> · {h.actor_name}</span>}
                              {h.team_name && <span className="text-muted-foreground"> · {h.team_name}</span>}
                              {h.at && <span className="text-muted-foreground/70"> · {when(h.at)}</span>}
                              {h.note && <p className="text-muted-foreground">{h.note}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Only when it is actually yours to judge. Drawing the
                      buttons otherwise offers something Media ERP would refuse. */}
                  {mine && (
                    <div className="space-y-1.5 border-t border-border/60 pt-3">
                      <Label htmlFor="reason">If you are sending it back, say why</Label>
                      <Input
                        id="reason" value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="What needs changing"
                      />
                    </div>
                  )}
                </div>

                {mine && (
                  <DialogFooter className="gap-2">
                    <Button
                      variant="ghost" className="gap-1.5"
                      disabled={verify.isPending || !reason.trim()}
                      title={reason.trim() ? undefined : "Say what needs changing first"}
                      onClick={() => verify.mutate({ taskId: idOf(d), passed: false })}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Send back
                    </Button>
                    <Button
                      className={cn("gap-1.5")}
                      disabled={verify.isPending}
                      onClick={() => verify.mutate({ taskId: idOf(d), passed: true })}
                    >
                      {verify.isPending
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Looks right
                    </Button>
                  </DialogFooter>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
