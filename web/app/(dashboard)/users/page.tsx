"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  BookOpen, Building2, ChevronRight, Clapperboard, Download, GraduationCap,
  Loader2, Plus, Search, ShieldCheck, Trash2, Users2, Wallet, X,
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
  DirectoryPerson, ImportResult, Person, PortalRole, Target, TargetCode, TargetKind, TargetRole,
} from "@/lib/types";

/**
 * Everybody who can sign in here, and what each of them can open.
 *
 * A table rather than cards: the question this answers is usually asked about
 * a group — who in sales has finance, who still has nothing — and cards put
 * one person on a screen and make you scroll to compare. Rows also make
 * selection obvious, which is what turns "grant twenty people the same thing"
 * from twenty jobs into one.
 */

const KIND_STYLE: Record<TargetKind, { icon: typeof Building2; className: string }> = {
  crm: { icon: Building2, className: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  finance: { icon: Wallet, className: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  hrms: { icon: GraduationCap, className: "text-violet-400 bg-violet-500/10 border-violet-500/20" },
  lms: { icon: BookOpen, className: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
  erp: { icon: Clapperboard, className: "text-pink-400 bg-pink-500/10 border-pink-500/20" },
};

const PAGE_SIZE = 25;

const ROLE_LABEL: Record<PortalRole, string> = {
  root_admin: "Root admin",
  member: "Member",
  viewer: "Viewer",
};

export default function UsersPage() {
  const { admin } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [granting, setGranting] = useState<Person[] | null>(null);
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

  /*
   * Departments, from HRMS rather than from here.
   *
   * This portal stores no department — HR owns that, and a copy taken at
   * import time would say the wrong thing the moment somebody moved teams.
   * So it is read live and joined on email, in its own query: the table is
   * useful without it, and a directory that cannot be reached should cost the
   * department column rather than the whole screen.
   */
  const directory = useQuery({
    queryKey: ["access", "hrms-directory"],
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (await api.get<{ data: DirectoryPerson[] }>("/access/hrms-directory")).data.data,
  });

  const hrms = useMemo(() => {
    const m = new Map<string, DirectoryPerson>();
    for (const d of directory.data ?? []) m.set(d.email.toLowerCase(), d);
    return m;
  }, [directory.data]);

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

  const all = people.data ?? [];

  const departments = useMemo(() => {
    const names = new Set<string>();
    for (const d of directory.data ?? []) if (d.department) names.add(d.department);
    return Array.from(names).sort();
  }, [directory.data]);

  /*
   * Filtered first, then paged. Paging a list before filtering it would show
   * "page 1 of 7" and three matches on it, which is the sort of thing that
   * makes somebody conclude the search is broken.
   */
  const matching = useMemo(() => {
    if (!dept) return all;
    return all.filter((p) => {
      const d = hrms.get(p.email.toLowerCase());
      if (dept === "__none__") return Boolean(d) && !d!.department;
      if (dept === "__missing__") return !d;
      return d?.department === dept;
    });
  }, [all, dept, hrms]);

  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = matching.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  /*
   * Root admins are not selectable. They already open everything without a
   * grant, so including them in a bulk action would record permissions they
   * did not gain and cannot lose.
   */
  /*
   * Selection is per page, deliberately. A header tick that silently reached
   * six other pages would be one click away from granting a hundred and sixty
   * people access to a production system.
   */
  const selectable = rows.filter((p) => p.role !== "root_admin");
  const allPicked = selectable.length > 0 && selectable.every((p) => picked.has(p.id));

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const chosen = rows.filter((p) => picked.has(p.id));

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2">
          <Users2 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Users</h1>
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
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search by name or email…"
            className="pl-9"
          />
        </div>
        {/* HRMS is where a person first exists, so they are brought in from
            there rather than typed here a second time. */}
        <select
          value={dept}
          onChange={(e) => { setDept(e.target.value); setPage(1); }}
          disabled={departments.length === 0}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
        >
          <option value="">Every department</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          {/* Both named, because "no department" and "not in HRMS at all" are
              different facts and somebody auditing access needs to tell them
              apart. Roughly half the staff have no department set. */}
          <option value="__none__">No department set</option>
          <option value="__missing__">Not in HRMS</option>
        </select>
        <Button variant="outline" className="gap-1.5" onClick={() => setImporting(true)}>
          <Download className="h-4 w-4" /> Import from HRMS
        </Button>
      </div>

      {directory.error && (
        <p className="text-xs text-amber-400">
          HRMS could not be read, so departments are unavailable. Everything else still works.
        </p>
      )}

      {/* Only once something is selected, so it does not sit there empty. */}
      {picked.size > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <p className="flex-1 text-sm">
              <span className="font-medium">{picked.size} selected</span>
              <span className="text-muted-foreground"> — give them all the same systems at once.</span>
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => setGranting(chosen)}>
              <Plus className="h-3.5 w-3.5" /> Give access
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
          </CardContent>
        </Card>
      )}

      {people.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Users2 className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">Nobody matches that</p>
            {dept && (
              <button
                onClick={() => { setDept(""); setPage(1); }}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Clear the department filter
              </button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select everybody listed"
                      className="h-4 w-4 accent-primary"
                      checked={allPicked}
                      onChange={() =>
                        setPicked(allPicked ? new Set() : new Set(selectable.map((p) => p.id)))
                      }
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">Person</th>
                  <th className="px-3 py-2.5 font-medium">Department</th>
                  <th className="px-3 py-2.5 font-medium">Here</th>
                  <th className="px-3 py-2.5 font-medium">Can open</th>
                  <th className="w-40 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const isRoot = p.role === "root_admin";
                  const isSelf = admin?._id === p.id;
                  return (
                    <tr
                      key={p.id}
                      className={cn(
                        "border-b border-border/50 last:border-0 hover:bg-muted/20",
                        p.status === "inactive" && "opacity-60",
                        picked.has(p.id) && "bg-primary/5",
                      )}
                    >
                      <td className="px-3 py-2.5 align-top">
                        {!isRoot && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${p.name}`}
                            className="mt-1 h-4 w-4 accent-primary"
                            checked={picked.has(p.id)}
                            onChange={() => toggle(p.id)}
                          />
                        )}
                      </td>

                      <td className="px-3 py-2.5 align-top">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{p.name}</span>
                          {isRoot && (
                            <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-400">
                              <ShieldCheck className="h-3 w-3" /> Root admin
                            </Badge>
                          )}
                          {p.status === "inactive" && <Badge variant="outline">Deactivated</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">{p.email}</p>
                      </td>

                      <td className="px-3 py-2.5 align-top">
                        {(() => {
                          const d = hrms.get(p.email.toLowerCase());
                          if (directory.isLoading) return <Skeleton className="h-4 w-20" />;
                          if (!d) {
                            return (
                              <span className="text-xs text-muted-foreground/60" title="No HRMS employee has this address">
                                not in HRMS
                              </span>
                            );
                          }
                          return d.department
                            ? <span className="text-xs text-muted-foreground">{d.department}</span>
                            : <span className="text-xs text-muted-foreground/60">—</span>;
                        })()}
                      </td>

                      <td className="px-3 py-2.5 align-top">
                        <select
                          value={p.role}
                          disabled={isSelf || setRole.isPending}
                          onChange={(e) =>
                            setRole.mutate({ userId: p.id, role: e.target.value as PortalRole })
                          }
                          className="h-8 rounded-md border border-border bg-background px-2 text-xs disabled:opacity-50"
                        >
                          {(Object.keys(ROLE_LABEL) as PortalRole[]).map((r) => (
                            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                          ))}
                        </select>
                        {isSelf && (
                          <p className="pt-0.5 text-[10px] text-muted-foreground">Your own</p>
                        )}
                      </td>

                      <td className="px-3 py-2.5 align-top">
                        {isRoot ? (
                          <span className="text-xs text-muted-foreground">
                            Every system, without a grant
                          </span>
                        ) : p.access.length === 0 ? (
                          <span className="text-xs text-muted-foreground">Nothing yet</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {p.access.map((a) => {
                              const t = byCode.get(a.target);
                              const k = KIND_STYLE[t?.kind ?? "crm"] ?? KIND_STYLE.crm;
                              const Icon = k.icon;
                              return (
                                <span
                                  key={a.target}
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]",
                                    k.className,
                                  )}
                                >
                                  <Icon className="h-3 w-3" />
                                  {t?.name ?? a.target}
                                  <span className="opacity-70">· {a.roleInTarget}</span>
                                  <button
                                    type="button"
                                    title="Take this away"
                                    className="ml-0.5 opacity-60 hover:opacity-100"
                                    onClick={() => revoke.mutate({ userId: p.id, target: a.target })}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2.5 align-top">
                        <div className="flex justify-end gap-1.5">
                          <Button variant="ghost" size="sm" asChild className="gap-1">
                            <Link href={`/users/${p.id}`}>
                              Manage <ChevronRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                          {!isRoot && (
                            <Button
                              variant="outline" size="sm" className="gap-1"
                              onClick={() => setGranting([p])}
                            >
                              <Plus className="h-3.5 w-3.5" /> Add
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Only when there is more than one page — a pager under a short list is
          furniture that says nothing. */}
      {!people.isLoading && matching.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            {matching.length === all.length
              ? `${all.length} ${all.length === 1 ? "person" : "people"}`
              : `${matching.length} of ${all.length} people`}
            {pageCount > 1 && (
              <span className="text-muted-foreground/70">
                {" "}· showing {(current - 1) * PAGE_SIZE + 1}–
                {Math.min(current * PAGE_SIZE, matching.length)}
              </span>
            )}
          </p>

          {pageCount > 1 && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline" size="sm"
                disabled={current <= 1}
                onClick={() => { setPage(current - 1); setPicked(new Set()); }}
              >
                Previous
              </Button>
              <span className="px-2 text-xs text-muted-foreground">
                Page {current} of {pageCount}
              </span>
              <Button
                variant="outline" size="sm"
                disabled={current >= pageCount}
                onClick={() => { setPage(current + 1); setPicked(new Set()); }}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      <GrantDialog
        people={granting}
        targets={targets.data ?? []}
        onClose={() => setGranting(null)}
        onDone={() => {
          setGranting(null);
          setPicked(new Set());
          void qc.invalidateQueries({ queryKey: ["access", "people"] });
        }}
      />

      <ImportDialog
        open={importing}
        targets={targets.data ?? []}
        onClose={() => setImporting(false)}
        onDone={() => void qc.invalidateQueries({ queryKey: ["access", "people"] })}
      />
    </div>
  );
}

/**
 * One row of "this system, that role".
 *
 * The roles come from the system itself, every time the system changes. A
 * typed role was accepted here and refused much later, at provisioning time,
 * in an application the administrator was not looking at — and a cached list
 * goes stale exactly when somebody has just added the role they are looking
 * for. A system that cannot be asked falls back to a text box rather than
 * blocking the work.
 */
function PlatformRow({
  row, targets, taken, onChange, onRemove,
}: {
  row: { target: string; roleInTarget: string };
  targets: Target[];
  taken: string[];
  onChange: (next: { target: string; roleInTarget: string }) => void;
  onRemove: () => void;
}) {
  const roles = useQuery({
    queryKey: ["target-roles", row.target],
    enabled: Boolean(row.target),
    retry: false,
    staleTime: 60_000,
    queryFn: async () =>
      (await api.get<{ data: { roles: TargetRole[] } }>(`/access/targets/${row.target}/roles`))
        .data.data.roles,
  });

  const list = roles.data ?? [];
  const chosen = list.find((r) => r.key === row.roleInTarget);
  const available = targets.filter((t) => t.code === row.target || !taken.includes(t.code));

  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-2.5">
      <div className="flex items-center gap-2">
        <select
          value={row.target}
          onChange={(e) => onChange({ target: e.target.value, roleInTarget: "" })}
          className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">Choose a system…</option>
          {available.map((t) => (
            <option key={t.code} value={t.code}>{t.name}</option>
          ))}
        </select>

        {roles.isLoading && row.target ? (
          <Skeleton className="h-9 flex-1" />
        ) : list.length > 0 ? (
          <select
            value={row.roleInTarget}
            onChange={(e) => onChange({ ...row, roleInTarget: e.target.value })}
            className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">Choose a role…</option>
            {list.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
        ) : (
          <Input
            value={row.roleInTarget}
            onChange={(e) => onChange({ ...row, roleInTarget: e.target.value })}
            placeholder="Their role there"
            disabled={!row.target}
            className="h-9 flex-1"
          />
        )}

        <Button variant="ghost" size="icon" onClick={onRemove} title="Remove this one">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {row.target && !roles.isLoading && list.length === 0 && (
        <p className="text-[11px] text-amber-400">
          {roles.error
            ? "That system could not be asked for its roles, so this has to be typed."
            : "That system lists no roles, so this has to be typed."}
        </p>
      )}

      {/* What the role permits, from the system itself — so the choice is not
          made from memory of an application they may never have used. */}
      {chosen && (
        <p className="text-[11px] text-muted-foreground">
          {chosen.permissions.length
            ? `Lets them: ${chosen.permissions.slice(0, 6).join(", ")}${
                chosen.permissions.length > 6 ? ` and ${chosen.permissions.length - 6} more` : ""
              }`
            : "No permissions listed."}
        </p>
      )}
    </div>
  );
}

/**
 * Give one person — or twenty — several systems at once.
 *
 * The same dialog either way. Granting one person and granting a team are the
 * same decision made about a different number of people, and two dialogs would
 * be two places for the role map to be applied differently.
 */
function GrantDialog({
  people, targets, onClose, onDone,
}: {
  people: Person[] | null;
  targets: Target[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<{ target: string; roleInTarget: string }[]>([
    { target: "", roleInTarget: "" },
  ]);
  const [results, setResults] = useState<
    { email: string; name: string;
      given: { targetName: string; roleInTarget: string }[];
      alsoGave: { target: string; roleInTarget: string }[];
      failed: { target: string; why: string }[] }[] | null
  >(null);
  const [error, setError] = useState("");

  const open = Boolean(people && people.length);
  const many = (people?.length ?? 0) > 1;

  const run = useMutation({
    mutationFn: async () =>
      (await api.post<{ data: typeof results }>("/access/grant-many", {
        userIds: (people ?? []).map((p) => p.id),
        grants: rows.filter((r) => r.target && r.roleInTarget.trim()),
      })).data.data,
    onSuccess: (r) => { setResults(r ?? []); setError(""); },
    onError: (e: unknown) =>
      setError(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "That could not be granted",
      ),
  });

  function close() {
    setRows([{ target: "", roleInTarget: "" }]);
    setResults(null);
    setError("");
    onClose();
  }

  const ready = rows.some((r) => r.target && r.roleInTarget.trim());
  const taken = rows.map((r) => r.target).filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {many ? `Give ${people!.length} people access` : `Give ${people?.[0]?.name} access`}
          </DialogTitle>
          <DialogDescription>
            Pick a system and the role they take there. Add as many systems as you need — they
            are applied together.
          </DialogDescription>
        </DialogHeader>

        {results ? (
          <div className="space-y-3">
            {results.map((r) => (
              <div key={r.email} className="rounded-lg border border-border p-2.5 text-xs">
                <p className="font-medium">{r.name}</p>
                {r.given.map((g) => (
                  <p key={g.targetName} className="text-emerald-400">
                    ✓ {g.targetName} as {g.roleInTarget}
                  </p>
                ))}
                {/* Access appearing that nobody asked for is alarming even when
                    it is right, so the role map's additions are named. */}
                {r.alsoGave.map((g, i) => (
                  <p key={i} className="text-muted-foreground">
                    → also {g.target} as {g.roleInTarget}, from the role map
                  </p>
                ))}
                {r.failed.map((f, i) => (
                  <p key={i} className="text-red-400">✗ {f.target} — {f.why}</p>
                ))}
              </div>
            ))}
            <DialogFooter>
              <Button onClick={() => { onDone(); close(); }}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            {many && (
              <p className="rounded-md border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
                {people!.map((p) => p.name).join(", ")}
              </p>
            )}

            {rows.map((row, i) => (
              <PlatformRow
                key={i}
                row={row}
                targets={targets}
                taken={taken}
                onChange={(next) => setRows(rows.map((r, j) => (j === i ? next : r)))}
                onRemove={() =>
                  setRows(rows.length === 1 ? [{ target: "", roleInTarget: "" }] : rows.filter((_, j) => j !== i))
                }
              />
            ))}

            <Button
              variant="outline" size="sm" className="gap-1.5"
              disabled={taken.length >= targets.length}
              onClick={() => setRows([...rows, { target: "", roleInTarget: "" }])}
            >
              <Plus className="h-3.5 w-3.5" /> Add another system
            </Button>

            <p className="text-[11px] text-muted-foreground">
              This says where they may go. It does not create their account there — that is a
              separate step on the person&apos;s own page.
            </p>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <DialogFooter>
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button disabled={!ready || run.isPending} onClick={() => run.mutate()} className="gap-1.5">
                {run.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Give access
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Bringing people in from HRMS.
 *
 * A hundred and sixty people is too many to find somebody in by scrolling, so
 * the list is searchable and filterable by department. Roughly half have no
 * department set in HRMS — they get their own group rather than disappearing
 * from a filter that would otherwise look broken.
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
  const [rows, setRows] = useState<{ target: string; roleInTarget: string }[]>([]);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");

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
        grants: rows.filter((g) => g.target && g.roleInTarget.trim()),
      })).data.data,
    onSuccess: (r) => { setResults(r); setError(""); onDone(); },
    onError: (e: unknown) =>
      setError(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "The import failed",
      ),
  });

  function close() {
    setPicked(new Set()); setRows([]); setResults(null);
    setError(""); setQ(""); setDept("");
    onClose();
  }

  const all = directory.data ?? [];
  const available = all.filter((d) => !d.alreadyHere);

  const departments = useMemo(() => {
    const names = new Set<string>();
    let anyBlank = false;
    for (const d of available) {
      if (d.department) names.add(d.department); else anyBlank = true;
    }
    return { names: Array.from(names).sort(), anyBlank };
  }, [available]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return available.filter((d) => {
      if (dept === "__none__" ? Boolean(d.department) : dept && d.department !== dept) return false;
      if (!needle) return true;
      return (
        d.name.toLowerCase().includes(needle) ||
        d.email.toLowerCase().includes(needle) ||
        (d.designation ?? "").toLowerCase().includes(needle)
      );
    });
  }, [available, q, dept]);

  // Select-all applies to what is on screen, not to everybody: the filter is
  // how somebody narrows to the group they mean, and ignoring it would import
  // the other hundred and forty.
  const allShown = shown.length > 0 && shown.every((d) => picked.has(d.email));
  const taken = rows.map((r) => r.target).filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import from HRMS</DialogTitle>
          <DialogDescription>
            Everybody HR has created. Their name and address come from there, so the two systems
            cannot disagree about who somebody is.
          </DialogDescription>
        </DialogHeader>

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
            <DialogFooter><Button onClick={close}>Done</Button></DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search name, email or job title…"
                  className="h-9 pl-9"
                />
              </div>
              <select
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">Every department</option>
                {departments.names.map((d) => <option key={d} value={d}>{d}</option>)}
                {departments.anyBlank && <option value="__none__">No department set</option>}
              </select>
              <Button
                variant="outline" size="sm"
                disabled={shown.length === 0}
                onClick={() =>
                  setPicked((s) => {
                    const next = new Set(s);
                    if (allShown) shown.forEach((d) => next.delete(d.email));
                    else shown.forEach((d) => next.add(d.email));
                    return next;
                  })
                }
              >
                {allShown ? "Clear these" : `Select all ${shown.length}`}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              {picked.size} selected · showing {shown.length} of {available.length} not yet here
              {all.length - available.length > 0 && ` · ${all.length - available.length} already imported`}
            </p>

            {directory.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : directory.error ? (
              <p className="text-sm text-red-400">
                HRMS could not be read — {(directory.error as { response?: { data?: { message?: string } } })
                  ?.response?.data?.message ?? "no answer"}
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                {shown.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">Nobody matches that</p>
                ) : shown.map((d) => (
                  <label
                    key={d.email}
                    className="flex cursor-pointer items-center gap-3 border-b border-border/50 px-3 py-2 last:border-0 hover:bg-muted/30"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={picked.has(d.email)}
                      onChange={() => {
                        const next = new Set(picked);
                        if (next.has(d.email)) next.delete(d.email); else next.add(d.email);
                        setPicked(next);
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="truncate text-sm">{d.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{d.email}</span>
                    </span>
                    {d.department && (
                      <span className="shrink-0 text-[11px] text-muted-foreground">{d.department}</span>
                    )}
                    {d.designation && (
                      <span className="shrink-0 text-xs text-muted-foreground">{d.designation}</span>
                    )}
                    {/* Leavers come through flagged rather than hidden, because
                        somebody who has left still needs their access closed. */}
                    {d.status !== "active" && <Badge variant="outline">{d.status}</Badge>}
                  </label>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Give everybody selected these systems (optional)
              </p>
              {rows.map((row, i) => (
                <PlatformRow
                  key={i}
                  row={row}
                  targets={targets}
                  taken={taken}
                  onChange={(next) => setRows(rows.map((r, j) => (j === i ? next : r)))}
                  onRemove={() => setRows(rows.filter((_, j) => j !== i))}
                />
              ))}
              <Button
                variant="outline" size="sm" className="gap-1.5"
                disabled={taken.length >= targets.length}
                onClick={() => setRows([...rows, { target: "", roleInTarget: "" }])}
              >
                <Plus className="h-3.5 w-3.5" /> Add a system
              </Button>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <DialogFooter>
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button
                disabled={picked.size === 0 || run.isPending}
                onClick={() => run.mutate()}
                className="gap-1.5"
              >
                {run.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Import {picked.size > 0 && picked.size}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
