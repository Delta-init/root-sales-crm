"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AxiosError } from "axios";
import { AlarmClock, AlertTriangle, BellRing, ChevronRight, Inbox, Phone, PhoneOff, RefreshCw, Search, ThumbsDown, Undo2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CseStatCard } from "@/components/cses/CseStatCard";
import { BreakdownDialog, Bars, type BarRow, type BreakdownTab } from "@/components/common/Breakdown";
import { Recording } from "@/components/calls/Recording";
import { api } from "@/lib/axios";
import { PersonLink } from "@/components/pending/access";
import { FlowBox, StepDots, STEP_LABEL, STEP_OWNER, STEPS, daysSince, whoLabel } from "@/components/pending/EnrolmentFlow";
import { fmtMoney } from "@/lib/salesTv";
import { cn } from "@/lib/utils";
import { CALL_PERIODS, callLength, periodDays, talkTime, type CallPeriod } from "@/lib/calls";
import type { FlowStep, SalesPending, SalesPendingCounts } from "@/lib/types";

/**
 * One sales CRM's tab on Pending → Sales (the user, 2026-10-17): total cards and
 * each salesperson's —
 *
 *   Inactive leads   the CRM's own Inactive leads page (owner hasn't acted in time)
 *   Reminders        their reminders past their time, not done
 *   Not connected    leads marked not connected in the period
 *   Lost             leads marked lost in the period, and why (lost reasons)
 *   Calls            calls in the calls period, connected, talk time — each
 *                    call with its recording
 *   Sent back        (2026-10-29) enrolments finance sent back, not sent again
 *                    yet — the course, the fee and what came in, finance's reason
 *
 * And the CRM's enrolment workflow (2026-10-29): Pending → Enrolments' chart
 * for this CRM alone, each unfinished close with its course and money.
 *
 * Every figure opens the leads or calls behind it. Root admins only; read-only.
 */

type Kind = "inactive" | "reminders" | "notConnected" | "lost" | "calls" | "sentBack";
type Pick = { kind: Kind; person?: string; personName?: string; reason?: string } | null;
const PERIODS: { key: CallPeriod; label: string }[] = CALL_PERIODS.map((p) => ({ key: p.key, label: p.label }));
const KIND_LABEL: Record<Kind, string> = {
  inactive: "Inactive leads", reminders: "Reminders overdue", notConnected: "Not connected", lost: "Lost", calls: "Calls", sentBack: "Sent back",
};

