"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { AlertTriangle, Coins, Inbox, MessageSquareText, PhoneCall, RefreshCw, ThumbsDown, Trophy, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bars } from "@/components/common/Breakdown";
import { RangePicker, resolveRange, REPORT_TZ_LABEL, type Range, type RangeKey } from "@/components/reports/RangePicker";
import { Recording } from "@/components/calls/Recording";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import { talkTime } from "@/lib/calls";
import { ReportBody, n0, pct, when, type Group, type Row, type Section } from "@/components/portal-reports/ReportBody";
import { LeadWorkflowSection } from "@/components/portal-reports/LeadWorkflow";

/**
 * Reports → Sales, one sales CRM (the user, 2026-10-17): what each salesperson
 * did in a period — leads received, follow-ups, closings (conversion), revenue,
 * lost (with reasons) and not connected, calls with recordings, commission —
 * per person, team and month, read from the CRM's database by Root with the
 * Salespeople page's rules (GET /portal-reports/sales/:code). Root admins only.
 */

type SectionKey = "leads" | "followups" | "closings" | "revenue" | "lost" | "calls" | "commission";
interface SalesReport extends Record<SectionKey, Group> {
  code: string; name: string; currency: string;
  filters: { teams: { id: string; name: string }[]; people: { id: string; name: string; team_id: string }[] };
  leads: Group & { sources: { source: string; count: number }[] };
  lost: Group & { reasons: { reason: string; count: number }[] };
  calls: Group & { supported: boolean; kind: string | null; unlinked: number };
}

const reasonLabel = (r: string) => (r === "not_given" ? "No reason given" : (r.charAt(0).toUpperCase() + r.slice(1)).replace(/_/g, " "));
const STATUS: Record<string, string> = { new: "New", assigned: "Assigned", pending_response: "Pending response", followup: "Follow-up", closed: "Closed", lost: "Lost",
  not_connected: "Not connected", mia: "MIA", repeated: "Repeated", callback: "Callback", cnc: "CNC", meeting_done: "Meeting done", wrong_number: "Wrong number" };
const ownerCell = (r: Row) => <div key="o"><div>{r.owner}</div>{r.team ? <div className="text-xs text-muted-foreground">{r.team}</div> : null}</div>;
const leadCell = (r: Row) => <div key="l"><div className="font-medium">{r.lead || r.student || "—"}</div>{r.phone ? <div className="text-xs text-muted-foreground">{r.phone}{r.source ? ` · ${r.source}` : ""}</div> : null}</div>;

