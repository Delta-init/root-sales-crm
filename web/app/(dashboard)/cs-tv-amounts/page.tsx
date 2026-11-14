"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AxiosError } from "axios";
import { toast } from "sonner";
import { Loader2, MonitorUp, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, apiErrorMessage } from "@/lib/axios";

/**
 * CS TV amounts (the user, 2026-11-14: "we need an option in the Root portal… the Bangalore employees… this is needed
 * in the Dubai TV"): amounts typed here for a Bangalore employee, which the CS TV shows like the course payments its
 * CSs collect — on the Dubai TV by default, the Bangalore TV, or both: ranking, totals, latest payments, pop-up and
 * voice, with nothing on the screen to tell them from a payment. They are not payments, and count nowhere else —
 * not CS Portal's reports, commission or finance, and not the Manager TV. CS Portal keeps them; root admins only.
 *
 * Somebody who is not a CS in CS Portal's Bangalore team (2026-11-14: "add … also in the Bangalore team TV amount") is
 * added here by name, once: no account is made for them anywhere; from then on they are picked like the team's CSs
 * and shown on the TV under the team, with their HRMS photo when the HRMS knows the name (or the email given).
 */

type ShowOn = "dubai" | "bangalore" | "both";
interface Amount { id: string; employeeId: string; employee: string; aed: number; course: string; at: string; showOn: ShowOn; addedBy: string; addedAt: string }
interface Employee { id: string; name: string; team: string; addedByName?: boolean }
interface Person { id: string; name: string; team: string; addedBy: string; addedAt: string }
interface Overview {
  month: string; amounts: Amount[]; employees: Employee[]; courses: string[]; totalAed: number;
  /** The people added by name, the teams one can be shown under, and whether CS Portal's server takes them yet. */
  people?: Person[]; teams?: Array<{ id: string; name: string }>; canAddPeople?: boolean;
}

const SHOW_ON: Array<{ value: ShowOn; label: string }> = [
  { value: "dubai", label: "Dubai TV" },
  { value: "bangalore", label: "Bangalore TV" },
  { value: "both", label: "Both TVs" },
];
const showOnLabel = (v: ShowOn) => SHOW_ON.find((s) => s.value === v)?.label ?? v;

