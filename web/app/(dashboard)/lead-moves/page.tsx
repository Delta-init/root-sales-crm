"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowRight, ArrowRightLeft, Loader2, Search, Send, Shuffle, Undo2, User as UserIcon, Users } from "lucide-react";
import { AxiosError } from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/axios";
import { useAuth } from "@/providers/AuthProvider";
import { cn } from "@/lib/utils";

/*
 * Lead moves (the user, 2026-11-19: "option to transfer between crms"). Find a lead in the Sales, Draw or Remote CRM
 * by its phone or name and move it to another — to one person in a team there, split across a team, or that CRM's own
 * split. The CRM it is in does the move, so it keeps the lead under Moved leads with Undo, as when moved from there.
 * Below, every move between the CRMs, from any of them, with Undo for 24 hours. Lead-traffic access: view to look,
 * manage to move and undo.
 */

type Crm = "delta" | "draw" | "remote";
type Mode = "person" | "team" | "split";
interface FoundLead { crm: Crm; crmName: string; leadId: string; name: string; phone: string; status: string; ownerName: string; teamName: string; createdAt: string | null; movable: boolean }
interface Target { code: Crm; name: string; ready: boolean; missing: string[]; error?: string; teams: { id: string; name: string; people: { id: string; name: string; leader: boolean }[] }[] }
interface MoveRow {
  id: string; from: Crm; to: Crm; fromName: string; toName: string; name: string; phone: string; outcome: "created" | "repeat"; holder: string;
  mode: Mode; teamName: string; personName: string; byName: string; ownerName: string; status: string; createdAt: string; undoneAt: string | null; undoneBy: string; canUndo: boolean;
}
interface MoveResult { moved: { leadId: string; name: string; holder: string; outcome: string }[]; refused: { leadId: string; name: string; reason: string }[] }

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const forbidden = (e: unknown) => e instanceof AxiosError && e.response?.status === 403;
const field = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50";
const CRM_TONE: Record<Crm, string> = { delta: "bg-primary/15 text-primary", draw: "bg-violet-500/15 text-violet-400", remote: "bg-amber-500/15 text-amber-400" };

