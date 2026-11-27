"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { comparePeriod, periodLabel, useReportOrgFilters } from "../ReportOrgShell";
import { change, count, money, percent, useFinanceExecutive, useFinanceOrgs, type ExPerf } from "./api";
import { FinanceFilters, pickOrg } from "./FinanceFilters";
import { Select } from "./FilterSelect";
import { CardsLoading, ErrorCard, axisMoney, dayText, monthText, periodText, timeText } from "./parts";

/*
 * Report Org → Executive dashboard (Phase 7, 2026-11-28): live from finance's executive answer, which puts together
 * the figures Phases 3–6 already work out — nothing is calculated here. It replaces the sample section.
 *
 *   A  performance, with the comparison period beside it
 *   B  the three profit views, kept apart: invoice-based, collection-based, cash movement
 *   C  cash and position
 *   D  receivables and obligations
 *   E  alerts, each opening its reconciliation or controls report; then trends
 *
 * Every currency stays apart and is never converted. Read-only.
 */

const WARN = new Set(["overdue", "critical", "high", "unreconciled", "unmatched_in", "unmatched_out", "open_differences", "psp_overdue", "duplicates", "negative", "doc_gaps"]);

function Delta({ now, before, invert = false }: { now: number; before: number | undefined; invert?: boolean }) {
  if (before === undefined) return null;
  const c = change(now, before);
  const up = now > before, flat = now === before;
  const good = flat ? null : invert ? !up : up;
  return (
    <span className={cn("text-[11px] tabular-nums", good === null ? "text-muted-foreground" : good ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
      {flat ? "no change" : `${up ? "▲" : "▼"} ${c === null ? "new" : percent(c)}`}
    </span>
  );
}

function Stat({ label, value, sub, before, now, invert, warn, href }: { label: string; value: string; sub?: ReactNode; before?: number; now?: number; invert?: boolean; warn?: boolean; href?: string }) {
  const body = (
    <Card className={cn("h-full", href && "transition-colors hover:border-primary/60 hover:bg-muted/30", warn && "border-amber-300 dark:border-amber-700")}>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("text-lg font-semibold tabular-nums", warn ? "text-amber-700 dark:text-amber-400" : "text-foreground")}>{value}</p>
        {now !== undefined && <Delta now={now} before={before} invert={invert} />}
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} title="Open the report behind it">{body}</Link> : body;
}

function Section({ letter, title, about, children }: { letter: string; title: string; about?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-foreground"><span className="mr-2 font-mono text-xs text-primary">{letter}</span>{title}</h2>
        {about && <p className="text-xs text-muted-foreground">{about}</p>}
      </div>
      {children}
    </section>
  );
}

const margin = (m: number | null) => (m === null ? "no income" : `margin ${m.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);

type TrendKey = "revenue" | "profit" | "cash" | "expenses" | "receivables";
const TRENDS: { key: TrendKey; name: string }[] = [
  { key: "revenue", name: "Revenue and collections" },
  { key: "profit", name: "Profit (three views)" },
  { key: "cash", name: "Cash flow" },
  { key: "expenses", name: "Costs by category" },
  { key: "receivables", name: "Receivables ageing" },
];

export function ExecutiveHome() {
  const f = useReportOrgFilters();
  const orgs = useFinanceOrgs();
  const org = pickOrg(orgs.data, f.entity);
  const other = comparePeriod(f.range, f.compare, f.compareCustom);
  const q = useFinanceExecutive(org?.id, f.range, other);
  const data = q.data;
  const [currency, setCurrency] = useState("");
  const [trend, setTrend] = useState<TrendKey>("revenue");
  const [asTable, setAsTable] = useState(false);
  const base = data?.currency ?? org?.currency ?? "";
  const currencies = data ? Array.from(new Set([base, ...data.performance.map((p) => p.currency)])) : [];
  const cur = currency && currencies.includes(currency) ? currency : base;
  const error = orgs.error ?? q.error;

  const perf = data?.performance.find((p) => p.currency === cur);
  const p = perf?.current, c = perf?.compare ?? undefined;
  const cash = data?.cash.find((x) => x.currency === cur);
  const rec = data?.receivables.find((x) => x.currency === cur);
  const obl = data?.obligations.find((x) => x.currency === cur);
  const alerts = (data?.alerts ?? []).filter((a) => a.currency === cur);
  const m = (n: number) => money(n, cur);
  const cmp = (k: keyof ExPerf) => (c ? (c[k] as number) : undefined);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Executive dashboard</h1>
        <p className="max-w-4xl text-xs text-muted-foreground">
          Live from finance: performance, the three profit views, cash and position, receivables and obligations, and the alerts from reconciliation and controls. Every figure is finance&apos;s own; each currency is shown apart and never converted.
          {data && <> {periodText(data.period)}{data.compare && <> compared with {periodLabel(data.compare)}</>} · as of {dayText(data.asOf)} · from finance at {timeText(data.generatedAt)}.</>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <FinanceFilters orgs={orgs.data} org={org} compare>
          {currencies.length > 1 && <Select label="Currency" value={cur} onChange={setCurrency} options={currencies.map((x) => ({ key: x, name: x === base ? `${x} (the organization's)` : `${x} (apart, never converted)` }))} />}
        </FinanceFilters>
      </div>
      {(data?.warnings ?? []).length > 0 && (
        <details className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <summary className="cursor-pointer font-medium">Data completeness ({data!.warnings.length})</summary>
          <div className="mt-1 space-y-0.5">{data!.warnings.map((w) => <p key={w}>{w}</p>)}</div>
        </details>
      )}

      {error ? (
        <ErrorCard error={error} onRetry={() => { void orgs.refetch(); void q.refetch(); }} />
      ) : !data ? (
        <CardsLoading n={8} />
      ) : (
        <>
          <Section letter="A" title="Performance" about={c ? "Arrows compare with the comparison period." : "Pick a comparison above to see the change."}>
            {p ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                <Stat label="Gross invoiced" value={m(p.grossInvoicedMinor)} now={p.grossInvoicedMinor} before={cmp("grossInvoicedMinor")} />
                <Stat label="Net invoiced (after credit notes and VAT)" value={m(p.netInvoicedMinor)} now={p.netInvoicedMinor} before={cmp("netInvoicedMinor")} />
                <Stat label="Collections" value={m(p.collectionsMinor)} now={p.collectionsMinor} before={cmp("collectionsMinor")} />
                <Stat label="Net collections (before VAT)" value={m(p.netCollectionsMinor)} now={p.netCollectionsMinor} before={cmp("netCollectionsMinor")} />
                <Stat label="Costs (incurred)" value={m(p.expensesMinor)} now={p.expensesMinor} before={cmp("expensesMinor")} invert />
                <Stat label="Revenue target" value="Not configured" sub={data.target.note} />
              </div>
            ) : <p className="text-xs text-muted-foreground">Nothing in {cur} for this period.</p>}
          </Section>

          {p && (
            <Section letter="B" title="Profit — three views, kept apart" about="Invoice-based and collection-based profitability are management measures; cash movement is money in and out of the bank. They are not added together.">
              <div className="grid gap-3 md:grid-cols-3">
                <Stat label="Invoice-based profit" value={m(p.invoiceProfitMinor)} sub={margin(p.invoiceMarginPct)} now={p.invoiceProfitMinor} before={cmp("invoiceProfitMinor")} href="/report-org/finance/prf-14" />
                <Stat label="Collection-based profit" value={m(p.collectionProfitMinor)} sub={margin(p.collectionMarginPct)} now={p.collectionProfitMinor} before={cmp("collectionProfitMinor")} href="/report-org/finance/prf-15" />
                <Stat label="Net cash movement" value={m(p.cashNetMinor)} sub={`in ${m(p.cashInMinor)} · out ${m(p.cashOutMinor)}`} now={p.cashNetMinor} before={cmp("cashNetMinor")} href="/report-org/finance/prf-16" />
              </div>
            </Section>
          )}

          {cash && (
            <Section letter="C" title="Cash and position" about="Bank balances are system-recorded; a verified balance needs a completed reconciliation.">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {cash.flow && <Stat label="Opening cash" value={m(cash.flow.openingMinor)} />}
                {cash.flow && <Stat label="Closing cash" value={m(cash.flow.closingMinor)} sub={`in ${m(cash.flow.inflowsMinor)} · out ${m(cash.flow.outflowsMinor)}`} now={cash.flow.closingMinor} before={cash.flowCompare?.closingMinor} href="/report-org/finance/fs-03" />}
                <Stat label="Estimated available cash" value={m(cash.availableMinor)} href="/report-org/finance/fs-11" />
                <Stat label="PSP pending settlement" value={m(cash.pspMinor)} />
                <Stat label="Verified by a reconciled statement" value={m(cash.verifiedMinor)} sub={cash.verifiedLabel} warn={cash.verifiedMinor === 0 && cash.availableMinor !== 0} />
                <Stat label="Accounts below zero" value={m(cash.negativeMinor)} warn={cash.negativeMinor !== 0} />
                <Stat label="Available cash less obligations" value={m(cash.availableAfterMinor)} sub={`obligations ${m(cash.obligationsMinor)}`} href="/report-org/finance/fs-12" />
                <Stat label="Due within 30 days or undated" value={m(cash.nearObligationsMinor)} sub={cash.surplusMinor < 0 ? `potential shortfall ${m(-cash.surplusMinor)}` : `covered by available cash — ${m(cash.surplusMinor)} left`} warn={cash.surplusMinor < 0} href="/report-org/controls/fc-04" />
              </div>
            </Section>
          )}

          {(rec || obl) && (
            <Section letter="D" title="Receivables and obligations" about="Receivables are due, not guaranteed collectible; pro-forma balances are conditional instalments; old books are apart. Obligations are not necessarily due now.">
              <div className="grid gap-3 lg:grid-cols-2">
                {rec && (
                  <Card><CardContent className="space-y-2 p-4">
                    <Link href="/report-org/finance/ar-13" className="text-sm font-medium text-foreground hover:text-primary">Receivables · {m(rec.totalMinor)}</Link>
                    <Rows rows={[["Invoices issued (balance due)", rec.invoicesMinor], ["Enrolment balances", rec.enrolmentMinor], ["Pro-forma (conditional)", rec.conditionalMinor], ["Old books (apart)", rec.oldBooksMinor], ["Overdue", rec.overdueMinor]]} m={m} />
                  </CardContent></Card>
                )}
                {obl && (
                  <Card><CardContent className="space-y-2 p-4">
                    <Link href="/report-org/finance/ap-13" className="text-sm font-medium text-foreground hover:text-primary">Obligations · {m(obl.totalMinor)}</Link>
                    <Rows rows={[["Bills", obl.billsMinor], ["Salaries", obl.salariesMinor], ["Commission", obl.commissionMinor], ["Expenses", obl.expensesMinor], ["Reimbursements", obl.reimbursementsMinor], ["Loans", obl.loansMinor]]} m={m} />
                    <p className="text-[11px] text-muted-foreground">Advances outstanding {m(obl.advancesOutstandingMinor)}{obl.advancesNotCalculableMinor ? ` · not calculable ${m(obl.advancesNotCalculableMinor)}` : ""}</p>
                  </CardContent></Card>
                )}
              </div>
            </Section>
          )}

          <Section letter="E" title="Alerts" about="From reconciliation and financial controls; each opens its report. Open reconciliation differences are unverified statement figures, not losses.">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {alerts.map((a) => (
                <Stat key={a.key} label={a.label} value={a.value === null ? "Not available" : a.as === "money" ? m(a.value) : count(a.value)} sub={a.note}
                  warn={WARN.has(a.key) && (a.value ?? 0) !== 0} href={`/report-org/${a.section}/${a.report}`} />
              ))}
            </div>
          </Section>

          <Section letter="" title="Trends" about="Month by month over the period picked. Financial exception trends are not available: exceptions are worked out from current records and no history is kept.">
            <div className="flex flex-wrap items-center gap-2">
              <Select label="Trend" value={trend} options={TRENDS} onChange={(v) => setTrend(v as TrendKey)} />
              <div className="inline-flex rounded-md border border-input p-0.5 text-xs">
                {[["Chart", false], ["Table", true]].map(([name, t]) => (
                  <button key={String(name)} type="button" onClick={() => setAsTable(t as boolean)} className={cn("rounded px-2 py-1", asTable === t ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground")}>{name as string}</button>
                ))}
              </div>
            </div>
            <Trend data={data} cur={cur} kind={trend} asTable={asTable} />
          </Section>
        </>
      )}
      {(data?.notes ?? []).map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
    </div>
  );
}

function Rows({ rows, m }: { rows: [string, number][]; m: (n: number) => string }) {
  return (
    <dl className="space-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="tabular-nums text-foreground">{m(v)}</dd></div>
      ))}
    </dl>
  );
}