const forbidden = (e: unknown) => e instanceof AxiosError && e.response?.status === 403;
const notYet = (e: unknown) => e instanceof AxiosError && e.response?.status === 404;
const aed = (n: number) => `AED ${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
/** Dubai's clock, whatever the browser's: the CS TV counts its days and months by it. */
const dubaiNow = () => new Date(Date.now() + 4 * 3_600_000).toISOString();
const thisMonth = () => dubaiNow().slice(0, 7);
const today = () => dubaiNow().slice(0, 10);
const dubaiParts = (iso: string) => { const d = new Date(new Date(iso).getTime() + 4 * 3_600_000).toISOString(); return { date: d.slice(0, 10), time: d.slice(11, 16) }; };
const toIso = (date: string, time: string) => new Date(`${date}T${time || "12:00"}:00+04:00`).toISOString();
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
const SELECT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

export default function CsTvAmountsPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(thisMonth());
  const q = useQuery({
    queryKey: ["cs-tv-amounts", month],
    queryFn: async () => (await api.get("/cs-tv-amounts", { params: { month } })).data.data as Overview,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["cs-tv-amounts"] });
  const o = q.data;

  // ── Add ──
  const [form, setForm] = useState({ employeeId: "", aed: "", course: "", showOn: "dubai" as ShowOn, date: "", time: "" });
  const add = useMutation({
    mutationFn: async () => (await api.post("/cs-tv-amounts", {
      employeeId: form.employeeId, aed: Number(form.aed), course: form.course.trim(), showOn: form.showOn,
      ...(form.date ? { at: toIso(form.date, form.time) } : {}),
    })).data,
    onSuccess: () => {
      toast.success(form.date ? "Added to the TV" : "Added. It shows on the TV within 20 seconds");
      setForm((f) => ({ ...f, aed: "", date: "", time: "" }));
      refresh();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Not added")),
  });
  const addProblem = !form.employeeId ? "Pick the employee"
    : !(Number(form.aed) > 0) ? "Give the amount"
    : !form.course.trim() ? "Give the course"
    : form.time && !form.date ? "Give the date too" : "";

  // ── Change, remove ──
  const [editing, setEditing] = useState<(Amount & { aedText: string; date: string; time: string }) | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return null;
      return (await api.patch(`/cs-tv-amounts/${editing.id}`, {
        aed: Number(editing.aedText), course: editing.course.trim(), showOn: editing.showOn, at: toIso(editing.date, editing.time),
      })).data;
    },
    onSuccess: () => { toast.success("Saved"); setEditing(null); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e, "Not saved")),
  });
  const editProblem = !editing ? "" : !(Number(editing.aedText) > 0) ? "Give the amount" : !editing.course.trim() ? "Give the course" : !editing.date ? "Give the date" : "";
  // ── Somebody added by name ──
  const [person, setPerson] = useState({ name: "", teamId: "", email: "" });
  const teams = o?.teams ?? [];
  const addPerson = useMutation({
    mutationFn: async () => (await api.post("/cs-tv-amounts/people", {
      name: person.name.trim(), ...(person.teamId ? { teamId: person.teamId } : {}), ...(person.email.trim() ? { email: person.email.trim() } : {}),
    })).data.data as { id: string },
    onSuccess: (r) => {
      toast.success(`${person.name.trim()} added, and picked in the form above. Type their amount there`);
      setPerson({ name: "", teamId: "", email: "" });
      // Chosen in the form above, ready for their first amount.
      setForm((f) => ({ ...f, employeeId: r.id }));
      refresh();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Not added")),
  });
  const personProblem = person.name.trim().length < 2 ? "Give the name" : teams.length > 1 && !person.teamId ? "Pick the team" : "";
  const [removingPerson, setRemovingPerson] = useState<string | null>(null);
  const removePerson = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/cs-tv-amounts/people/${id}`)).data,
    onSuccess: (_r, id) => {
      toast.success("Removed, with their amounts");
      setRemovingPerson(null);
      setForm((f) => (f.employeeId === id ? { ...f, employeeId: "" } : f));
      refresh();
    },
    onError: (e) => { toast.error(apiErrorMessage(e, "Not removed")); setRemovingPerson(null); refresh(); },
  });

  const [removing, setRemoving] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/cs-tv-amounts/${id}`)).data,
    onSuccess: () => { toast.success("Removed from the TV"); setRemoving(null); refresh(); },
    onError: (e) => { toast.error(apiErrorMessage(e, "Not removed")); setRemoving(null); refresh(); },
  });

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h2 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-foreground">
          <MonitorUp className="h-6 w-6 text-primary" /> CS TV amounts <Badge variant="secondary">Bangalore employees</Badge>
        </h2>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          An amount added here shows on the CS TV like a course payment the employee collected: in the ranking, the totals and the
          latest payments, with the pop-up and voice, and nothing on the screen marks it. It is not a payment. It counts nowhere
          else: not in CS Portal&apos;s reports, commission or finance, and not on the Manager TV.
        </p>
      </motion.div>

      {notYet(q.error) && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">The portal&apos;s server is still on the previous version, so this page has nothing to show yet. It works once the server is updated.</CardContent></Card>
      )}
      {q.error && !forbidden(q.error) && !notYet(q.error) && (
        <Card><CardContent className="pt-6 text-sm text-destructive">{apiErrorMessage(q.error, "The TV amounts couldn't be loaded")}</CardContent></Card>
      )}
      {forbidden(q.error) && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">This page is for root admins.</CardContent></Card>
      )}

      {/* Add an amount */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Plus className="h-4 w-4" /> Add an amount</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {q.isLoading ? <Skeleton className="h-24 w-full" /> : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-1.5 text-sm">
                  <span className="block text-muted-foreground">Bangalore employee</span>
                  <select id="tv-amount-employee" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className={SELECT} disabled={!o}>
                    <option value="">Choose…</option>
                    {(o?.employees ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} · {c.team}{c.addedByName ? " · added by name" : ""}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="block text-muted-foreground">Amount (AED)</span>
                  <Input id="tv-amount-aed" type="number" min={1} step="0.01" inputMode="decimal" placeholder="e.g. 12000" value={form.aed} onChange={(e) => setForm({ ...form, aed: e.target.value })} />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="block text-muted-foreground">Course</span>
                  <Input id="tv-amount-course" list="tv-amount-courses" placeholder="e.g. MSNR" value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} />
                  <datalist id="tv-amount-courses">{(o?.courses ?? []).map((c) => <option key={c} value={c} />)}</datalist>
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="block text-muted-foreground">Show on</span>
                  <select id="tv-amount-show-on" value={form.showOn} onChange={(e) => setForm({ ...form, showOn: e.target.value as ShowOn })} className={SELECT}>
                    {SHOW_ON.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1.5 text-sm">
                  <span className="block text-muted-foreground">When, Dubai time (leave empty for now)</span>
                  <div className="flex gap-2">
                    <Input id="tv-amount-date" type="date" max={today()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} aria-label="Date" className="w-40" />
                    <Input id="tv-amount-time" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} aria-label="Time" className="w-32" />
                  </div>
                </div>
                <Button onClick={() => (addProblem ? toast.error(addProblem) : add.mutate())} disabled={add.isPending || !o}>
                  {add.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />} Add to the TV
                </Button>
                <p className="max-w-md text-xs text-muted-foreground">
                  On the Dubai TV the employee stands among Dubai&apos;s CSs with only the amounts added here, in AED. The Bangalore TV shows
                  the same amount in rupees, on top of their own payments.
                </p>
              </div>
              {o && o.employees.length === 0 && (
                <p className="text-sm text-muted-foreground">CS Portal has no active CS in a Bangalore team, so there is nobody to pick. Add somebody by name below.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Somebody who isn't in the list */}
      {o && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><UserPlus className="h-4 w-4" /> Somebody who isn&apos;t in the list</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {o.canAddPeople === false ? (
              <p className="text-sm text-muted-foreground">CS Portal&apos;s server is still on the previous version, so nobody can be added by name yet. It works once that server is updated.</p>
            ) : (
              <>
                <p className="max-w-3xl text-sm text-muted-foreground">
                  The list above has the CSs of CS Portal&apos;s Bangalore team. For anybody else, add their name here once. No account is made
                  for them: they only become somebody to pick above, and show on the TV under the team while they have an amount.
                </p>
                <div className="flex flex-wrap items-end gap-4">
                  <label className="w-full max-w-xs space-y-1.5 text-sm">
                    <span className="block text-muted-foreground">Name, as the TV should show it</span>
                    <Input id="tv-person-name" value={person.name} maxLength={80} placeholder="e.g. Asha R" onChange={(e) => setPerson({ ...person, name: e.target.value })} />
                  </label>
                  {teams.length > 1 && (
                    <label className="w-full max-w-[14rem] space-y-1.5 text-sm">
                      <span className="block text-muted-foreground">Team</span>
                      <select id="tv-person-team" value={person.teamId} onChange={(e) => setPerson({ ...person, teamId: e.target.value })} className={SELECT}>
                        <option value="">Choose…</option>
                        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="w-full max-w-xs space-y-1.5 text-sm">
                    <span className="block text-muted-foreground">HRMS email, for the photo (optional)</span>
                    <Input id="tv-person-email" type="email" value={person.email} placeholder="name@company.com" onChange={(e) => setPerson({ ...person, email: e.target.value })} />
                  </label>
                  <Button variant="outline" onClick={() => (personProblem ? toast.error(personProblem) : addPerson.mutate())} disabled={addPerson.isPending}>
                    {addPerson.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />} Add person
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {teams.length === 1 ? `Shown under ${teams[0]!.name}. ` : teams.length === 0 ? "CS Portal has no Bangalore team, so they show with no team. " : ""}
                  Without an email the HRMS is asked for a photo by the name, which must match exactly; with none found the TV shows initials.
                </p>
                {(o.people ?? []).length > 0 && (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {(o.people ?? []).map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm" data-testid={`tv-person-${p.id}`}>
                        <span className="font-medium text-foreground">{p.name}</span>
                        <Badge variant="secondary">{p.team}</Badge>
                        <span className="text-xs text-muted-foreground">added by {p.addedBy || "somebody"}</span>
                        <span className="ml-auto inline-flex gap-1">
                          {removingPerson === p.id ? (
                            <>
                              <Button size="sm" variant="destructive" disabled={removePerson.isPending} onClick={() => removePerson.mutate(p.id)}>Remove with their amounts</Button>
                              <Button size="sm" variant="ghost" onClick={() => setRemovingPerson(null)}>Keep</Button>
                            </>
                          ) : (
                            <Button size="sm" variant="ghost" aria-label={`Remove ${p.name}`} onClick={() => setRemovingPerson(p.id)}><Trash2 className="h-4 w-4" /></Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* The month's amounts */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">Added for {monthLabel(o?.month ?? month)}</CardTitle>
          <div className="flex items-center gap-3">
            {o && <span className="text-sm tabular-nums text-muted-foreground">{o.amounts.length} · {aed(o.totalAed)}</span>}
            <Input id="tv-amount-month" type="month" max={thisMonth()} value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} aria-label="Month" className="h-9 w-44" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {q.isLoading ? <div className="p-6"><Skeleton className="h-20 w-full" /></div>
            : !o ? null
            : o.amounts.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Nothing added for this month.</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-6 py-2">Employee</th><th className="px-4 py-2">Course</th><th className="px-4 py-2 text-right">Amount</th>
                      <th className="px-4 py-2">Shown on</th><th className="px-4 py-2">On the TV at</th><th className="px-4 py-2">Added by</th><th className="px-6 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {o.amounts.map((a) => (
                      <tr key={a.id}>
                        <td className="whitespace-nowrap px-6 py-2.5 font-medium text-foreground">{a.employee}</td>
                        <td className="px-4 py-2.5">{a.course}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{aed(a.aed)}</td>
                        <td className="px-4 py-2.5"><Badge variant={a.showOn === "dubai" ? "default" : "secondary"} className="whitespace-nowrap">{showOnLabel(a.showOn)}</Badge></td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{when(a.at)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{a.addedBy}</td>
                        <td className="whitespace-nowrap px-6 py-2.5 text-right">
                          {removing === a.id ? (
                            <span className="inline-flex gap-1">
                              <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(a.id)}>Remove</Button>
                              <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>Keep</Button>
                            </span>
                          ) : (
                            <span className="inline-flex gap-1">
                              <Button size="sm" variant="ghost" aria-label={`Change ${a.employee}'s amount`} onClick={() => setEditing({ ...a, aedText: String(a.aed), ...dubaiParts(a.at) })}><Pencil className="h-4 w-4" /></Button>
                              <Button size="sm" variant="ghost" aria-label={`Remove ${a.employee}'s amount`} onClick={() => setRemoving(a.id)}><Trash2 className="h-4 w-4" /></Button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </CardContent>
      </Card>

      {/* Change one */}
      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change {editing?.employee}&apos;s amount</DialogTitle>
            <DialogDescription>The TV shows the change within 20 seconds. To give it to somebody else, remove it and add another.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="block text-muted-foreground">Amount (AED)</span>
                <Input id="tv-amount-edit-aed" type="number" min={1} step="0.01" inputMode="decimal" value={editing.aedText} onChange={(e) => setEditing({ ...editing, aedText: e.target.value })} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="block text-muted-foreground">Course</span>
                <Input id="tv-amount-edit-course" list="tv-amount-courses" value={editing.course} onChange={(e) => setEditing({ ...editing, course: e.target.value })} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="block text-muted-foreground">Show on</span>
                <select id="tv-amount-edit-show-on" value={editing.showOn} onChange={(e) => setEditing({ ...editing, showOn: e.target.value as ShowOn })} className={SELECT}>
                  {SHOW_ON.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <div className="space-y-1.5 text-sm sm:col-span-2">
                <span className="block text-muted-foreground">When, Dubai time</span>
                <div className="flex gap-2">
                  <Input id="tv-amount-edit-date" type="date" max={today()} value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} aria-label="Date" />
                  <Input id="tv-amount-edit-time" type="time" value={editing.time} onChange={(e) => setEditing({ ...editing, time: e.target.value })} aria-label="Time" />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => (editProblem ? toast.error(editProblem) : save.mutate())} disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