export default function LeadMovesPage() {
  const { admin } = useAuth();
  const canManage = admin?.role === "root_admin" || admin?.trafficAccess === "manage";
  const qc = useQueryClient();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<FoundLead[]>([]);

  const found = useQuery({
    queryKey: ["crm-moves", "find", q],
    queryFn: async () => (await api.get<{ data: { leads: FoundLead[]; unreadable: string[] } }>("/traffic/crm-moves/find", { params: { q } })).data.data,
    enabled: q.length > 0,
    retry: false,
  });
  const moves = useQuery({
    queryKey: ["crm-moves", "list"],
    queryFn: async () => (await api.get<{ data: MoveRow[] }>("/traffic/crm-moves")).data.data,
  });
  const undo = useMutation({
    mutationFn: async (id: string) => (await api.post(`/traffic/crm-moves/${id}/undo`)).data,
    onSuccess: () => { toast.success("Undone — the lead is back where it was"); qc.invalidateQueries({ queryKey: ["crm-moves"] }); },
    onError: (e) => toast.error(apiErrorMessage(e, "Not undone")),
  });

  const from = picked[0]?.crm;
  const toggle = (l: FoundLead) => setPicked((p) => (
    p.some((x) => x.leadId === l.leadId) ? p.filter((x) => x.leadId !== l.leadId) : p.length && p[0].crm !== l.crm ? [l] : [...p, l]
  ));

  if (forbidden(moves.error)) {
    return <p className="py-10 text-center text-muted-foreground">You do not have access to lead traffic.</p>;
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <ArrowRightLeft className="h-6 w-6 text-primary" /> Lead moves
        </h2>
        <p className="mt-1 text-muted-foreground">Move leads between the Sales, Draw and Remote CRMs — and every move made, from any of them.</p>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3"><CardTitle className="text-base">Find a lead</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setQ(typed.trim()); }}>
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Phone number or name" className="pl-8" />
              </div>
              <Button type="submit" disabled={!typed.trim()}>Search</Button>
            </form>
            {found.isFetching ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Looking in the three CRMs…</p>
            ) : found.isError ? (
              <p className="text-sm text-destructive">{apiErrorMessage(found.error, "Couldn't search")}</p>
            ) : found.data ? (
              <>
                {found.data.unreadable.length > 0 && <p className="text-xs text-amber-500">Couldn&apos;t look in: {found.data.unreadable.join(", ")}</p>}
                {!found.data.leads.length ? <p className="text-sm text-muted-foreground">No lead matches in any CRM.</p> : (
                  <ul className="divide-y divide-border/60 rounded-md border">
                    {found.data.leads.map((l) => {
                      const on = picked.some((x) => x.leadId === l.leadId);
                      return (
                        <li key={`${l.crm}-${l.leadId}`} className={cn("flex items-center gap-3 px-3 py-2 text-sm", on && "bg-primary/5")}>
                          <input type="checkbox" className="h-4 w-4" checked={on} disabled={!canManage || !l.movable} onChange={() => toggle(l)} aria-label={`Pick ${l.name}`} />
                          <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", CRM_TONE[l.crm])}>{l.crmName}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{l.name || "—"} <span className="font-normal text-muted-foreground">{l.phone}</span></p>
                            <p className="truncate text-xs text-muted-foreground">
                              {l.ownerName || "Nobody"}{l.teamName ? ` · ${l.teamName}` : ""} · <span className="capitalize">{l.status.replace(/_/g, " ")}</span>
                              {!l.movable && " — closed and lost leads stay"}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {picked.length > 0 && <p className="text-xs text-muted-foreground">Leads from one CRM at a time — picking one in another CRM starts again.</p>}
              </>
            ) : <p className="text-sm text-muted-foreground">Type at least 6 digits of the phone, or 3 letters of the name.</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-base">Move</CardTitle></CardHeader>
          <CardContent>
            {!canManage ? <p className="text-sm text-muted-foreground">Moving leads needs lead-traffic manage access.</p>
              : !from ? <p className="text-sm text-muted-foreground">Pick the leads to move in the search.</p>
              : <MovePanel key={`${from}-${picked.map((p) => p.leadId).join(",")}`} from={from} leads={picked} onMoved={() => { setPicked([]); qc.invalidateQueries({ queryKey: ["crm-moves"] }); }} />}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Every move</CardTitle></CardHeader>
        <CardContent>
          {moves.isLoading ? <Skeleton className="h-24 w-full" /> : moves.isError ? (
            <p className="text-sm text-destructive">{apiErrorMessage(moves.error, "Couldn't load the moves")}</p>
          ) : !moves.data?.length ? <p className="text-sm text-muted-foreground">No leads moved between the CRMs yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="py-2 pr-3">Lead</th><th className="py-2 pr-3">From</th><th className="py-2 pr-3">To</th><th className="py-2 pr-3">By</th><th className="py-2"></th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {moves.data.map((m) => (
                    <tr key={m.id} className={cn(m.undoneAt && "opacity-60")}>
                      <td className="py-2 pr-3"><p className="font-medium">{m.name || "—"}</p><p className="text-xs text-muted-foreground">{m.phone}</p></td>
                      <td className="py-2 pr-3"><span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", CRM_TONE[m.from])}>{m.fromName}</span><p className="mt-0.5 text-xs text-muted-foreground">{m.ownerName || "Nobody"}{m.status ? `, ${m.status.replace(/_/g, " ")}` : ""}</p></td>
                      <td className="py-2 pr-3"><span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", CRM_TONE[m.to])}>{m.toName}</span>
                        <p className="mt-0.5 text-xs text-muted-foreground">{m.outcome === "repeat" ? `Already there — its team leader${m.holder ? ` (${m.holder})` : ""}` : m.holder ? `→ ${m.holder}` : "→ their split"}</p></td>
                      <td className="py-2 pr-3"><p>{m.byName || "—"}</p><p className="text-xs text-muted-foreground">{when(m.createdAt)}</p></td>
                      <td className="py-2 text-right">
                        {m.undoneAt ? <Badge variant="secondary">Undone{m.undoneBy ? ` by ${m.undoneBy}` : ""}</Badge>
                          : canManage && m.canUndo ? (
                            <Button size="sm" variant="outline" disabled={undo.isPending && undo.variables === m.id} onClick={() => undo.mutate(m.id)}>
                              {undo.isPending && undo.variables === m.id ? <Loader2 className="animate-spin" /> : <Undo2 />} Undo
                            </Button>
                          ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MovePanel({ from, leads, onMoved }: { from: Crm; leads: FoundLead[]; onMoved: () => void }) {
  const qc = useQueryClient();
  const targets = useQuery({
    queryKey: ["crm-moves", "targets", from],
    queryFn: async () => (await api.get<{ data: Target[] }>(`/traffic/crm-moves/targets/${from}`)).data.data,
    retry: false,
  });
  const [to, setTo] = useState<Crm | "">("");
  const [mode, setMode] = useState<Mode>("person");
  const [teamId, setTeamId] = useState("");
  const [userId, setUserId] = useState("");
  const [done, setDone] = useState<MoveResult | null>(null);
  const crm = targets.data?.find((t) => t.code === to);
  const team = crm?.teams.find((t) => t.id === teamId);
  const ready = !!crm && (mode === "split" || (!!team && (mode === "team" ? team.people.length > 0 : !!userId)));
  const move = useMutation({
    mutationFn: async () => (await api.post<{ data: MoveResult }>("/traffic/crm-moves", {
      from, to, mode, teamId: mode === "split" ? null : teamId, userId: mode === "person" ? userId : null, leadIds: leads.map((l) => l.leadId),
    })).data.data,
    onSuccess: (r) => {
      setDone(r);
      // Every move shows it at once; the search is looked at again on Done (it would take the picked leads away
      // from under this answer).
      qc.invalidateQueries({ queryKey: ["crm-moves", "list"] });
      if (r.moved.length) toast.success(`${r.moved.length} moved to ${crm?.name}`); else toast.error("Nothing moved");
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Not moved")),
  });

  if (targets.isLoading) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading the other CRMs…</p>;
  if (targets.isError) return <p className="text-sm text-destructive">{apiErrorMessage(targets.error, "Couldn't load the other CRMs")}</p>;
  if (done) {
    return (
      <div className="space-y-3 text-sm">
        {done.moved.length > 0 && <div><p className="font-medium">Moved {done.moved.length} to {crm?.name}:</p>
          <ul className="mt-1 space-y-1">{done.moved.map((m) => <li key={m.leadId} className="flex items-center gap-2"><ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /><span className="flex-1">{m.name}</span><span className="text-xs text-muted-foreground">{m.outcome === "repeat" ? "already there — its team leader" : m.holder ? `→ ${m.holder}` : "→ their split"}</span></li>)}</ul></div>}
        {done.refused.length > 0 && <div><p className="font-medium text-amber-500">Not moved ({done.refused.length}):</p>
          <ul className="mt-1 space-y-1 text-xs">{done.refused.map((r) => <li key={r.leadId}><span className="font-medium">{r.name || "A lead"}</span> — {r.reason}</li>)}</ul></div>}
        <p className="text-xs text-muted-foreground">Undo stays open for 24 hours in Every move below.</p>
        <Button size="sm" variant="outline" onClick={onMoved}>Done</Button>
      </div>
    );
  }
  return (
    <div className="space-y-4 text-sm">
      <p><strong>{leads.length}</strong> lead{leads.length === 1 ? "" : "s"} from the <strong>{leads[0].crmName}</strong>.</p>
      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">To</p>
        <div className="grid grid-cols-2 gap-2">
          {(targets.data ?? []).map((t) => (
            <Button key={t.code} type="button" size="sm" variant={to === t.code ? "default" : "outline"} disabled={!t.ready || !!t.error}
              onClick={() => { setTo(t.code); setTeamId(""); setUserId(""); }}>{t.name}</Button>
          ))}
        </div>
        {(targets.data ?? []).filter((t) => !t.ready || t.error).map((t) => (
          <p key={t.code} className="text-xs text-amber-500">{t.name}: {t.error ?? `not set up here yet (${t.missing.join(", ")})`}</p>
        ))}
      </div>
      {crm && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Button type="button" size="sm" variant={mode === "person" ? "default" : "outline"} onClick={() => setMode("person")}><UserIcon /> A person</Button>
            <Button type="button" size="sm" variant={mode === "team" ? "default" : "outline"} onClick={() => setMode("team")}><Users /> A team</Button>
            <Button type="button" size="sm" variant={mode === "split" ? "default" : "outline"} onClick={() => setMode("split")}><Shuffle /> Their split</Button>
          </div>
          {mode !== "split" && (
            <select value={teamId} onChange={(e) => { setTeamId(e.target.value); setUserId(""); }} className={field} aria-label="Team">
              <option value="">Team in {crm.name}…</option>
              {crm.teams.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.people.length})</option>)}
            </select>
          )}
          {mode === "person" && (
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className={field} disabled={!team} aria-label="Person">
              <option value="">{team ? "Person…" : "Pick a team first"}</option>
              {team?.people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.leader ? " (team leader)" : ""}</option>)}
            </select>
          )}
          <p className="text-xs text-muted-foreground">
            {mode === "person" ? "They all go to this person, in this team, as new leads." : mode === "team" ? `Shared out across ${team?.name ?? "the team"}, fewest open leads first.` : `${crm.name} gives them out the way it gives out new leads.`}
            {" "}A number {crm.name} already has goes to that lead&apos;s team leader. Notes and history go with them; the WhatsApp chat doesn&apos;t.
          </p>
        </>
      )}
      <Button className="w-full" disabled={!ready || move.isPending} onClick={() => move.mutate()}>
        {move.isPending ? <Loader2 className="animate-spin" /> : <Send />} Move {leads.length} lead{leads.length === 1 ? "" : "s"}{crm ? ` to ${crm.name}` : ""}
      </Button>
    </div>
  );
}
