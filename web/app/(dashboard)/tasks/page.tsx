"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, Loader2, RotateCcw, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { api, apiErrorMessage } from "@/lib/axios";

/**
 * Raising work in Media ERP, and clearing what is waiting on you.
 *
 * Two halves of one job, side by side, because they are the same job seen from
 * either end: somebody asks for something, somebody else says it is done, and
 * a third person decides whether it is. Splitting them across two screens made
 * the second half easy to forget.
 *
 * Nothing here decides anything. Who may put work on whose plate, and who may
 * approve it, are Media ERP's rules — this screen asks, and reports the answer
 * in Media ERP's own words when it is no.
 */

interface Member { id: string; name: string; email: string; role: string }
interface Team { id: string; name: string; color: string; members: Member[] }

interface Pending {
  id?: string;
  _id?: string;
  title?: string;
  priority?: string;
  due_date?: string;
  assigned_to_name?: string;
  teamName?: string;
}

const idOf = (t: Pending) => t.id ?? t._id ?? "";

export default function TasksPage() {
  const qc = useQueryClient();

  const teams = useQuery({
    queryKey: ["tasks", "teams"],
    retry: false,
    queryFn: async () => (await api.get<{ data: { teams: Team[] } }>("/tasks/teams")).data.data.teams,
  });

  /*
   * What is waiting on you, and why it might be nothing.
   *
   * Media ERP refuses this outright for somebody with no account there, which
   * is most of the portal. That is not an error to shout about — it is the
   * ordinary state for anybody who does not work in Media ERP — so it is caught
   * and explained rather than coloured red.
   */
  const approvals = useQuery({
    queryKey: ["tasks", "approvals"],
    retry: false,
    queryFn: async () =>
      (await api.get<{ data: { reviewerEmail: string; tasks: Pending[] } }>("/tasks/approvals")).data.data,
  });

  const [form, setForm] = useState({
    teamId: "", assignedTo: "", title: "", description: "", priority: "medium", dueDate: "",
  });

  const team = useMemo(
    () => (teams.data ?? []).find((t) => t.id === form.teamId),
    [teams.data, form.teamId],
  );

  const create = useMutation({
    mutationFn: async () =>
      (await api.post<{ data: { stoodIn: boolean; createdAs: string } }>("/tasks", form)).data.data,
    onSuccess: (d) => {
      /* Said out loud when it applies. Somebody whose name is not on the task
         in Media ERP should know that before they go looking for it there. */
      toast.success(
        d.stoodIn
          ? `Raised — recorded in Media ERP as ${d.createdAs}`
          : "Raised, and they have been notified",
      );
      setForm((f) => ({ ...f, title: "", description: "", dueDate: "" }));
      void qc.invalidateQueries({ queryKey: ["tasks", "approvals"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not raise that")),
  });

  const decide = useMutation({
    mutationFn: async (v: { taskId: string; approve: boolean }) =>
      api.post(`/tasks/${v.taskId}/decide`, { approve: v.approve }),
    onSuccess: (_d, v) => {
      toast.success(v.approve ? "Approved" : "Sent back for another pass");
      void qc.invalidateQueries({ queryKey: ["tasks", "approvals"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "That decision did not go through")),
  });

  const canSubmit =
    form.teamId && form.assignedTo && form.title.trim().length > 0 && form.dueDate;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Tasks</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Raise work for the Media ERP team, and clear what is waiting on you.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Raise work ────────────────────────────────────────────── */}
        <Card>
          <CardContent className="space-y-3 pt-5">
            <p className="text-sm font-semibold text-foreground">Assign work</p>

            {teams.isPending && <Skeleton className="h-9 w-full" />}
            {teams.isError && (
              <p className="text-sm text-destructive">
                {apiErrorMessage(teams.error, "Media ERP could not be reached, so there are no teams to choose.")}
              </p>
            )}

            {teams.data && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="team">Team</Label>
                    <select
                      id="team"
                      value={form.teamId}
                      onChange={(e) => setForm((f) => ({ ...f, teamId: e.target.value, assignedTo: "" }))}
                      className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                    >
                      <option value="">Choose a team…</option>
                      {teams.data.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="who">Who it is for</Label>
                    <select
                      id="who"
                      value={form.assignedTo}
                      disabled={!team}
                      onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))}
                      className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
                    >
                      <option value="">{team ? "Choose somebody…" : "Pick a team first"}</option>
                      {(team?.members ?? []).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}{m.role === "leader" ? " · leader" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="title">What needs doing</Label>
                  <Input
                    id="title"
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="Banner set for the October campaign"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
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
                      id="pri"
                      value={form.priority}
                      onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                      className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="desc">Anything else</Label>
                  <Input
                    id="desc"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Optional"
                  />
                </div>

                <Button
                  className="w-full gap-1.5"
                  disabled={!canSubmit || create.isPending}
                  onClick={() => create.mutate()}
                >
                  {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Assign it
                </Button>

                <p className="text-xs text-muted-foreground">
                  They are notified in Media ERP, by push and WhatsApp.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Waiting on you ────────────────────────────────────────── */}
        <Card>
          <CardContent className="space-y-3 pt-5">
            <p className="text-sm font-semibold text-foreground">Waiting on you</p>

            {approvals.isPending && <Skeleton className="h-20 w-full" />}

            {/*
              Not having a Media ERP account is the ordinary state for most of
              this portal, not a fault. It is explained rather than reported.
            */}
            {approvals.isError && (
              <p className="text-sm text-muted-foreground">
                {apiErrorMessage(approvals.error, "Nothing to show.")}
              </p>
            )}

            {approvals.data && approvals.data.tasks.length === 0 && (
              <div className="py-10 text-center">
                <CheckCircle2 className="mx-auto h-7 w-7 text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">Nothing waiting on you</p>
              </div>
            )}

            {approvals.data?.tasks.map((t) => {
              const id = idOf(t);
              const busy = decide.isPending && decide.variables?.taskId === id;
              return (
                <div key={id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-start gap-2">
                    <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{t.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.teamName}
                        {t.assigned_to_name ? ` · ${t.assigned_to_name}` : ""}
                        {t.due_date ? ` · due ${t.due_date}` : ""}
                      </p>
                    </div>
                    {t.priority && (
                      <Badge variant="outline" className="shrink-0 text-[10px]">{t.priority}</Badge>
                    )}
                  </div>

                  <div className="mt-2 flex justify-end gap-1.5">
                    <Button
                      variant="ghost" size="sm" className="gap-1"
                      disabled={busy}
                      onClick={() => decide.mutate({ taskId: id, approve: false })}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Send back
                    </Button>
                    <Button
                      size="sm" className="gap-1"
                      disabled={busy}
                      onClick={() => decide.mutate({ taskId: id, approve: true })}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Approve
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
