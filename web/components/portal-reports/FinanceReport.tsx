"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { AlertTriangle, CheckCheck, Coins, FileText, PiggyBank, Receipt, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bars } from "@/components/common/Breakdown";
import { RangePicker, resolveRange, REPORT_TZ_LABEL, type Range, type RangeKey } from "@/components/reports/RangePicker";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import { ReportBody, minutes, monthName, n0, pct, when, type Group, type Row, type Section } from "@/components/portal-reports/ReportBody";

/**
 * Reports → Finance (the user, 2026-10-17): one finance organization over a
 * period, in its own currency (organizations are never added together) —
 * expenses, approvals decided, invoices, budget allocation; commission later —
 * as finance counts them (GET /portal-reports/finance → finance's
 * /service/finance-report). Root admins only.
 */

type SectionKey = "expenses" | "approvals" | "invoices" | "commission" | "budget";
type Tally = { name: string; count: number; amount: number };
interface FinanceReport extends Record<SectionKey, Group> {
  organizations: { id: string; name: string; currency: string }[];
  org: { id: string; name: string; currency: string };
  rules: { delayMinutes: number };
  appUrl: string;
  expenses: Group & { categories: Tally[]; methods: Tally[] };
  invoices: Group & { statuses: Tally[] };
}

const METHOD: Record<string, string> = { bank_transfer: "Bank transfer", cash: "Cash", cheque: "Cheque", card: "Card", online: "Online" };
const STATUS: Record<string, string> = { draft: "Draft", sent: "Sent", viewed: "Viewed", paid: "Paid", partial: "Part paid", overdue: "Overdue", void: "Void" };
const sub = (main: ReactNode, line?: ReactNode) => <div><div>{main}</div>{line ? <div className="text-xs text-muted-foreground">{line}</div> : null}</div>;

