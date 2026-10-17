"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { AlertTriangle, ArrowUpCircle, CalendarRange, Coins, Gift, PhoneCall, RefreshCw, UserCheck, Wallet, MessageSquareText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RangePicker, resolveRange, REPORT_TZ_LABEL, type Range, type RangeKey } from "@/components/reports/RangePicker";
import { Recording } from "@/components/calls/Recording";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import { talkTime } from "@/lib/calls";
import { ReportBody, n0, usd, aed, pct, when, type Group, type Row, type Section } from "@/components/portal-reports/ReportBody";

/**
 * Reports → CS portal (the user, 2026-10-17): what Tetra Commission's CSs did
 * in a period — revenue, follow-ups and contacted, calls, program scheduling,
 * onboarded clients, bonuses, commission, course upgrades — as its own Reports
 * section counts them (GET /service/cs-report): a row for whoever it counts
 * for, their team and its location, and by month (Gulf days). Each section has
 * total cards, every CS's / team's / month's figures, and the rows behind
 * them; a CS opens their own. Root admins only; read-only.
 */

type SectionKey = "revenue" | "followups" | "calls" | "programs" | "onboarded" | "bonus" | "commission" | "upgrades";
interface Report extends Record<SectionKey, Group> {
  period: string; since: string | null; until: string | null; studentLink: string;
  filters: { teams: { id: string; name: string; location: string }[]; people: { id: string; name: string; team_id: string }[] };
}

const STAGE: Record<string, { label: string; cls: string }> = {
  approved: { label: "Approved", cls: "text-emerald-500" }, rejected: { label: "Rejected", cls: "text-rose-500" },
  with_finance: { label: "With finance", cls: "text-sky-500" }, waiting_broker: { label: "Waiting for broker admin", cls: "text-violet-500" },
  needs_call: { label: "Needs a call", cls: "text-amber-500" }, sent_back: { label: "Sent back", cls: "text-rose-500" },
};
const csCell = (r: Row) => <div key="cs"><div>{r.cs}</div><div className="text-xs text-muted-foreground">{r.team}{r.location === "bangalore" ? " · Bangalore" : ""}</div></div>;

