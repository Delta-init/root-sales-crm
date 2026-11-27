"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/axios";

/*
 * Report Org → Finance and revenue: what Root's server passes on from finance (GET /report-org/finance/…), as finance
 * answers it. Amounts are in minor units (fils, paise) of the organization's own currency.
 */

export interface FinanceOrg { id: string; name: string; currency: string }
export interface Period { from: string; to: string }

/** A figure, and the same figure for the period before. */
export interface Pair { minor: number; priorMinor: number; count?: number }

export interface Aged { asOf: string; current: number; band1to30: number; band31to60: number; band61to90: number; band90plus: number; grand: number }

/** Money paid in another currency than its invoice's: as it was paid, never converted or added in. */
export interface ForeignLine { currency: string; amountMinor: number; count: number; recordedMinor?: number; unknownCount?: number; unknownMinor?: number }

export interface Overview {
  generatedAt: string;
  org: FinanceOrg;
  period: Period;
  before: Period;
  /** The CRMs the invoiced and collected figures were kept to; null: all of them. */
  crm: string[] | string | null;
  kpis: Record<"grossInvoiced" | "creditNotes" | "netInvoiced" | "collections" | "income" | "expenses" | "netProfit", Pair>;
  receivables: Aged;
  payables: Aged;
  vat: { outputMinor: number; inputMinor: number; netPayableMinor: number; /** Output VAT kept to the CRMs picked. */ outputByCrm?: boolean };
  /** A method taken in another currency only (INR Transfer) has nothing in `amountMinor`: its money is in `foreign`. */
  methods: { key: string; name: string; amountMinor: number; count: number; foreign?: ForeignLine[] }[];
  expenseCategories: { label: string; amountMinor: number }[];
  /** Expenses in another currency than the organization's — apart, never in `kpis.expenses` or the profit. */
  expensesOther?: { currency: string; amountMinor: number; count: number }[];
  collectedForeign: { lines: ForeignLine[] } | null;
  trend: { day: string; invoicedMinor: number; collectedMinor: number }[] | null;
  bank: {
    accounts: { name: string; type: string; currency: string; balanceMinor: number }[];
    byCurrency: { currency: string; balanceMinor: number }[];
  };
  appUrl: string;
}

export interface Group { key: string; name: string; count: number; amountMinor: number; collectedMinor?: number; owedMinor?: number; foreign?: ForeignLine[]; /** A category's subcategories. */ sub?: Group[] }

/**
 * One record of a report as a row of its table — an invoice, a credit note, a payment or an expense — with each
 * dimension by its name.
 */
export interface ReportRow {
  id: string; date: string; number: string; title: string; detail: string; href: string;
  /** In `currency` when it has one (a payment made in another currency, as paid; an expense's own), else in the report's. */
  amountMinor: number;
  currency?: string;
  collectedMinor?: number;
  owedMinor?: number;
  /** A payment made in another currency: what finance recorded it as, in the report's currency. */
  recordedMinor?: number;
  /** Paid in this currency, but the amount in it was never recorded — so it is counted as recorded, in the report's. */
  paidIn?: string;
  salesperson?: string; department?: string; course?: string; crm?: string; academy?: string; method?: string; bank?: string; status?: string;
  category?: string; subcategory?: string; employee?: string; submittedBy?: string; source?: string; paid?: string;
}

/** A page of a report's rows: which, sorted how — as finance gave it. */
interface Paged { rows: ReportRow[]; rowCount: number; offset: number; sort: string; dir: "asc" | "desc"; recordCount: number; capped: boolean }

export interface RevenueReport extends Paged {
  /** What each filter can be set to in this period: every value, with its name and how many records it has. */
  options?: Record<string, { key: string; name: string; count: number }[]>;
  generatedAt: string;
  org: FinanceOrg;
  period: Period;
  basis: "invoiced" | "collected";
  groupBy: string;
  currency: string;
  totals: { amountMinor: number; count: number; invoicedMinor?: number; creditMinor?: number; collectedMinor?: number; outstandingMinor?: number };
  groups: Group[];
  months: { month: string; amountMinor: number; count: number }[];
  days: { day: string; amountMinor: number; count: number; foreign?: ForeignLine[] }[] | null;
  foreign: { lines: ForeignLine[] } | null;
  appUrl: string;
}

/** One currency's totals. Two currencies are never added together. */
export interface CurrencyTotals { currency: string; amountMinor: number; count: number; paidMinor?: number; unpaidMinor?: number }

