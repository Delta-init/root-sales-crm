"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Loader2, ShieldCheck, ShieldAlert, ShieldOff,
  UserPlus, Trash2, Check, AlertTriangle, PlugZap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import { useAuth } from "@/providers/AuthProvider";
import type { PersonDetail, PortalRole, TargetRole, TargetView } from "@/lib/types";

/**
 * One person, as every system actually sees them.
 *
 * The list screen answers "who can open what" from this portal's own records.
 * That is what somebody once decided, which is not the same as what is true —
 * a role changed directly in finance, or an account that exists there and was
 * never granted here, are both invisible to it.
 *
 * So this page asks each system instead, puts the answer next to the grant,
 * and names the disagreement where there is one. Everything an administrator
 * can change about a person lives here: which systems they may open, what
 * they are once they arrive, and what that lets them do.
 */

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

/**
 * What somebody is in this portal, as opposed to in any system it fronts.
 *
 * Two different things share the word "role" here and confusing them is easy:
 * this one decides whether they administer the portal, may launch into what
 * they have been granted, or may only read the group report. The roles on the
 * cards below are what they become inside another system once they arrive.
 */
const PORTAL_ROLE_LABEL: Record<PortalRole, string> = {
  root_admin: "Root admin",
  member: "Member",
  viewer: "Viewer",
};