function sectionsFor(currency: string, delay: number): Section<SectionKey>[] {
  const money = (v: number | undefined) => `${currency} ${n0(v)}`;
  const tallyBars = (title: string, rows: Tally[], unit: string, label: (n: string) => string = (n) => n) => rows.length ? (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <Bars rows={rows.map((x) => ({ key: x.name, label: label(x.name), sub: `${n0(x.count)} ${unit}`, value: x.amount, display: money(x.amount) }))} />
    </div>
  ) : null;
  return [
    {
      key: "expenses", label: "Expenses", icon: Receipt, accent: "rose", views: { people: "By submitter", teams: "By department" },
      headline: (t) => money(t.amount), headlineHint: (t) => `${n0(t.expenses)} expenses · ${money(t.unpaid_amount)} unpaid`,
      cards: (t) => [{ title: "Expenses", value: money(t.amount), hint: `${n0(t.expenses)} approved` }, { title: "Paid", value: money(t.paid_amount), hint: `${n0(t.paid)} expenses` },
        { title: "Still unpaid", value: money(t.unpaid_amount), hint: `${n0(t.unpaid)} expenses`, alert: (t.unpaid ?? 0) > 0 }],
      cols: [{ key: "expenses", label: "Expenses" }, { key: "amount", label: "Amount", fmt: "money" }, { key: "paid_amount", label: "Paid", fmt: "money" }, { key: "unpaid_amount", label: "Unpaid", fmt: "money" }],
      rowHead: ["Dated", "Expense", "Submitted by", "Category", "Amount"],
      row: (r, link) => [when(r.at), link(r), sub(r.owner || "—", r.department), sub(r.category, r.from_hrms ? "From HRMS" : undefined),
        <span key="a" className="tabular-nums">{money(r.amount)}<span className={cn("block text-xs", r.paid ? "text-emerald-500" : "text-amber-500")}>{r.paid ? `Paid ${when(r.paid_on)}${r.method ? ` · ${METHOD[r.method] ?? r.method}` : ""}` : "Not paid yet"}</span></span>],
      extra: (g) => {
        const e = g as FinanceReport["expenses"];
        return e.categories?.length || e.methods?.length ? (
          <div className="flex flex-col gap-4 lg:flex-row">{tallyBars("By category", e.categories ?? [], "expenses")}{tallyBars("By payment method", e.methods ?? [], "expenses", (n) => METHOD[n] ?? n)}</div>
        ) : null;
      },
    },
    {
      key: "approvals", label: "Approvals decided", icon: CheckCheck, accent: "violet", views: { people: "By who decided", teams: "By kind" },
      headline: (t) => n0(t.decided), headlineHint: (t) => `${n0(t.over_30)} took over ${delay} min · ${minutes(t.avg_minutes)} on average`,
      cards: (t) => [{ title: "Decided", value: n0(t.decided) }, { title: "Approved", value: n0(t.approved), hint: pct(t.approved ?? 0, t.decided ?? 0) },
        { title: "Rejected or sent back", value: n0(t.rejected), hint: pct(t.rejected ?? 0, t.decided ?? 0) },
        { title: "Average time to decide", value: minutes(t.avg_minutes), hint: `over ${n0(t.timed)} with a sent time` },
        { title: `Over ${delay} minutes`, value: n0(t.over_30), hint: pct(t.over_30 ?? 0, t.timed ?? 0), alert: (t.over_30 ?? 0) > 0 }],
      cols: [{ key: "decided", label: "Decided" }, { key: "approved", label: "Approved" }, { key: "rejected", label: "Rejected / sent back" }, { key: "avg_minutes", label: "Average", fmt: "mins" }, { key: "over_30", label: `Over ${delay} min` }],
      rowHead: ["Decided", "What", "Decided by", "Took", "Outcome"],
      row: (r, link) => [when(r.at), sub(link(r), [r.kind, r.raised_by ? `raised by ${r.raised_by}` : "", r.amount != null ? money(r.amount) : ""].filter(Boolean).join(" · ")), r.owner,
        r.minutes == null ? <span key="t" className="text-muted-foreground/60">—</span> : <span key="t" className={cn("tabular-nums", r.minutes > delay && "text-rose-500")}>{minutes(r.minutes)}</span>,
        <span key="o" className={cn(r.outcome === "approved" ? "text-emerald-500" : "text-rose-500")}>{r.outcome === "approved" ? "Approved" : r.outcome === "sent back" ? "Sent back" : "Rejected"}</span>],
    },
    {
      key: "invoices", label: "Invoices", icon: FileText, accent: "blue", views: { people: "By salesperson", teams: "By CRM" },
      headline: (t) => money(t.amount), headlineHint: (t) => `${n0(t.invoices)} issued · ${money(t.collected)} collected`,
      cards: (t) => [{ title: "Invoiced", value: money(t.amount), hint: `${n0(t.invoices)} issued${t.void ? ` · ${n0(t.void)} void` : ""}` },
        { title: "Collected", value: money(t.collected), hint: `${n0(t.payments)} payments dated in the period` },
        { title: "Outstanding", value: money(t.outstanding), hint: "on the invoices issued" },
        { title: "Overdue", value: money(t.overdue_amount), hint: `${n0(t.overdue)} invoices past due`, alert: (t.overdue ?? 0) > 0 },
        { title: "Paid in full", value: n0(t.paid), hint: pct(t.paid ?? 0, (t.invoices ?? 0) - (t.void ?? 0)) }],
      cols: [{ key: "invoices", label: "Issued" }, { key: "amount", label: "Invoiced", fmt: "money" }, { key: "collected", label: "Collected", fmt: "money" },
        { key: "outstanding", label: "Outstanding", fmt: "money" }, { key: "overdue_amount", label: "Overdue", fmt: "money" }],
      rowHead: ["Issued", "Invoice", "Salesperson", "Status", "Amount"],
      row: (r, link) => [when(r.at), sub(link(r), [r.title, r.course].filter(Boolean).join(" · ")), sub(r.owner || "—", r.team),
        <span key="s" className={cn(r.status === "void" ? "text-muted-foreground" : r.overdue ? "text-rose-500" : r.status === "paid" ? "text-emerald-500" : "")}>{r.overdue ? "Overdue" : STATUS[r.status] ?? r.status}{r.due && r.status !== "paid" && r.status !== "void" ? <span className="block text-xs text-muted-foreground">due {when(r.due)}</span> : null}</span>,
        <span key="a" className="tabular-nums">{money(r.amount)}{r.status !== "void" && r.balance > 0 ? <span className="block text-xs text-muted-foreground">{money(r.balance)} to pay</span> : null}</span>],
      extra: (g) => tallyBars("By status", (g as FinanceReport["invoices"]).statuses ?? [], "invoices", (n) => STATUS[n] ?? n),
    },
    {
      key: "commission", label: "Commission", icon: Coins, accent: "amber", soon: "Finance's commission report comes later.",
      headline: () => "—", headlineHint: () => "coming soon",
      cards: () => [], cols: [], rowHead: [], row: () => [],
    },
    {
      key: "budget", label: "Budget allocation", icon: PiggyBank, accent: "emerald", views: { people: "By department", teams: null },
      headline: (t) => money(t.available), headlineHint: (t) => `available of ${money((t.allocated ?? 0) + (t.topups ?? 0))} · ${n0(t.pending)} requests pending`,
      cards: (t) => [{ title: "Allocated", value: money(t.allocated) }, { title: "Top-ups approved", value: money(t.topups) }, { title: "Drawdowns", value: money(t.drawdowns) },
        { title: "Approved expenses", value: money(t.spent) }, { title: "Available", value: money(t.available), alert: (t.available ?? 0) < 0, hint: (t.available ?? 0) < 0 ? "over budget" : undefined },
        { title: "Requests pending", value: n0(t.pending), alert: (t.pending ?? 0) > 0 }],
      cols: [{ key: "allocated", label: "Allocated", fmt: "money" }, { key: "topups", label: "Top-ups", fmt: "money" }, { key: "drawdowns", label: "Drawdowns", fmt: "money" },
        { key: "spent", label: "Expenses", fmt: "money" }, { key: "available", label: "Available", fmt: "money" }, { key: "pending", label: "Pending" }],
      rowHead: ["Month", "Department", "Allocated", "Top-ups / drawdowns", "Expenses", "Available"],
      row: (r) => [monthName(r.period), <span key="d" className="font-medium">{r.owner}</span>, money(r.allocated),
        sub(`+${money(r.topups)}`, r.drawdowns ? `−${money(r.drawdowns)}` : undefined), money(r.spent),
        <span key="v" className={cn("tabular-nums", r.available < 0 && "text-rose-500")}>{money(r.available)}{r.pending ? <span className="block text-xs text-amber-500">{n0(r.pending)} pending</span> : null}</span>],
    },
  ];
}

