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
  change, count, fetchAging, fetchExpenses, fetchLedger, fetchRevenue, money, percent, useFinanceAging, useFinanceExpenses, useFinanceLedger, useFinanceOrgs, useFinanceRevenue,
  type AgingGroup, type AgingRow, type ForeignLine, type LedgerGroup, type LedgerRow, type PageAsk, type ReportRow, type RevenueReport,
} from "./api";
import { reportById, type Column, type LiveSpec, type Report } from "./catalog";
import { ColumnsMenu, DataGrid, Pager, gridCsv, useGridColumns, type GridColumn, type GridSort } from "./DataGrid";
import { FinanceFilters, pickOrg, usePicks, type FilterDef } from "./FinanceFilters";
import { Select } from "./FilterSelect";
import { ErrorCard, ForeignUnknown, dayText, periodText, saveCsv, timeText } from "./parts";
import { StateBadge } from "./ReportCatalog";

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
        <Link href="/report-org/finance" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Finance and revenue <span className="opacity-60">/</span> {report.category.name}
        </Link>
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
      { key: "number", header: spec.source === "commission" ? "Expense" : spec.source === "vat" ? "Number" : "Run", cell: (r) => (r.number ? (r.href ? numberCell(appUrl, r) : <span className="font-medium">{r.number}</span>) : DASH), text: (r) => r.number },
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

/** Each organization's invoiced revenue as a row, in its own currency — never a column to be added up. */
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
  return <RevenueTable key={report.id} report={report} spec={report.spec} />;
}