export default function PersonAccessPage() {
  const { userId } = useParams<{ userId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { admin } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["person-access", userId],
    queryFn: async () =>
      (await api.get<{ data: PersonDetail }>(`/access/person/${userId}`)).data.data,
  });

  /*
   * What they are in the portal itself.
   *
   * This used to be a dropdown in a column of the user list, which put the
   * portal's own roles beside the roles people hold in other systems and
   * invited reading them as the same kind of thing. It belongs here, with
   * everything else that is true of one person.
   *
   * The user list is invalidated too: it shows this role, and leaving it
   * stale would have the two screens disagreeing about the same person.
   */
  const setPortalRole = useMutation({
    mutationFn: async (role: PortalRole) =>
      api.patch(`/access/${userId}/role`, { role }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["person-access", userId] });
      void qc.invalidateQueries({ queryKey: ["access", "people"] });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!data) return <div className="p-6 text-sm text-muted-foreground">No such person.</div>;

  const { person, targets } = data;
  const isSelf = admin?._id === person.id;
  const withAccount = targets.filter((t) => t.account?.inOrganization || t.granted);
  const drifting = targets.filter((t) => t.drift);

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/users")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{person.name}</h1>
          <p className="truncate text-sm text-muted-foreground">{person.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={person.status === "active" ? "default" : "secondary"}>
            {person.status}
          </Badge>
          {/*
            Nobody changes their own, deliberately: a root admin who makes
            themselves a viewer by accident has locked themselves out of the
            screen that would put it back.
          */}
          {isSelf ? (
            <div className="text-right">
              <Badge variant="outline">{PORTAL_ROLE_LABEL[person.role as PortalRole] ?? person.role}</Badge>
              <p className="pt-0.5 text-[10px] text-muted-foreground">Your own</p>
            </div>
          ) : (
            <label className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">In the portal</span>
              <select
                value={person.role}
                disabled={setPortalRole.isPending}
                onChange={(e) => setPortalRole.mutate(e.target.value as PortalRole)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs disabled:opacity-50"
              >
                {(Object.keys(PORTAL_ROLE_LABEL) as PortalRole[]).map((r) => (
                  <option key={r} value={r}>{PORTAL_ROLE_LABEL[r]}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {/*
        The disagreements first, and only when there are any.
        Somebody opening this page to check one thing should not have to read
        eight cards to find the one that is wrong.
      */}
      {drifting.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="space-y-1.5 p-4">
            <p className="flex items-center gap-1.5 text-sm font-medium text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              {drifting.length === 1
                ? "One system does not match this portal's record"
                : `${drifting.length} systems do not match this portal's records`}
            </p>
            {drifting.map((t) => (
              <p key={t.target} className="text-xs text-muted-foreground">
                <span className="text-foreground">{t.targetName}:</span> {t.drift}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        {withAccount.length === 0
          ? "They cannot open anything yet."
          : `They can open ${withAccount.length} of the ${targets.length} systems the portal knows about.`}
      </p>

      <div className="space-y-3">
        {targets.map((t) => (
          <TargetCard key={t.target} view={t} userId={userId} personName={person.name}
            onChanged={() => qc.invalidateQueries({ queryKey: ["person-access", userId] })} />
        ))}
      </div>
    </div>
  );
}

/**
 * One system, and everything that can be done about it from here.
 *
 * Kept as one card per system rather than a table: each one carries a role,
 * what that role permits, whether the account exists, and up to three actions,
 * and a row wide enough for all of that is a row nobody can read.
 */
function TargetCard({
  view, userId, personName, onChanged,
}: {
  view: TargetView; userId: string; personName: string; onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(view.account?.roleKey ?? view.roleInTarget ?? "");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const say = (e: unknown, fallback: string) =>
    setErr((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback);

  /* The roles that system has — asked only when somebody opens the editor. */
  const roleList = useQuery({
    queryKey: ["target-roles", view.target],
    enabled: editing,
    retry: false,
    staleTime: 60_000,
    queryFn: async () =>
      (await api.get<{ data: { roles: TargetRole[] } }>(`/access/targets/${view.target}/roles`))
        .data.data.roles,
  });
  const roles = roleList.data ?? [];
  const chosen = roles.find((r) => r.key === role);

  /*
   * Changing the role in that system, not just the note here.
   *
   * The old screen could only edit the portal's own record, so an
   * administrator could "change" somebody's finance role and finance would
   * carry on exactly as before.
   */
  const changeRole = useMutation({
    mutationFn: async () =>
      (await api.patch<{ message: string }>(`/access/${userId}/${view.target}/role`, {
        roleInTarget: role.trim(),
      })).data,
    onSuccess: (d) => { setErr(""); setMsg(d.message); setEditing(false); onChanged(); },
    onError: (e) => { setMsg(""); say(e, "That role could not be changed"); },
  });

  const provision = useMutation({
    mutationFn: async () =>
      (await api.post<{ message: string }>("/access/provision", {
        userId, target: view.target, roleInTarget: role.trim() || view.roleInTarget,
      })).data,
    onSuccess: (d) => { setErr(""); setMsg(d.message); onChanged(); },
    onError: (e) => { setMsg(""); say(e, "The account could not be created"); },
  });

  const revoke = useMutation({
    mutationFn: async () => api.delete(`/access/${userId}/${view.target}`),
    onSuccess: () => { setErr(""); setMsg(""); onChanged(); },
    onError: (e) => say(e, "That could not be revoked"),
  });

  const grant = useMutation({
    mutationFn: async () =>
      api.post("/access/grant", { userId, target: view.target, roleInTarget: role.trim() }),
    onSuccess: () => { setErr(""); setMsg(""); setEditing(false); onChanged(); },
    onError: (e) => say(e, "That could not be granted"),
  });

  const acct = view.account;
  const live = acct?.inOrganization;

  return (
    <Card className={view.drift ? "border-amber-500/40" : undefined}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium">{view.targetName}</p>
              <Badge variant="outline" className="text-[10px]">{view.kind}</Badge>
            </div>

            {/* The state, in one line, from whichever source can actually answer. */}
            {view.unreachable ? (
              <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                <PlugZap className="h-3.5 w-3.5" />
                Could not be asked — {view.unreachable}
              </p>
            ) : live ? (
              <p className="flex items-center gap-1.5 pt-1 text-xs text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                {acct!.roleName ?? acct!.roleKey}
                {acct!.membershipStatus && acct!.membershipStatus !== "active" &&
                  ` — ${acct!.membershipStatus} there`}
                <span className="text-muted-foreground">· last signed in {fmt(acct!.lastLoginAt)}</span>
              </p>
            ) : view.granted ? (
              <p className="flex items-center gap-1.5 pt-1 text-xs text-amber-400">
                <ShieldAlert className="h-3.5 w-3.5" />
                Granted as {view.roleInTarget}, but no account exists there yet
              </p>
            ) : (
              <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                <ShieldOff className="h-3.5 w-3.5" />
                No access
              </p>
            )}

            {view.granted && (
              <p className="pt-0.5 text-[11px] text-muted-foreground">
                Granted {fmt(view.grantedAt)}
              </p>
            )}
          </div>

          {!view.unreachable && (
            <div className="flex shrink-0 gap-1.5">
              <Button variant="outline" size="sm" onClick={() => { setEditing((v) => !v); setMsg(""); setErr(""); }}>
                {live ? "Change role" : view.granted ? "Set role" : "Give access"}
              </Button>
              {view.granted && (
                <Button
                  variant="ghost" size="icon"
                  title="Revoke this portal's grant"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate()}
                >
                  {revoke.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* What they can currently do there, from the system itself. */}
        {live && acct!.permissions.length > 0 && !editing && (
          <p className="text-[11px] text-muted-foreground">
            Lets them: {acct!.permissions.slice(0, 8).join(", ")}
            {acct!.permissions.length > 8 && ` and ${acct!.permissions.length - 8} more`}
          </p>
        )}

        {editing && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
            {roleList.isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : roles.length > 0 ? (
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">Choose a role…</option>
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>{r.name}</option>
                ))}
              </select>
            ) : (
              <input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Their role there"
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              />
            )}

            {chosen && (
              <div className="text-[11px] text-muted-foreground">
                {chosen.description && <p>{chosen.description}</p>}
                <p>
                  {chosen.permissions.length
                    ? `Lets them: ${chosen.permissions.slice(0, 8).join(", ")}${
                        chosen.permissions.length > 8 ? ` and ${chosen.permissions.length - 8} more` : ""
                      }`
                    : "No permissions listed."}
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-0.5">
              {live ? (
                <Button
                  size="sm" className="gap-1.5"
                  disabled={!role.trim() || role === acct!.roleKey || changeRole.isPending}
                  onClick={() => changeRole.mutate()}
                >
                  {changeRole.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Check className="h-3.5 w-3.5" />}
                  Change it in {view.targetName}
                </Button>
              ) : (
                <>
                  {!view.granted && (
                    <Button size="sm" disabled={!role.trim() || grant.isPending}
                      onClick={() => grant.mutate()} className="gap-1.5">
                      {grant.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Give access
                    </Button>
                  )}
                  {/* Creating the account is its own act, and says so. A grant
                      decides where somebody may go; this makes them exist in a
                      production system. */}
                  <Button
                    size="sm" variant="outline" className="gap-1.5"
                    disabled={!role.trim() || provision.isPending}
                    onClick={() => provision.mutate()}
                  >
                    {provision.isPending
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <UserPlus className="h-3.5 w-3.5" />}
                    Create their account there
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>

            <p className="text-[11px] text-muted-foreground">
              {live
                ? `This changes what ${personName} is inside ${view.targetName}, not just what this portal records.`
                : `${view.targetName} will not create an account on its own — they need one before they can sign in.`}
            </p>
          </div>
        )}

        {msg && <p className="text-xs text-emerald-400">{msg}</p>}
        {err && <p className="text-xs text-red-400">{err}</p>}
      </CardContent>
    </Card>
  );
}