const SECTIONS: Section<SectionKey>[] = [
  {
    key: "revenue", label: "Revenue", icon: Wallet, accent: "emerald",
    headline: (t) => usd(t.deposit_usd), headlineHint: (t) => `${n0(t.deposits)} deposits · net ${usd(t.net_usd)}`,
    cards: (t) => [
      { title: "Deposits", value: usd(t.deposit_usd), hint: `${n0(t.deposits)} approved · ${aed(t.deposit_aed)}` },
      { title: "Withdrawals", value: usd(t.withdrawal_usd), hint: `${n0(t.withdrawals)} approved` },
      { title: "Net (deposits − withdrawals)", value: usd(t.net_usd), alert: (t.net_usd ?? 0) < 0 },
      { title: "Course payments", value: aed(t.course_payment_aed), hint: `${n0(t.course_payments)} approved by finance` },
    ],
    cols: [{ key: "deposits", label: "Deposits" }, { key: "deposit_usd", label: "Deposit USD", fmt: "usd" }, { key: "deposit_aed", label: "Deposit AED", fmt: "aed" },
      { key: "withdrawals", label: "Withdrawals" }, { key: "withdrawal_usd", label: "Withdrawn USD", fmt: "usd" }, { key: "net_usd", label: "Net USD", fmt: "usd" },
      { key: "course_payments", label: "Course payments" }, { key: "course_payment_aed", label: "Course AED", fmt: "aed" }],
    rowHead: ["When", "Student", "CS", "What", "Amount"],
    row: (r, link) => [when(r.at), link(r), csCell(r), r.kind === "course_payment" ? `Course payment${r.course ? ` · ${r.course}` : ""}` : r.kind === "deposit" ? "Deposit" : "Withdrawal",
      <span key="a" className={cn("tabular-nums", r.kind === "withdrawal" && "text-rose-500")}>{r.kind === "course_payment" ? aed(r.aed) : `${usd(r.usd)} · ${aed(r.aed)}`}</span>],
  },
  {
    key: "followups", label: "Follow-ups & contacted", icon: MessageSquareText, accent: "blue",
    headline: (t) => n0(t.logged), headlineHint: (t) => `calls logged · ${n0(t.contacted)} students contacted`,
    cards: (t) => [
      { title: "Calls logged", value: n0(t.logged) }, { title: "Follow-ups opened", value: n0(t.opened) },
      { title: "Students contacted", value: n0(t.contacted), hint: "different students worked on" },
      { title: "Converted", value: n0(t.converted), hint: `${pct(t.converted ?? 0, t.contacted ?? 0)} of contacted` },
      { title: "Lost", value: n0(t.lost), alert: (t.lost ?? 0) > 0 },
    ],
    cols: [{ key: "opened", label: "Opened" }, { key: "logged", label: "Logged" }, { key: "contacted", label: "Contacted" }, { key: "converted", label: "Converted" }, { key: "lost", label: "Lost" }],
    rowHead: ["When", "Student", "By", "What", "Note"],
    row: (r, link) => [when(r.at), link(r), csCell(r),
      <span key="w">{r.kind === "created" ? "Opened" : "Logged"}{r.stage_to && r.stage_to !== r.stage_from ? ` · ${r.stage_from ? `${r.stage_from} → ` : ""}${r.stage_to}` : ""}</span>,
      <span key="t" className="text-xs text-muted-foreground">{r.client_said || r.text || "—"}</span>],
  },
  {
    key: "calls", label: "Calls", icon: PhoneCall, accent: "cyan",
    headline: (t) => n0(t.calls), headlineHint: (t) => `${n0(t.connected)} connected · ${talkTime(t.talk_seconds ?? 0)}`,
    cards: (t) => [
      { title: "Calls", value: n0(t.calls), hint: `${n0(t.outgoing)} out · ${n0(t.incoming)} in` },
      { title: "Connected", value: n0(t.connected), hint: `${pct(t.connected ?? 0, t.calls ?? 0)} of calls` },
      { title: "Missed / not answered", value: n0(t.missed), alert: (t.missed ?? 0) > 0 },
      { title: "Talk time", value: talkTime(t.talk_seconds ?? 0), hint: `${n0(t.recorded)} recorded` },
    ],
    cols: [{ key: "calls", label: "Calls" }, { key: "connected", label: "Connected" }, { key: "missed", label: "Missed" }, { key: "talk_seconds", label: "Talk", fmt: "secs" },
      { key: "outgoing", label: "Out" }, { key: "incoming", label: "In" }],
    rowHead: ["When", "Student", "CS", "Call", "Recording"],
    row: (r, link) => [when(r.at), r.student ? link(r) : <span key="n" className="text-muted-foreground">{r.number || "—"}</span>, csCell(r),
      <span key="c" className={cn(r.answered ? "text-emerald-500" : "text-rose-500")}>{r.direction === "in" ? "In" : "Out"} · {r.answered ? talkTime(r.talk_seconds) : "not answered"}</span>,
      r.recordings > 0 ? <Recording key="p" call={{ portal: "commission", id: r.id }} /> : <span key="p" className="text-xs text-muted-foreground/60">None</span>],
  },
  {
    key: "programs", label: "Program scheduling", icon: CalendarRange, accent: "violet", unavailable: "Programs could not be read",
    headline: (t) => n0(t.programs), headlineHint: (t) => `programs · ${n0(t.classes)} classes · ${n0(t.students)} students`,
    cards: (t) => [
      { title: "Programs", value: n0(t.programs), hint: "with classes in the period" },
      { title: "Classes", value: n0(t.classes), hint: `${n0(t.held)} held · ${n0(t.cancelled)} cancelled`, alert: (t.cancelled ?? 0) > 0 },
      { title: "Students on them", value: n0(t.students) },
      { title: "Confirmed", value: n0(t.confirmed), hint: `${n0(t.declined)} can't attend` },
    ],
    cols: [{ key: "programs", label: "Programs" }, { key: "classes", label: "Classes" }, { key: "held", label: "Held" }, { key: "cancelled", label: "Cancelled" },
      { key: "students", label: "Students" }, { key: "confirmed", label: "Confirmed" }, { key: "declined", label: "Can't attend" }],
    rowHead: ["First class", "Program", "Made by", "Classes", "Students"],
    row: (r) => [when(r.at), <div key="p"><div className="font-medium">{r.title}</div><div className="text-xs text-muted-foreground">{[r.mentor, r.repeat].filter(Boolean).join(" · ")}</div></div>,
      csCell(r), <span key="c">{r.classes} ({r.held} held{r.cancelled ? `, ${r.cancelled} cancelled` : ""})</span>,
      <span key="s">{r.students} · {r.confirmed} confirmed{r.declined ? `, ${r.declined} can't` : ""}</span>],
  },
  {
    key: "onboarded", label: "Onboarded clients", icon: UserCheck, accent: "amber",
    headline: (t) => n0(t.onboarded), headlineHint: (t) => `${n0(t.from_finance)} from finance`,
    cards: (t) => [{ title: "Onboarded", value: n0(t.onboarded) }, { title: "From finance (sale closed)", value: n0(t.from_finance) },
      { title: "Added in the portal", value: n0((t.onboarded ?? 0) - (t.from_finance ?? 0)) }],
    cols: [{ key: "onboarded", label: "Onboarded" }, { key: "from_finance", label: "From finance" }],
    rowHead: ["Onboarded", "Student", "CS", "By", "Added"],
    row: (r, link) => [when(r.at), link(r), csCell(r), r.by || "—", <span key="a" className="text-xs text-muted-foreground">{r.from_finance ? "From finance" : "Added in the portal"} · {when(r.added_at)}</span>],
  },
  {
    key: "bonus", label: "Bonus", icon: Gift, accent: "rose",
    headline: (t) => usd(t.approved_usd), headlineHint: (t) => `${n0(t.approved)} approved of ${n0(t.count)} raised`,
    cards: (t) => [
      { title: "Raised", value: usd(t.usd), hint: `${n0(t.count)} bonuses · ${aed(t.aed)} paid` },
      { title: "Approved (done)", value: usd(t.approved_usd), hint: `${n0(t.approved)} · ${aed(t.approved_aed)} collected` },
      { title: "With finance", value: n0(t.with_finance) }, { title: "Waiting for broker admin", value: n0(t.waiting_broker) },
      { title: "Needs a call", value: n0(t.needs_call), alert: (t.needs_call ?? 0) > 0 }, { title: "Rejected", value: n0(t.rejected) },
    ],
    cols: [{ key: "count", label: "Raised" }, { key: "usd", label: "USD", fmt: "usd" }, { key: "aed", label: "AED paid", fmt: "aed" }, { key: "approved", label: "Approved" },
      { key: "approved_usd", label: "Approved USD", fmt: "usd" }, { key: "with_finance", label: "With finance" }, { key: "waiting_broker", label: "Broker admin" },
      { key: "needs_call", label: "Needs call" }, { key: "rejected", label: "Rejected" }],
    rowHead: ["Raised", "Student", "CS", "Bonus", "Where it is"],
    row: (r, link) => [when(r.at), link(r), csCell(r), <span key="b" className="tabular-nums">{usd(r.usd)}{r.aed ? ` · ${aed(r.aed)}` : ""}<span className="block text-xs text-muted-foreground">{r.kind}{r.mt5 ? ` · MT5 ${r.mt5}` : ""}</span></span>,
      <span key="s" className={STAGE[r.raw_stage]?.cls ?? STAGE[r.stage]?.cls}>{STAGE[r.raw_stage]?.label ?? STAGE[r.stage]?.label ?? r.stage}{r.decided_at ? <span className="block text-xs text-muted-foreground">{when(r.decided_at)}</span> : null}</span>],
  },
  {
    key: "commission", label: "Commission", icon: Coins, accent: "cyan",
    headline: (t) => usd(t.usd), headlineHint: (t) => `${n0(t.credits)} credits`,
    cards: (t) => [{ title: "Commission credited", value: usd(t.usd), hint: `${n0(t.credits)} credits` }],
    cols: [{ key: "credits", label: "Credits" }, { key: "usd", label: "USD", fmt: "usd" }],
    rowHead: ["When", "Student", "Credited to", "For", "Commission"],
    row: (r, link) => [when(r.at), link(r), csCell(r), <span key="f">{String(r.type || "").toLowerCase() || "—"}{r.level ? ` · level ${r.level}` : ""}</span>, <span key="u" className="tabular-nums">{usd(r.usd)}</span>],
  },
  {
    key: "upgrades", label: "Course upgrades", icon: ArrowUpCircle, accent: "violet",
    headline: (t) => aed(t.paid_aed), headlineHint: (t) => `${n0(t.started)} started · ${n0(t.payments)} payments`,
    cards: (t) => [{ title: "Upgrades started", value: n0(t.started), hint: `${aed(t.quoted_aed)} quoted` },
      { title: "Paid (approved)", value: aed(t.paid_aed), hint: `${n0(t.payments)} payments` }],
    cols: [{ key: "started", label: "Started" }, { key: "quoted_aed", label: "Quoted", fmt: "aed" }, { key: "payments", label: "Payments" }, { key: "paid_aed", label: "Paid", fmt: "aed" }],
    rowHead: ["Started", "Student", "By", "Upgrade", "Paid"],
    row: (r, link) => [when(r.at), link(r), csCell(r), <span key="u">{r.course}{r.plan ? ` · ${r.plan}` : ""}<span className="block text-xs text-muted-foreground">{r.status} · {aed(r.quoted_aed)} quoted</span></span>,
      <span key="p" className="tabular-nums">{aed(r.paid_aed)}</span>],
  },
];