export interface ExpenseReport extends Paged {
  /** What each filter can be set to in this period: every value, with its name and how many records it has. */
  options?: Record<string, { key: string; name: string; count: number }[]>;
  generatedAt: string;
  org: FinanceOrg;
  period: Period;
  basis: "expense" | "paid";
  groupBy: string;
  /** Profit-and-loss expenses only: advances, payroll clearing, VAT and loan principal left out. */
  pnlOnly: boolean;
  /** The currency the totals, groups and rows are in. */
  currency: string;
  /** Every currency the period has, the organization's first — and each one's own totals. */
  currencies: string[];
  byCurrency: CurrencyTotals[];
  totals: { amountMinor: number; count: number; paidMinor?: number; unpaidMinor?: number };
  groups: Group[];
  months: { month: string; amountMinor: number; count: number }[];
  days: { day: string; amountMinor: number; count: number }[] | null;
  appUrl: string;
}

const get = async <T,>(path: string, params?: Record<string, string | string[] | undefined>) => {
  const { data } = await api.get(`/report-org/finance/${path}`, { params });
  return data.data as T;
};

/** Finance's "all" is no filter at all. */
/** What each filter is set to: any number of values each. An empty list is no filter. */
export type Picks = Record<string, string[]>;
/** For a query's key: the same picks always read the same. */
const picksKey = (p: Picks) => JSON.stringify(Object.keys(p).sort().map((k) => [k, [...p[k]].sort()]));
/** As request parameters: a filter with several values goes several times under its name. */
const picksParams = (p: Picks): Record<string, string[]> => Object.fromEntries(Object.entries(p).filter(([, v]) => v.length > 0));

/** The figures are finance's live ones; a minute is fresh enough, and a failure is said once rather than retried. */
const LIVE = { staleTime: 60_000, retry: false, refetchOnWindowFocus: false } as const;

export const useFinanceOrgs = () =>
  useQuery({
    queryKey: ["report-org", "finance", "organizations"],
    queryFn: async () => (await get<{ organizations: FinanceOrg[]; appUrl: string }>("organizations")).organizations,
    ...LIVE,
    staleTime: 10 * 60_000,
  });

export const useFinanceOverview = (org: string | undefined, period: Period, crm: string[]) =>
  useQuery({
    queryKey: ["report-org", "finance", "overview", org, period.from, period.to, [...crm].sort().join("|")],
    queryFn: () => get<Overview>("overview", { org, from: period.from, to: period.to, ...(crm.length ? { crm } : {}) }),
    enabled: !!org,
    ...LIVE,
  });

/** Which page of rows a table wants: how many, from where, sorted by which column and which way, and the words searched for. */
export interface PageAsk { limit: number; offset: number; sort: string; dir: "asc" | "desc"; q: string }

const pageParams = (p: PageAsk) => ({ limit: String(p.limit), offset: String(p.offset), sort: p.sort, dir: p.dir, q: p.q || undefined });
const pageKey = (p: PageAsk) => [p.limit, p.offset, p.sort, p.dir, p.q];

export interface RevenueAsk { basis: "invoiced" | "collected"; groupBy: string; /** Only the payments made in this other currency. */ paidIn?: string }

export const fetchRevenue = (org: string, period: Period, picks: Picks, ask: RevenueAsk, page: PageAsk) =>
  get<RevenueReport>("revenue", { org, from: period.from, to: period.to, basis: ask.basis, groupBy: ask.groupBy, ...(ask.paidIn ? { paidIn: ask.paidIn } : {}), ...picksParams(picks), ...pageParams(page) });

export const useFinanceRevenue = (org: string | undefined, period: Period, picks: Picks, ask: RevenueAsk, page: PageAsk) =>
  useQuery({
    queryKey: ["report-org", "finance", "revenue", org, period.from, period.to, picksKey(picks), ask.basis, ask.groupBy, ask.paidIn ?? "", ...pageKey(page)],
    queryFn: () => fetchRevenue(org!, period, picks, ask, page),
    enabled: !!org,
    // Turning a page keeps the rows on screen until the next ones arrive, rather than blanking the table.
    placeholderData: (before) => before,
    ...LIVE,
  });

export interface ExpenseAsk { basis: "expense" | "paid"; groupBy: string; pnl: boolean; currency?: string; only?: Record<string, string>; picks?: Picks }

export const fetchExpenses = (org: string, period: Period, ask: ExpenseAsk, page: PageAsk) =>
  get<ExpenseReport>("expenses", {
    org, from: period.from, to: period.to, basis: ask.basis, groupBy: ask.groupBy, pnl: ask.pnl ? "1" : "0", currency: ask.currency, ...picksParams(ask.picks ?? {}), ...(ask.only ?? {}), ...pageParams(page),
  });