const COLORS = ["hsl(var(--primary))", "#0ea5e9", "#f59e0b", "#a855f7", "#ef4444", "#64748b"];

function Trend({ data, cur, kind, asTable }: { data: NonNullable<ReturnType<typeof useFinanceExecutive>["data"]>; cur: string; kind: TrendKey; asTable: boolean }) {
  const months = data.trends.months.filter((x) => x.currency === cur);
  const cash = data.trends.cash.filter((x) => x.currency === cur);
  let rows: Record<string, string | number>[] = [];
  let series: { key: string; name: string }[] = [];
  let label = "month";
  let bar = false;
  if (kind === "revenue") {
    rows = months.map((x) => ({ month: monthText(x.month), gross: x.grossInvoicedMinor, net: x.netInvoicedMinor, collections: x.collectionsMinor }));
    series = [{ key: "gross", name: "Gross invoiced" }, { key: "net", name: "Net invoiced" }, { key: "collections", name: "Collections" }];
  } else if (kind === "profit") {
    rows = months.map((x) => ({ month: monthText(x.month), invoice: x.invoiceProfitMinor, collection: x.collectionProfitMinor, cash: x.cashNetMinor }));
    series = [{ key: "invoice", name: "Invoice-based profit" }, { key: "collection", name: "Collection-based profit" }, { key: "cash", name: "Net cash movement" }];
  } else if (kind === "cash") {
    rows = cash.map((x) => ({ month: monthText(x.month), inflows: x.inflowsMinor, outflows: x.outflowsMinor, closing: x.closingMinor }));
    series = [{ key: "inflows", name: "Money in" }, { key: "outflows", name: "Money out" }, { key: "closing", name: "Closing cash" }];
  } else if (kind === "expenses") {
    label = "category"; bar = true;
    rows = data.trends.expenseCategories.filter((x) => x.currency === cur).slice(0, 12).map((x) => ({ category: x.category, amount: x.amountMinor }));
    series = [{ key: "amount", name: "Costs (incurred)" }];
  } else {
    label = "band"; bar = true;
    rows = (data.receivables.find((x) => x.currency === cur)?.ageing ?? []).map((x) => ({ band: x.label, amount: x.amountMinor }));
    series = [{ key: "amount", name: "Outstanding" }];
  }
  if (!rows.length) return <p className="text-xs text-muted-foreground">Nothing to show for this period.</p>;
  if (asTable) {
    return (
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground"><tr><th className="px-3 py-2 text-left font-medium capitalize">{label}</th>{series.map((s) => <th key={s.key} className="px-3 py-2 text-right font-medium">{s.name}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={String(r[label])} className="border-t border-border"><td className="px-3 py-1.5">{r[label]}</td>{series.map((s) => <td key={s.key} className="px-3 py-1.5 text-right tabular-nums">{money(Number(r[s.key]), cur)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  const tip = (v: unknown) => money(Number(v), cur);
  return (
    <div className="rounded-md border border-border p-3">
      <ResponsiveContainer width="100%" height={260}>
        {bar ? (
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis dataKey={label} tick={{ fontSize: 10 }} interval={0} angle={rows.length > 6 ? -25 : 0} textAnchor={rows.length > 6 ? "end" : "middle"} height={rows.length > 6 ? 60 : 30} />
            <YAxis tickFormatter={axisMoney} tick={{ fontSize: 10 }} width={48} />
            <Tooltip formatter={tip} />
            <Bar dataKey="amount" name={series[0]!.name} fill={COLORS[0]} radius={[3, 3, 0, 0]} />
          </BarChart>
        ) : (
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={axisMoney} tick={{ fontSize: 10 }} width={48} />
            <Tooltip formatter={tip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {series.map((s, i) => <Line key={s.key} type="linear" dataKey={s.key} name={s.name} stroke={COLORS[i]} strokeWidth={2} dot={rows.length < 3} />)}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
