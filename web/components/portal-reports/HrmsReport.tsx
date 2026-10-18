"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { AlertTriangle, CalendarOff, ClipboardCheck, Clock, Receipt, RefreshCw, ShoppingCart, UserPlus, Users, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bars } from "@/components/common/Breakdown";
import { RangePicker, resolveRange, REPORT_TZ_LABEL, type Range, type RangeKey } from "@/components/reports/RangePicker";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import { ReportBody, minutes, monthName, n0, pct, when, type Group, type Row, type Section } from "@/components/portal-reports/ReportBody";

/**
 * Reports → HRMS (the user, 2026-10-18): one HRMS organization over a period —
 * attendance, leave, regularization, hiring, joiners and leavers, payroll (with
 * its totals), purchase and office-keeping requests, overtime and
 * reimbursements — by employee, department and month, as HRMS counts them
 * (GET /portal-reports/hrms → HRMS's /service/hrms-report). Root admins only.
 */

type SectionKey = "attendance" | "leave" | "regularization" | "hiring" | "people" | "payroll" | "requests" | "claims";
type Tally = { name: string; count: number };
interface HrmsReport extends Record<SectionKey, Group> {
  organizations: { id: string; name: string; currency: string }[];
  org: { id: string; name: string; currency: string };
  leave: Group & { types: Tally[] };
  regularization: Group & { types: Tally[] };
  hiring: Group & { stages: Tally[] };
  people: Group & { exitTypes: Tally[]; headcount: Tally[] };
  requests: Group & { categories: Tally[] };
  claims: Group & { categories: Tally[] };
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s).replace(/_/g, " ");
const sub = (main: ReactNode, line?: ReactNode) => <div><div>{main}</div>{line ? <div className="text-xs text-muted-foreground">{line}</div> : null}</div>;
const dayOf = (iso: string) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "—");
const tone = (s: string) => (["approved", "paid", "sorted", "received", "relieved", "filled", "hired", "on a payslip"].includes(s) ? "text-emerald-500"
  : ["rejected", "absent", "returned", "cancelled", "withdrawn"].includes(s) ? "text-rose-500" : ["pending", "requested", "late"].includes(s) ? "text-amber-500" : "");
const statusCell = (s: string) => <span key="s" className={cn(tone(String(s)))}>{cap(String(s ?? ""))}</span>;
const who = (r: Row) => sub(r.owner, r.team);

function tallyBars(title: string, rows: Tally[], display?: (n: number) => string) {
  return rows.length ? (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <Bars rows={rows.map((x) => ({ key: x.name, label: cap(x.name), value: x.count, display: display ? display(x.count) : undefined }))} />
    </div>
  ) : null;
}