/** "not_interested" → "Not interested"; none given says so. */
export const reasonLabel = (r: string) => (r === "not_given" ? "No reason given" : (r.charAt(0).toUpperCase() + r.slice(1)).replace(/_/g, " "));
const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
};
/** How long since: "40 min", "6 h", "3 d". */
const ago = (iso: string) => {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
};
/** Working minutes as "2 h 05 m". */
const waited = (min: number) => (min < 60 ? `${min} m` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} m`);
const periodText = (p: { from: string; to: string }) => (p.from === p.to ? p.from : `${p.from} → ${p.to}`);
const countOf = (c: SalesPendingCounts, kind: Kind) =>
  kind === "inactive" ? c.inactive : kind === "reminders" ? c.reminders_overdue : kind === "notConnected" ? c.not_connected : kind === "lost" ? c.lost
    : kind === "sentBack" ? c.sent_back ?? 0 : c.calls;
/** "AED 4,500 · INR 50,000" — each currency apart, never added together. */
const amounts = (m: Record<string, number> | undefined) => Object.entries(m ?? {}).filter(([, n]) => n).map(([cur, n]) => fmtMoney(n, cur)).join(" · ");

export function SalesPortalView({ code }: { code: string }) {
  const [period, setPeriod] = useState<CallPeriod>("month");
  const [callsPeriod, setCallsPeriod] = useState<CallPeriod>("today");
  const [search, setSearch] = useState("");
  const [pick, setPick] = useState<Pick>(null);
  const days = useMemo(() => periodDays(period), [period]);
  const callDays = useMemo(() => periodDays(callsPeriod), [callsPeriod]);
  const q = useQuery({
    queryKey: ["pending-sales", code, days, callDays],
    queryFn: async () => (await api.get(`/pending/sales/${code}`, {
      params: { from: days.from, to: days.to, callsFrom: callDays.from, callsTo: callDays.to },
    })).data.data as SalesPending,
    refetchInterval: 60_000,
    // A CRM that can't be read says so after one more try, not three.
    retry: 1,
  });
  const data = q.data;
  const needle = search.trim().toLowerCase();
  const people = useMemo(() => (data?.people ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.email.includes(needle)), [data, needle]);

  if (q.error instanceof AxiosError && q.error.response?.status === 403) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">You haven&apos;t been given this Pending tab — a root admin gives it on Users.</CardContent></Card>;
  }

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Picker label="Lost & not connected" icon={<ThumbsDown className="h-3.5 w-3.5" />} value={period} onChange={setPeriod} />
        <Picker label="Calls" icon={<Phone className="h-3.5 w-3.5" />} value={callsPeriod} onChange={setCallsPeriod} />
      </div>
      <div className="flex items-center gap-2">
        {data && <span className="text-xs text-muted-foreground">Updated {time(data.generatedAt)} · every minute</span>}
        <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={cn(q.isFetching && "animate-spin")} /> Refresh
        </Button>
      </div>
    </div>
  );

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        {toolbar}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">{[0, 1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}</div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (q.isError || !data) {
    const message = q.error instanceof AxiosError ? (q.error.response?.data as { message?: string } | undefined)?.message : undefined;
    return (
      <div className="space-y-4">
        {toolbar}
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            {q.error instanceof AxiosError && q.error.response?.status === 404 && !message
              ? "Root's server is still on the previous version — this tab shows once it is updated."
              : message ? `This CRM could not be read — ${message}` : "Could not load this CRM. Refresh in a moment."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const t = data.totals;
  const topReason = data.lostReasons[0];
  const inactiveHint = !data.inactive.supported ? "this CRM has no Inactive leads page"
    : !data.inactive.available ? data.inactive.error || "could not be read"
      : `owner hasn't acted within ${waited(data.inactive.limitMinutes)}${data.inactive.capped ? " · first 2,000" : ""}`;
  const callsHint = !data.calls.supported ? "no calls system in this CRM"
    : !data.calls.available ? data.calls.error || "could not be read"
      : `${t.connected} connected · ${talkTime(t.talkSeconds)} · ${periodText(data.callsPeriod)}`;

  return (
    <div className="space-y-6">
      {toolbar}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        <CseStatCard icon={Inbox} title="Total pending" value={String(t.total)} hint="inactive + reminders + not connected + lost + sent back" />
        <CseStatCard icon={AlarmClock} accent="amber" title="Inactive leads" onClick={data.inactive.available ? () => setPick({ kind: "inactive" }) : undefined}
          value={data.inactive.available ? String(t.inactive) : "—"} hint={inactiveHint} alert={data.inactive.supported && !data.inactive.available} delay={0.05} />
        <CseStatCard icon={BellRing} accent="rose" title="Reminders overdue" onClick={() => setPick({ kind: "reminders" })} value={String(t.reminders_overdue)}
          hint="past their time, not done" alert={t.reminders_overdue > 0} delay={0.1} />
        <CseStatCard icon={PhoneOff} accent="violet" title="Not connected" onClick={() => setPick({ kind: "notConnected" })} value={String(t.not_connected)}
          hint={`marked ${periodText(data.period)}`} delay={0.15} />
        <CseStatCard icon={ThumbsDown} accent="rose" title="Lost" onClick={() => setPick({ kind: "lost" })} value={String(t.lost)}
          hint={topReason ? `most: ${reasonLabel(topReason.reason)} (${topReason.count})` : `marked ${periodText(data.period)}`} delay={0.2} />
        <CseStatCard icon={Phone} accent="cyan" title="Calls" onClick={data.calls.available ? () => setPick({ kind: "calls" }) : undefined}
          value={data.calls.available ? String(t.calls) : "—"} hint={callsHint} alert={data.calls.supported && !data.calls.available} delay={0.25} />
        <CseStatCard icon={Undo2} accent="amber" title="Sent back" onClick={data.sentBack?.available ? () => setPick({ kind: "sentBack" }) : undefined}
          value={data.sentBack?.available ? String(t.sent_back ?? 0) : "—"}
          hint={!data.sentBack ? "Root's server needs updating" : !data.sentBack.available ? data.sentBack.error || "could not be read"
            : t.sent_back ? `${amounts(data.sentBack.amount)} · with the salesperson to correct` : "nothing sent back by finance"}
          alert={(t.sent_back ?? 0) > 0} delay={0.3} />
      </div>

      {data.workflow && <SalesWorkflow data={data} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lost reasons</CardTitle>
            <p className="text-xs text-muted-foreground">{t.lost} lost · {periodText(data.period)} · tap one for its leads</p>
          </CardHeader>
          <CardContent>
            <ReasonBars reasons={data.lostReasons} onPick={(reason) => setPick({ kind: "lost", reason })} />
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base">Each salesperson · {people.length}</CardTitle>
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a person" className="pl-8" aria-label="Find a person" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {people.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{needle ? "Nobody by that name." : "Nobody here."}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Person</th>
                      <th className="pb-2 pr-3 text-right font-medium">Inactive</th>
                      <th className="pb-2 pr-3 text-right font-medium">Reminders</th>
                      <th className="pb-2 pr-3 text-right font-medium">Not connected</th>
                      <th className="pb-2 pr-3 text-right font-medium">Lost</th>
                      <th className="whitespace-nowrap pb-2 pr-3 text-right font-medium">Sent back</th>
                      <th className="pb-2 pr-3 text-right font-medium">Total</th>
                      <th className="whitespace-nowrap border-l border-border/40 pb-2 pl-3 pr-3 text-right font-medium">Calls</th>
                      <th className="pb-2 text-right font-medium">Talk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p, i) => {
                      const cell = (kind: Kind, extra?: ReactNode) => {
                        const n = countOf(p.counts, kind);
                        return n ? (
                          <button type="button" onClick={() => setPick({ kind, person: p.id, personName: p.name })} className="rounded px-1 hover:bg-muted/60 hover:underline">
                            <span className="font-medium">{n}</span>{extra}
                          </button>
                        ) : <span className="text-muted-foreground/60">—</span>;
                      };
                      return (
                        <motion.tr key={p.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 15) * 0.02 }}
                          className="border-b border-border/20 last:border-0">
                          <td className="py-2.5 pr-3">
                            <PersonLink href={`/salespeople/${data.code}/${p.id}`} className={cn("font-medium hover:underline", !p.active && "text-muted-foreground")}>{p.name}</PersonLink>
                            {!p.active && <span className="ml-1.5 text-xs text-muted-foreground">(left)</span>}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{data.inactive.available ? cell("inactive") : <span className="text-muted-foreground/60">—</span>}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{cell("reminders")}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{cell("notConnected")}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{cell("lost")}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{cell("sentBack")}</td>
                          <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{p.total || <span className="font-normal text-muted-foreground/60">—</span>}</td>
                          <td className="border-l border-border/40 py-2.5 pl-3 pr-3 text-right tabular-nums">
                            {cell("calls", p.counts.connected ? <span className="ml-1 text-xs text-muted-foreground">({p.counts.connected} conn.)</span> : null)}
                          </td>
                          <td className="whitespace-nowrap py-2.5 text-right tabular-nums">{p.counts.talkSeconds ? talkTime(p.counts.talkSeconds) : <span className="text-muted-foreground/60">—</span>}</td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Lost and not connected are counted against the lead&apos;s owner, by when it was marked. Reminders against whoever set them.
              Sent back against whoever closed it, until it is sent to finance again.
              {data.calls.kind === "recorder" ? " Calls come from the phone call-recorder app, which does not say who made them — only the total." : ""}
              {data.calls.unlinked ? ` ${data.calls.unlinked} calls were taken by extensions not linked to anyone here.` : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      {pick && <ItemsDialog data={data} pick={pick} onClose={() => setPick(null)} />}
    </div>
  );
}