function sectionsFor(currency: string): Section<SectionKey>[] {
  const money = (v: number | undefined) => `${currency} ${n0(v)}`;
  return [
    {
      key: "leads", label: "Leads", icon: Inbox, accent: "blue",
      headline: (t) => n0(t.received), headlineHint: (t) => `received · ${n0(t.untouched)} still untouched`,
      cards: (t) => [{ title: "Leads received", value: n0(t.received) }, { title: "Still untouched", value: n0(t.untouched), hint: pct(t.untouched ?? 0, t.received ?? 0), alert: (t.untouched ?? 0) > 0 }],
      cols: [{ key: "received", label: "Received" }, { key: "untouched", label: "Untouched" }],
      rowHead: ["Received", "Lead", "Owner", "Status"],
      row: (r) => [when(r.at), leadCell(r), ownerCell(r), STATUS[r.status] ?? r.status],
      extra: (g) => {
        const sources = (g as SalesReport["leads"]).sources ?? [];
        return sources.length ? <div><p className="mb-1 text-xs font-medium text-muted-foreground">By source</p><Bars rows={sources.slice(0, 10).map((s) => ({ key: s.source, label: s.source, value: s.count }))} /></div> : null;
      },
    },
    {
      key: "followups", label: "Follow-ups & contacted", icon: MessageSquareText, accent: "violet",
      headline: (t) => n0(t.followups), headlineHint: (t) => `${n0(t.leads_contacted)} leads contacted · ${n0(t.status_changes)} status changes`,
      cards: (t) => [{ title: "Follow-ups logged", value: n0(t.followups) }, { title: "Leads contacted", value: n0(t.leads_contacted), hint: "different leads followed up" },
        { title: "Status changes", value: n0(t.status_changes), hint: "leads moved on" }],
      cols: [{ key: "followups", label: "Follow-ups" }, { key: "leads_contacted", label: "Leads contacted" }, { key: "status_changes", label: "Status changes" }],
      rowHead: ["When", "Lead", "By", "Note"],
      row: (r) => [when(r.at), leadCell(r), ownerCell(r), <span key="n" className="text-xs text-muted-foreground">{r.note || "—"}</span>],
    },
    {
      key: "closings", label: "Closings", icon: Trophy, accent: "emerald",
      headline: (t) => n0(t.closings), headlineHint: (t) => `${n0(t.conversion)}% of leads received`,
      cards: (t) => [{ title: "Closings", value: n0(t.closings), hint: `${n0(t.conversion)}% conversion` }, { title: "Course fees", value: money(t.fee) },
        { title: "Collected at the close", value: money(t.collected), hint: pct(t.collected ?? 0, t.fee ?? 0) }],
      cols: [{ key: "closings", label: "Closings" }, { key: "conversion", label: "Conversion", fmt: "pct" }, { key: "fee", label: "Fees", fmt: "money" }, { key: "collected", label: "Collected", fmt: "money" }],
      rowHead: ["Enrolled", "Student", "Closed by", "Course", "Fee"],
      row: (r) => [when(r.at), <span key="s" className="font-medium">{r.student}</span>, ownerCell(r), r.course || "—",
        <span key="f" className="tabular-nums">{money(r.fee)}<span className="block text-xs text-muted-foreground">{money(r.collected)} paid</span></span>],
    },
    {
      key: "revenue", label: "Revenue", icon: Wallet, accent: "emerald",
      headline: (t) => money(t.revenue), headlineHint: (t) => `${n0(t.payments)} payments`,
      cards: (t) => [{ title: "Revenue", value: money(t.revenue), hint: `${n0(t.payments)} payments dated in the period` }],
      cols: [{ key: "payments", label: "Payments" }, { key: "revenue", label: "Revenue", fmt: "money" }],
      rowHead: ["Paid", "Lead", "Owner", "Amount"],
      row: (r) => [when(r.at), leadCell(r), ownerCell(r), <span key="a" className="tabular-nums">{money(r.amount)}{r.note ? <span className="block text-xs text-muted-foreground">{r.note}</span> : null}</span>],
    },
    {
      key: "lost", label: "Lost & not connected", icon: ThumbsDown, accent: "rose",
      headline: (t) => n0(t.lost), headlineHint: (t) => `lost · ${n0(t.not_connected)} not connected`,
      cards: (t) => [{ title: "Lost", value: n0(t.lost), alert: (t.lost ?? 0) > 0 }, { title: "Not connected", value: n0(t.not_connected) }],
      cols: [{ key: "lost", label: "Lost" }, { key: "not_connected", label: "Not connected" }],
      rowHead: ["Marked", "Lead", "Owner", "Status", "Reason"],
      row: (r) => [when(r.at), leadCell(r), ownerCell(r), <span key="s" className={cn(r.status === "lost" ? "text-rose-500" : "text-muted-foreground")}>{STATUS[r.status] ?? r.status}{r.marked_by && r.marked_by !== r.owner ? <span className="block text-xs text-muted-foreground">by {r.marked_by}</span> : null}</span>,
        r.reason ? <div key="r"><span className="font-medium">{reasonLabel(r.reason)}</span>{r.notes ? <div className="text-xs text-muted-foreground">{r.notes}</div> : null}</div> : "—"],
      extra: (g) => {
        const reasons = (g as SalesReport["lost"]).reasons ?? [];
        return reasons.length ? <div><p className="mb-1 text-xs font-medium text-muted-foreground">Lost reasons</p><Bars rows={reasons.map((x) => ({ key: x.reason, label: reasonLabel(x.reason), value: x.count }))} /></div> : null;
      },
    },
    {
      key: "calls", label: "Calls", icon: PhoneCall, accent: "cyan", unavailable: "Calls could not be read",
      headline: (t) => n0(t.calls), headlineHint: (t) => `${n0(t.connected)} connected · ${talkTime(t.talk_seconds ?? 0)}`,
      cards: (t) => [{ title: "Calls", value: n0(t.calls) }, { title: "Connected", value: n0(t.connected), hint: pct(t.connected ?? 0, t.calls ?? 0) }, { title: "Talk time", value: talkTime(t.talk_seconds ?? 0) }],
      cols: [{ key: "calls", label: "Calls" }, { key: "connected", label: "Connected" }, { key: "talk_seconds", label: "Talk", fmt: "secs" }],
      rowHead: ["When", "With", "Who", "Call", "Recording"],
      row: (r) => [when(r.at), r.contact || "—", ownerCell(r),
        <span key="c" className={cn(r.status === "answered" ? "text-emerald-500" : "text-rose-500")}>{r.direction === "in" ? "In" : "Out"} · {r.status === "answered" ? talkTime(r.talk_seconds) : r.status === "missed" ? "missed" : "not answered"}</span>,
        r.recordings > 0 ? <Recording key="p" call={{ portal: r.portal, id: r.id }} /> : <span key="p" className="text-xs text-muted-foreground/60">None</span>],
    },
    {
      key: "commission", label: "Commission", icon: Coins, accent: "amber",
      headline: (t) => money(t.commission), headlineHint: (t) => `${n0(t.sales)} sales counted`,
      cards: (t) => [{ title: "Commission counted", value: money(t.commission), hint: `${n0(t.sales)} sales made in the period` }],
      cols: [{ key: "sales", label: "Sales" }, { key: "commission", label: "Commission", fmt: "money" }],
      rowHead: ["Sale", "Student", "To", "Role", "Commission"],
      row: (r) => [when(r.at), <div key="s"><div className="font-medium">{r.student}</div>{r.course ? <div className="text-xs text-muted-foreground">{r.course}</div> : null}</div>,
        ownerCell(r), String(r.role || "").toUpperCase() || "—", <span key="a" className="tabular-nums">{money(r.amount)}</span>],
    },
  ];
}

