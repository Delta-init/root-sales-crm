"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { ArrowLeft, Download, ExternalLink, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/axios";
import { useReportOrgFilters, yearRange } from "../ReportOrgShell";
import {
  change, count, fetchAging, fetchExpenses, fetchLedger, fetchRevenue, money, useFinanceFp, useFinanceRc, useFinanceManagement, useFinancePl, percent, useFinanceAging, useFinanceExpenses, useFinanceLedger, useFinanceOrgs, useFinanceRevenue,
  type FpReportKind, type FpSide, type MpSide, type MpSum, type AgingGroup, type AgingRow, type ForeignLine, type PlBasis, type PlMonth, type PlMonths, type PlStatement, type LedgerGroup, type LedgerRow, type PageAsk, type ReportRow, type RevenueReport,
} from "./api";
import { reportById, type Column, type LiveSpec, type Report } from "./catalog";
import { ColumnsMenu, DataGrid, Pager, gridCsv, useGridColumns, type GridColumn, type GridSort } from "./DataGrid";
import { FinanceFilters, pickOrg, usePicks, type FilterDef } from "./FinanceFilters";
import { Select } from "./FilterSelect";
import { ErrorCard, ForeignUnknown, dayText, monthText, periodText, saveCsv, timeText } from "./parts";
import { StateBadge } from "./ReportCatalog";
import { CardPopup } from "./CardPopup";

/*
 * Report Org → Finance and revenue: the one viewer every report opens in.
 *
 * A report is a table and nothing else (the user, 2026-11-26: "show table only, with filter and pagination and
 * columns reorder") — no cards, no chart. What the cards said is the totals row under the rows, and money in another
 * currency has a column of its own, never added in. Each report has two tables to switch between: its summary (a row
 * per day, month, course, method…) and the records behind it (every invoice, payment or expense), which finance
 * sorts, searches and pages, so the totals are always of everything that matched and not of the page on screen.
 *
 * Every figure is finance's; the only arithmetic here is an average, a share, or one month against the one before.
 */

export type Titled = Report & { category: { name: string } };
type RevenueSpec = Extract<LiveSpec, { kind: "revenue" }>;
type ExpenseSpec = Extract<LiveSpec, { kind: "expenses" }>;
type AgingSpec = Extract<LiveSpec, { kind: "aging" }>;
type LedgerSpec = Extract<LiveSpec, { kind: "ledger" }>;
type PlSpec = Extract<LiveSpec, { kind: "pl" }>;
type MpSpec = Extract<LiveSpec, { kind: "mp" }>;
type FpSpec = Extract<LiveSpec, { kind: "fp" }> | Extract<LiveSpec, { kind: "rc" }>;
type Mode = "summary" | "records";

/** A summary row: one day, month or group. */
interface Sum {
  key: string; label: string; count: number; amount: number; collected?: number; owed?: number;
  /** What the row has in other currencies, as paid — never in `amount`. A row with only this has count and amount 0. */
  foreign?: ForeignLine[];
  /** Against the row before it in time. */
  moved?: number | null;
  /** A subcategory, listed under its category and not counted again in the total. */
  sub?: boolean;
}

const BASIS: Record<"invoiced" | "collected" | "expense" | "paid", string> = {
  invoiced: "Invoice totals with VAT, by issue date, less credit notes. Not drafts, not void.",
  collected: "Payments as received, VAT included, by the day each was made.",
  expense: "Approved expenses and those waiting for approval, by expense date. A supplier bill's expense is in it.",
  paid: "Approved expenses and those waiting for approval that have been paid, by the day paid.",
};

/* The filters each kind of table offers, in the order they sit in the bar. Every one is a column of the records too. */
const REVENUE_FILTERS: FilterDef[] = [
  { key: "crm", label: "CRM" }, { key: "salesperson", label: "Salesperson" }, { key: "department", label: "Department" },
  { key: "course", label: "Course" }, { key: "status", label: "Invoice status" }, { key: "academy", label: "Academy" },
];
const COLLECTION_FILTERS: FilterDef[] = [
  { key: "crm", label: "CRM" }, { key: "salesperson", label: "Salesperson" }, { key: "department", label: "Department" },
  { key: "method", label: "Payment method" }, { key: "bank", label: "Bank account" }, { key: "course", label: "Course" }, { key: "status", label: "Invoice status" },
];
const EXPENSE_FILTERS: FilterDef[] = [
  { key: "category", label: "Category" }, { key: "department", label: "Department" }, { key: "employee", label: "Employee" },
  { key: "method", label: "Payment method" }, { key: "bank", label: "Bank account" }, { key: "source", label: "Source" }, { key: "status", label: "Status" }, { key: "paid", label: "Paid" },
];
const RECEIVABLE_FILTERS: FilterDef[] = [{ key: "crm", label: "CRM" }, { key: "party", label: "Student" }, { key: "band", label: "How late" }, { key: "salesperson", label: "Salesperson" }, { key: "department", label: "Department" }];
const PAYABLE_FILTERS: FilterDef[] = [{ key: "party", label: "Vendor" }, { key: "band", label: "How late" }];

const EXTRA: Record<Column, string> = { collected: "Collected so far", owed: "Still owed", average: "Average", change: "On the one before", efficiency: "Collected %" };
const DASH = <span className="text-muted-foreground">—</span>;
const amber = (text: string) => <span className="text-amber-600 dark:text-amber-400">{text}</span>;
const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%` : "");
const awayCount = (lines: ForeignLine[] | undefined) => (lines ?? []).reduce((n, f) => n + f.count, 0);

/** What is typed, once the typing has stopped — so finance is asked once, not on every letter. */
function useSettled(value: string, ms = 350) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** A report read across a year opens on the year the page was on, rather than on one month of it. */
function useYearFor(period: "month" | "year", reportId: string) {
  const { range, setRange } = useReportOrgFilters();
  useEffect(() => {
    if (period === "year" && range.mode === "month") setRange(yearRange(Number(range.from.slice(0, 4))));
    // Only as the report opens: after that the period is whatever is picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);
}

/** Inside a headline card's breakdown: the table without the page's way back, title or catalog badge. */
export const InPopup = createContext(false);

function Head({ report, basis, source, at }: { report: Titled; basis?: string; source?: string; at?: string }) {
  const popup = useContext(InPopup);
  if (popup) {
    return (
      <p className="max-w-4xl text-xs text-muted-foreground">
        {report.about}
        {basis && <> {basis}</>}
        {source && <> Source: {source}.</>}
        {at && <> From finance at {timeText(at)}.</>}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {report.id.startsWith("RC-") ? (
          <Link href="/report-org/reconciliation" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Reconciliation
          </Link>
        ) : (
          <Link href="/report-org/finance" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Finance and revenue <span className="opacity-60">/</span> {report.category.name}
          </Link>
        )}
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <StateBadge state={report.state} />
          {at && <>From finance at {timeText(at)}</>}
        </p>
      </div>
      <h1 className="text-lg font-semibold text-foreground">
        <span className="mr-2 font-mono text-xs font-normal text-primary">{report.id}</span>
        {report.name}
      </h1>
      <p className="max-w-4xl text-xs text-muted-foreground">
        {report.about}
        {basis && <> {basis}</>}
        {source && <> Source: {source}.</>}
      </p>
    </div>
  );
}

function Tools({ text, onText, mode, onMode, children, actions }: { text: string; onText: (v: string) => void; mode: Mode; onMode: (m: Mode) => void; children?: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="relative w-full sm:w-60">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={text} onChange={(e) => onText(e.target.value)} placeholder="Filter by number, name or detail" aria-label="Filter rows" className="h-8 pl-8 text-xs sm:text-xs" />
      </div>
      <Select label="Rows" value={mode} onChange={(m) => onMode(m as Mode)} options={[{ key: "summary", name: "Summary: a row per group" }, { key: "records", name: "Records: every row" }]} />
      {children}
      <div className="flex items-center gap-2 sm:ml-auto">{actions}</div>
    </div>
  );
}

/** A record's number, opening it in finance when finance's address is known. */
const numberCell = (appUrl: string, r: ReportRow) =>
  appUrl ? (
    <a href={`${appUrl}${r.href}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
      {r.number || "Open"}
      <ExternalLink className="h-3 w-3" />
    </a>
  ) : (
    <span className="font-medium">{r.number || "—"}</span>
  );

const textCol = (key: keyof ReportRow & string, header: string, extra: Partial<GridColumn<ReportRow>> = {}): GridColumn<ReportRow> => ({
  key, header, sort: key, cell: (r) => (r[key] as string) || DASH, text: (r) => (r[key] as string) ?? "", ...extra,
});

const clip = (value: string) => <span className="block max-w-[22rem] truncate" title={value}>{value || "—"}</span>;

/** Sorting a summary: days and months by their date when sorted by name, everything else by the value. */
function sortSums(rows: Sum[], sort: GridSort, overTime: boolean): Sum[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  const by = (a: Sum, b: Sum) =>
    (sort.key === "label" ? (overTime ? a.key.localeCompare(b.key) : a.label.localeCompare(b.label)) : sort.key === "count" ? a.count - b.count : a.amount - b.amount) * dir;
  return [...rows].sort(by);
}

const nextSort = (now: GridSort, key: string, textKeys: string[]): GridSort =>
  now.key === key ? { key, dir: now.dir === "asc" ? "desc" : "asc" } : { key, dir: textKeys.includes(key) ? "asc" : "desc" };

/** What every report's table keeps: the mode, the words filtered by, the page and the two sorts. */
function useTable(startMode: Mode, overTime: boolean, resetOn: unknown[], startSort: GridSort = { key: "date", dir: "desc" }) {
  const [mode, setMode] = useState<Mode>(startMode);
  const [text, setText] = useState("");
  const q = useSettled(text.trim());
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<GridSort>(startSort);
  const [sumSort, setSumSort] = useState<GridSort>(overTime ? { key: "label", dir: "asc" } : { key: "amount", dir: "desc" });
  // Back to the first page whenever what is listed changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(0); }, [q, mode, pageSize, sort.key, sort.dir, sumSort.key, sumSort.dir, ...resetOn]);
  const ask: PageAsk = { limit: mode === "records" ? pageSize : 0, offset: mode === "records" ? page * pageSize : 0, sort: sort.key, dir: sort.dir, q };
  return { mode, setMode, text, setText, q, pageSize, setPageSize, page, setPage, sort, setSort, sumSort, setSumSort, ask };
}