const LOCS = [{ key: "", label: "Everyone" }, { key: "dubai", label: "Dubai" }, { key: "bangalore", label: "Bangalore" }];

export function CsReportView() {
  const [range, setRange] = useState<RangeKey>("month");
  const [custom, setCustom] = useState<Range>({});
  const [location, setLocation] = useState("");
  const [team, setTeam] = useState("");
  const [cs, setCs] = useState("");
  const period = useMemo(() => resolveRange(range, custom), [range, custom]);
  const q = useQuery({
    queryKey: ["portal-reports", "cs", period, location, team, cs],
    queryFn: async () => (await api.get("/portal-reports/cs", { params: { ...period, location: location || undefined, team: team || undefined, cs: cs || undefined } })).data.data as Report,
    retry: 1,
  });
  const data = q.data;
  const link = (r: Row) => (data?.studentLink && r.student_id
    ? <a key="s" href={`${data.studentLink}${r.student_id}`} target="_blank" rel="noreferrer" className="hover:underline"><span className="font-medium">{r.student || "A student"}</span>{r.code ? <span className="block text-xs text-muted-foreground">{r.code}</span> : null}</a>
    : <span key="s" className="font-medium">{r.student || "—"}{r.code ? <span className="block text-xs font-normal text-muted-foreground">{r.code}</span> : null}</span>);
  const teamsShown = (data?.filters.teams ?? []).filter((t) => !location || t.location === location);
  const peopleShown = (data?.filters.people ?? []).filter((p) => !team || p.team_id === team);

  if (q.error instanceof AxiosError && q.error.response?.status === 403) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">Reports are for root admins.</CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <RangePicker value={range} custom={custom} onChange={(k, c) => { setRange(k); if (c) setCustom(c); }} />
        <div className="flex gap-1" role="group" aria-label="Location">
          {LOCS.map((l) => <Button key={l.key} size="sm" variant={location === l.key ? "default" : "outline"} onClick={() => { setLocation(l.key); setTeam(""); setCs(""); }}>{l.label}</Button>)}
        </div>
        <select value={team} onChange={(e) => { setTeam(e.target.value); setCs(""); }} aria-label="Team" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">Every team</option>
          {teamsShown.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={cs} onChange={(e) => setCs(e.target.value)} aria-label="CS" className="h-9 max-w-[12rem] rounded-md border border-input bg-background px-2 text-sm">
          <option value="">Every CS</option>
          {peopleShown.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{REPORT_TZ_LABEL}</span>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw className={cn(q.isFetching && "animate-spin")} /> Refresh</Button>
        </div>
      </div>

      {q.isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{SECTIONS.map((s) => <Skeleton key={s.key} className="h-28 w-full rounded-2xl" />)}</div>
          <Skeleton className="h-96 w-full" />
        </div>
      ) : q.isError || !data ? (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            {(q.error instanceof AxiosError && (q.error.response?.data as { message?: string } | undefined)?.message)
              || (q.error instanceof AxiosError && q.error.response?.status === 404 ? "Root's server is still on the previous version — this tab shows once it is updated." : "Could not load the report. Refresh in a moment.")}
          </CardContent>
        </Card>
      ) : (
        <ReportBody sections={SECTIONS} data={data} link={link} personLabel="CS" ownerKey="cs_id"
          note={<>As Tetra Commission&apos;s Reports count it: a row for whoever it counts for (who raised or did it, else the student&apos;s CS), their team and its location. The list shows the latest 2,000.</>} />
      )}
    </div>
  );
}