export function SalesReportView({ code }: { code: string }) {
  const [range, setRange] = useState<RangeKey>("month");
  const [custom, setCustom] = useState<Range>({});
  const [team, setTeam] = useState("");
  const [person, setPerson] = useState("");
  const period = useMemo(() => resolveRange(range, custom), [range, custom]);
  const q = useQuery({
    queryKey: ["portal-reports", "sales", code, period, team, person],
    queryFn: async () => (await api.get(`/portal-reports/sales/${code}`, { params: { ...period, team: team || undefined, person: person || undefined } })).data.data as SalesReport,
    retry: 1,
  });
  const data = q.data;
  const sections = useMemo(() => sectionsFor(data?.currency || "AED"), [data?.currency]);
  const peopleShown = (data?.filters.people ?? []).filter((p) => !team || p.team_id === team);

  if (q.error instanceof AxiosError && q.error.response?.status === 403) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">Reports are for root admins.</CardContent></Card>;
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <RangePicker value={range} custom={custom} onChange={(k, c) => { setRange(k); if (c) setCustom(c); }} />
        <select value={team} onChange={(e) => { setTeam(e.target.value); setPerson(""); }} aria-label="Team" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">Every team</option>
          {(data?.filters.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Salesperson" className="h-9 max-w-[12rem] rounded-md border border-input bg-background px-2 text-sm">
          <option value="">Every salesperson</option>
          {peopleShown.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{REPORT_TZ_LABEL}</span>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw className={cn(q.isFetching && "animate-spin")} /> Refresh</Button>
        </div>
      </div>

      <LeadWorkflowSection code={code} period={period} team={team} person={person} />

      {q.isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{sections.map((s) => <Skeleton key={s.key} className="h-28 w-full rounded-2xl" />)}</div>
          <Skeleton className="h-96 w-full" />
        </div>
      ) : q.isError || !data ? (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            {(q.error instanceof AxiosError && (q.error.response?.data as { message?: string } | undefined)?.message)
              || (q.error instanceof AxiosError && q.error.response?.status === 404 ? "Root's server is still on the previous version — this tab shows once it is updated." : "Could not load this CRM's report. Refresh in a moment.")}
          </CardContent>
        </Card>
      ) : (
        <ReportBody sections={sections} data={data} link={leadCell} personLabel="Salesperson" ownerKey="owner_id" currency={data.currency}
          note={<>
            Leads that reached them in the period; follow-ups they logged; enrolments credited to them; payments dated in the period on the leads they hold;
            lost and not connected by when they were marked, against the lead&apos;s owner — the Salespeople page&apos;s rules, in {data.currency}. The list shows the latest 2,000.
            {data.calls.kind === "recorder" ? " Calls come from the call-recorder app, which does not say who made them." : ""}
            {!data.calls.supported ? " This CRM has no calls system." : ""}
            {data.calls.unlinked ? ` ${data.calls.unlinked} calls were taken by extensions not linked to anyone here.` : ""}
          </>} />
      )}
    </div>
  );
}