/** Lost reasons in a narrow card: the name and count on a line, the bar under it; each opens its leads. */
function ReasonBars({ reasons, onPick }: { reasons: SalesPending["lostReasons"]; onPick: (reason: string) => void }) {
  if (!reasons.length) return <p className="py-8 text-center text-sm text-muted-foreground">Nothing lost in this period.</p>;
  const max = Math.max(1, ...reasons.map((r) => r.count));
  const total = reasons.reduce((n, r) => n + r.count, 0);
  return (
    <div className="space-y-1">
      {reasons.map((r) => (
        <button key={r.reason} type="button" onClick={() => onPick(r.reason)} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted/50">
          <span className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-medium">{reasonLabel(r.reason)}</span>
            <span className="shrink-0 tabular-nums">{r.count}<span className="ml-1.5 text-xs text-muted-foreground">{Math.round((r.count / total) * 100)}%</span></span>
          </span>
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-rose-500/80" style={{ width: `${Math.max(3, Math.round((r.count / max) * 100))}%` }} />
          </span>
        </button>
      ))}
    </div>
  );
}

function Picker({ label, icon, value, onChange }: { label: string; icon: ReactNode; value: CallPeriod; onChange: (p: CallPeriod) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      <span className="mr-1 flex items-center gap-1 text-xs text-muted-foreground">{icon} {label}</span>
      {PERIODS.map((p) => (
        <Button key={p.key} size="sm" variant={value === p.key ? "secondary" : "ghost"} className="h-7 px-2.5 text-xs" onClick={() => onChange(p.key)}>{p.label}</Button>
      ))}
    </div>
  );
}