function sectionsFor(currency: string): Section<SectionKey>[] {
  const money = (v: number | undefined) => `${currency} ${n0(v)}`;
  return [
    {
      key: "attendance", label: "Attendance", icon: Clock, accent: "cyan", views: { people: "By employee", teams: "By department" },
      headline: (t) => n0(t.days), headlineHint: (t) => `working days · ${n0(t.late)} late · ${n0(t.absent)} absent`,
      cards: (t) => [{ title: "Working days", value: n0(t.days), hint: `${minutes(t.worked_minutes)} worked` }, { title: "Present", value: n0(t.present) },
        { title: "Late", value: n0(t.late), hint: `${minutes(t.late_minutes)} late in all`, alert: (t.late ?? 0) > 0 }, { title: "Absent", value: n0(t.absent), alert: (t.absent ?? 0) > 0 },
        { title: "Half day · early out", value: `${n0(t.half_day)} · ${n0(t.early_out)}` }, { title: "WFH · on leave", value: `${n0(t.wfh)} · ${n0(t.on_leave)}` }],
      cols: [{ key: "days", label: "Days" }, { key: "present", label: "Present" }, { key: "late", label: "Late" }, { key: "late_minutes", label: "Late by", fmt: "mins" },
        { key: "absent", label: "Absent" }, { key: "half_day", label: "Half day" }, { key: "early_out", label: "Early out" }, { key: "wfh", label: "WFH" }, { key: "worked_minutes", label: "Worked", fmt: "mins" }],
      rowHead: ["Day", "Employee", "Status", "Late", "Worked", "In / out"],
      row: (r) => [dayOf(r.day), who(r), statusCell(r.status), r.late_minutes ? minutes(r.late_minutes) : "—", minutes(r.worked_minutes),
        <span key="io" className="text-xs text-muted-foreground">{r.check_in ? when(r.check_in) : "—"}{r.check_out ? ` → ${when(r.check_out)}` : ""}</span>],
    },
    {
      key: "leave", label: "Leave", icon: CalendarOff, accent: "violet", views: { people: "By employee", teams: "By department" },
      headline: (t) => `${n0(t.days)} days`, headlineHint: (t) => `taken · ${n0(t.requests)} requests · ${n0(t.pending)} pending`,
      cards: (t) => [{ title: "Days taken", value: n0(t.days), hint: "approved leave starting in the period" }, { title: "Requests", value: n0(t.requests) },
        { title: "Approved", value: n0(t.approved), hint: pct(t.approved ?? 0, t.requests ?? 0) }, { title: "Rejected", value: n0(t.rejected) },
        { title: "Pending", value: n0(t.pending), alert: (t.pending ?? 0) > 0 }, { title: "Cancelled", value: n0(t.cancelled) }],
      cols: [{ key: "requests", label: "Requests" }, { key: "approved", label: "Approved" }, { key: "rejected", label: "Rejected" }, { key: "pending", label: "Pending" }, { key: "days", label: "Days taken" }],
      rowHead: ["From", "Employee", "Type", "Days", "Status"],
      row: (r) => [`${dayOf(r.from)}${r.to && r.to !== r.from ? ` – ${dayOf(r.to)}` : ""}`, who(r), cap(r.type), `${n0(r.days)}${r.half_day ? " (half)" : ""}`, statusCell(r.status)],
      extra: (g) => tallyBars("Days taken by type", (g as HrmsReport["leave"]).types ?? [], (n) => `${n0(n)} days`),
    },
    {
      key: "regularization", label: "Regularization", icon: ClipboardCheck, accent: "amber", views: { people: "By employee", teams: "By department" },
      headline: (t) => n0(t.requests), headlineHint: (t) => `requests · ${n0(t.pending)} pending · ${n0(t.escalated)} escalated`,
      cards: (t) => [{ title: "Requests", value: n0(t.requests) }, { title: "Approved", value: n0(t.approved), hint: pct(t.approved ?? 0, t.requests ?? 0) },
        { title: "Rejected", value: n0(t.rejected) }, { title: "Pending", value: n0(t.pending), alert: (t.pending ?? 0) > 0 }, { title: "Escalated", value: n0(t.escalated) }],
      cols: [{ key: "requests", label: "Requests" }, { key: "approved", label: "Approved" }, { key: "rejected", label: "Rejected" }, { key: "pending", label: "Pending" }, { key: "escalated", label: "Escalated" }],
      rowHead: ["Raised", "Employee", "Type", "For", "Status"],
      row: (r) => [when(r.at), who(r), sub(cap(r.type), r.becomes ? `becomes ${r.becomes}` : undefined), dayOf(r.day),
        <span key="s">{statusCell(r.status)}{r.escalated ? <span className="block text-xs text-amber-500">escalated</span> : null}</span>],
      extra: (g) => tallyBars("By type", (g as HrmsReport["regularization"]).types ?? []),
    },
    {
      key: "hiring", label: "Hiring", icon: UserPlus, accent: "violet", views: { people: "By who raised it", teams: "By department" },
      headline: (t) => n0(t.hired), headlineHint: (t) => `hired · ${n0(t.requisitions)} requisitions · ${n0(t.offers_sent)} offers sent`,
      cards: (t) => [{ title: "Requisitions", value: n0(t.requisitions), hint: `${n0(t.headcount)} headcount` }, { title: "Approved · rejected", value: `${n0(t.approved)} · ${n0(t.rejected)}` },
        { title: "Candidates", value: n0(t.applications), hint: "applied in the period" }, { title: "Offers sent", value: n0(t.offers_sent) },
        { title: "Offers signed", value: n0(t.offers_signed), hint: pct(t.offers_signed ?? 0, t.offers_sent ?? 0) }, { title: "Hired", value: n0(t.hired) }],
      cols: [{ key: "requisitions", label: "Requisitions" }, { key: "headcount", label: "Headcount" }, { key: "approved", label: "Approved" }, { key: "rejected", label: "Rejected" },
        { key: "applications", label: "Candidates" }, { key: "offers_sent", label: "Offers sent" }, { key: "offers_signed", label: "Signed" }, { key: "hired", label: "Hired" }],
      rowHead: ["When", "What", "Raised by / for", "Status"],
      row: (r) => [when(r.at), sub(<span className="font-medium">{r.title}</span>, `${cap(r.kind)} · ${r.detail}`), who(r), statusCell(r.status)],
      extra: (g) => tallyBars("Candidates by where they stand", (g as HrmsReport["hiring"]).stages ?? []),
    },
    {
      key: "people", label: "Joiners & leavers", icon: Users, accent: "emerald", views: { people: "By employee", teams: "By department" },
      headline: (t) => `+${n0(t.joined)} / −${n0(t.exits)}`, headlineHint: (t) => `joined · left · ${n0(t.relieved)} relieved`,
      cards: (t) => [{ title: "Joined", value: n0(t.joined) }, { title: "Exits", value: n0(t.exits), alert: (t.exits ?? 0) > 0 }, { title: "Resignations", value: n0(t.resignations) },
        { title: "Terminations", value: n0(t.terminations) }, { title: "Other exits", value: n0(t.other_exits) }, { title: "Relieved", value: n0(t.relieved), hint: "last day in the period" }],
      cols: [{ key: "joined", label: "Joined" }, { key: "exits", label: "Exits" }, { key: "resignations", label: "Resignations" }, { key: "terminations", label: "Terminations" }, { key: "relieved", label: "Relieved" }],
      rowHead: ["When", "Employee", "What", "Status"],
      row: (r) => [dayOf(r.at), who(r), sub(cap(r.kind), r.detail), statusCell(r.status)],
      extra: (g) => {
        const p = g as HrmsReport["people"];
        return <div className="flex flex-col gap-4 lg:flex-row">{tallyBars("Exits by type", p.exitTypes ?? [])}{tallyBars("Headcount now, by department", p.headcount ?? [])}</div>;
      },
    },
    {
      key: "payroll", label: "Payroll", icon: Wallet, accent: "emerald", views: { people: "By run", teams: "By status" },
      headline: (t) => money(t.net), headlineHint: (t) => `net · ${n0(t.runs)} runs · ${money(t.paid)} paid`,
      cards: (t) => [{ title: "Runs", value: n0(t.runs), hint: `${n0(t.employees)} employees` }, { title: "Gross", value: money(t.gross) }, { title: "Deductions", value: money(t.deductions) },
        { title: "Net", value: money(t.net) }, { title: "Paid", value: money(t.paid), hint: pct(t.paid ?? 0, t.net ?? 0) }],
      cols: [{ key: "runs", label: "Runs" }, { key: "employees", label: "Employees" }, { key: "gross", label: "Gross", fmt: "money" }, { key: "deductions", label: "Deductions", fmt: "money" },
        { key: "net", label: "Net", fmt: "money" }, { key: "paid", label: "Paid", fmt: "money" }],
      rowHead: ["Month", "Status", "Employees", "Gross", "Deductions", "Net"],
      row: (r) => [<span key="m" className="font-medium">{monthName(r.month)}</span>,
        <span key="s">{statusCell(r.status)}{r.paid_at ? <span className="block text-xs text-muted-foreground">paid {dayOf(r.paid_at)}</span> : null}{r.returned ? <span className="block text-xs text-rose-500">{r.returned}</span> : null}</span>,
        n0(r.employees), `${r.currency} ${n0(r.gross)}`, `${r.currency} ${n0(r.deductions)}`, <span key="n" className="font-medium tabular-nums">{r.currency} {n0(r.net)}</span>],
    },
    {
      key: "requests", label: "Purchases & office keeping", icon: ShoppingCart, accent: "blue", views: { people: "By who asked", teams: "By department" },
      headline: (t) => n0((t.purchases ?? 0) + (t.office ?? 0)), headlineHint: (t) => `${n0(t.purchases)} purchases (${money(t.cost)}) · ${n0(t.office)} office keeping`,
      cards: (t) => [{ title: "Purchase requests", value: n0(t.purchases), hint: money(t.cost) }, { title: "Approved", value: n0(t.approved) }, { title: "Rejected", value: n0(t.rejected) },
        { title: "Received", value: n0(t.received) }, { title: "Office keeping", value: n0(t.office) }, { title: "Sorted", value: n0(t.sorted), hint: pct(t.sorted ?? 0, t.office ?? 0) }],
      cols: [{ key: "purchases", label: "Purchases" }, { key: "cost", label: "Cost", fmt: "money" }, { key: "approved", label: "Approved" }, { key: "rejected", label: "Rejected" },
        { key: "received", label: "Received" }, { key: "office", label: "Office keeping" }, { key: "sorted", label: "Sorted" }],
      rowHead: ["Raised", "What", "Asked by", "Cost", "Status"],
      row: (r) => [when(r.at), sub(<span className="font-medium">{r.title}</span>, `${cap(r.kind)}${r.detail ? ` · ${r.detail}` : ""}`), who(r), r.cost ? money(r.cost) : "—",
        <span key="s">{statusCell(r.status)}{r.handled_by ? <span className="block text-xs text-muted-foreground">by {r.handled_by}</span> : null}</span>],
      extra: (g) => tallyBars("Purchases by category", (g as HrmsReport["requests"]).categories ?? []),
    },
    {
      key: "claims", label: "Overtime & reimbursements", icon: Receipt, accent: "rose", views: { people: "By employee", teams: "By department" },
      headline: (t) => money((t.overtime_amount ?? 0) + (t.claimed ?? 0)), headlineHint: (t) => `${n0(t.overtime_hours)} h overtime · ${n0(t.claims)} claims`,
      cards: (t) => [{ title: "Overtime", value: `${n0(t.overtime_hours)} h`, hint: money(t.overtime_amount) }, { title: "Claims", value: n0(t.claims), hint: money(t.claimed) },
        { title: "Approved", value: money(t.approved), hint: pct(t.approved ?? 0, t.claimed ?? 0) }, { title: "Rejected", value: n0(t.rejected) }],
      cols: [{ key: "overtime_hours", label: "Overtime h" }, { key: "overtime_amount", label: "Overtime", fmt: "money" }, { key: "claims", label: "Claims" },
        { key: "claimed", label: "Claimed", fmt: "money" }, { key: "approved", label: "Approved", fmt: "money" }, { key: "rejected", label: "Rejected" }],
      rowHead: ["Date", "Employee", "What", "Amount", "Status"],
      row: (r) => [dayOf(r.at), who(r), sub(<span className="font-medium">{r.title}</span>, `${cap(r.kind)}${r.detail ? ` · ${cap(r.detail)}` : ""}`), money(r.amount), statusCell(r.status)],
      extra: (g) => tallyBars("Claimed by category", (g as HrmsReport["claims"]).categories ?? [], money),
    },
  ];
}