export const useFinanceExpenses = (org: string | undefined, period: Period, ask: ExpenseAsk, page: PageAsk) =>
  useQuery({
    queryKey: ["report-org", "finance", "expenses", org, period.from, period.to, ask.basis, ask.groupBy, ask.pnl, ask.currency ?? "", JSON.stringify(ask.only ?? {}), picksKey(ask.picks ?? {}), ...pageKey(page)],
    queryFn: () => fetchExpenses(org!, period, ask, page),
    enabled: !!org,
    placeholderData: (before) => before,
    ...LIVE,
  });

/** An open invoice or bill as a row: what is left on it, when it was due and how late it is. */
export interface AgingRow extends ReportRow { dueDate: string; totalMinor: number; daysOverdue: number; band: string }

export interface AgingGroup { key: string; name: string; count: number; amountMinor: number; totalMinor: number; overdueMinor?: number }

export interface AgingReport {
  generatedAt: string;
  org: FinanceOrg;
  kind: "receivables" | "payables";
  due: "upcoming" | "overdue" | null;
  groupBy: "band" | "party";
  /** The day the balances are as of — today. Finance keeps none as of a past date. */
  asOf: string;
  currency: string;
  totals: { amountMinor: number; count: number; totalMinor: number; overdueMinor: number; overdueCount: number };
  groups: AgingGroup[];
  options?: Record<string, { key: string; name: string; count: number }[]>;
  rows: AgingRow[]; rowCount: number; offset: number; sort: string; dir: "asc" | "desc"; recordCount: number; capped: boolean;
  /** What is owed in another currency than the organization's — apart, never in the figures above. */
  otherCurrencies: { currency: string; what: string; amountMinor: number; count: number }[];
  appUrl: string;
}

export interface AgingAsk { kind: "receivables" | "payables"; groupBy: "band" | "party"; due?: "upcoming" | "overdue"; picks?: Picks }

export const fetchAging = (org: string, ask: AgingAsk, page: PageAsk) =>
  get<AgingReport>("aging", { org, kind: ask.kind, groupBy: ask.groupBy, due: ask.due, ...picksParams(ask.picks ?? {}), ...pageParams(page) });

export const useFinanceAging = (org: string | undefined, ask: AgingAsk, page: PageAsk) =>
  useQuery({
    queryKey: ["report-org", "finance", "aging", org, ask.kind, ask.groupBy, ask.due ?? "", picksKey(ask.picks ?? {}), ...pageKey(page)],
    queryFn: () => fetchAging(org!, ask, page),
    enabled: !!org,
    placeholderData: (before) => before,
    ...LIVE,
  });

/** A row of a list finance keeps: a commission payout, a person on a payroll run, or a payroll payment. */
export type LedgerRow = ReportRow & Record<string, string | number | undefined>;
export type LedgerGroup = { key: string; name: string; count: number } & Record<string, string | number>;

export interface LedgerReport {
  generatedAt: string;
  org: FinanceOrg;
  period: Period;
  groupBy: string;
  currency: string;
  /** In the organization's own currency: how many rows, and the sum of each amount column. */
  totals: { count: number } & Record<string, number>;
  groups: LedgerGroup[];
  options?: Record<string, { key: string; name: string; count: number }[]>;
  /** The same sums for each other currency — apart, never added in. */
  otherCurrencies: ({ currency: string; count: number } & Record<string, string | number>)[];
  rows: LedgerRow[]; rowCount: number; offset: number; sort: string; dir: "asc" | "desc"; recordCount: number; capped: boolean;
  appUrl: string;
}

export interface LedgerAsk { source: "commission" | "payroll" | "vat" | "pl-lines" | "management-profit-lines"; groupBy: string; params?: Record<string, string>; picks?: Picks }

export const fetchLedger = (org: string, period: Period, ask: LedgerAsk, page: PageAsk) =>
  get<LedgerReport>(ask.source, { org, from: period.from, to: period.to, groupBy: ask.groupBy, ...picksParams(ask.picks ?? {}), ...(ask.params ?? {}), ...pageParams(page) });

export const useFinanceLedger = (org: string | undefined, period: Period, ask: LedgerAsk, page: PageAsk) =>
  useQuery({
    queryKey: ["report-org", "finance", ask.source, org, period.from, period.to, ask.groupBy, JSON.stringify(ask.params ?? {}), picksKey(ask.picks ?? {}), ...pageKey(page)],
    queryFn: () => fetchLedger(org!, period, ask, page),
    enabled: !!org,
    placeholderData: (before) => before,
    ...LIVE,
  });