export function RevenueTable({ report, spec }: { report: Titled; spec: RevenueSpec }) {
  const f = useReportOrgFilters();
  const orgs = useFinanceOrgs();
  const org = pickOrg(orgs.data, f.entity);
  const overTime = spec.groupBy === "day" || spec.groupBy === "month";
  useYearFor(spec.period, report.id);
  const picks = usePicks("revenue");
  const t = useTable(spec.groupBy === "day" ? "records" : "summary", overTime, [org?.id, f.range.from, f.range.to, JSON.stringify(picks)]);

  const query = useFinanceRevenue(org?.id, f.range, picks, { basis: spec.basis, groupBy: spec.groupBy, paidIn: spec.paidIn }, t.ask);
  const data = query.data;
  const cur = data?.currency ?? org?.currency ?? "";
  const appUrl = data?.appUrl ?? "";
  const invoiced = spec.basis === "invoiced";
  const lines = useMemo(() => (data?.foreign?.lines ?? []).filter((l) => l.count > 0), [data]);

  const sums = useMemo<Sum[]>(() => {
    if (!data) return [];
    const list: Sum[] = spec.groupBy === "day"
      ? (data.days ?? []).map((d) => ({ key: d.day, label: dayText(d.day), count: d.count, amount: d.amountMinor, foreign: d.foreign }))
      : data.groups.map((g) => ({ key: g.key, label: g.name, count: g.count, amount: g.amountMinor, collected: g.collectedMinor, owed: g.owedMinor, foreign: g.foreign }));
    if (overTime) {
      list.sort((a, b) => a.key.localeCompare(b.key));
      list.forEach((r, i) => { r.moved = i ? change(r.amount, list[i - 1].amount) : null; });
    }
    return list;
  }, [data, spec.groupBy, overTime]);
  const sorted = useMemo(() => sortSums(sums, t.sumSort, overTime), [sums, t.sumSort, overTime]);

  const sumCols = useMemo<GridColumn<Sum>[]>(() => {
    const totals = data?.totals;
    const all = totals?.amountMinor ?? 0;
    const collectedAll = sums.reduce((s, r) => s + (r.collected ?? 0), 0);
    const cols: GridColumn<Sum>[] = [
      { key: "label", header: overTime ? (spec.groupBy === "day" ? "Day" : "Month") : "Name", fixed: true, sort: "label", cell: (r) => <span className="font-medium">{r.label}</span>, text: (r) => r.label, total: "Total", totalText: "Total" },
      {
        key: "count", header: invoiced ? "Invoices" : "Payments", align: "right", sort: "count",
        cell: (r) => <>{count(r.count)}{awayCount(r.foreign) > 0 && <span className="ml-1 text-amber-600 dark:text-amber-400">+{count(awayCount(r.foreign))}</span>}</>,
        text: (r) => r.count + awayCount(r.foreign),
        total: count((totals?.count ?? 0) + awayCount(lines)), totalText: (totals?.count ?? 0) + awayCount(lines),
      },
      {
        key: "amount", header: `Amount (${cur})`, align: "right", sort: "amount",
        cell: (r) => (r.count === 0 && r.amount === 0 && r.foreign?.length ? DASH : money(r.amount, cur)), text: (r) => r.amount / 100,
        total: money(all, cur), totalText: all / 100,
      },
      ...lines.map((l): GridColumn<Sum> => ({
        key: `paid-${l.currency}`, header: `Paid in ${l.currency}`, align: "right",
        cell: (r) => { const x = r.foreign?.find((y) => y.currency === l.currency); return x ? amber(money(x.amountMinor, l.currency)) : DASH; },
        text: (r) => { const x = r.foreign?.find((y) => y.currency === l.currency); return x ? x.amountMinor / 100 : ""; },
        total: amber(money(l.amountMinor, l.currency)), totalText: l.amountMinor / 100,
      })),
    ];
    for (const c of spec.columns ?? []) {
      if (c === "collected") cols.push({ key: c, header: EXTRA[c], align: "right", cell: (r) => (r.collected === undefined ? DASH : money(r.collected, cur)), text: (r) => (r.collected ?? 0) / 100, total: money(collectedAll, cur), totalText: collectedAll / 100 });
      if (c === "owed") cols.push({ key: c, header: EXTRA[c], align: "right", cell: (r) => (r.owed === undefined ? DASH : money(r.owed, cur)), text: (r) => (r.owed ?? 0) / 100, total: money(totals?.outstandingMinor ?? 0, cur), totalText: (totals?.outstandingMinor ?? 0) / 100 });
      if (c === "average") cols.push({ key: c, header: EXTRA[c], align: "right", cell: (r) => (r.count ? money(Math.round(r.amount / r.count), cur) : DASH), text: (r) => (r.count ? Math.round(r.amount / r.count) / 100 : ""), total: totals?.count ? money(Math.round(all / totals.count), cur) : "", totalText: totals?.count ? Math.round(all / totals.count) / 100 : "" });
      if (c === "change") cols.push({ key: c, header: EXTRA[c], align: "right", cell: (r) => (r.moved === null || r.moved === undefined ? DASH : percent(r.moved)), text: (r) => (r.moved === null || r.moved === undefined ? "" : percent(r.moved)) });
      if (c === "efficiency") cols.push({ key: c, header: EXTRA[c], align: "right", cell: (r) => pct(r.collected ?? 0, r.amount) || DASH, text: (r) => pct(r.collected ?? 0, r.amount), total: pct(collectedAll, all), totalText: pct(collectedAll, all) });
    }
    if (!overTime) cols.push({ key: "share", header: "Share", align: "right", cell: (r) => pct(r.amount, all) || DASH, text: (r) => pct(r.amount, all) });
    return cols;
  }, [data, sums, lines, cur, invoiced, overTime, spec.groupBy, spec.columns]);

  const recCols = useMemo<GridColumn<ReportRow>[]>(() => {
    const totals = data?.totals;
    const cols: GridColumn<ReportRow>[] = [
      { key: "date", header: "Date", fixed: true, sort: "date", cell: (r) => dayText(r.date), text: (r) => r.date, total: "Total", totalText: "Total" },
      { key: "number", header: invoiced ? "Number" : "Receipt", sort: "number", cell: (r) => numberCell(appUrl, r), text: (r) => r.number },
      textCol("title", "Client", { cell: (r) => clip(r.title) }),
      ...(invoiced ? [] : [textCol("method", "Method"), textCol("bank", "Bank account")]),
      textCol("salesperson", "Salesperson"),
      textCol("course", "Course", { cell: (r) => clip(r.course ?? "") }),
      textCol("crm", "CRM"),
      textCol("status", "Invoice status", { hidden: !invoiced }),
      textCol("department", "Department", { hidden: true }),
      textCol("academy", "Academy", { hidden: true }),
      { key: "detail", header: "Detail", hidden: true, cell: (r) => clip(r.detail), text: (r) => r.detail },
      {
        key: "amount", header: `Amount (${cur})`, align: "right", sort: "amount",
        // A payment made in another currency is not in this column: its money is in its own, and what finance recorded it as is beside.
        // Asked for one other currency's payments only, they are this column: in that currency, as paid.
        cell: (r) => r.recordedMinor !== undefined && !spec.paidIn ? DASH : (
          <>
            <span className={r.amountMinor < 0 ? "text-rose-600 dark:text-rose-400" : "font-medium"}>{money(r.amountMinor, cur)}</span>
            {r.paidIn && <span className="ml-1.5 text-[11px] text-amber-600 dark:text-amber-400" title={`Paid in ${r.paidIn}, but the amount in ${r.paidIn} was never recorded, so it is counted in ${cur}`}>paid in {r.paidIn}</span>}
          </>
        ),
        text: (r) => (r.recordedMinor !== undefined && !spec.paidIn ? "" : r.amountMinor / 100),
        total: money(totals?.amountMinor ?? 0, cur), totalText: (totals?.amountMinor ?? 0) / 100,
      },
      // …and beside them, what finance recorded each as in the organization's own currency — shown, never added.
      ...(spec.paidIn && data ? [{
        key: "recorded", header: `Recorded as (${data.org.currency})`, align: "right" as const,
        cell: (r: ReportRow) => (r.recordedMinor !== undefined ? <span className="text-muted-foreground">{money(r.recordedMinor, data.org.currency)}</span> : DASH),
        text: (r: ReportRow) => (r.recordedMinor !== undefined ? r.recordedMinor / 100 : ""),
        total: <span className="text-muted-foreground">{money(Number((totals as { recordedMinor?: number } | undefined)?.recordedMinor ?? 0), data.org.currency)}</span>,
        totalText: Number((totals as { recordedMinor?: number } | undefined)?.recordedMinor ?? 0) / 100,
      }] : []),
      ...lines.flatMap((l): GridColumn<ReportRow>[] => [
        {
          key: `paid-${l.currency}`, header: `Paid in ${l.currency}`, align: "right",
          cell: (r) => (r.recordedMinor !== undefined && r.currency === l.currency ? amber(money(r.amountMinor, l.currency)) : DASH),
          text: (r) => (r.recordedMinor !== undefined && r.currency === l.currency ? r.amountMinor / 100 : ""),
          total: amber(money(l.amountMinor, l.currency)), totalText: l.amountMinor / 100,
        },
        {
          key: `recorded-${l.currency}`, header: `${l.currency} recorded as (${cur})`, align: "right",
          cell: (r) => (r.recordedMinor !== undefined && r.currency === l.currency ? <span className="text-muted-foreground">{money(r.recordedMinor, cur)}</span> : DASH),
          text: (r) => (r.recordedMinor !== undefined && r.currency === l.currency ? r.recordedMinor / 100 : ""),
          total: <span className="text-muted-foreground">{money(l.recordedMinor ?? 0, cur)}</span>, totalText: (l.recordedMinor ?? 0) / 100,
        },
      ]),
    ];
    if (invoiced) {
      cols.push(
        { key: "collected", header: "Collected so far", align: "right", cell: (r) => (r.collectedMinor === undefined ? DASH : money(r.collectedMinor, cur)), text: (r) => (r.collectedMinor ?? 0) / 100, total: money(totals?.collectedMinor ?? 0, cur), totalText: (totals?.collectedMinor ?? 0) / 100 },
        { key: "owed", header: "Still owed", align: "right", cell: (r) => (r.owedMinor === undefined ? DASH : money(r.owedMinor, cur)), text: (r) => (r.owedMinor ?? 0) / 100, total: money(totals?.outstandingMinor ?? 0, cur), totalText: (totals?.outstandingMinor ?? 0) / 100 },
      );
    }
    return cols;
  }, [data, lines, cur, invoiced, appUrl, spec.paidIn]);

  const sumGrid = useGridColumns(`${report.id}:summary`, sumCols);
  const recGrid = useGridColumns(`${report.id}:records`, recCols);
  const error = orgs.error ?? query.error;
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!data || !org) return;
    const name = `${report.id}-${data.org.name}-${data.period.from}_${data.period.to}`.replace(/\s+/g, "-");
    const top = [[`${report.id} ${report.name}`], [data.org.name, periodText(data.period), BASIS[spec.basis]], ...(t.q ? [[`Filtered by "${t.q}"`]] : []), []];
    if (t.mode === "summary") return saveCsv(`${name}.csv`, [...top, ...gridCsv(sumGrid.visible, sorted)]);
    setSaving(true);
    try {
      // Every row the filter keeps, not only the page on screen — in the same order.
      const all = await fetchRevenue(org.id, f.range, picks, { basis: spec.basis, groupBy: spec.groupBy, paidIn: spec.paidIn }, { ...t.ask, limit: 5000, offset: 0 });
      saveCsv(`${name}-records.csv`, [...top, ...gridCsv(recGrid.visible, all.rows)]);
    } catch (e) {
      toast.error(apiErrorMessage(e, "The export could not be read from finance"));
    } finally {
      setSaving(false);
    }
  };

  const shownSums = sorted.slice(t.page * t.pageSize, (t.page + 1) * t.pageSize);
  const nothing = `Nothing was ${invoiced ? "invoiced" : "collected"} for ${data?.org.name ?? "this organization"} in ${data ? periodText(data.period) : "this period"}${t.q ? ` matching “${t.q}”` : ""}.`;

  return (
    <div className="space-y-3">
      <Head report={report} basis={BASIS[spec.basis]} source="finance's Revenue report" at={data?.generatedAt} />
      <FinanceFilters orgs={orgs.data} org={org} space="revenue" options={data?.options} filters={invoiced ? REVENUE_FILTERS : COLLECTION_FILTERS} />
      <Tools
        text={t.text} onText={t.setText} mode={t.mode} onMode={t.setMode}
        actions={
          <>
            {t.mode === "summary" ? <ColumnsMenu grid={sumGrid} /> : <ColumnsMenu grid={recGrid} />}
            <Button variant="outline" size="sm" className="h-8" onClick={() => void save()} disabled={!data || saving}>
              <Download />
              {saving ? "Exporting…" : "Export"}
            </Button>
          </>
        }
      />

      {error ? (
        <ErrorCard error={error} onRetry={() => { void orgs.refetch(); void query.refetch(); }} />
      ) : t.mode === "summary" ? (
        <>
          <DataGrid
            grid={sumGrid} rows={shownSums} rowKey={(r) => r.key} loading={query.isFetching}
            sort={t.sumSort} onSort={(k) => t.setSumSort(nextSort(t.sumSort, k, ["label"]))}
            empty={spec.groupBy === "day" && data?.days === null ? "This period has more records than can be read day by day. Pick a shorter one, or open Records." : nothing}
          />
          <Pager page={t.page} pageSize={t.pageSize} total={sorted.length} onPage={t.setPage} onPageSize={t.setPageSize} />
        </>
      ) : (
        <>
          <DataGrid
            grid={recGrid} rows={data?.rows ?? []} rowKey={(r) => r.id} loading={query.isFetching}
            sort={t.sort} onSort={(k) => t.setSort(nextSort(t.sort, k, ["title", "number", "salesperson", "course", "crm", "method", "bank", "status", "department", "academy"]))}
            empty={nothing}
          />
          <Pager page={t.page} pageSize={t.pageSize} total={data?.rowCount ?? 0} onPage={t.setPage} onPageSize={t.setPageSize} noun={invoiced ? "Records" : "Payments"} />
          {data && data.rowCount < data.recordCount && (
            <p className="text-xs text-muted-foreground">
              The newest {count(data.rowCount)} of {count(data.recordCount)} are listed. The totals count all of them. Pick a shorter period to page through the rest.
            </p>
          )}
        </>
      )}

      {data && lines.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Money paid in another currency is in its own column, as it was paid. It is never converted into {cur} or added to the {cur} total.
        </p>
      )}
      <ForeignUnknown lines={data?.foreign?.lines} cur={cur} />
    </div>
  );
}