export function HrmsReportView() {
  const [range, setRange] = useState<RangeKey>("month");
  const [custom, setCustom] = useState<Range>({});
  const [org, setOrg] = useState("");
  const period = useMemo(() => resolveRange(range, custom), [range, custom]);
  const q = useQuery({
    queryKey: ["portal-reports", "hrms", period, org],
    queryFn: async () => (await api.get("/portal-reports/hrms", { params: { ...period, org: org || undefined } })).data.data as HrmsReport,
    retry: 1,
  });
  const data = q.data;
  const sections = useMemo(() => sectionsFor(data?.org.currency || "AED"), [data?.org.currency]);
  const link = (r: Row) => <span className="font-medium">{r.title || r.owner}</span>;

  if (q.error instanceof AxiosError && q.error.response?.status === 403) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">Reports are for root admins.</CardContent></Card>;
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <RangePicker value={range} custom={custom} onChange={(k, c) => { setRange(k); if (c) setCustom(c); }} />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{REPORT_TZ_LABEL}</span>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw className={cn(q.isFetching && "animate-spin")} /> Refresh</Button>
        </div>
      </div>
      {(data?.organizations.length ?? 0) > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Organization">
          {data!.organizations.map((o) => (
            <Button key={o.id} size="sm" role="tab" aria-selected={data!.org.id === o.id} variant={data!.org.id === o.id ? "default" : "outline"} onClick={() => setOrg(o.id)}>
              {o.name} <span className="text-xs opacity-70">{o.currency}</span>
            </Button>
          ))}
        </div>
      )}

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
              || (q.error instanceof AxiosError && q.error.response?.status === 404 ? "Root's server is still on the previous version — this tab shows once it is updated." : "Could not load HRMS's report. Refresh in a moment.")}
          </CardContent>
        </Card>
      ) : (
        <ReportBody key={data.org.id} sections={sections} data={data} link={link} personLabel="Employee" ownerKey="owner_id" currency={data.org.currency}
          note={<>
            {data.org.name}{data.organizations.length > 1 ? `, in ${data.org.currency} — another organization is its own pill` : ""}. Attendance: each day in the period (weekends and
            holidays left out; the list keeps late, absent, half-day and early-out days). Leave: requests starting in the period, days taken = approved. Regularization, hiring
            requisitions, purchases and office keeping: raised in the period. Candidates, offers and hires: by when each happened. Exits by resignation date; relieved by last day.
            Payroll: the runs for the period&apos;s months. Overtime by its date; reimbursements by expense date. The lists show the latest 2,000.
          </>} />
      )}
    </div>
  );
}
