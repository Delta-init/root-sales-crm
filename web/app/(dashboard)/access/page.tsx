"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Building2, Download, GraduationCap, KeyRound, Loader2, Plus, Search, ShieldCheck, Trash2, UserPlus, Users2, Wallet,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import type {
  DirectoryPerson, ImportResult, Person, PortalRole, Target, TargetCode, TargetKind,
} from "@/lib/types";

/**
 * Who may open what.
 *
 * The portal used to be a control tower: a handful of super admins, each able
 * to open every CRM, and nothing to decide. Now that ordinary staff sign in
 * here, somebody has to say where each of them may go — and this is the screen
 * that says it.
 *
 * Built around people rather than systems, because the question that gets
 * asked is "what can this person reach", usually while somebody is joining,
 * moving team or leaving. The other direction — everyone who can reach finance
 * — is a report, and this is not it.
 */

const KIND_STYLE: Record<TargetKind, { icon: typeof Building2; className: string }> = {
  crm: { icon: Building2, className: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  finance: { icon: Wallet, className: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  hrms: { icon: GraduationCap, className: "text-violet-400 bg-violet-500/10 border-violet-500/20" },
};

const ROLE_LABEL: Record<PortalRole, string> = {
  root_admin: "Root admin",
  member: "Member",
  viewer: "Viewer",
};

export default function AccessPage() {
  const { admin } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [granting, setGranting] = useState<Person | null>(null);
  const [importing, setImporting] = useState(false);

  const people = useQuery({
    queryKey: ["access", "people", q],
    queryFn: async () =>
      (await api.get<{ data: Person[] }>(`/access/people${q ? `?q=${encodeURIComponent(q)}` : ""}`)).data.data,
  });

  const targets = useQuery({
    queryKey: ["access", "targets"],
    queryFn: async () => (await api.get<{ data: Target[] }>("/access/targets")).data.data,
  });

  const byCode = useMemo(
    () => new Map((targets.data ?? []).map((t) => [t.code, t])),
    [targets.data],
  );

  const revoke = useMutation({
    mutationFn: async (v: { userId: string; target: TargetCode }) =>
      api.delete(`/access/${v.userId}/${v.target}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["access", "people"] }),
  });

  const setRole = useMutation({
    mutationFn: async (v: { userId: string; role: PortalRole }) =>
      api.patch(`/access/${v.userId}/role`, { role: v.role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["access", "people"] }),
  });

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2">
          <KeyRound className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Access</h1>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Who may sign in here, and which systems each of them can open
        </p>
      </motion.div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email…"
            className="pl-9"
          />
        </div>
        {/* HRMS is where a person first exists, so they are brought in from
            there rather than typed here a second time. */}
        <Button variant="outline" className="gap-1.5" onClick={() => setImporting(true)}>
          <Download className="h-4 w-4" /> Import from HRMS
        </Button>
      </div>

      {people.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : (people.data?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Users2 className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">Nobody matches that</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {people.data?.map((p) => (
            <Card key={p.id} className={cn(p.status === "inactive" && "opacity-60")}>
              <CardContent className="flex flex-wrap items-start gap-4 p-4">
                <div className="min-w-[200px] flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{p.name}</p>
                    {p.role === "root_admin" && (
                      <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-400">
                        <ShieldCheck className="h-3 w-3" /> Root admin
                      </Badge>
                    )}
                    {p.status === "inactive" && <Badge variant="outline">Deactivated</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{p.email}</p>

                  {/* What they are in the portal. A root admin opens everything
                      without a single row, so saying so here stops somebody
                      hunting for grants that were never needed. */}
                  <select
                    value={p.role}
                    disabled={p.id === admin?._id || setRole.isPending}
                    onChange={(e) => setRole.mutate({ userId: p.id, role: e.target.value as PortalRole })}
                    className="mt-2 h-7 rounded-md border border-border bg-background px-2 text-xs disabled:opacity-50"
                  >
                    {(Object.keys(ROLE_LABEL) as PortalRole[]).map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                  {p.id === admin?._id && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      You cannot change your own.
                    </p>
                  )}
                </div>

                <div className="flex-[2] space-y-2">
                  {p.role === "root_admin" ? (
                    <p className="text-xs text-muted-foreground">
                      Opens every system without a grant.
                    </p>
                  ) : p.access.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No access yet — they can sign in here and open nothing.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {p.access.map((a) => {
                        const t = byCode.get(a.target);
                        const style = KIND_STYLE[t?.kind ?? "crm"];
                        const Icon = style.icon;
                        return (
                          <span
                            key={a.target}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                              style.className,
                            )}
                          >
                            <Icon className="h-3 w-3" />
                            <span className="font-medium">{t?.name ?? a.target}</span>
                            <span className="opacity-70">· {a.roleInTarget}</span>
                            <button
                              onClick={() => revoke.mutate({ userId: p.id, target: a.target })}
                              title={`Revoke ${t?.name ?? a.target}`}
                              className="ml-0.5 opacity-60 hover:text-red-400 hover:opacity-100"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {p.role !== "root_admin" && (
                  <Button variant="outline" size="sm" onClick={() => setGranting(p)} className="gap-1.5">
                    <Plus className="h-3.5 w-3.5" /> Give access
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ImportDialog
        open={importing}
        targets={targets.data ?? []}
        onClose={() => setImporting(false)}
        onDone={() => void qc.invalidateQueries({ queryKey: ["access", "people"] })}
      />

      <GrantDialog
        person={granting}
        targets={targets.data ?? []}
        onClose={() => setGranting(null)}
        onDone={() => {
          setGranting(null);
          void qc.invalidateQueries({ queryKey: ["access", "people"] });
        }}
      />
    </div>
  );
}

/**
 * Giving one person one door.
 *
 * The role they become on arrival is typed rather than chosen from a list,
 * because the list differs per system and the portal does not hold it: a CRM
 * has BDEs, finance has salespeople and accountants. Suggestions are offered
 * for the common cases, which is as far as a guess should go.
 */
function GrantDialog({
  person, targets, onClose, onDone,
}: {
  person: Person | null;
  targets: Target[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [target, setTarget] = useState<string>("");
  const [role, setRole] = useState("");
  const [error, setError] = useState("");

  const [note, setNote] = useState("");

  /*
   * Making the account in the target, for somebody who has none.
   *
   * Its own button rather than something the grant does quietly. A grant says
   * where somebody may go; this makes them exist there, with a role, in a
   * production system. Rolling the two together would mean every grant
   * creating accounts, which is a much larger thing to do by accident.
   */
  const provision = useMutation({
    mutationFn: async () =>
      (await api.post<{ data: { created: boolean }; message: string }>("/access/provision", {
        userId: person!.id, target, roleInTarget: role.trim(),
      })).data,
    onSuccess: (d) => {
      setError("");
      setNote(d.data.created ? "Account created there." : "They already had an account there.");
    },
    onError: (e: unknown) => {
      setNote("");
      setError(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "The account could not be created",
      );
    },
  });

  const grant = useMutation({
    mutationFn: async () =>
      api.post("/access/grant", { userId: person!.id, target, roleInTarget: role.trim() }),
    onSuccess: () => { setTarget(""); setRole(""); setError(""); setNote(""); onDone(); },
    onError: (e: unknown) => {
      setError(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "That could not be granted",
      );
    },
  });

  const already = new Set(person?.access.map((a) => a.target) ?? []);
  const available = targets.filter((t) => !already.has(t.code));
  const kind = targets.find((t) => t.code === target)?.kind;
  const suggestions =
    kind === "finance" ? ["salesperson", "accountant", "viewer"]
    : kind === "hrms" ? ["employee"]
    : ["BDE", "Team Leader", "Manager"];

  return (
    <Dialog open={Boolean(person)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Give {person?.name} access</DialogTitle>
          <DialogDescription>
            They will be able to open this from the portal without signing in again. An account has
            to exist for them there already — the portal will not create one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">System</label>
            <select
              value={target}
              onChange={(e) => { setTarget(e.target.value); setRole(""); }}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">Choose one…</option>
              {available.map((t) => (
                <option key={t.code} value={t.code}>{t.name}</option>
              ))}
            </select>
            {available.length === 0 && (
              <p className="text-xs text-muted-foreground">
                They already have every system the portal knows about.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Their role there</label>
            <Input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={suggestions[0]}
              disabled={!target}
            />
            {target && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setRole(s)}
                    className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Said here rather than left to be discovered on the first launch:
              access to a system somebody has no account in fails at sign-in,
              with a message they cannot act on. */}
          {target && role.trim() && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
              <p className="text-muted-foreground">
                They need an account in that system already. If they have none, create one here —
                it is made with the role above and no password, since they arrive through the portal.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 gap-1.5"
                disabled={provision.isPending}
                onClick={() => provision.mutate()}
              >
                {provision.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <UserPlus className="h-3.5 w-3.5" />}
                Create their account there
              </Button>
              {note && <p className="mt-2 text-emerald-400">{note}</p>}
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!target || !role.trim() || grant.isPending}
            onClick={() => grant.mutate()}
            className="gap-1.5"
          >
            {grant.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Give access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/**
 * Bringing people in from HRMS.
 *
 * Name and email come from HRMS and cannot be edited here — that is the point
 * of importing rather than typing, since email is what every handoff matches
 * on and a second spelling of an address is somebody who cannot sign in.
 *
 * Their systems can be chosen at the same time, because the alternative is
 * importing twenty people and then opening twenty dialogs. Everybody selected
 * gets the same ones, which is the common case: a batch of joiners on the same
 * team. Anything unusual is a grant afterwards.
 */
function ImportDialog({
  open, targets, onClose, onDone,
}: {
  open: boolean;
  targets: Target[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [grants, setGrants] = useState<{ target: string; roleInTarget: string }[]>([]);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [error, setError] = useState("");

  const directory = useQuery({
    queryKey: ["access", "hrms-directory"],
    enabled: open,
    queryFn: async () =>
      (await api.get<{ data: DirectoryPerson[] }>("/access/hrms-directory")).data.data,
  });

  const run = useMutation({
    mutationFn: async () =>
      (await api.post<{ data: ImportResult[] }>("/access/import", {
        emails: Array.from(picked),
        grants: grants.filter((g) => g.target && g.roleInTarget.trim()),
      })).data.data,
    onSuccess: (r) => { setResults(r); setError(""); onDone(); },
    onError: (e: unknown) => {
      setError(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "The import failed",
      );
    },
  });

  function close() {
    setPicked(new Set());
    setGrants([]);
    setResults(null);
    setError("");
    onClose();
  }

  const available = (directory.data ?? []).filter((d) => !d.alreadyHere);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import from HRMS</DialogTitle>
          <DialogDescription>
            Everybody HR has created. Their name and address come from there, so the two systems
            cannot disagree about who somebody is.
          </DialogDescription>
        </DialogHeader>

        {/* Shown once. There is nowhere else these are kept. */}
        {results ? (
          <div className="space-y-3">
            <p className="text-sm">
              {results.filter((r) => r.created).length} added,{" "}
              {results.filter((r) => !r.created).length} already here.
            </p>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-xs text-amber-400">
                These passwords are shown once and stored nowhere. Copy them before closing.
              </p>
              <div className="mt-2 space-y-1 font-mono text-xs">
                {results.filter((r) => r.password).map((r) => (
                  <div key={r.email} className="flex justify-between gap-3">
                    <span className="truncate">{r.email}</span>
                    <span className="shrink-0 font-semibold">{r.password}</span>
                  </div>
                ))}
              </div>
            </div>
            {results.some((r) => r.note) && (
              <div className="space-y-1 text-xs text-muted-foreground">
                {results.filter((r) => r.note).map((r) => (
                  <p key={r.email}>{r.email} — {r.note}</p>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {directory.isLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Asking HRMS…
              </div>
            ) : directory.isError ? (
              <p className="text-sm text-red-400">
                {(directory.error as { response?: { data?: { message?: string } } })?.response?.data
                  ?.message ?? "HRMS could not be reached"}
              </p>
            ) : available.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Everybody HRMS knows about is already here.
              </p>
            ) : (
              <>
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                  {available.map((d) => (
                    <label
                      key={d.email}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
                    >
                      <input
                        type="checkbox"
                        checked={picked.has(d.email)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(d.email); else next.delete(d.email);
                          setPicked(next);
                        }}
                      />
                      <span className="flex-1 truncate">
                        {d.name}
                        <span className="ml-2 text-xs text-muted-foreground">{d.email}</span>
                      </span>
                      {d.designation && (
                        <span className="shrink-0 text-xs text-muted-foreground">{d.designation}</span>
                      )}
                      {d.status !== "active" && <Badge variant="outline">{d.status}</Badge>}
                    </label>
                  ))}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Give everybody selected these systems (optional)
                  </p>
                  {grants.map((g, i) => (
                    <div key={i} className="flex gap-2">
                      <select
                        value={g.target}
                        onChange={(e) => {
                          const next = [...grants];
                          next[i] = { ...next[i]!, target: e.target.value };
                          setGrants(next);
                        }}
                        className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm"
                      >
                        <option value="">Choose a system…</option>
                        {targets.map((t) => (
                          <option key={t.code} value={t.code}>{t.name}</option>
                        ))}
                      </select>
                      <Input
                        value={g.roleInTarget}
                        onChange={(e) => {
                          const next = [...grants];
                          next[i] = { ...next[i]!, roleInTarget: e.target.value };
                          setGrants(next);
                        }}
                        placeholder="their role there"
                        className="flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setGrants(grants.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setGrants([...grants, { target: "", roleInTarget: "" }])}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add a system
                  </Button>
                </div>
              </>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}

            <DialogFooter>
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button
                disabled={picked.size === 0 || run.isPending}
                onClick={() => run.mutate()}
                className="gap-1.5"
              >
                {run.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Import {picked.size > 0 ? picked.size : ""}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