export function ExpenseTable({ report, spec }: { report: Titled; spec: ExpenseSpec }) {
  const f = useReportOrgFilters();
  const orgs = useFinanceOrgs();
  const org = pickOrg(orgs.data, f.entity);
  const orgId = org?.id;
  const overTime = spec.groupBy === "day" || spec.groupBy === "month";
  useYearFor(spec.period, report.id);
  const [basis, setBasis] = useState<"expense" | "paid">("expense");
  const [pnl, setPnl] = useState(true);
  const [currency, setCurrency] = useState<string | undefined>(spec.currency);
  // Another organization has its own currencies: back to its own (after the first, which may open on another).
  const [firstOrg] = useState(orgId);
  useEffect(() => { if (orgId !== firstOrg) setCurrency(undefined); }, [orgId, firstOrg]);
  const picks = usePicks("expenses");
  const t = useTable(spec.groupBy === "day" ? "records" : "summary", overTime, [orgId, f.range.from, f.range.to, basis, pnl, currency, JSON.stringify(picks)]);

  const ask = { basis, groupBy: spec.groupBy, pnl, currency, only: spec.only, picks };
  const query = useFinanceExpenses(orgId, f.range, ask, t.ask);
  const data = query.data;
  const cur = data?.currency ?? org?.currency ?? "";
  const appUrl = data?.appUrl ?? "";
  // Every other currency the period has: said under the table, never added to the one shown.
  const others = (data?.byCurrency ?? []).filter((c) => c.currency !== cur && c.count > 0);

  const sums = useMemo<Sum[]>(() => {
    if (!data) return [];
    if (spec.groupBy === "day") return (data.days ?? []).map((d) => ({ key: d.day, label: dayText(d.day), count: d.count, amount: d.amountMinor }));
    const list: Sum[] = data.groups.map((g) => ({ key: g.key, label: g.name, count: g.count, amount: g.amountMinor }));
    if (overTime) {
      list.sort((a, b) => a.key.localeCompare(b.key));
      list.forEach((r, i) => { r.moved = i ? change(r.amount, list[i - 1].amount) : null; });
    }
    return list;
  }, [data, spec.groupBy, overTime]);
  // A category's subcategories sit under it wherever sorting puts it — only when there is more than the one line.
  const sorted = useMemo(() => {
    const subs = new Map((data?.groups ?? []).map((g) => [g.key, g.sub ?? []]));
    return sortSums(sums, t.sumSort, overTime).flatMap((r) => {
      const under = spec.groupBy === "category" ? (subs.get(r.key) ?? []) : [];
      return [r, ...(under.length > 1 ? under.map((x): Sum => ({ key: `${r.key}/${x.key}`, label: x.name, count: x.count, amount: x.amountMinor, sub: true })) : [])];
    });
  }, [sums, t.sumSort, overTime, data, spec.groupBy]);

  const sumCols = useMemo<GridColumn<Sum>[]>(() => {
    const all = data?.totals.amountMinor ?? 0;
    const cols: GridColumn<Sum>[] = [
      { key: "label", header: overTime ? (spec.groupBy === "day" ? "Day" : "Month") : "Name", fixed: true, sort: "label", cell: (r) => (r.sub ? <span className="pl-4 text-muted-foreground">{r.label}</span> : <span className="font-medium">{r.label}</span>), text: (r) => (r.sub ? `   ${r.label}` : r.label), total: "Total", totalText: "Total" },
      { key: "count", header: "Expenses", align: "right", sort: "count", cell: (r) => count(r.count), text: (r) => r.count, total: count(data?.totals.count ?? 0), totalText: data?.totals.count ?? 0 },
      { key: "amount", header: `Amount (${cur})`, align: "right", sort: "amount", cell: (r) => money(r.amount, cur), text: (r) => r.amount / 100, total: money(all, cur), totalText: all / 100 },
    ];
    if ((spec.columns ?? []).includes("change")) cols.push({ key: "change", header: EXTRA.change, align: "right", cell: (r) => (r.moved === null || r.moved === undefined ? DASH : percent(r.moved)), text: (r) => (r.moved === null || r.moved === undefined ? "" : percent(r.moved)) });
    if (!overTime) cols.push({ key: "share", header: "Share", align: "right", cell: (r) => pct(r.amount, all) || DASH, text: (r) => pct(r.amount, all) });
    return cols;
  }, [data, cur, overTime, spec.groupBy, spec.columns]);

  const recCols = useMemo<GridColumn<ReportRow>[]>(() => [
    { key: "date", header: "Date", fixed: true, sort: "date", cell: (r) => dayText(r.date), text: (r) => r.date, total: "Total", totalText: "Total" },
    { key: "number", header: "Number", sort: "number", cell: (r) => numberCell(appUrl, r), text: (r) => r.number },
    textCol("title", "Category", { cell: (r) => clip(r.title) }),
    { key: "detail", header: "Description", cell: (r) => clip(r.detail), text: (r) => r.detail },
    textCol("employee", "Employee"),
    textCol("department", "Department"),
    textCol("method", "Method"),
    textCol("bank", "Bank account", { hidden: true }),
    textCol("source", "Source", { hidden: true }),
    textCol("submittedBy", "Submitted by", { hidden: true }),
    textCol("status", "Status"),
    textCol("paid", "Paid"),
    { key: "amount", header: `Amount (${cur})`, align: "right", sort: "amount", cell: (r) => <span className="font-medium">{money(r.amountMinor, r.currency ?? cur)}</span>, text: (r) => r.amountMinor / 100, total: money(data?.totals.amountMinor ?? 0, cur), totalText: (data?.totals.amountMinor ?? 0) / 100 },
  ], [data, cur, appUrl]);

  const sumGrid = useGridColumns(`${report.id}:summary`, sumCols);
  const recGrid = useGridColumns(`${report.id}:records`, recCols);
  const error = orgs.error ?? query.error;
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!data || !org) return;
    const name = `${report.id}-${data.org.name}-${data.period.from}_${data.period.to}`.replace(/\s+/g, "-");
    const top = [[`${report.id} ${report.name}`], [data.org.name, periodText(data.period), BASIS[basis], pnl ? "Profit-and-loss expenses only" : "All expenses"], ...(t.q ? [[`Filtered by "${t.q}"`]] : []), []];
    if (t.mode === "summary") return saveCsv(`${name}.csv`, [...top, ...gridCsv(sumGrid.visible, sorted)]);
    setSaving(true);
    try {
      const all = await fetchExpenses(org.id, f.range, ask, { ...t.ask, limit: 5000, offset: 0 });
      saveCsv(`${name}-records.csv`, [...top, ...gridCsv(recGrid.visible, all.rows)]);
    } catch (e) {
      toast.error(apiErrorMessage(e, "The export could not be read from finance"));
    } finally {
      setSaving(false);
    }
  };

  const shownSums = sorted.slice(t.page * t.pageSize, (t.page + 1) * t.pageSize);
  const nothing = `No ${spec.only ? "such " : ""}expense ${basis === "paid" ? "was paid" : "is dated"} in ${data ? periodText(data.period) : "this period"} for ${data?.org.name ?? "this organization"}${pnl ? " among profit-and-loss expenses" : ""}${t.q ? ` matching “${t.q}”` : ""}.`;

  return (
    <div className="space-y-3">
      <Head report={report} basis={BASIS[basis]} source="finance's Expense report" at={data?.generatedAt} />
      {/* Expenses belong to no CRM, so there is no CRM to pick. */}
      <FinanceFilters orgs={orgs.data} org={org} space="expenses" options={data?.options} filters={EXPENSE_FILTERS.filter((d) => !spec.only?.[d.key])} />
      <Tools
        text={t.text} onText={t.setText} mode={t.mode} onMode={t.setMode}
        actions={
          <>
            {t.mode === "summary" ? <ColumnsMenu grid={sumGrid} /> : <ColumnsMenu grid={recGrid} />}
            <Button variant="outline" size="sm" className="h-8" onClick={() => void save()} disabled={!data || saving}>
              <Download />
              {saving ? "Exporting…" : "Export"}
            </Button>
          </>
        }
      >
        <Select label="Which expenses" value={pnl ? "pnl" : "all"} onChange={(v) => setPnl(v === "pnl")} options={[{ key: "pnl", name: "Profit and loss only" }, { key: "all", name: "All expenses" }]} />
        <Select label="Dated by" value={basis} onChange={(v) => setBasis(v as "expense" | "paid")} options={[{ key: "expense", name: "By expense date" }, { key: "paid", name: "By paid date" }]} />
        {data && data.currencies.length > 1 && (
          <Select label="Currency" value={cur} onChange={setCurrency} options={data.currencies.map((c) => ({ key: c, name: c }))} />
        )}
      </Tools>

      {error ? (
        <ErrorCard error={error} onRetry={() => { void orgs.refetch(); void query.refetch(); }} />
      ) : t.mode === "summary" ? (
        <>
          <DataGrid
            grid={sumGrid} rows={shownSums} rowKey={(r) => r.key} loading={query.isFetching}
            sort={t.sumSort} onSort={(k) => t.setSumSort(nextSort(t.sumSort, k, ["label"]))}
            empty={spec.groupBy === "day" && data?.days === null ? "This period has more expenses than can be read day by day. Pick a shorter one, or open Records." : nothing}
          />
          <Pager page={t.page} pageSize={t.pageSize} total={sorted.length} onPage={t.setPage} onPageSize={t.setPageSize} />
        </>
      ) : (
        <>
          <DataGrid
            grid={recGrid} rows={data?.rows ?? []} rowKey={(r) => r.id} loading={query.isFetching}
            sort={t.sort} onSort={(k) => t.setSort(nextSort(t.sort, k, ["title", "number", "employee", "department", "method", "bank", "source", "submittedBy", "status", "paid"]))}
            empty={nothing}
          />
          <Pager page={t.page} pageSize={t.pageSize} total={data?.rowCount ?? 0} onPage={t.setPage} onPageSize={t.setPageSize} noun="Expenses" />
          {data && data.rowCount < data.recordCount && (
            <p className="text-xs text-muted-foreground">
              The newest {count(data.rowCount)} of {count(data.recordCount)} are listed. The totals count all of them. Pick a shorter period to page through the rest.
            </p>
          )}
        </>
      )}

      {others.map((c) => (
        <p key={c.currency} className="text-xs text-muted-foreground">
          Also {amber(money(c.amountMinor, c.currency))} over {count(c.count)} {c.count === 1 ? "expense" : "expenses"} in {c.currency}. Not in the {cur} total.{" "}
          <button type="button" onClick={() => setCurrency(c.currency)} className="font-medium text-primary underline-offset-4 hover:underline">Show these</button>
        </p>
      ))}
    </div>
  );
}

/*
 * What is still owed (2026-11-27): finance's aged lists of open invoices and open bills, as a table.
 *
 * Balances as they stand today — finance keeps none as of a past date — so there is no period to pick, and the page
 * says the day they are as of. The summary is by how late (the five bands) or by student or vendor; the records are
 * every open invoice or bill. What is owed in another currency is said under the table, never added in.
 */
