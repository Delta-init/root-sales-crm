"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { AlertTriangle, CalendarClock, Clock, FileClock, Hourglass, Inbox, RefreshCw, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CseStatCard } from "@/components/cses/CseStatCard";
import { BreakdownDialog, Bars, type BarRow, type BreakdownTab } from "@/components/common/Breakdown";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { FinanceWatch } from "@/lib/types";

/**
 * Pending → Finance (the user, 2026-10-17): "approvals pending, or 30 minutes
 * delayed approvals, and old-date transactions entered" — with total cards like
 * the CS portal tab.
 *
 *   Approvals waiting   everything on finance's Approvals page, every
 *                       organization, and late entries waiting for a manager;
 *                       how long each has waited — past 30 minutes, delayed
 *   Old-date entries    entered in the last 30 days with a date of its own a
 *                       day or more before the day it was typed: payments,
 *                       expenses, bills, invoices, cash lines — how each got in
 *                       (typed in finance, recorded by an approval, from HRMS),
 *                       who entered it, and the late-entry reason and decision
 *
 * Finance answers for itself (GET /service/finance-watch). Read-only.
 */

type Approval = FinanceWatch["approvals"]["rows"][number];
type Entry = FinanceWatch["backdated"]["rows"][number];
type Pick = "waiting" | "delayed" | "oldest" | "entries" | "late" | "gap" | null;
const ORIGIN: Record<Entry["origin"], { label: string; cls: string }> = {
  typed: { label: "Typed in finance", cls: "text-amber-500" },
  approval: { label: "Recorded by an approval", cls: "text-muted-foreground" },
  hrms: { label: "From HRMS", cls: "text-muted-foreground" },
};
const LATE: Record<string, { label: string; cls: string }> = {
  pending: { label: "Waiting for a manager", cls: "text-amber-500" },
  approved: { label: "Manager approved", cls: "text-emerald-500" },
  rejected: { label: "Manager rejected", cls: "text-rose-500" },
};

const money = (minor: number | undefined, currency: string | undefined) =>
  minor === undefined ? "—" : `${currency || "AED"} ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
};
const day = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(d);
};
/** "25 min", "3 h 10 m", "2 d 4 h". */
const waited = (min: number) => {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h ${String(min % 60).padStart(2, "0")} m` : `${Math.floor(h / 24)} d ${h % 24} h`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const bars = <T,>(rows: T[], key: (x: T) => string, label: (x: T) => string = key): BarRow[] => {
  const m = new Map<string, BarRow>();
  for (const x of rows) {
    const k = key(x) || "—";
    const r = m.get(k) ?? { key: k, label: label(x) || "—", value: 0 };
    r.value++;
    m.set(k, r);
  }
  return Array.from(m.values());
};