/** The leads or calls behind a figure: everyone's or one person's, with a By person tab. */
function ItemsDialog({ data, pick, onClose }: { data: SalesPending; pick: NonNullable<Pick>; onClose: () => void }) {
  const mine = <T extends { ownerId: string }>(rows: T[]) => rows.filter((x) => !pick.person || x.ownerId === pick.person);
  const leadCell = (x: { lead: string; phone: string; source: string }) => (
    <div className="min-w-0"><div className="font-medium">{x.lead}</div><div className="text-xs text-muted-foreground">{[x.phone, x.source].filter(Boolean).join(" · ")}</div></div>
  );
  const byPerson = (rows: { ownerId: string; owner: string }[]): BarRow[] => {
    const m = new Map<string, BarRow>();
    for (const x of rows) {
      const r = m.get(x.ownerId) ?? { key: x.ownerId || "none", label: x.owner || "Nobody", value: 0 };
      r.value++;
      m.set(x.ownerId, r);
    }
    return Array.from(m.values());
  };
  const table = (head: string[], rows: { key: string; cells: ReactNode[] }[], empty = "Nothing here.") => rows.length === 0
    ? <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
    : (
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">{head.map((h) => <th key={h} className="pb-2 pr-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-border/20 align-top last:border-0">{r.cells.map((c, i) => <td key={i} className="py-2 pr-3">{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  const ownerCol = !pick.person;
  const tabs: BreakdownTab[] = [];
  let count = 0, about = "";

  if (pick.kind === "inactive") {
    const rows = mine(data.items.inactive);
    count = rows.length;
    about = `Leads whose owner hasn't acted on them within ${waited(data.inactive.limitMinutes)} of working time — this CRM's Inactive leads page, longest waiting first.`;
    tabs.push({ key: "list", label: `Leads · ${rows.length}`, content: table(["Lead", ...(ownerCol ? ["Owner"] : []), "Waiting", "Moves", "Calls"], rows.map((x) => ({
      key: x.leadId,
      cells: [leadCell(x), ...(ownerCol ? [<div key="o">{x.owner}{x.team ? <div className="text-xs text-muted-foreground">{x.team}</div> : null}</div>] : []),
        <span key="w" className="whitespace-nowrap tabular-nums">{waited(x.waitingMinutes)}</span>, x.moves || "—", x.calls ? `${x.calls.total} (${x.calls.answered} answered)` : "—"],
    }))) });
    if (ownerCol) tabs.push({ key: "person", label: "By person", content: <Bars rows={byPerson(rows)} empty="Nobody." /> });
  } else if (pick.kind === "reminders") {
    const rows = mine(data.items.reminders);
    count = rows.length;
    about = "Reminders past their time and not done yet, the most overdue first.";
    tabs.push({ key: "list", label: `Reminders · ${rows.length}`, content: table(["Lead", ...(ownerCol ? ["Set by"] : []), "Reminder", "Was due"], rows.map((x, i) => ({
      key: `${x.leadId}-${i}`,
      cells: [leadCell(x), ...(ownerCol ? [x.owner] : []), <div key="r">{x.title || "Reminder"}{x.note ? <div className="text-xs text-muted-foreground">{x.note}</div> : null}</div>,
        <span key="d" className="whitespace-nowrap text-rose-500">{when(x.remindAt)} · {ago(x.remindAt)} late</span>],
    }))) });
    if (ownerCol) tabs.push({ key: "person", label: "By person", content: <Bars rows={byPerson(rows)} empty="Nobody." /> });
  } else if (pick.kind === "notConnected") {
    const rows = mine(data.items.notConnected);
    count = rows.length;
    about = `Leads marked not connected ${periodText(data.period)}, newest first, against the lead's owner.`;
    tabs.push({ key: "list", label: `Leads · ${rows.length}`, content: table(["Lead", ...(ownerCol ? ["Owner"] : []), "Marked"], rows.map((x) => ({
      key: x.leadId,
      cells: [leadCell(x), ...(ownerCol ? [x.owner] : []), <span key="m" className="whitespace-nowrap">{when(x.markedAt)}{x.markedBy && x.markedBy !== x.owner ? ` · by ${x.markedBy}` : ""}</span>],
    }))) });
    if (ownerCol) tabs.push({ key: "person", label: "By person", content: <Bars rows={byPerson(rows)} empty="Nobody." /> });
  } else if (pick.kind === "lost") {
    const all = mine(data.items.lost);
    const rows = pick.reason ? all.filter((x) => x.reason === pick.reason) : all;
    count = rows.length;
    about = `Leads marked lost ${periodText(data.period)}, with the reason chosen and the notes${pick.reason ? ` — ${reasonLabel(pick.reason)}` : ""}.`;
    tabs.push({ key: "list", label: `Leads · ${rows.length}`, content: table(["Lead", ...(ownerCol ? ["Owner"] : []), "Reason", "Marked"], rows.map((x) => ({
      key: x.leadId,
      cells: [leadCell(x), ...(ownerCol ? [x.owner] : []),
        <div key="r"><span className="font-medium">{reasonLabel(x.reason)}</span>{x.notes ? <div className="text-xs text-muted-foreground">{x.notes}</div> : null}</div>,
        <span key="m" className="whitespace-nowrap">{when(x.markedAt)}{x.markedBy && x.markedBy !== x.owner ? ` · by ${x.markedBy}` : ""}</span>],
    }))) });
    if (!pick.reason) {
      const reasons = new Map<string, number>();
      for (const x of all) reasons.set(x.reason, (reasons.get(x.reason) ?? 0) + 1);
      tabs.push({ key: "reason", label: "By reason", content: <Bars rows={Array.from(reasons).map(([r, n]) => ({ key: r, label: reasonLabel(r), value: n }))} empty="Nothing lost." /> });
    }
    if (ownerCol) tabs.push({ key: "person", label: "By person", content: <Bars rows={byPerson(rows)} empty="Nobody." /> });
  } else if (pick.kind === "sentBack") {
    const rows = mine(data.items.sentBack ?? []);
    count = rows.length;
    about = "Enrolments finance sent back to correct and not sent again yet, the longest waiting first — the course, the fee and what came in, and finance's reason.";
    const stepsOf = new Map((data.workflow?.open ?? []).map((x) => [x.id, x.steps]));
    tabs.push({ key: "list", label: `Enrolments · ${rows.length}`, content: table(["Client", "Course", "Amount", "Finance's reason", "Sent back", ...(ownerCol ? ["Closed by"] : [])], rows.map((x) => ({
      key: x.studentId,
      cells: [
        <div key="c" className="min-w-0"><div className="font-medium">{x.client}</div>
          <div className="text-xs text-muted-foreground">{[x.enrollmentNumber, x.phone, x.academy === "bangalore" ? "Bangalore" : ""].filter(Boolean).join(" · ")}</div>
          {stepsOf.get(x.studentId) && <div className="mt-1"><StepDots steps={stepsOf.get(x.studentId)!} /></div>}</div>,
        x.course || <span key="n" className="text-muted-foreground/60">—</span>,
        <div key="a" className="whitespace-nowrap tabular-nums"><div className="font-medium">{fmtMoney(x.fee, x.currency)}</div>
          <div className="text-xs text-muted-foreground">{fmtMoney(x.collected, x.currency)} in{x.balance > 0 ? ` · ${fmtMoney(x.balance, x.currency)} due` : ""}</div></div>,
        <div key="r" className="max-w-[260px] text-xs">{x.reason || <span className="text-muted-foreground">No reason given</span>}</div>,
        <div key="s" className="whitespace-nowrap text-xs">{x.returnedAt ? <>{when(x.returnedAt)}<div className="text-rose-500">{ago(x.returnedAt)} waiting</div></> : "—"}
          {x.resends > 0 && <div className="text-muted-foreground">sent again {x.resends}× before</div>}</div>,
        ...(ownerCol ? [<div key="o">{x.owner}{x.team ? <div className="text-xs text-muted-foreground">{x.team}</div> : null}</div>] : []),
      ],
    })), "Nothing sent back.") });
    const groups = (keyOf: (x: typeof rows[number]) => string) => {
      const m = new Map<string, { n: number; money: Record<string, number> }>();
      for (const x of rows) {
        const g = m.get(keyOf(x)) ?? { n: 0, money: {} };
        g.n++; g.money[x.currency] = (g.money[x.currency] ?? 0) + x.fee;
        m.set(keyOf(x), g);
      }
      return Array.from(m).map(([k, g]) => ({ key: k, label: k, value: g.n, sub: amounts(g.money) }));
    };
    if (ownerCol) tabs.push({ key: "person", label: "By person", content: <Bars rows={groups((x) => x.owner || "Nobody")} empty="Nobody." /> });
    tabs.push({ key: "course", label: "By course", content: <Bars rows={groups((x) => x.course || "No course")} empty="Nothing." /> });
  } else {
    const rows = data.calls.list.filter((x) => !pick.person || x.personId === pick.person);
    count = pick.person ? countOf(data.people.find((p) => p.id === pick.person)?.counts ?? ({} as SalesPendingCounts), "calls") : data.totals.calls;
    about = `Calls ${periodText(data.callsPeriod)} (Dubai), newest first${data.calls.total > data.calls.list.length ? ` — the latest ${data.calls.list.length} of ${data.calls.total}` : ""}. Press Play for a recording.`;
    tabs.push({ key: "list", label: `Calls · ${rows.length}`, content: table(["When", ...(ownerCol ? ["Who"] : []), "With", "Result", "Length", "Recording"], rows.map((c) => ({
      key: c.id,
      cells: [<span key="w" className="whitespace-nowrap">{when(c.startedAt)}</span>, ...(ownerCol ? [c.personName || "—"] : []),
        <div key="c">{c.contact || c.number || "—"}<div className="text-xs text-muted-foreground">{c.direction === "out" ? "Outgoing" : "Incoming"}</div></div>,
        <span key="r" className={cn(c.status === "answered" ? "text-emerald-500" : "text-rose-500")}>{c.status === "answered" ? "Connected" : c.status === "missed" ? "Missed" : "Not answered"}</span>,
        <span key="l" className="tabular-nums">{c.talkSeconds ? callLength(c.talkSeconds) : "—"}</span>,
        c.recordings > 0 ? <Recording key="p" call={c} /> : <span key="p" className="text-xs text-muted-foreground/60">None</span>],
    })), "No calls in this period.") });
    if (ownerCol) {
      tabs.push({ key: "person", label: "By person", content: <Bars rows={data.people.filter((p) => p.counts.calls).map((p) => ({
        key: p.id, label: p.name, value: p.counts.calls, sub: `${p.counts.connected} connected · ${talkTime(p.counts.talkSeconds)}`,
      }))} empty="Nobody." /> });
    }
  }

  return (
    <BreakdownDialog open onClose={onClose} description={about} tabs={tabs}
      title={`${data.name} · ${pick.personName ? `${pick.personName} · ` : ""}${KIND_LABEL[pick.kind]}${pick.reason ? ` · ${reasonLabel(pick.reason)}` : ""} · ${count}`} />
  );
}

/** This CRM's enrolment workflow — Pending → Enrolments' chart for it alone — and the closes behind each step. */
function SalesWorkflow({ data }: { data: SalesPending }) {
  const [step, setStep] = useState<FlowStep | null>(null);
  const wf = data.workflow!;
  if (!wf.available || !wf.counts) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="flex gap-3 pt-6 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span className="text-muted-foreground">The enrolment workflow could not be read — {wf.error || "no answer"}.</span>
        </CardContent>
      </Card>
    );
  }
  const counts = wf.counts;
  // Banglore's closes go only as far as the LMS.
  const steps = data.code === "banglore" ? STEPS.slice(0, 2) : STEPS;
  const atStep = (k: FlowStep) => counts.atStep[k].waiting + counts.atStep[k].failed;
  const biggest = steps.reduce<FlowStep | null>((best, k) => (atStep(k) > (best ? atStep(best) : 0) ? k : best), null);
  const shown = wf.open.filter((c) => !step || c.stage === step);
  const money: Record<string, number> = {};
  for (const c of shown) money[c.currency] = (money[c.currency] ?? 0) + c.fee;

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Enrolment workflow · {counts.open} unfinished</CardTitle>
        <p className="text-xs text-muted-foreground">
          Every close handed to finance, where it stands now — pick a step for its enrolments.
          {!wf.financeAnswered && " Finance could not be asked just now, so steps after the close show as unknown."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-stretch gap-2">
          <FlowBox title="Closed" value={counts.total} hint="handed to finance" tone="muted" />
          {steps.map((k) => (
            <Fragment key={k}>
              <ChevronRight className="hidden h-5 w-5 self-center text-muted-foreground sm:block" />
              <FlowBox title={STEP_LABEL[k]} value={atStep(k)} hint={`on ${STEP_OWNER[k]}`} failed={counts.atStep[k].failed}
                failedLabel={k === "finance" ? "sent back / refused" : k === "bonus" ? "turned down" : "failed"}
                tone={k === biggest && atStep(k) > 0 ? "hot" : atStep(k) ? "warm" : "muted"}
                active={step === k} onClick={() => setStep(step === k ? null : k)} />
            </Fragment>
          ))}
          <ChevronRight className="hidden h-5 w-5 self-center text-muted-foreground sm:block" />
          <FlowBox title="Done" value={counts.finished} hint="every step finished" tone="done" icon />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{step ? STEP_LABEL[step] : "Unfinished enrolments"} · {shown.length}</span>
          {shown.length > 0 && <span className="text-xs text-muted-foreground">{amounts(money)}</span>}
          {step && <Badge variant="outline" className="gap-1">{STEP_LABEL[step]}<button type="button" onClick={() => setStep(null)} aria-label="All steps"><X className="h-3 w-3" /></button></Badge>}
        </div>
        {shown.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">None.</p> : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Student</th>
                  <th className="pb-2 pr-3 font-medium">Course</th>
                  <th className="pb-2 pr-3 font-medium">Amount</th>
                  <th className="pb-2 pr-3 font-medium">Closed by</th>
                  <th className="pb-2 pr-3 font-medium">Steps</th>
                  <th className="pb-2 pr-3 font-medium">Stands at</th>
                  <th className="pb-2 pr-3 font-medium">Waiting on</th>
                  <th className="pb-2 text-right font-medium">Since</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} className="border-b border-border/20 align-top last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{c.name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{[c.enrollmentNumber, c.invoiceNumber].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="py-2 pr-3">{c.course || <span className="text-muted-foreground/60">—</span>}</td>
                    <td className="whitespace-nowrap py-2 pr-3 tabular-nums">
                      <div className="font-medium">{fmtMoney(c.fee, c.currency)}</div>
                      <div className="text-xs text-muted-foreground">{fmtMoney(c.collected, c.currency)} in{c.balance > 0 ? ` · ${fmtMoney(c.balance, c.currency)} due` : ""}</div>
                    </td>
                    <td className="py-2 pr-3">{c.closedBy.name || "—"}{c.team ? <div className="text-xs text-muted-foreground">{c.team}</div> : null}</td>
                    <td className="py-2 pr-3"><StepDots steps={c.steps} /></td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className={cn("py-0 text-[11px]", c.stageState === "failed" ? "border-rose-500/40 text-rose-500" : "border-amber-500/40 text-amber-500")}>
                        {STEP_LABEL[c.stage]}
                      </Badge>
                      {c.detail && <div className="mt-0.5 max-w-[260px] text-xs text-muted-foreground">{c.detail}</div>}
                    </td>
                    <td className="py-2 pr-3 text-xs">{whoLabel(c.waitingOn)}</td>
                    <td className="whitespace-nowrap py-2 text-right text-xs tabular-nums text-muted-foreground">{daysSince(c.since || c.closedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