export function AgingTable({ report, spec }: { report: Titled; spec: AgingSpec }) {
  const f = useReportOrgFilters();
  const orgs = useFinanceOrgs();
  const org = pickOrg(orgs.data, f.entity);
  const receivable = spec.side === "receivables";
  const byParty = spec.groupBy === "party";
  // What is past due opens most late first; everything else soonest due first.
  const picks = usePicks(spec.side);
  const t = useTable(spec.view, false, [org?.id, JSON.stringify(picks)], spec.due === "overdue" ? { key: "daysOverdue", dir: "desc" } : { key: "dueDate", dir: "asc" });
  const ask = { kind: spec.side, groupBy: spec.groupBy, due: spec.due, picks };
  const query = useFinanceAging(org?.id, ask, t.ask);
  const data = query.data;
  const cur = data?.currency ?? org?.currency ?? "";
  const appUrl = data?.appUrl ?? "";
  const thing = receivable ? "Invoices" : "Bills";
  const party = receivable ? "Student" : "Vendor";

  const sorted = useMemo(() => {
    const groups = data?.groups ?? [];
    // The bands keep their own order — soonest to latest — unless a heading is clicked.
    if (!byParty && t.sumSort.key === "amount" && t.sumSort.dir === "desc") return groups;
    const dir = t.sumSort.dir === "asc" ? 1 : -1;
    return [...groups].sort((a, b) => (t.sumSort.key === "label" ? a.name.localeCompare(b.name) : t.sumSort.key === "count" ? a.count - b.count : a.amountMinor - b.amountMinor) * dir);
  }, [data, byParty, t.sumSort]);

  const sumCols = useMemo<GridColumn<AgingGroup>[]>(() => {
    const totals = data?.totals;
    const all = totals?.amountMinor ?? 0;
    return [
      { key: "label", header: byParty ? party : "How late", fixed: true, sort: "label", cell: (r) => <span className="font-medium">{r.name}</span>, text: (r) => r.name, total: "Total", totalText: "Total" },
      { key: "count", header: thing, align: "right", sort: "count", cell: (r) => count(r.count), text: (r) => r.count, total: count(totals?.count ?? 0), totalText: totals?.count ?? 0 },
      { key: "amount", header: `Still owed (${cur})`, align: "right", sort: "amount", cell: (r) => money(r.amountMinor, cur), text: (r) => r.amountMinor / 100, total: money(all, cur), totalText: all / 100 },
      ...(byParty ? [{ key: "overdue", header: "Of which past due", align: "right", cell: (r) => (r.overdueMinor ? <span className="text-rose-600 dark:text-rose-400">{money(r.overdueMinor, cur)}</span> : DASH), text: (r) => (r.overdueMinor ?? 0) / 100, total: money(totals?.overdueMinor ?? 0, cur), totalText: (totals?.overdueMinor ?? 0) / 100 } as GridColumn<AgingGroup>] : []),
      { key: "total", header: `${receivable ? "Invoice" : "Bill"} total`, align: "right", cell: (r) => money(r.totalMinor, cur), text: (r) => r.totalMinor / 100, total: money(totals?.totalMinor ?? 0, cur), totalText: (totals?.totalMinor ?? 0) / 100 },
      { key: "share", header: "Share", align: "right", cell: (r) => pct(r.amountMinor, all) || DASH, text: (r) => pct(r.amountMinor, all) },
    ];
  }, [data, cur, byParty, party, thing, receivable]);

  const recCols = useMemo<GridColumn<AgingRow>[]>(() => {
    const totals = data?.totals;
    return [
      { key: "dueDate", header: "Due", fixed: true, sort: "dueDate", cell: (r) => dayText(r.dueDate), text: (r) => r.dueDate, total: "Total", totalText: "Total" },
      { key: "number", header: "Number", sort: "number", cell: (r) => numberCell(appUrl, r), text: (r) => r.number },
      { key: "title", header: party, sort: "title", cell: (r) => clip(r.title), text: (r) => r.title },
      { key: "date", header: "Issued", sort: "date", cell: (r) => dayText(r.date), text: (r) => r.date },
      ...(receivable ? [textCol("crm", "CRM") as unknown as GridColumn<AgingRow>, textCol("salesperson", "Salesperson") as unknown as GridColumn<AgingRow>, textCol("department", "Department", { hidden: true }) as unknown as GridColumn<AgingRow>] : []),
      { key: "daysOverdue", header: "Days late", align: "right", sort: "daysOverdue", cell: (r) => (r.daysOverdue > 0 ? <span className="text-rose-600 dark:text-rose-400">{count(r.daysOverdue)}</span> : DASH), text: (r) => r.daysOverdue },
      { key: "band", header: "How late", cell: (r) => r.band, text: (r) => r.band },
      { key: "totalMinor", header: `${receivable ? "Invoice" : "Bill"} total`, align: "right", sort: "totalMinor", cell: (r) => money(r.totalMinor, cur), text: (r) => r.totalMinor / 100, total: money(totals?.totalMinor ?? 0, cur), totalText: (totals?.totalMinor ?? 0) / 100 },
      { key: "amount", header: `Still owed (${cur})`, align: "right", sort: "amount", cell: (r) => <span className="font-medium">{money(r.amountMinor, cur)}</span>, text: (r) => r.amountMinor / 100, total: money(totals?.amountMinor ?? 0, cur), totalText: (totals?.amountMinor ?? 0) / 100 },
    ];
  }, [data, cur, appUrl, party, receivable]);

  const sumGrid = useGridColumns(`${report.id}:summary`, sumCols);
  const recGrid = useGridColumns(`${report.id}:records`, recCols);
  const error = orgs.error ?? query.error;
  const [saving, setSaving] = useState(false);
  const asOf = data ? `As of ${dayText(data.asOf)}. Finance keeps balances as they stand today, not as of a past date.` : undefined;

  const save = async () => {
    if (!data || !org) return;
    const name = `${report.id}-${data.org.name}-${data.asOf}`.replace(/\s+/g, "-");
    const top = [[`${report.id} ${report.name}`], [data.org.name, `As of ${dayText(data.asOf)}`], ...(t.q ? [[`Filtered by "${t.q}"`]] : []), []];
    if (t.mode === "summary") return saveCsv(`${name}.csv`, [...top, ...gridCsv(sumGrid.visible, sorted)]);
    setSaving(true);
    try {
      const all = await fetchAging(org.id, ask, { ...t.ask, limit: 5000, offset: 0 });
      saveCsv(`${name}-records.csv`, [...top, ...gridCsv(recGrid.visible, all.rows)]);
    } catch (e) {
      toast.error(apiErrorMessage(e, "The export could not be read from finance"));
    } finally {
      setSaving(false);
    }
  };

  const shown = sorted.slice(t.page * t.pageSize, (t.page + 1) * t.pageSize);
  const nothing = `Nothing is ${spec.due === "overdue" ? "past due" : spec.due === "upcoming" ? "waiting to fall due" : "still owed"} ${receivable ? "to" : "by"} ${data?.org.name ?? "this organization"}${t.q ? ` matching “${t.q}”` : ""}.`;

  return (
    <div className="space-y-3">
      <Head report={report} basis={asOf} source={`finance's aged ${receivable ? "receivables" : "payables"}`} at={data?.generatedAt} />
      {/* Balances as they stand: no CRM and no period to pick. */}
      <FinanceFilters orgs={orgs.data} org={org} period={false} space={spec.side} options={data?.options} filters={receivable ? RECEIVABLE_FILTERS : PAYABLE_FILTERS} />
      <Tools
        text={t.text} onText={t.setText} mode={t.mode} onMode={t.setMode}
        actions={
          <>
            {t.mode === "summary" ? <ColumnsMenu grid={sumGrid} /> : <ColumnsMenu grid={recGrid} />}
            <Button variant="outline" size="sm" className="h-8" onClick={() => void save()} disabled={!data || saving}>
              <Download />
              {saving ? "Exporting…" : "Export"}
            </Button>
          </>
        }
      />

      {error ? (
        <ErrorCard error={error} onRetry={() => { void orgs.refetch(); void query.refetch(); }} />
      ) : t.mode === "summary" ? (
        <>
          <DataGrid grid={sumGrid} rows={shown} rowKey={(r) => r.key} loading={query.isFetching} sort={t.sumSort} onSort={(k) => t.setSumSort(nextSort(t.sumSort, k, ["label"]))} empty={nothing} />
          <Pager page={t.page} pageSize={t.pageSize} total={sorted.length} onPage={t.setPage} onPageSize={t.setPageSize} />
        </>
      ) : (
        <>
          <DataGrid
            grid={recGrid} rows={data?.rows ?? []} rowKey={(r) => r.id} loading={query.isFetching}
            sort={t.sort} onSort={(k) => t.setSort(nextSort(t.sort, k, ["title", "number", "dueDate", "date", "crm", "salesperson", "department"]))}
            empty={nothing}
          />
          <Pager page={t.page} pageSize={t.pageSize} total={data?.rowCount ?? 0} onPage={t.setPage} onPageSize={t.setPageSize} noun={thing} />
        </>
      )}

      {(data?.otherCurrencies ?? []).map((c) => (
        <p key={`${c.currency}:${c.what}`} className="text-xs text-muted-foreground">
          Also {amber(money(c.amountMinor, c.currency))} still owed over {count(c.count)} {c.count === 1 ? (receivable ? "invoice" : "bill") : thing.toLowerCase()} in {c.currency}. Not in the {cur} total.
        </p>
      ))}
    </div>
  );
}

/*
 * Commission and payroll (2026-11-27): a list finance keeps, as a table — the commission payouts it approved and
 * paid, the people on its payroll runs, or the payroll payments it made.
 *
 * One view for all three, told apart by what follows: which filters the bar offers, which amounts the summary adds
 * up, and which columns a row has. Amounts in another currency are said under the table, never added in. Nobody's
 * bank details are here: finance does not send them.
 */
interface LedgerShape {
  /** Which picks these tables share. */
  space: string;
  filters: FilterDef[];
  /** The amount columns: the row's field, and its heading. The first is the one shares are of. */
  sums: [string, string][];
  /** What one row is called, for the count column and the pager. */
  noun: string;
  /** The records' own columns, before the amounts: the row's field, its heading, and whether it starts hidden. */
  fields: [string, string, boolean?][];
  /** The first column of the records: its field and heading. */
  first: [string, string];
  basis: string;
  source: string;
}

const GROUP_LABEL: Record<string, string> = { person: "Person", source: "CRM or CS", month: "Month", state: "State", kind: "Type", department: "Department", status: "Status", runState: "Payroll run", method: "Payment method", bank: "Bank account", vendor: "Vendor", crm: "CRM", salesperson: "Salesperson" };