/* Profit & Loss (2026-11-27): finance's own calculation, the statement or month by month, invoiced or collected. */
export type PlBasis = "invoiced" | "collected";
export interface PlLine { label: string; amountMinor: number; /** Which records are behind it: income, bills, cat:<category>. */ key?: string }
export interface PlSide { total: number; breakdown: PlLine[] }
export interface PlPeriod { from: string; to: string; income: PlSide & { otherCurrencies?: { currency: string; what?: string; amountMinor: number; count: number }[] }; expenses: PlSide & { otherCurrencies?: { currency: string; amountMinor: number; count: number; breakdown?: PlLine[] }[] }; netProfitMinor: number }
export interface PlStatement extends PlPeriod {
  generatedAt: string; org: FinanceOrg; period: Period; basis: PlBasis; view: "statement"; currency: string;
  prior: PlPeriod | null;
  bases?: { invoicedMinor: number; collectedMinor: number; owedMinor: number };
  appUrl: string;
}
export interface PlMonth { month: string; from: string; to: string; incomeMinor: number; expensesMinor: number; netMinor: number }
export interface PlMonths {
  generatedAt: string; org: FinanceOrg; period: Period; basis: PlBasis; view: "months"; currency: string;
  months: PlMonth[]; totals: { incomeMinor: number; expensesMinor: number; netMinor: number };
  incomeOther: { currency: string; amountMinor: number; count: number }[]; expensesOther: { currency: string; amountMinor: number; count: number }[];
  capped: boolean; appUrl: string;
}

export const fetchPl = <T extends PlStatement | PlMonths>(org: string, period: Period, basis: PlBasis, view: T["view"]) =>
  get<T>("pl", { org, from: period.from, to: period.to, basis, view });

export const useFinancePl = <T extends PlStatement | PlMonths>(org: string | undefined, period: Period, basis: PlBasis, view: T["view"]) =>
  useQuery({
    queryKey: ["report-org", "finance", "pl", org, period.from, period.to, basis, view],
    queryFn: () => fetchPl<T>(org!, period, basis, view),
    enabled: !!org,
    placeholderData: (before) => before,
    ...LIVE,
  });

/* Management profitability (Phase 3, 2026-11-27): three views, figures per currency, month by month. */
export type MpView = "invoice" | "collection" | "cash";
export interface MpSum { total: number; paid: number; unpaid: number; count: number }
export interface MpSide { currency: string; income: MpSum; payroll: MpSum; commission: MpSum; supplier: MpSum; other: MpSum; expenses: MpSum; netMinor: number; marginPct: number | null }
export interface MpPayroll { currency: string; people: number; grossMinor: number; deductionsMinor: number; recoveriesMinor: number; netMinor: number; additionsMinor: number; commissionMinor: number; payableMinor: number; paidMinor: number; outstandingMinor: number; onHold: number; onHoldMinor: number }
export interface MpCommission { currency: string; approvedUnpaidMinor: number; paidMinor: number; earnedMinor: number; typedMinor: number; inPayrollMinor: number; count: number }
export interface MpReport {
  generatedAt: string; org: FinanceOrg; period: Period; view: MpView; currency: string;
  sides: MpSide[]; months: { month: string; sides: MpSide[] }[]; payroll: MpPayroll[]; commission: MpCommission[];
  notes: string[]; duplicates: number; recordCount: number; appUrl: string;
}

export const useFinanceManagement = (org: string | undefined, period: Period, view: MpView) =>
  useQuery({
    queryKey: ["report-org", "finance", "management-profit", org, period.from, period.to, view],
    queryFn: () => get<MpReport>("management-profit", { org: org!, from: period.from, to: period.to, view }),
    enabled: !!org,
    placeholderData: (before) => before,
    ...LIVE,
  });

/** An amount as the Report Org shows it: exact, in its own currency — rupees grouped the Indian way. */
export const money = (minor: number, currency: string) =>
  `${currency} ${(minor / 100).toLocaleString(currency === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: 2 })}`;

export const count = (n: number) => n.toLocaleString("en-US");

/** "1 invoice or credit note", "3 invoices and credit notes" — what the invoiced figures count. */
export const invoicesText = (n: number) => (n === 1 ? "1 invoice or credit note" : `${count(n)} invoices and credit notes`);

/** "1 payment", "3 payments". */
export const paymentsText = (n: number) => (n === 1 ? "1 payment" : `${count(n)} payments`);

/** "1 expense", "3 expenses". */
export const expensesText = (n: number) => (n === 1 ? "1 expense" : `${count(n)} expenses`);

/** How a figure moved against the one before, as a signed percentage — null when there was nothing before to compare with. */
export const change = (now: number, before: number): number | null => (before ? ((now - before) / Math.abs(before)) * 100 : null);

export const percent = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