export function FinanceReportView() {
  const [range, setRange] = useState<RangeKey>("month");
  const [custom, setCustom] = useState<Range>({});
  const [org, setOrg] = useState("");
  const period = useMemo(() => resolveRange(range, custom), [range, custom]);
  const q = useQuery({
    queryKey: ["portal-reports", "finance", period, org],
    queryFn: async () => (await api.get("/portal-reports/finance", { params: { ...period, org: org || undefined } })).data.data as FinanceReport,
    retry: 1,
  });
  const data = q.data;
  const sections = useMemo(() => sectionsFor(data?.org.currency || "AED", data?.rules.delayMinutes || 30), [data?.org.currency, data?.rules.delayMinutes]);
  const link = (r: Row) => {
    const label = <span className="font-medium">{r.number || r.title || "Open"}</span>;
    return data?.appUrl && r.href ? <a href={`${data.appUrl}${r.href}`} target="_blank" rel="noreferrer" className="hover:underline">{label}</a> : label;
  };

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
              || (q.error instanceof AxiosError && q.error.response?.status === 404 ? "Root's server is still on the previous version — this tab shows once it is updated." : "Could not load finance's report. Refresh in a moment.")}
          </CardContent>
        </Card>
      ) : (
        <ReportBody key={data.org.id} sections={sections} data={data} link={link} personLabel="Person" ownerKey="owner_id" currency={data.org.currency}
          note={<>
            {data.org.name}, in {data.org.currency} only — another organization is its own pill, never added in. Expenses: approved ones dated in the period, paid or not (drafts,
            rejected and voided left out). Approvals: what was decided in the period, late entries too; the time is from sent to decided, where finance keeps when it was sent.
            Invoices: issued in the period; collected is every payment dated in the period, on any invoice; overdue is past its due date today. Budget: the Budget page&apos;s
            own figures for each month in the period. The lists show the latest 2,000.
          </>} />
      )}
    </div>
  );
}