function ledgerShape(spec: LedgerSpec): LedgerShape {
  if (spec.source === "reconciliation-lines") {
    const report = spec.params?.report ?? "exceptions";
    return {
      space: `rc-${report}`, noun: report === "exceptions" ? "Exceptions" : "Records",
      filters: [{ key: "category", label: report === "exceptions" ? "Exception" : "Kind" }, { key: "severityName", label: "Severity" }, { key: "status", label: "Status" }, { key: "module", label: "Module" }, { key: "account", label: "Account" }, { key: "month", label: "Month" }],
      sums: [["amountMinor", report === "exceptions" ? "Amount or difference" : "Amount"]],
      first: ["date", "Date"],
      fields: [["title", "Record"], ["category", report === "exceptions" ? "Exception" : "Kind"], ["severityName", "Severity"], ["status", "Status"], ["module", "Module"], ["ageDays", "Age (days)"], ["action", "Recommended action"], ["detail", "Detail"], ["month", "Month", true]],
      basis: "From finance's reconciliation reports. Nothing here changes a record, a balance or a reconciliation.",
      source: "finance's reconciliation",
    };
  }
  if (spec.source === "financial-lines") {
    const report = spec.params?.report ?? "cashflow";
    if (report === "receivables") {
      return {
        space: "fp-receivables", noun: "Invoices",
        filters: [{ key: "kind", label: "Kind" }, { key: "band", label: "Age" }, { key: "crm", label: "CRM" }, { key: "month", label: "Issued in" }],
        sums: [["amountMinor", "Outstanding"], ["originalMinor", "Invoice total"], ["settledMinor", "Paid"], ["creditMinor", "Credit applied"]],
        first: ["date", "Issued"],
        fields: [["title", "Customer"], ["category", "Kind"], ["crm", "CRM"], ["due", "Due"], ["status", "Age"], ["detail", "Salesperson"], ["month", "Month", true]],
        basis: "Outstanding as of the date: payments and credit applied after it are not taken off.",
        source: "finance's receivables",
      };
    }
    if (report === "obligations") {
      return {
        space: "fp-obligations", noun: "Obligations",
        filters: [{ key: "category", label: "Category" }, { key: "band", label: "Age" }, { key: "status", label: "Status" }, { key: "month", label: "Month" }],
        sums: [["amountMinor", "Outstanding"], ["originalMinor", "Original"], ["settledMinor", "Settled"], ["creditMinor", "Credits"]],
        first: ["date", "Date"],
        fields: [["title", "Owed to"], ["category", "Category"], ["due", "Due"], ["status", "Status"], ["detail", "Detail"], ["month", "Month", true]],
        basis: "Recorded obligations as of the date — not a complete statutory liability balance.",
        source: "finance's obligations",
      };
    }
    return {
      space: `fp-${report}`, noun: report === "cash" ? "Accounts" : report === "advances" ? "Records" : "Bank lines",
      filters: [{ key: "category", label: "Kind" }, { key: "account", label: "Account" }, { key: "status", label: "Status" }, { key: "month", label: "Month" }],
      sums: [["amountMinor", report === "cash" ? "Balance" : "Amount"]],
      first: ["date", report === "cash" ? "Last transaction" : "Date"],
      fields: [["title", report === "cash" ? "Account" : "Description"], ["account", "Account", report === "cash"], ["category", "Kind"], ["status", "Status"], ["detail", "Detail"], ["month", "Month", true]],
      basis: report === "cash" ? "Balances as of the date: opening balance plus every bank line up to it." : report === "advances" ? "Advances issued and recovered from pay." : "Bank lines of the period, by activity; transfers between own accounts are their own kind.",
      source: "finance's banking",
    };
  }
  if (spec.source === "management-profit-lines") {
    const view = spec.params?.view ?? "invoice";
    const line = spec.params?.line ?? "income";
    if (line === "income") {
      return {
        space: `mp-income-${view}`, noun: view === "invoice" ? "Invoices and credit notes" : view === "collection" ? "Payments" : "Bank lines",
        filters: [{ key: "category", label: "Kind" }, { key: "crm", label: "CRM" }, { key: "method", label: "Payment method" }, { key: "month", label: "Month" }],
        sums: view === "cash" ? [["amountMinor", "Money in"]] : [["amountMinor", "Counted (no VAT)"], ["vatMinor", "VAT"], ["grossMinor", "With VAT"]],
        first: ["date", view === "invoice" ? "Issued" : view === "collection" ? "Paid on" : "Date"],
        fields: [["title", view === "cash" ? "Description" : "Client"], ["category", "Kind"], ["crm", "CRM", view === "cash"], ["method", "Payment method", view !== "collection"], ["detail", "Detail"], ["month", "Month", true]],
        basis: view === "invoice" ? "Invoices issued in the period before VAT, less credit notes; a part paid in another currency is apart." : view === "collection" ? "Payments received in the period, without their VAT. A payment in another currency carries none and is apart." : "Money in on the bank lines of the period; transfers between own accounts left out.",
        source: "finance's management profitability",
      };
    }
    return {
      space: `mp-costs-${view}`, noun: view === "cash" ? "Bank lines" : "Records",
      filters: [{ key: "category", label: view === "cash" ? "Kind" : "Category" }, { key: "status", label: "Status" }, { key: "month", label: "Month" }],
      sums: view === "cash" ? [["amountMinor", "Money out"]] : [["amountMinor", "Cost"], ["paidMinor", "Paid"], ["unpaidMinor", "Unpaid"]],
      first: ["date", view === "cash" ? "Date" : "Incurred"],
      fields: [["title", "Name"], ["category", view === "cash" ? "Kind" : "Category"], ["status", "Status"], ["detail", "Detail"], ["month", "Month", true]],
      basis: view === "cash" ? "Money out on the bank lines of the period; transfers between own accounts left out." : "Costs incurred in the period: payroll in its payroll month whether paid or not, commission outside payroll, supplier bills before VAT less vendor credits, and other expenses.",
      source: "finance's management profitability",
    };
  }
  if (spec.source === "pl-lines") {
    const collected = spec.params?.basis === "collected";
    if (spec.params?.line === "income") {
      return {
        space: "pl-income", noun: collected ? "Payments" : "Invoices",
        filters: [{ key: "crm", label: "CRM" }, { key: "salesperson", label: "Salesperson" }, { key: "method", label: "Payment method" }, { key: "month", label: "Month" }],
        sums: collected ? [["amountMinor", "Received"]] : [["amountMinor", "Counted"], ["vatMinor", "VAT"], ["grossMinor", "With VAT"]],
        first: ["date", collected ? "Paid on" : "Issued"],
        fields: [["title", "Client"], ["crm", "CRM"], ["salesperson", "Salesperson"], ["method", "Payment method", !collected], ["detail", "Detail"], ["month", "Month", true]],
        basis: collected ? "Each payment received in the period, as received. Payments in another currency are apart on the profit and loss." : "Each invoice issued in the period, before VAT; any part paid in another currency is taken out and shown apart on the profit and loss.",
        source: "finance's Profit & Loss",
      };
    }
    return {
      space: "pl-expenses", noun: "Records",
      filters: [{ key: "category", label: "Category" }, { key: "subcategory", label: "Subcategory" }, { key: "department", label: "Department" }, { key: "method", label: "Payment method" }, { key: "month", label: "Month" }],
      sums: [["amountMinor", "Counted"]],
      first: ["date", collected ? "Paid on" : "Date"],
      fields: [["title", "Description"], ["category", "Category"], ["subcategory", "Subcategory"], ["department", "Department"], ["method", "Payment method"], ["employee", "Submitted by", true], ["detail", "Detail"], ["month", "Month", true]],
      basis: collected ? "Bills and expenses paid in the period; payroll in the month the pay is for." : "Bills and expenses dated in the period; payroll in the month the pay is for.",
      source: "finance's Profit & Loss",
    };
  }
  if (spec.source === "vat") {
    const kind = spec.params?.kind ?? "output";
    if (kind === "input") {
      return {
        space: "vat-input", noun: "Bills",
        filters: [{ key: "vendor", label: "Vendor" }, { key: "month", label: "Month" }, { key: "status", label: "Bill status" }],
        sums: [["amountMinor", "Input VAT"], ["netMinor", "Before VAT"], ["totalMinor", "Bill total"]],
        first: ["date", "Bill date"],
        fields: [["title", "Vendor"], ["month", "Month", true], ["status", "Status"]],
        basis: "VAT on supplier bills dated in the period. Drafts and void bills are left out.",
        source: "finance's supplier bills",
      };
    }
    const income = kind === "income";
    return {
      space: income ? "vat-income" : "vat-output", noun: income ? "Invoices" : "Invoices and tax invoices",
      filters: [{ key: "crm", label: "CRM" }, { key: "salesperson", label: "Salesperson" }, { key: "month", label: "Month" }, { key: "status", label: "Invoice status" }],
      sums: income
        ? [["amountMinor", "Before VAT"], ["vatMinor", "VAT"], ["totalMinor", "Invoice total"]]
        : [["amountMinor", "Output VAT"], ["netMinor", "Before VAT"], ["totalMinor", "With VAT"]],
      first: ["date", income ? "Issued" : "Date"],
      fields: [["title", "Client"], ["crmName", "CRM"], ["salesperson", "Salesperson"], ["detail", "Detail", true], ["month", "Month", true], ["status", "Status"]],
      basis: income
        ? "Invoices issued in the period, before VAT, as the profit and loss counts them. Drafts and void invoices are left out."
        : "VAT on invoices issued in the period; on a pro-forma, each payment's tax invoice by the day it was paid. Drafts and void invoices are left out.",
      source: income ? "finance's invoices" : "finance's invoices and tax invoices",
    };
  }
  if (spec.source === "commission") {
    return {
      space: "commission", noun: "Payouts",
      filters: [{ key: "source", label: "CRM or CS" }, { key: "person", label: "Person" }, { key: "state", label: "State" }, { key: "kind", label: "Type" }, { key: "method", label: "Payment method" }, { key: "month", label: "Month" }],
      sums: [["amountMinor", "Commission"], ["paidMinor", "Paid"], ["unpaidMinor", "Not paid yet"]],
      first: ["date", spec.params?.when === "paid" ? "Paid on" : "Date"],
      fields: [["title", "Person"], ["source", "CRM or CS"], ["kind", "Type"], ["month", "Month"], ["state", "State"], ["approvedBy", "Approved by"], ["approvedOn", "Approved on", true], ["paidOn", "Paid on", true], ["method", "Payment method"], ["reference", "Reference"], ["payrollRun", "Payroll run", true], ["detail", "Roles and level", true]],
      basis: spec.params?.when === "paid" ? "Commission paid, by the day it was paid." : "Commission finance approved, by the month it is for.",
      source: "finance's CRM and CS commission payouts",
    };
  }
  if (spec.params?.kind === "payments") {
    return {
      space: "payroll-payments", noun: "Payments",
      filters: [{ key: "month", label: "Payroll month" }, { key: "method", label: "Payment method" }, { key: "bank", label: "Bank account" }],
      sums: [["amountMinor", "Paid"]],
      first: ["date", "Paid on"],
      fields: [["month", "Payroll month"], ["method", "Payment method"], ["bank", "Bank account"], ["reference", "Reference"], ["paidBy", "Recorded by"]],
      basis: "Payroll payments by the month of the run they pay. Reversed payments are left out.",
      source: "finance's payroll runs",
    };
  }
  return {
    space: "payroll", noun: "People",
    filters: [{ key: "month", label: "Month" }, { key: "department", label: "Department" }, { key: "person", label: "Person" }, { key: "status", label: "Status" }, { key: "runState", label: "Payroll run" }],
    sums: [["amountMinor", "Payable"], ["grossMinor", "Gross"], ["deductionsMinor", "Deductions"], ["netMinor", "Net from HRMS"], ["adjustmentsMinor", "Additions and deductions"], ["paidMinor", "Paid"], ["balanceMinor", "Still to pay"]],
    first: ["month", "Month"],
    fields: [["title", "Person"], ["detail", "Designation"], ["department", "Department"], ["status", "Status"], ["runState", "Payroll run"]],
    basis: "Payroll runs of the period's months, approved or not yet. Voided and returned runs are left out. No bank details are shown.",
    source: "finance's payroll runs",
  };
}

export function LedgerTable({ report, spec }: { report: Titled; spec: LedgerSpec }) {
  const f = useReportOrgFilters();
  const orgs = useFinanceOrgs();
  const org = pickOrg(orgs.data, f.entity);
  const shape = useMemo(() => ledgerShape(spec), [spec]);
  useYearFor(spec.period, report.id);
  const byMonth = spec.groupBy === "month";
  const picked = usePicks(shape.space);
  // What makes this report this one is asked for as well, and cannot be unpicked.
  const picks = useMemo(() => ({ ...picked, ...Object.fromEntries(Object.entries(spec.only ?? {}).map(([k, v]) => [k, [v]])) }), [picked, spec.only]);
  const t = useTable(spec.view, byMonth, [org?.id, f.range.from, f.range.to, JSON.stringify(picks)], { key: shape.first[0] === "month" ? "person" : "date", dir: shape.first[0] === "month" ? "asc" : "desc" });
  const ask = { source: spec.source, groupBy: spec.groupBy, params: spec.params, picks };
  const query = useFinanceLedger(org?.id, f.range, ask, t.ask);
  const data = query.data;
  const cur = data?.currency ?? org?.currency ?? "";
  const appUrl = data?.appUrl ?? "";
  const [amount] = shape.sums[0];

  const sorted = useMemo(() => {
    const groups = data?.groups ?? [];
    const dir = t.sumSort.dir === "asc" ? 1 : -1;
    return [...groups].sort((a, b) => (t.sumSort.key === "label" ? String(a.key).localeCompare(String(b.key)) : t.sumSort.key === "count" ? a.count - b.count : Number(a[amount]) - Number(b[amount])) * dir);
  }, [data, t.sumSort, amount]);

  const sumCols = useMemo<GridColumn<LedgerGroup>[]>(() => {
    const totals = data?.totals;
    const all = Number(totals?.[amount] ?? 0);
    return [
      { key: "label", header: GROUP_LABEL[spec.groupBy] ?? "Name", fixed: true, sort: "label", cell: (r) => <span className="font-medium">{r.name}</span>, text: (r) => r.name, total: "Total", totalText: "Total" },
      { key: "count", header: shape.noun, align: "right", sort: "count", cell: (r) => count(r.count), text: (r) => r.count, total: count(totals?.count ?? 0), totalText: totals?.count ?? 0 },
      ...shape.sums.map(([key, header], i): GridColumn<LedgerGroup> => ({
        key, header: `${header} (${cur})`, align: "right", ...(i === 0 ? { sort: "amount" } : {}),
        cell: (r) => money(Number(r[key]) || 0, cur), text: (r) => (Number(r[key]) || 0) / 100,
        total: money(Number(totals?.[key] ?? 0), cur), totalText: Number(totals?.[key] ?? 0) / 100,
      })),
      { key: "share", header: "Share", align: "right", cell: (r) => pct(Number(r[amount]) || 0, all) || DASH, text: (r) => pct(Number(r[amount]) || 0, all) },
    ];
  }, [data, cur, shape, spec.groupBy, amount]);

  const recCols = useMemo<GridColumn<LedgerRow>[]>(() => {
    const totals = data?.totals;
    const [firstKey, firstHead] = shape.first;
    return [
      { key: firstKey, header: firstHead, fixed: true, sort: firstKey, cell: (r) => (firstKey === "date" ? dayText(r.date) : String(r[firstKey] ?? "")), text: (r) => String(r[firstKey] ?? ""), total: "Total", totalText: "Total" },
      { key: "number", header: spec.source === "commission" ? "Expense" : spec.source === "vat" || spec.source === "pl-lines" ? "Number" : "Run", cell: (r) => (r.number ? (r.href ? numberCell(appUrl, r) : <span className="font-medium">{r.number}</span>) : DASH), text: (r) => r.number },
      ...shape.fields.map(([key, header, hidden]): GridColumn<LedgerRow> => ({
        key, header, hidden: !!hidden, sort: key === "title" ? "title" : key === "detail" ? undefined : key,
        cell: (r) => (r[key] ? clip(String(r[key])) : DASH), text: (r) => String(r[key] ?? ""),
      })),
      { key: "currency", header: "Currency", hidden: true, cell: (r) => r.currency ?? cur, text: (r) => r.currency ?? cur },
      ...shape.sums.map(([key, header], i): GridColumn<LedgerRow> => ({
        key: i === 0 ? "amount" : key, header, align: "right", sort: i === 0 ? "amount" : key,
        // A row in another currency shows its own; the total under the column is the organization's currency only.
        cell: (r) => { const own = (r.currency ?? cur) === cur; const text = money(Number(r[key]) || 0, r.currency ?? cur); return own ? <span className={i === 0 ? "font-medium" : undefined}>{text}</span> : amber(text); },
        text: (r) => (Number(r[key]) || 0) / 100,
        total: money(Number(totals?.[key] ?? 0), cur), totalText: Number(totals?.[key] ?? 0) / 100,
      })),
    ];
  }, [data, cur, appUrl, shape, spec.source]);

  const sumGrid = useGridColumns(`${report.id}:summary`, sumCols);
  const recGrid = useGridColumns(`${report.id}:records`, recCols);
  const error = orgs.error ?? query.error;
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!data || !org) return;
    const name = `${report.id}-${data.org.name}-${data.period.from}_${data.period.to}`.replace(/\s+/g, "-");
    const top = [[`${report.id} ${report.name}`], [data.org.name, periodText(data.period), shape.basis], ...(t.q ? [[`Filtered by "${t.q}"`]] : []), []];
    if (t.mode === "summary") return saveCsv(`${name}.csv`, [...top, ...gridCsv(sumGrid.visible, sorted)]);
    setSaving(true);
    try {
      const all = await fetchLedger(org.id, f.range, ask, { ...t.ask, limit: 5000, offset: 0 });
      saveCsv(`${name}-records.csv`, [...top, ...gridCsv(recGrid.visible, all.rows)]);
    } catch (e) {
      toast.error(apiErrorMessage(e, "The export could not be read from finance"));
    } finally {
      setSaving(false);
    }
  };

  const shown = sorted.slice(t.page * t.pageSize, (t.page + 1) * t.pageSize);
  const nothing = `Finance has nothing here for ${data?.org.name ?? "this organization"} in ${data ? periodText(data.period) : "this period"}${t.q ? ` matching “${t.q}”` : ""}.`;

  return (
    <div className="space-y-3">
      <Head report={report} basis={shape.basis} source={shape.source} at={data?.generatedAt} />
      <FinanceFilters orgs={orgs.data} org={org} space={shape.space} options={data?.options} filters={shape.filters.filter((d) => !spec.only?.[d.key])} />
      <Tools
        text={t.text} onText={t.setText} mode={t.mode} onMode={t.setMode}
        actions={
          <>
            {t.mode === "summary" ? <ColumnsMenu grid={sumGrid} /> : <ColumnsMenu grid={recGrid} />}
            <Button variant="outline" size="sm" className="h-8" onClick={() => void save()} disabled={!data || saving}>
              <Download />
              {saving ? "Exporting…" : "Export"}
            </Button>
          </>
        }
      />

      {error ? (
        <ErrorCard error={error} onRetry={() => { void orgs.refetch(); void query.refetch(); }} />
      ) : t.mode === "summary" ? (
        <>
          <DataGrid grid={sumGrid} rows={shown} rowKey={(r) => r.key} loading={query.isFetching} sort={t.sumSort} onSort={(k) => t.setSumSort(nextSort(t.sumSort, k, ["label"]))} empty={nothing} />
          <Pager page={t.page} pageSize={t.pageSize} total={sorted.length} onPage={t.setPage} onPageSize={t.setPageSize} />
        </>
      ) : (
        <>
          <DataGrid
            grid={recGrid} rows={data?.rows ?? []} rowKey={(r) => r.id} loading={query.isFetching}
            sort={t.sort} onSort={(k) => t.setSort(nextSort(t.sort, k, ["title", "person", "source", "month", "state", "kind", "method", "bank", "department", "status", "runState", "run", "reference", "approvedBy", "vendor", "crm", "salesperson"]))}
            empty={nothing}
          />
          <Pager page={t.page} pageSize={t.pageSize} total={data?.rowCount ?? 0} onPage={t.setPage} onPageSize={t.setPageSize} noun={shape.noun} />
        </>
      )}

      {(data?.otherCurrencies ?? []).map((c) => (
        <p key={c.currency} className="text-xs text-muted-foreground">
          Also in {c.currency}, over {count(c.count)} {c.count === 1 ? "row" : "rows"}:{" "}
          {shape.sums.map(([key, header], i) => <span key={key}>{i > 0 && " · "}{header} {amber(money(Number(c[key]) || 0, c.currency))}</span>)}. Not in the {cur} totals.
        </p>
      ))}
    </div>
  );
}