export function FinanceWatchView() {
  const [org, setOrg] = useState("all");
  const [pick, setPick] = useState<Pick>(null);
  const [entryFilter, setEntryFilter] = useState<"all" | Entry["origin"]>("typed");
  const [approvalFilter, setApprovalFilter] = useState<"all" | "delayed">("all");
  const q = useQuery({
    queryKey: ["pending-finance"],
    queryFn: async () => (await api.get("/pending/finance")).data.data as FinanceWatch,
    refetchInterval: 60_000,
    retry: 1,
  });
  const data = q.data;
  const approvals = useMemo(() => (data?.approvals.rows ?? []).filter((a) => org === "all" || a.orgId === org), [data, org]);
  const entries = useMemo(() => (data?.backdated.rows ?? []).filter((e) => org === "all" || e.orgId === org), [data, org]);

  if (q.error instanceof AxiosError && q.error.response?.status === 403) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">You haven&apos;t been given this Pending tab — a root admin gives it on Users.</CardContent></Card>;
  }
  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}</div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (q.isError || !data) {
    const message = q.error instanceof AxiosError ? (q.error.response?.data as { message?: string } | undefined)?.message : undefined;
    return (
      <Card className="border-rose-500/40 bg-rose-500/5">
        <CardContent className="flex gap-3 pt-6 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
          {q.error instanceof AxiosError && q.error.response?.status === 404 && !message
            ? "Root's server is still on the previous version — this tab shows once it is updated."
            : message || "Could not load finance. Refresh in a moment."}
        </CardContent>
      </Card>
    );
  }

  const delayed = approvals.filter((a) => a.delayed);
  const oldest = approvals[0];
  const typed = entries.filter((e) => e.origin === "typed");
  const lateWaiting = approvals.filter((a) => a.type === "late_entry");
  const biggest = entries.reduce<Entry | null>((m, e) => (!m || e.daysBack > m.daysBack ? e : m), null);
  const link = (href: string, label: ReactNode) => data.appUrl
    ? <a href={`${data.appUrl}${href}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">{label}</a>
    : <span className="font-medium">{label}</span>;

  const approvalTable = (rows: Approval[]) => rows.length === 0
    ? <p className="py-8 text-center text-sm text-muted-foreground">Nothing waiting.</p>
    : (
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">What</th><th className="pb-2 pr-3 font-medium">Organization</th><th className="pb-2 pr-3 font-medium">Raised by</th>
              <th className="pb-2 pr-3 text-right font-medium">Amount</th><th className="pb-2 text-right font-medium">Waiting</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={`${a.type}-${a.id}`} className="border-b border-border/20 align-top last:border-0">
                <td className="py-2 pr-3">{link(a.href, a.title || a.kind)}<div className="text-xs text-muted-foreground">{[a.kind, a.subtitle].filter(Boolean).join(" · ")}</div></td>
                <td className="py-2 pr-3">{a.orgName}</td>
                <td className="py-2 pr-3">{a.raisedBy || "—"}</td>
                <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{money(a.amountMinor, a.currency)}</td>
                <td className={cn("whitespace-nowrap py-2 text-right tabular-nums", a.delayed && "font-medium text-rose-500")}>
                  {waited(a.waitingMinutes)}<div className="text-xs font-normal text-muted-foreground">since {when(a.submittedAt)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  const entryTable = (rows: Entry[]) => rows.length === 0
    ? <p className="py-8 text-center text-sm text-muted-foreground">Nothing entered with an old date.</p>
    : (
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">Entry</th><th className="pb-2 pr-3 font-medium">Its date</th><th className="pb-2 pr-3 font-medium">Entered</th>
              <th className="pb-2 pr-3 text-right font-medium">Days back</th><th className="pb-2 pr-3 text-right font-medium">Amount</th><th className="pb-2 font-medium">How · who · late entry</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={`${e.kind}-${e.id}`} className="border-b border-border/20 align-top last:border-0">
                <td className="py-2 pr-3">
                  {link(e.href, [e.number, e.title].filter(Boolean).join(" · ") || e.kind)}
                  <div className="text-xs text-muted-foreground">{e.kind.replace(/_/g, " ")} · {e.orgName}</div>
                </td>
                <td className="whitespace-nowrap py-2 pr-3">{day(e.date)}</td>
                <td className="whitespace-nowrap py-2 pr-3">{when(e.enteredAt)}</td>
                <td className={cn("py-2 pr-3 text-right font-medium tabular-nums", e.daysBack >= 7 ? "text-rose-500" : "text-amber-500")}>{e.daysBack}</td>
                <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{money(e.amountMinor, e.currency)}</td>
                <td className="py-2 text-xs">
                  <span className={ORIGIN[e.origin].cls}>{ORIGIN[e.origin].label}</span>
                  {e.enteredBy ? <span className="text-muted-foreground"> · {e.enteredBy}</span> : null}
                  {e.late ? (
                    <div className="mt-0.5">
                      <span className={LATE[e.late.state]?.cls}>{LATE[e.late.state]?.label ?? e.late.state}</span>
                      {e.late.decidedBy ? <span className="text-muted-foreground"> ({e.late.decidedBy})</span> : null}
                      {e.late.reason ? <div className="text-muted-foreground">&ldquo;{e.late.reason}&rdquo;</div> : null}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  const dialogs: Record<NonNullable<Pick>, { title: string; about: string; tabs: BreakdownTab[] }> = {
    waiting: { title: `Approvals waiting · ${approvals.length}`, about: "Everything on finance's Approvals page and late entries waiting for a manager, longest waiting first.", tabs: [
      { key: "list", label: "List", content: approvalTable(approvals) },
      { key: "kind", label: "By kind", content: <Bars rows={bars(approvals, (a) => a.kind)} /> },
      { key: "org", label: "By organization", content: <Bars rows={bars(approvals, (a) => a.orgName)} /> },
      { key: "raiser", label: "By who raised it", content: <Bars rows={bars(approvals, (a) => a.raisedBy || "Not recorded")} /> },
    ] },
    delayed: { title: `Delayed — over ${data.rules.delayMinutes} minutes · ${delayed.length}`, about: `Waiting more than ${data.rules.delayMinutes} minutes since it was sent, counted around the clock.`, tabs: [
      { key: "list", label: "List", content: approvalTable(delayed) },
      { key: "kind", label: "By kind", content: <Bars rows={bars(delayed, (a) => a.kind)} /> },
      { key: "org", label: "By organization", content: <Bars rows={bars(delayed, (a) => a.orgName)} /> },
    ] },
    oldest: { title: "Waiting longest", about: "The ten approvals that have waited longest.", tabs: [{ key: "list", label: "List", content: approvalTable(approvals.slice(0, 10)) }] },
    entries: { title: `Entered with an old date · ${entries.length}`, about: `Entered in the last ${data.rules.enteredWithinDays} days with a date of its own ${plural(data.rules.backdateMinDays, "day")} or more before the day it was typed (Gulf days).`, tabs: [
      { key: "typed", label: `Typed in finance · ${typed.length}`, content: entryTable(typed) },
      { key: "all", label: `All · ${entries.length}`, content: entryTable(entries) },
      { key: "kind", label: "By kind", content: <Bars rows={bars(entries, (e) => e.kind, (e) => e.kind.replace(/_/g, " "))} /> },
      { key: "who", label: "By who entered it", content: <Bars rows={bars(typed, (e) => e.enteredBy || "Not recorded")} /> },
    ] },
    late: { title: `Late entries waiting for a manager · ${lateWaiting.length}`, about: "Old-dated entries past finance's late-entry limit, waiting for a manager to approve or reject them.", tabs: [
      { key: "list", label: "List", content: approvalTable(lateWaiting) },
    ] },
    gap: { title: "Furthest back", about: "Entries whose own date is furthest before the day they were typed.", tabs: [
      { key: "list", label: "List", content: entryTable([...entries].sort((a, b) => b.daysBack - a.daysBack).slice(0, 20)) },
    ] },
  };

  const shownApprovals = approvalFilter === "delayed" ? delayed : approvals;
  const shownEntries = entryFilter === "all" ? entries : entries.filter((e) => e.origin === entryFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Organization">
          <Button size="sm" variant={org === "all" ? "default" : "outline"} onClick={() => setOrg("all")}>Every organization</Button>
          {data.organizations.map((o) => (
            <Button key={o.id} size="sm" variant={org === o.id ? "default" : "outline"} onClick={() => setOrg(o.id)}>{o.name}</Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Updated {time(data.generatedAt)} · every minute</span>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={cn(q.isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <CseStatCard icon={Inbox} title="Approvals waiting" onClick={() => setPick("waiting")} value={String(approvals.length)}
          hint={data.approvals.byKind.slice(0, 2).map((k) => `${k.total} ${k.label.toLowerCase()}`).join(" · ") || "nothing waiting"} />
        <CseStatCard icon={Clock} accent="rose" title={`Delayed — ${data.rules.delayMinutes} min+`} onClick={() => setPick("delayed")} value={String(delayed.length)}
          hint={delayed.length ? "waiting past the 30 minutes" : "nothing late"} alert={delayed.length > 0} delay={0.05} />
        <CseStatCard icon={Hourglass} accent="amber" title="Waiting longest" onClick={() => setPick("oldest")} value={oldest ? waited(oldest.waitingMinutes) : "—"}
          hint={oldest ? `${oldest.kind} · ${oldest.title}` : "nothing waiting"} delay={0.1} />
        <CseStatCard icon={CalendarClock} accent="violet" title="Old-date entries" onClick={() => setPick("entries")} value={String(entries.length)}
          hint={`${typed.length} typed in finance · last ${data.rules.enteredWithinDays} days`} delay={0.15} />
        <CseStatCard icon={ShieldAlert} accent="amber" title="Late entries waiting" onClick={() => setPick("late")} value={String(lateWaiting.length)}
          hint="for a manager's approval" alert={lateWaiting.length > 0} delay={0.2} />
        <CseStatCard icon={FileClock} accent="cyan" title="Furthest back" onClick={() => setPick("gap")} value={biggest ? `${biggest.daysBack} days` : "—"}
          hint={biggest ? `${biggest.number || biggest.kind} · ${biggest.orgName}` : "nothing old-dated"} delay={0.25} />
      </div>

      {data.approvals.unavailable.length > 0 && (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span className="text-muted-foreground">Not counted right now: {data.approvals.unavailable.join("; ")}.</span>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Approvals waiting · {shownApprovals.length}</CardTitle>
            <div className="flex gap-1.5">
              <Button size="sm" variant={approvalFilter === "all" ? "secondary" : "ghost"} onClick={() => setApprovalFilter("all")}>All {approvals.length}</Button>
              <Button size="sm" variant={approvalFilter === "delayed" ? "secondary" : "ghost"} onClick={() => setApprovalFilter("delayed")}>
                <span className={cn(delayed.length && "text-rose-500")}>Delayed {delayed.length}</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>{approvalTable(shownApprovals)}</CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Entered with an old date · {shownEntries.length}</CardTitle>
            <div className="flex flex-wrap gap-1.5">
              {(["typed", "approval", "hrms", "all"] as const).map((k) => (
                <Button key={k} size="sm" variant={entryFilter === k ? "secondary" : "ghost"} onClick={() => setEntryFilter(k)}>
                  {k === "all" ? "All" : ORIGIN[k].label} {k === "all" ? entries.length : entries.filter((e) => e.origin === k).length}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {entryTable(shownEntries)}
          <p className="mt-3 text-xs text-muted-foreground">
            Days back is from the entry&apos;s own date to the day it was typed in (Gulf days); 7 or more in red. &ldquo;Recorded by an approval&rdquo; is a payment
            or invoice that came in when an enrolment or balance payment was approved, dated as the CRM or CS Portal gave it.
          </p>
        </CardContent>
      </Card>

      {pick && <BreakdownDialog open onClose={() => setPick(null)} title={dialogs[pick].title} description={dialogs[pick].about} tabs={dialogs[pick].tabs} />}
    </div>
  );
}