/*
 * Profit & Loss (2026-11-27): finance's own calculation, as a table. The statement is its lines — income, each kind of
 * expense, net profit — optionally beside the period before; the months view is a row per month with net margin or the
 * change on the month before. Invoiced or collected, as on finance's page. Other currencies are said under the table.
 */
const PL_BASIS: Record<PlBasis, string> = {
  invoiced: "Income is invoices issued in the period, before VAT; expenses are those dated in it.",
  collected: "Income is payments received in the period, as received; expenses are those paid in it.",
};

interface PlRow { key: string; label: string; kind: "line" | "total" | "net"; amount: number; prior?: number | null; /** The records behind it (2026-11-27). */ line?: string }

export function PLTable({ report, spec }: { report: Titled; spec: PlSpec }) {
  const f = useReportOrgFilters();
  const orgs = useFinanceOrgs();
  const org = pickOrg(orgs.data, f.entity);
  useYearFor(spec.period, report.id);
  const [basis, setBasis] = useState<PlBasis>("invoiced");
  const [linePick, setLinePick] = useState<PlRow | null>(null);
  const months = spec.view === "months";
  const statement = useFinancePl<PlStatement>(months ? undefined : org?.id, f.range, basis, "statement");
  const series = useFinancePl<PlMonths>(months ? org?.id : undefined, f.range, basis, "months");
  const query = months ? series : statement;
  const cur = (months ? series.data?.currency : statement.data?.currency) ?? org?.currency ?? "";
  const compare = spec.view === "compare";

  const lines = useMemo<PlRow[]>(() => {
    const d = statement.data;
    if (!d) return [];
    const prior = (side: "income" | "expenses", label: string) => (d.prior ? d.prior[side].breakdown.find((x) => x.label === label)?.amountMinor ?? 0 : null);
    // Lines only in the period before still show, at nothing now — so a cost that stopped is not hidden.
    const labels = (side: "income" | "expenses") => Array.from(new Set([...d[side].breakdown.map((x) => x.label), ...(compare && d.prior ? d.prior[side].breakdown.map((x) => x.label) : [])]));
    const now = (side: "income" | "expenses", label: string) => d[side].breakdown.find((x) => x.label === label)?.amountMinor ?? 0;
    const keyOf = (side: "income" | "expenses", label: string) => (d[side].breakdown.find((x) => x.label === label) ?? d.prior?.[side].breakdown.find((x) => x.label === label))?.key;
    return [
      ...labels("income").map((label): PlRow => ({ key: `i:${label}`, label, kind: "line", amount: now("income", label), prior: prior("income", label), line: keyOf("income", label) })),
      { key: "income", label: "Total income", kind: "total", amount: d.income.total, prior: d.prior?.income.total ?? null, line: "income" },
      ...labels("expenses").map((label): PlRow => ({ key: `e:${label}`, label, kind: "line", amount: now("expenses", label), prior: prior("expenses", label), line: keyOf("expenses", label) })),
      { key: "expenses", label: "Total expenses", kind: "total", amount: d.expenses.total, prior: d.prior?.expenses.total ?? null, line: "expenses" },
      { key: "net", label: "Net profit", kind: "net", amount: d.netProfitMinor, prior: d.prior?.netProfitMinor ?? null, line: "net" },
    ];
  }, [statement.data, compare]);

  const stCols = useMemo<GridColumn<PlRow>[]>(() => {
    // A line that has records behind it opens them (the user, 2026-11-27: "each line will be break down also popup").
    const label = (r: PlRow) => {
      const text = r.kind === "line" ? <span className="pl-4 text-muted-foreground">{r.label}</span> : <span className="font-semibold">{r.label}</span>;
      return r.line ? (
        <button type="button" title="See the records behind this line" onClick={() => setLinePick(r)} className="text-left underline-offset-4 hover:text-primary hover:underline">{text}</button>
      ) : text;
    };
    const amount = (v: number, r: PlRow) => <span className={r.kind === "line" ? undefined : r.kind === "net" && v < 0 ? "font-semibold text-rose-600 dark:text-rose-400" : "font-semibold"}>{money(v, cur)}</span>;
    const priorText = statement.data?.prior ? periodText(statement.data.prior) : "Period before";
    return [
      { key: "label", header: "Line", fixed: true, cell: label, text: (r) => (r.kind === "line" ? `   ${r.label}` : r.label) },
      { key: "amount", header: `${statement.data ? periodText(statement.data.period) : "Period"} (${cur})`, align: "right", cell: (r) => amount(r.amount, r), text: (r) => r.amount / 100 },
      ...(compare ? [
        { key: "prior", header: `${priorText} (${cur})`, align: "right", cell: (r: PlRow) => (r.prior === null || r.prior === undefined ? DASH : amount(r.prior, r)), text: (r: PlRow) => (r.prior === null || r.prior === undefined ? "" : r.prior / 100) },
        { key: "moved", header: "Change", align: "right", cell: (r: PlRow) => { const m = r.prior ? change(r.amount, r.prior) : null; return m === null ? DASH : percent(m); }, text: (r: PlRow) => { const m = r.prior ? change(r.amount, r.prior) : null; return m === null ? "" : percent(m); } },
      ] as GridColumn<PlRow>[] : []),
    ];
  }, [cur, compare, statement.data]);

  const moCols = useMemo<GridColumn<PlMonth>[]>(() => {
    const d = series.data;
    const t = d?.totals;
    const list = d?.months ?? [];
    const before = (r: PlMonth) => { const i = list.indexOf(r); return i > 0 ? list[i - 1] : undefined; };
    const margin = (net: number, inc: number) => (inc > 0 ? `${((net / inc) * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%` : "");
    return [
      { key: "month", header: "Month", fixed: true, cell: (r) => <span className="font-medium">{monthText(r.month)}</span>, text: (r) => r.month, total: "Total", totalText: "Total" },
      { key: "income", header: `Income (${cur})`, align: "right", cell: (r) => money(r.incomeMinor, cur), text: (r) => r.incomeMinor / 100, total: money(t?.incomeMinor ?? 0, cur), totalText: (t?.incomeMinor ?? 0) / 100 },
      { key: "expenses", header: `Expenses (${cur})`, align: "right", cell: (r) => money(r.expensesMinor, cur), text: (r) => r.expensesMinor / 100, total: money(t?.expensesMinor ?? 0, cur), totalText: (t?.expensesMinor ?? 0) / 100 },
      { key: "net", header: `Net profit (${cur})`, align: "right", cell: (r) => <span className={r.netMinor < 0 ? "font-medium text-rose-600 dark:text-rose-400" : "font-medium"}>{money(r.netMinor, cur)}</span>, text: (r) => r.netMinor / 100, total: money(t?.netMinor ?? 0, cur), totalText: (t?.netMinor ?? 0) / 100 },
      ...(spec.column === "margin" ? [{ key: "margin", header: "Net margin", align: "right", cell: (r: PlMonth) => margin(r.netMinor, r.incomeMinor) || DASH, text: (r: PlMonth) => margin(r.netMinor, r.incomeMinor), total: margin(t?.netMinor ?? 0, t?.incomeMinor ?? 0) || DASH, totalText: margin(t?.netMinor ?? 0, t?.incomeMinor ?? 0) }] as GridColumn<PlMonth>[] : []),
      ...(spec.column === "change" ? [{ key: "change", header: "Net profit on the month before", align: "right", cell: (r: PlMonth) => { const b = before(r); const m = b && b.netMinor !== 0 ? (r.netMinor - b.netMinor) / Math.abs(b.netMinor) * 100 : null; return m === null ? DASH : percent(m); }, text: (r: PlMonth) => { const b = before(r); const m = b && b.netMinor !== 0 ? (r.netMinor - b.netMinor) / Math.abs(b.netMinor) * 100 : null; return m === null ? "" : percent(m); } }] as GridColumn<PlMonth>[] : []),
    ];
  }, [series.data, cur, spec.column]);

  const stGrid = useGridColumns(`${report.id}:statement`, stCols);
  const moGrid = useGridColumns(`${report.id}:months`, moCols);
  const error = orgs.error ?? query.error;
  const data = query.data;
  const others = months
    ? [...(series.data?.incomeOther ?? []).map((c) => ({ ...c, side: "income" })), ...(series.data?.expensesOther ?? []).map((c) => ({ ...c, side: "expenses" }))]
    : [...(statement.data?.income.otherCurrencies ?? []).map((c) => ({ ...c, side: "income" })), ...(statement.data?.expenses.otherCurrencies ?? []).map((c) => ({ ...c, side: "expenses" }))];

  const save = () => {
    if (!data) return;
    const name = `${report.id}-${data.org.name}-${data.period.from}_${data.period.to}-${basis}`.replace(/\s+/g, "-");
    const top = [[`${report.id} ${report.name}`], [data.org.name, periodText(data.period), PL_BASIS[basis]], []];
    saveCsv(`${name}.csv`, [...top, ...(months ? gridCsv(moGrid.visible, series.data?.months ?? []) : gridCsv(stGrid.visible, lines))]);
  };

  return (
    <div className="space-y-3">
      <Head report={report} basis={PL_BASIS[basis]} source="finance's Profit & Loss" at={data?.generatedAt} />
      {/* Expenses and bills record no CRM, so there is none to pick. */}
      <FinanceFilters orgs={orgs.data} org={org} space="pl" filters={[]} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Select label="Count income by" value={basis} onChange={(v) => setBasis(v as PlBasis)} options={[{ key: "invoiced", name: "Income: invoiced" }, { key: "collected", name: "Income: collected" }]} />
        {!months && statement.data?.bases && (
          <p className="text-xs text-muted-foreground">
            Invoiced before VAT {money(statement.data.bases.invoicedMinor, cur)} · collected {money(statement.data.bases.collectedMinor, cur)} · still owed on the period&apos;s invoices {money(statement.data.bases.owedMinor, cur)}
          </p>
        )}
        <div className="flex items-center gap-2 sm:ml-auto">
          {months ? <ColumnsMenu grid={moGrid} /> : <ColumnsMenu grid={stGrid} />}
          <Button variant="outline" size="sm" className="h-8" onClick={save} disabled={!data}>
            <Download />
            Export
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorCard error={error} onRetry={() => { void orgs.refetch(); void query.refetch(); }} />
      ) : months ? (
        <DataGrid grid={moGrid} rows={series.data?.months ?? []} rowKey={(r) => r.month} loading={series.isFetching} empty="No month in this period." />
      ) : (
        <DataGrid grid={stGrid} rows={lines} rowKey={(r) => r.key} loading={statement.isFetching} empty="Finance has nothing for this period." />
      )}
      {months && series.data?.capped && <p className="text-xs text-muted-foreground">The first 24 months of the period are shown. Pick a shorter period for the rest.</p>}
      <CardPopup
        open={linePick ? { card: "plLine", title: linePick.label, value: money(linePick.amount, cur), line: linePick.line, basis, note: `${statement.data ? periodText(statement.data.period) : ""} · ${PL_BASIS[basis]} The total is the line's.` } : null}
        onClose={() => setLinePick(null)}
      />

      {others.map((c) => (
        <p key={`${c.side}:${c.currency}`} className="text-xs text-muted-foreground">
          Also {amber(money(c.amountMinor, c.currency))} of {c.side} in {c.currency}, over {count(c.count)} {c.count === 1 ? "record" : "records"}. Not in the {cur} figures, never converted.
        </p>
      ))}
    </div>
  );
}

/** Each organization's invoiced revenue as a row, in its own currency — never a column to be added up. */
/* ── Management profitability (Phase 3, 2026-11-27) ─────────────────────────── */

const MP_TITLE: Record<MpSpec["view"], string> = {
  invoice: "Invoice-based management profitability",
  collection: "Collection-based management profitability",
  cash: "Cash movement",
};
interface MpRow { key: string; label: string; kind: "line" | "total" | "net" | "margin"; sum?: MpSum; amount: number; line?: string }
const marginText = (v: number | null) => (v === null ? "" : `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);

export function MPTable({ report, spec }: { report: Titled; spec: MpSpec }) {
  const f = useReportOrgFilters();
  const orgs = useFinanceOrgs();
  const org = pickOrg(orgs.data, f.entity);
  useYearFor(spec.period, report.id);
  const [show, setShow] = useState<"statement" | "months">("statement");
  const [pick, setPick] = useState<MpRow | null>(null);
  const query = useFinanceManagement(org?.id, f.range, spec.view);
  const data = query.data;
  const cur = data?.currency ?? org?.currency ?? "";
  const cash = spec.view === "cash";
  const own = data?.sides.find((x) => x.currency === cur);
  const others = (data?.sides ?? []).filter((x) => x.currency !== cur);

  const rowsOf = (side: MpSide | undefined): MpRow[] => {
    const z = { total: 0, paid: 0, unpaid: 0, count: 0 };
    const s = side ?? { income: z, payroll: z, commission: z, supplier: z, other: z, expenses: z, netMinor: 0, marginPct: null } as unknown as MpSide;
    return [
      { key: "income", label: cash ? "Money in" : spec.view === "invoice" ? "Net invoiced revenue (before VAT, less credit notes)" : "Collections (without VAT)", kind: "total", sum: s.income, amount: s.income.total, line: "income" },
      { key: "payroll", label: cash ? "Payroll paid" : "Payroll", kind: "line", sum: s.payroll, amount: s.payroll.total, line: "payroll" },
      { key: "commission", label: cash ? "Commission paid" : "Commission (outside payroll)", kind: "line", sum: s.commission, amount: s.commission.total, line: "commission" },
      { key: "supplier", label: cash ? "Supplier bills paid" : "Supplier costs (before VAT, less vendor credits)", kind: "line", sum: s.supplier, amount: s.supplier.total, line: "supplier" },
      { key: "other", label: cash ? "Other money out" : "Other operating expenses", kind: "line", sum: s.other, amount: s.other.total, line: "other" },
      { key: "expenses", label: cash ? "Total money out" : "Total costs", kind: "total", sum: s.expenses, amount: s.expenses.total, line: "expenses" },
      { key: "net", label: cash ? "Net cash movement" : "Net management profit", kind: "net", amount: s.netMinor, line: "net" },
      ...(cash ? [] : [{ key: "margin", label: "Profit margin", kind: "margin" as const, amount: s.marginPct ?? 0 }]),
    ];
  };
  const lines = useMemo(() => rowsOf(own), [own, cash, spec.view]); // eslint-disable-line react-hooks/exhaustive-deps

  const stCols = useMemo<GridColumn<MpRow>[]>(() => {
    const label = (r: MpRow) => {
      const text = r.kind === "line" ? <span className="pl-4 text-muted-foreground">{r.label}</span> : <span className="font-semibold">{r.label}</span>;
      return r.line ? <button type="button" title="See the records behind this figure" onClick={() => setPick(r)} className="text-left underline-offset-4 hover:text-primary hover:underline">{text}</button> : text;
    };
    const amt = (r: MpRow) => (r.kind === "margin" ? (own?.marginPct === null || own?.marginPct === undefined ? DASH : marginText(own.marginPct)) : <span className={r.kind === "line" ? undefined : r.kind === "net" && r.amount < 0 ? "font-semibold text-rose-600 dark:text-rose-400" : "font-semibold"}>{money(r.amount, cur)}</span>);
    const isCost = (r: MpRow) => r.sum && r.key !== "income";
    return [
      { key: "label", header: "Figure", fixed: true, cell: label, text: (r) => (r.kind === "line" ? `   ${r.label}` : r.label) },
      { key: "amount", header: `${data ? periodText(data.period) : "Period"} (${cur})`, align: "right", cell: amt, text: (r) => (r.kind === "margin" ? marginText(own?.marginPct ?? null) : r.amount / 100) },
      ...(cash ? [] : [
        { key: "paid", header: "Paid", align: "right", cell: (r: MpRow) => (isCost(r) ? money(r.sum!.paid, cur) : DASH), text: (r: MpRow) => (isCost(r) ? r.sum!.paid / 100 : "") },
        { key: "unpaid", header: "Unpaid", align: "right", cell: (r: MpRow) => (isCost(r) ? <span className={r.sum!.unpaid ? "text-amber-600 dark:text-amber-400" : undefined}>{money(r.sum!.unpaid, cur)}</span> : DASH), text: (r: MpRow) => (isCost(r) ? r.sum!.unpaid / 100 : "") },
      ] as GridColumn<MpRow>[]),
      { key: "count", header: "Records", align: "right", cell: (r) => (r.sum ? count(r.sum.count) : DASH), text: (r) => (r.sum ? r.sum.count : "") },
    ];
  }, [cur, data, own, cash]);

  type MoRow = { month: string; s?: MpSide };
  const moRows = useMemo<MoRow[]>(() => (data?.months ?? []).map((m) => ({ month: m.month, s: m.sides.find((x) => x.currency === cur) })), [data, cur]);
  const moCols = useMemo<GridColumn<MoRow>[]>(() => {
    const v = (r: MoRow, k: "income" | "payroll" | "commission" | "supplier" | "other" | "expenses") => r.s?.[k].total ?? 0;
    const t = own;
    const col = (k: "income" | "payroll" | "commission" | "supplier" | "other" | "expenses", header: string): GridColumn<MoRow> => ({ key: k, header: `${header} (${cur})`, align: "right", cell: (r) => money(v(r, k), cur), text: (r) => v(r, k) / 100, total: money(t?.[k].total ?? 0, cur), totalText: (t?.[k].total ?? 0) / 100 });
    return [
      { key: "month", header: "Month", fixed: true, cell: (r) => <span className="font-medium">{monthText(r.month)}</span>, text: (r) => r.month, total: "Total", totalText: "Total" },
      col("income", cash ? "Money in" : "Income"),
      col("payroll", "Payroll"), col("commission", "Commission"), col("supplier", "Supplier"), col("other", "Other"),
      col("expenses", cash ? "Money out" : "Costs"),
      { key: "net", header: `${cash ? "Net" : "Net profit"} (${cur})`, align: "right", cell: (r) => <span className={(r.s?.netMinor ?? 0) < 0 ? "font-medium text-rose-600 dark:text-rose-400" : "font-medium"}>{money(r.s?.netMinor ?? 0, cur)}</span>, text: (r) => (r.s?.netMinor ?? 0) / 100, total: money(t?.netMinor ?? 0, cur), totalText: (t?.netMinor ?? 0) / 100 },
      ...(cash ? [] : [{ key: "margin", header: "Margin", align: "right", cell: (r: MoRow) => marginText(r.s?.marginPct ?? null) || DASH, text: (r: MoRow) => marginText(r.s?.marginPct ?? null), total: marginText(t?.marginPct ?? null) || DASH, totalText: marginText(t?.marginPct ?? null) }] as GridColumn<MoRow>[]),
    ];
  }, [cur, own, cash]);

  const stGrid = useGridColumns(`${report.id}:statement`, stCols);
  const moGrid = useGridColumns(`${report.id}:months`, moCols);
  const pay = data?.payroll.find((p) => p.currency === cur);
  const com = data?.commission.find((c) => c.currency === cur);
  const error = orgs.error ?? query.error;

  const save = () => {
    if (!data) return;
    const name = `${report.id}-${data.org.name}-${data.period.from}_${data.period.to}`.replace(/\s+/g, "-");
    const top = [[`${report.id} ${report.name}`], [data.org.name, periodText(data.period), MP_TITLE[spec.view]], []];
    saveCsv(`${name}.csv`, [...top, ...(show === "months" ? gridCsv(moGrid.visible, moRows) : gridCsv(stGrid.visible, lines))]);
  };

  return (
    <div className="space-y-3">
      <Head report={report} basis={MP_TITLE[spec.view]} source="finance's management profitability" at={data?.generatedAt} />
      <FinanceFilters orgs={orgs.data} org={org} space={`mp-${spec.view}`} filters={[]} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Select label="Show" value={show} onChange={(v) => setShow(v as "statement" | "months")} options={[{ key: "statement", name: "The period" }, { key: "months", name: "Month by month" }]} />
        <div className="flex items-center gap-2 sm:ml-auto">
          {show === "months" ? <ColumnsMenu grid={moGrid} /> : <ColumnsMenu grid={stGrid} />}
          <Button variant="outline" size="sm" className="h-8" onClick={save} disabled={!data}>
            <Download />
            Export
          </Button>
        </div>
      </div>
      {error ? (
        <ErrorCard error={error} onRetry={() => { void orgs.refetch(); void query.refetch(); }} />
      ) : show === "months" ? (
        <DataGrid grid={moGrid} rows={moRows} rowKey={(r) => r.month} loading={query.isFetching} empty="No month in this period." />
      ) : (
        <DataGrid grid={stGrid} rows={lines} rowKey={(r) => r.key} loading={query.isFetching} empty="Finance has nothing for this period." />
      )}

      {!cash && pay && (
        <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Payroll in {cur}: {count(pay.people)} {pay.people === 1 ? "person" : "people"}</p>
          <p>
            Gross {money(pay.grossMinor, cur)} · deductions {money(pay.deductionsMinor, cur)} (of which advance and loan recoveries {money(pay.recoveriesMinor, cur)}) · net from HRMS {money(pay.netMinor, cur)} ·
            additions {money(pay.additionsMinor, cur)} (of which commission {money(pay.commissionMinor, cur)}) · <span className="font-medium text-foreground">payable {money(pay.payableMinor, cur)}</span> ·
            paid {money(pay.paidMinor, cur)} · outstanding {money(pay.outstandingMinor, cur)}{pay.onHold ? ` (${count(pay.onHold)} on hold, ${money(pay.onHoldMinor, cur)})` : ""}.
          </p>
          <p className="mt-1">The cost counted is the payable. Recoveries pay back money given earlier and are shown, not added. Employer costs are not recorded in finance.</p>
        </div>
      )}
      {!cash && com && (com.count > 0 || com.inPayrollMinor !== 0) && (
        <p className="text-xs text-muted-foreground">
          Commission in {cur}: approved, not paid {money(com.approvedUnpaidMinor, cur)} · paid {money(com.paidMinor, cur)} · earned in finance, not paid {money(com.earnedMinor, cur)}{com.typedMinor ? ` · typed as Sales Commission ${money(com.typedMinor, cur)}` : ""} · inside payroll (counted in payroll, not again) {money(com.inPayrollMinor, cur)}. Pending eligibility and earned-not-approved commission are in the CRMs, not finance.
        </p>
      )}
      {others.map((o) => (
        <p key={o.currency} className="text-xs text-muted-foreground">
          Also in {o.currency}: {cash ? "money in" : "income"} {amber(money(o.income.total, o.currency))}, {cash ? "money out" : "costs"} {amber(money(o.expenses.total, o.currency))}{cash ? "" : ` (unpaid ${money(o.expenses.unpaid, o.currency)})`}, net {amber(money(o.netMinor, o.currency))}. Not in the {cur} figures, never converted.
        </p>
      ))}
      {cash && !!data?.duplicates && <p className="text-xs text-muted-foreground">{count(data.duplicates)} bank {data.duplicates === 1 ? "line is" : "lines are"} marked duplicate and still counted, as in the account balance.</p>}
      {(data?.notes ?? []).map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
      <CardPopup
        open={pick ? { card: "mpLine", title: pick.label, value: money(pick.amount, cur), line: pick.line, basis: spec.view, note: `${data ? periodText(data.period) : ""} · ${MP_TITLE[spec.view]}. The total is the figure's.` } : null}
        onClose={() => setPick(null)}
      />
    </div>
  );
}

/* ── Cash flow and financial position (Phase 4, 2026-11-27) ──────────────────── */

const FP_TITLE: Record<string, string> = {
  cashflow: "Cash flow statement", cash: "Cash and bank position", receivables: "Receivables", obligations: "Outstanding obligations",
  advances: "Employee advances", position: "Management Financial Position — not a statutory balance sheet",
  "rc:bank": "Bank reconciliation", "rc:psp": "PSP and settlement reconciliation", "rc:invoices": "Invoice and collection reconciliation", "rc:expenses": "Expense and supplier reconciliation",
  "rc:payroll": "Payroll and commission reconciliation", "rc:advances": "Employee advance reconciliation", "rc:historical": "Historical data reconciliation", "rc:exceptions": "Financial exceptions",
};
interface FpRow { key: string; label: string; kind: "head" | "line" | "subtotal" | "total"; amount: number | null; count?: number; line?: string }

export function FPTable({ report, spec }: { report: Titled; spec: FpSpec }) {
  const f = useReportOrgFilters();
  const orgs = useFinanceOrgs();
  const org = pickOrg(orgs.data, f.entity);
  useYearFor(spec.period, report.id);
  const [show, setShow] = useState<"statement" | "months">("statement");
  const [currency, setCurrency] = useState<string>("");
  const [pick, setPick] = useState<FpRow | null>(null);
  const rc = spec.kind === "rc";
  const fpQuery = useFinanceFp(rc ? undefined : org?.id, f.range, rc ? "cash" : (spec.report as FpReportKind));
  const rcQuery = useFinanceRc(rc ? org?.id : undefined, f.range, rc ? spec.report : "bank");
  const query = rc ? rcQuery : fpQuery;
  const titleKey = rc ? `rc:${spec.report}` : spec.report;
  const data = query.data;
  const base = data?.currency ?? org?.currency ?? "";
  const cur = currency && data?.sides.some((x) => x.currency === currency) ? currency : base;
  const side: FpSide | undefined = data?.sides.find((x) => x.currency === cur);
  const flow = !rc && spec.report === "cashflow";
  const when = data ? (flow ? periodText(data.period) : `As of ${dayText(data.asOf)}`) : "";

  const rows = useMemo<FpRow[]>(() => {
    if (!side) return [];
    const out: FpRow[] = [];
    for (const sct of side.sections) {
      out.push({ key: `h:${sct.key}`, label: sct.title, kind: "head", amount: null });
      for (const l of sct.lines) out.push({ key: l.key, label: l.label, kind: "line", amount: l.amountMinor, count: l.count, line: l.key });
      if (sct.showTotal) out.push({ key: `t:${sct.key}`, label: `Total — ${sct.title.toLowerCase()}`, kind: "subtotal", amount: sct.totalMinor, line: sct.key });
    }
    out.push({ key: "h:totals", label: flow ? "Reconciliation" : "Summary", kind: "head", amount: null });
    for (const t of side.totals) out.push({ key: `x:${t.key}`, label: t.label, kind: t.strong ? "total" : "line", amount: t.amountMinor });
    return out;
  }, [side, flow]);

  const stCols = useMemo<GridColumn<FpRow>[]>(() => [
    { key: "label", header: "Line", fixed: true, cell: (r) => {
      const text = r.kind === "head" ? <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{r.label}</span> : r.kind === "line" ? <span className="pl-4">{r.label}</span> : <span className="font-semibold">{r.label}</span>;
      return r.line ? <button type="button" title="See the records behind this line" onClick={() => setPick(r)} className="text-left underline-offset-4 hover:text-primary hover:underline">{text}</button> : text;
    }, text: (r) => r.label },
    { key: "amount", header: `${when} (${cur})`, align: "right", cell: (r) => (r.amount === null ? "" : <span className={r.kind === "line" ? (r.amount < 0 ? "text-rose-600 dark:text-rose-400" : undefined) : r.amount < 0 ? "font-semibold text-rose-600 dark:text-rose-400" : "font-semibold"}>{money(r.amount, cur)}</span>), text: (r) => (r.amount === null ? "" : r.amount / 100) },
    { key: "count", header: "Records", align: "right", cell: (r) => (r.count ? count(r.count) : ""), text: (r) => r.count ?? "" },
  ], [cur, when]);

  type MoRow = { month: string; s?: FpSide };
  const moRows = useMemo<MoRow[]>(() => (data?.months ?? []).map((m) => ({ month: m.month, s: m.sides.find((x) => x.currency === cur) })), [data, cur]);
  const moCols = useMemo<GridColumn<MoRow>[]>(() => {
    const keys = (data?.months.find((m) => m.sides.some((x) => x.currency === cur))?.sides.find((x) => x.currency === cur)?.totals ?? side?.totals ?? []).filter((t) => t.key !== "check" && t.key !== "restricted");
    return [
      { key: "month", header: flow ? "Month" : "Month end", fixed: true, cell: (r) => <span className="font-medium">{monthText(r.month)}</span>, text: (r) => r.month },
      ...keys.map((t): GridColumn<MoRow> => {
        const v = (r: MoRow) => r.s?.totals.find((x) => x.key === t.key)?.amountMinor ?? 0;
        return { key: t.key, header: t.label, align: "right", cell: (r) => <span className={v(r) < 0 ? "text-rose-600 dark:text-rose-400" : undefined}>{money(v(r), cur)}</span>, text: (r) => v(r) / 100 };
      }),
    ];
  }, [data, cur, side, flow]);

  const stGrid = useGridColumns(`${report.id}:statement`, stCols);
  const moGrid = useGridColumns(`${report.id}:months:${cur}`, moCols);
  const error = orgs.error ?? query.error;
  const save = () => {
    if (!data) return;
    const name = `${report.id}-${data.org.name}-${data.from}_${data.to}-${cur}`.replace(/\s+/g, "-");
    const top = [[`${report.id} ${report.name}`], [data.org.name, when, FP_TITLE[titleKey], cur], []];
    saveCsv(`${name}.csv`, [...top, ...(show === "months" ? gridCsv(moGrid.visible, moRows) : gridCsv(stGrid.visible, rows))]);
  };

  return (
    <div className="space-y-3">
      <Head report={report} basis={FP_TITLE[titleKey]} source={rc ? "finance's reconciliation" : "finance"} at={data?.generatedAt} />
      <FinanceFilters orgs={orgs.data} org={org} space={`${rc ? "rc" : "fp"}-${spec.report}`} filters={[]} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {spec.report !== "advances" && !rc && <Select label="Show" value={show} onChange={(v) => setShow(v as "statement" | "months")} options={[{ key: "statement", name: flow ? "The period" : "As of the date" }, { key: "months", name: flow ? "Month by month" : "Each month end" }]} />}
        {(data?.sides.length ?? 0) > 1 && <Select label="Currency" value={cur} onChange={setCurrency} options={(data?.sides ?? []).map((x) => ({ key: x.currency, name: x.currency === base ? `${x.currency} (the organization's)` : `${x.currency} (apart, never converted)` }))} />}
        {!flow && data && <p className="text-xs text-muted-foreground">As of {dayText(data.asOf)}: the last day of the period, or today if that is later.</p>}
        <div className="flex items-center gap-2 sm:ml-auto">
          {show === "months" ? <ColumnsMenu grid={moGrid} /> : <ColumnsMenu grid={stGrid} />}
          <Button variant="outline" size="sm" className="h-8" onClick={save} disabled={!data}>
            <Download />
            Export
          </Button>
        </div>
      </div>
      {(data?.warnings ?? []).length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="mb-1 font-medium">Data completeness</p>
          {data!.warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}
      {error ? (
        <ErrorCard error={error} onRetry={() => { void orgs.refetch(); void query.refetch(); }} />
      ) : show === "months" ? (
        <DataGrid grid={moGrid} rows={moRows} rowKey={(r) => r.month} loading={query.isFetching} empty="No month in this period." />
      ) : (
        <DataGrid grid={stGrid} rows={rows} rowKey={(r) => r.key} loading={query.isFetching} empty="Finance has nothing for this." />
      )}
      {(data?.notes ?? []).map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
      <CardPopup
        open={pick ? { card: "fpLine", title: pick.label, value: money(pick.amount ?? 0, cur), line: pick.line, basis: rc ? `rc:${spec.report}` : spec.report, note: `${when} · ${FP_TITLE[titleKey]}. Each record behind the line; other currencies apart.` } : null}
        onClose={() => setPick(null)}
      />
    </div>
  );
}

function EntitiesTable({ report, basis }: { report: Titled; basis: "invoiced" | "collected" }) {
  const f = useReportOrgFilters();
  const orgs = useFinanceOrgs();
  const list = orgs.data ?? [];
  const page: PageAsk = { limit: 0, offset: 0, sort: "date", dir: "desc", q: "" };
  const results = useQueries({
    queries: list.map((o) => ({
      queryKey: ["report-org", "finance", "revenue", o.id, f.range.from, f.range.to, "entities", basis, "month", 0, 0, "date", "desc", ""],
      queryFn: () => fetchRevenue(o.id, f.range, {}, { basis, groupBy: "month" }, page),
      staleTime: 60_000, retry: false, refetchOnWindowFocus: false,
    })),
  });
  type Line = { id: string; name: string; currency: string; data?: RevenueReport; failed?: string };
  const rows: Line[] = list.map((o, i) => ({ id: o.id, name: o.name, currency: o.currency, data: results[i]?.data, failed: results[i]?.error ? apiErrorMessage(results[i]!.error, "Could not be read") : undefined }));
  const cols = useMemo<GridColumn<Line>[]>(() => {
    const cell = (r: Line, pick: (d: RevenueReport) => number) => (r.failed ? <span className="text-amber-600 dark:text-amber-400" title={r.failed}>Could not be read</span> : r.data ? money(pick(r.data), r.data.currency) : <span className="text-muted-foreground">…</span>);
    const num = (r: Line, pick: (d: RevenueReport) => number) => (r.data ? pick(r.data) / 100 : "");
    return [
      { key: "name", header: "Organization", fixed: true, cell: (r) => <span className="font-medium">{r.name}</span>, text: (r) => r.name },
      { key: "currency", header: "Currency", cell: (r) => r.currency, text: (r) => r.currency },
      { key: "count", header: "Invoices", align: "right", cell: (r) => (r.data ? count(r.data.totals.count) : DASH), text: (r) => r.data?.totals.count ?? "" },
      { key: "amount", header: "Net invoiced", align: "right", cell: (r) => cell(r, (d) => d.totals.amountMinor), text: (r) => num(r, (d) => d.totals.amountMinor) },
      { key: "collected", header: "Collected so far", align: "right", cell: (r) => cell(r, (d) => d.totals.collectedMinor ?? 0), text: (r) => num(r, (d) => d.totals.collectedMinor ?? 0) },
      { key: "owed", header: "Still owed", align: "right", cell: (r) => cell(r, (d) => d.totals.outstandingMinor ?? 0), text: (r) => num(r, (d) => d.totals.outstandingMinor ?? 0) },
    ];
  }, []);
  const grid = useGridColumns(`${report.id}:entities`, cols);

  return (
    <div className="space-y-3">
      <Head report={report} basis={BASIS[basis]} source="finance's Revenue report" at={rows.find((r) => r.data)?.data?.generatedAt} />
      {/* No organization to pick here: the report is every one of them, side by side. */}
      <FinanceFilters orgs={undefined} org={undefined} />
      <div className="flex items-center justify-end gap-2">
        <ColumnsMenu grid={grid} />
        <Button variant="outline" size="sm" className="h-8" onClick={() => saveCsv(`${report.id}-${f.range.from}_${f.range.to}.csv`, [[`${report.id} ${report.name}`], [periodText(f.range)], [], ...gridCsv(grid.visible, rows, false)])} disabled={!rows.length}>
          <Download />
          Export
        </Button>
      </div>
      {orgs.error ? (
        <ErrorCard error={orgs.error} onRetry={() => void orgs.refetch()} />
      ) : (
        <DataGrid grid={grid} rows={rows} rowKey={(r) => r.id} loading={orgs.isLoading} totals={false} empty="Finance has no organization to list." />
      )}
      <p className="text-xs text-muted-foreground">
        There is no total row. Each organization keeps its books in its own currency, and the Report Org never converts one into the other or adds them.
      </p>
    </div>
  );
}

export function ReportViewer({ id }: { id: string }) {
  const report = reportById(id);

  if (!report) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm font-medium text-foreground">There is no report with the ID “{id.toUpperCase()}”</p>
        <Link href="/report-org/finance" className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline">Open the report catalog</Link>
      </div>
    );
  }

  if (report.state !== "live") {
    return (
      <div className="space-y-4">
        <Head report={report} />
        <div className="rounded-lg border border-dashed border-border p-6">
          <p className="text-sm font-medium text-foreground">{report.state === "planned" ? "This report is not connected yet" : "This report cannot be shown"}</p>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {report.state === "planned"
              ? "Finance holds what it needs. Nothing is shown rather than an empty table, which would read as there being none."
              : "Finance keeps nothing it could be built from, so there are no rows to show."}
          </p>
        </div>
      </div>
    );
  }

  if (report.spec.kind === "overview") {
    return (
      <div className="space-y-4">
        <Head report={report} />
        <Link href="/report-org/finance" className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
          The headline figures are on the Finance and revenue page
        </Link>
      </div>
    );
  }

  if (report.spec.kind === "entities") return <EntitiesTable report={report} basis={report.spec.basis} />;
  if (report.spec.kind === "expenses") return <ExpenseTable key={report.id} report={report} spec={report.spec} />;
  if (report.spec.kind === "aging") return <AgingTable key={report.id} report={report} spec={report.spec} />;
  if (report.spec.kind === "ledger") return <LedgerTable key={report.id} report={report} spec={report.spec} />;
  if (report.spec.kind === "pl") return <PLTable key={report.id} report={report} spec={report.spec} />;
  if (report.spec.kind === "mp") return <MPTable key={report.id} report={report} spec={report.spec} />;
  if (report.spec.kind === "fp" || report.spec.kind === "rc") return <FPTable key={report.id} report={report} spec={report.spec} />;
  return <RevenueTable key={report.id} report={report} spec={report.spec} />;
}
