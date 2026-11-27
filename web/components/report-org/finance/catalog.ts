/*
 * Report Org → Finance and revenue: every report in the specification the user supplied (finance-revenue-reports.md,
 * 2026-11-26), and whether it can be shown.
 *
 * Three honest states, because the specification asks for reports the finance system has nothing to build from, and a
 * report that shows zeros where there is no data reads as "there was no revenue":
 *
 *   live     read from finance now, as finance's own pages count it
 *   planned  finance holds the data; it has not been connected yet
 *   none     finance keeps nothing this could be built from — the reason is said
 *
 * The specification was written for another platform with a ledger. Finance here keeps invoices, payments, credit
 * notes, expenses, bills, bank accounts, budgets, payroll and VAT — no chart of accounts, journals, accounting
 * periods, revenue recognition, targets, forecasts, branches or brands.
 */

/** What a revenue report is grouped by: one of finance's Revenue report dimensions, or the day. */
export type GroupBy = "day" | "month" | "salesperson" | "department" | "course" | "crm" | "academy" | "method" | "bank" | "status";

/** What an expense report is grouped by: one of finance's Expense report dimensions, or the day. */
export type ExpenseGroupBy = "day" | "month" | "category" | "department" | "employee" | "status";

/** An extra column worked out from what finance sends. */
export type Column = "collected" | "owed" | "average" | "change" | "efficiency";

export type LiveSpec =
  /** The headline figures — shown on the section's own page. */
  | { kind: "overview" }
  /** Each finance organization side by side, in its own currency, never added. */
  | { kind: "entities"; basis: "invoiced" | "collected" }
  | {
      kind: "revenue";
      /** invoiced: by issue date, less credit notes. collected: by the day each payment was made. */
      basis: "invoiced" | "collected";
      groupBy: GroupBy;
      /** The period it opens on. */
      period: "month" | "year";
      chart: "bar" | "line";
      columns?: Column[];
    }
  /** What is still owed on open invoices or open bills, as of now — finance's aged lists. No period: balances as they stand. */
  | {
      kind: "aging";
      side: "receivables" | "payables";
      /** The summary: by how late, or by student or vendor. */
      groupBy: "band" | "party";
      /** Kept to what is not yet due, or to what is past due. */
      due?: "upcoming" | "overdue";
      /** Which table it opens on. */
      view: "summary" | "records";
    }
  /** A list finance keeps — commission payouts, or payroll runs — grouped and listed. */
  | {
      kind: "ledger";
      /** vat: the rows behind the VAT position and the income of "Income less expenses" (headline cards only). */
      source: "commission" | "payroll" | "vat";
      /** The summary's grouping. */
      groupBy: string;
      view: "summary" | "records";
      period: "month" | "year";
      /** What makes this report this one: paid by date, the payments rather than the people, only those still owed. */
      params?: Record<string, string>;
      /** Kept to one value of a filter, which is then not offered. */
      only?: Record<string, string>;
    }
  /** Finance's Expense report: approved expenses and those waiting for approval. */
  | {
      kind: "expenses";
      groupBy: ExpenseGroupBy;
      period: "month" | "year";
      chart: "bar" | "line";
      columns?: Column[];
      /** Kept to one value of a dimension — reimbursements are one source of expense. */
      only?: Record<string, string>;
      /** The currency it opens on, where not the organization's own. */
      currency?: string;
    };

export type Report = {
  id: string;
  name: string;
  /** What it counts, in a sentence — or why it cannot be shown. */
  about: string;
} & ({ state: "live"; spec: LiveSpec } | { state: "planned" } | { state: "none" });

export interface Category {
  slug: string;
  name: string;
  reports: Report[];
}

const live = (id: string, name: string, spec: LiveSpec, about: string): Report => ({ id, name, about, state: "live", spec });
const planned = (id: string, name: string, about = LATER): Report => ({ id, name, about, state: "planned" });
const none = (id: string, name: string, about: string): Report => ({ id, name, about, state: "none" });

const LATER = "Finance holds the data for this. It has not been connected to the Report Org yet.";
const NO_LEDGER = "Finance keeps invoices, bills and expenses, not a chart of accounts or a ledger, so this cannot be drawn up.";
const NO_RECOGNITION = "Finance does not record when a course is delivered, so revenue is not spread over time.";
const NO_TARGETS = "No sales or revenue targets are kept in finance.";
const NO_FORECAST = "Finance keeps no forecasts.";
const NO_BRANCH = "Finance keeps no branches. Its closest split is the academy (Dubai or Bangalore).";
const NO_BRAND = "Finance keeps no brands.";
const NO_KIND = "Finance does not mark an invoice as an admission, an upgrade or a workshop.";
const NO_REFUNDS = "Finance records no refunds, chargebacks or reversals of a payment.";
const NO_COST_SPLIT = "Finance does not mark a cost as fixed or variable, or as direct or shared.";

const invoiced = (groupBy: GroupBy, chart: "bar" | "line", period: "month" | "year" = "month", columns?: Column[]): LiveSpec =>
  ({ kind: "revenue", basis: "invoiced", groupBy, chart, period, ...(columns ? { columns } : {}) });
const collected = (groupBy: GroupBy, chart: "bar" | "line", period: "month" | "year" = "month", columns?: Column[]): LiveSpec =>
  ({ kind: "revenue", basis: "collected", groupBy, chart, period, ...(columns ? { columns } : {}) });

const spent = (groupBy: ExpenseGroupBy, chart: "bar" | "line", period: "month" | "year" = "month", extra: { columns?: Column[]; only?: Record<string, string> } = {}): LiveSpec =>
  ({ kind: "expenses", groupBy, chart, period, ...extra });

const owed = (side: "receivables" | "payables", groupBy: "band" | "party", view: "summary" | "records", due?: "upcoming" | "overdue"): LiveSpec =>
  ({ kind: "aging", side, groupBy, view, ...(due ? { due } : {}) });

const listed = (source: "commission" | "payroll", groupBy: string, view: "summary" | "records", period: "month" | "year" = "month", extra: { params?: Record<string, string>; only?: Record<string, string> } = {}): LiveSpec =>
  ({ kind: "ledger", source, groupBy, view, period, ...extra });
const NOT_IN_FINANCE = "This is worked out in the CRMs and Root before finance approves anything, so finance has no record of it.";

export const CATEGORIES: Category[] = [
  {
    slug: "overview",
    name: "Finance overview",
    reports: [
      live("OVR-01", "Financial KPI dashboard", { kind: "overview" }, "The headline figures for the period, each beside the period before."),
      planned("OVR-02", "Financial health"),
      none("OVR-03", "Data quality", "Finance records no data-quality checks to report on."),
      planned("OVR-04", "Reconciliation summary"),
    ],
  },
  {
    slug: "revenue",
    name: "Revenue analysis",
    reports: [
      live("REV-01", "Daily revenue", invoiced("day", "line"), "Invoices issued each day, less the credit notes issued that day."),
      live("REV-02", "Monthly revenue", invoiced("month", "bar", "year", ["collected", "owed"]), "Invoices issued each month, less credit notes — with what has been collected on them and what is still owed."),
      live("REV-03", "Annual revenue", invoiced("month", "bar", "year"), "A whole year's invoiced revenue, month by month, with the year's total."),
      live("REV-04", "Course revenue", invoiced("course", "bar", "month", ["collected", "owed"]), "Invoiced revenue by course or product."),
      live("REV-05", "Department revenue", invoiced("department", "bar", "month", ["collected", "owed"]), "Invoiced revenue by the department of the salesperson on the invoice."),
      live("REV-06", "Branch revenue", invoiced("academy", "bar", "month", ["collected", "owed"]), "Invoiced revenue by academy — Dubai or Bangalore. Finance keeps the academy, not branches."),
      live("REV-07", "Legal entity revenue", { kind: "entities", basis: "invoiced" }, "Each finance organization's invoiced revenue, in its own currency. Two currencies are never added together."),
      none("REV-08", "Brand revenue", NO_BRAND),
      live("REV-09", "Employee attribution", invoiced("salesperson", "bar", "month", ["collected", "owed"]), "Invoiced revenue by the salesperson on the invoice."),
      none("REV-10", "New admissions", NO_KIND),
      none("REV-11", "Upgrades", NO_KIND),
      none("REV-12", "Workshops", NO_KIND),
      none("REV-13", "Other income", NO_KIND),
      live("REV-14", "Gross vs net invoiced sales", invoiced("month", "bar", "year"), "Invoices before credit notes, the credit notes, and what is left — the totals above the table, the net month by month."),
      none("REV-15", "Revenue recognition", NO_RECOGNITION),
      none("REV-16", "Deferred revenue schedule", NO_RECOGNITION),
      live("REV-17", "Growth", invoiced("month", "line", "year", ["change"]), "Invoiced revenue month by month, and how each month moved against the one before."),
      none("REV-18", "Target variance", NO_TARGETS),
      planned("REV-19", "Revenue adjustments", "Finance holds the credit notes. A report of them on their own has not been connected yet."),
      live("REV-20", "Average transaction value", invoiced("month", "line", "year", ["average"]), "Invoiced revenue divided by the number of invoices, month by month."),
    ],
  },
  {
    slug: "collections",
    name: "Collections",
    reports: [
      live("COL-01", "Daily collections", collected("day", "line"), "Payments received each day, by the day they were paid."),
      live("COL-02", "Monthly collections", collected("month", "bar", "year"), "Payments received each month."),
      live("COL-03", "By payment method", collected("method", "bar"), "Payments received by method — cash, bank transfer, card, POS, Tabby, Tamara and the rest."),
      live("COL-04", "By bank account", collected("bank", "bar"), "Payments received by the account each was recorded into."),
      none("COL-05", "By POS terminal", "Finance records POS as a payment method only. It keeps no terminals."),
      live("COL-06", "By gateway", collected("method", "bar"), "Finance records a gateway as the payment's method, so this is the same split as by payment method."),
      live("COL-07", "By department", collected("department", "bar"), "Payments received by the department of the salesperson on the invoice."),
      live("COL-08", "By employee", collected("salesperson", "bar"), "Payments received by the salesperson on the invoice."),
      live("COL-09", "By course", collected("course", "bar"), "Payments received by course or product."),
      live("COL-10", "Full vs partial", collected("status", "bar"), "Payments received, split by whether their invoice is now paid in full or part paid."),
      planned("COL-11", "Installments"),
      none("COL-12", "Advances", "Finance records a payment against an invoice only, never as an advance held for later."),
      none("COL-13", "Refunds and chargebacks", NO_REFUNDS),
      none("COL-14", "Unallocated receipts", "Every payment in finance sits on an invoice, so none is unallocated."),
      none("COL-15", "Target achievement", NO_TARGETS),
      planned("COL-16", "Expected collections"),
      live("COL-17", "Collection efficiency", invoiced("month", "line", "year", ["collected", "efficiency"]), "Of the invoices issued each month, how much has been collected so far."),
      none("COL-18", "Reversals", NO_REFUNDS),
    ],
  },
  {
    slug: "statements",
    name: "Financial statements",
    reports: [
      planned("FS-01", "Profit and loss", "Finance works this out from invoices, bills and expenses, not from a ledger. It has not been connected yet."),
      none("FS-02", "Balance sheet", NO_LEDGER),
      planned("FS-03", "Cash flow", "Finance can give money in and money out from operations only. It has not been connected yet."),
      none("FS-04", "Trial balance", NO_LEDGER),
      none("FS-05", "General ledger", NO_LEDGER),
      none("FS-06", "Account ledger", NO_LEDGER),
      none("FS-07", "Journal register", NO_LEDGER),
      none("FS-08", "Changes in equity", NO_LEDGER),
      planned("FS-09", "Comparative statements", "Profit and loss beside the period before. It has not been connected yet."),
      none("FS-10", "Consolidated statements", "The organizations keep their books in different currencies, and finance never adds them together."),
      planned("FS-11", "Opening and closing balances", "Finance has these for bank accounts only. It has not been connected yet."),
    ],
  },
  {
    slug: "receivables",
    name: "Receivables",
    reports: [
      live("AR-01", "Total outstanding", owed("receivables", "band", "summary"), "What is still owed on open invoices, as of today, by how late it is."),
      live("AR-02", "Aging", owed("receivables", "band", "summary"), "Open invoices by age: not yet due, 1–30, 31–60, 61–90 and over 90 days late. The same split as Total outstanding."),
      live("AR-03", "Student balances", owed("receivables", "party", "summary"), "What each student still owes, and how much of it is past due."),
      live("AR-04", "Invoice balances", owed("receivables", "band", "records"), "Every open invoice: its total, what is left on it, when it was due and how late it is."),
      live("AR-05", "Upcoming installments", owed("receivables", "band", "records", "upcoming"), "Open invoices not yet due, soonest first. Finance keeps no instalment schedule, so this goes by each invoice's own due date."),
      live("AR-06", "Overdue installments", owed("receivables", "band", "records", "overdue"), "Open invoices past their due date. Finance keeps no instalment schedule, so this goes by each invoice's own due date."),
      planned("AR-07", "By salesperson"),
      planned("AR-08", "By CSE"),
      planned("AR-09", "Student credits"),
      none("AR-10", "Bad debt and impairment", "Finance writes nothing off, so there is no bad debt to list."),
      none("AR-11", "Disputes", "Finance does not mark a balance as disputed."),
      planned("AR-12", "Expected collections"),
    ],
  },
  {
    slug: "payables",
    name: "Payables",
    reports: [
      live("AP-01", "Total outstanding", owed("payables", "band", "summary"), "What is still owed on open supplier bills, as of today, by how late it is."),
      live("AP-02", "Vendor aging", owed("payables", "party", "summary"), "What is owed to each vendor, and how much of it is past due."),
      planned("AP-03", "Vendor statement"),
      live("AP-04", "Upcoming payments", owed("payables", "band", "records", "upcoming"), "Open bills not yet due, soonest first."),
      live("AP-05", "Overdue payments", owed("payables", "band", "records", "overdue"), "Open bills past their due date."),
      live("AP-06", "Unpaid bills", owed("payables", "band", "records"), "Every open bill: its total, what is left on it, when it is due and how late it is."),
      planned("AP-07", "Salary payable"),
      planned("AP-08", "Commission payable"),
      planned("AP-09", "Tax payable"),
      none("AP-10", "Accrued expenses", NO_LEDGER),
      planned("AP-11", "Vendor advances"),
      none("AP-12", "Payment forecast", NO_FORECAST),
    ],
  },
  {
    slug: "expenses",
    name: "Expenses",
    reports: [
      live("EXP-01", "Daily expenses", spent("day", "line"), "Expenses each day."),
      live("EXP-02", "Monthly expenses", spent("month", "bar", "year"), "Expenses each month."),
      live("EXP-03", "By category", spent("category", "bar"), "Expenses by category, each with its subcategories."),
      live("EXP-04", "By department", spent("department", "bar"), "Expenses by the department each was recorded against."),
      none("EXP-05", "By branch", NO_BRANCH),
      planned("EXP-06", "By cost center"),
      planned("EXP-07", "By vendor"),
      none("EXP-08", "Fixed vs variable", NO_COST_SPLIT),
      planned("EXP-09", "Recurring"),
      live("EXP-10", "Reimbursements", spent("employee", "bar", "month", { only: { source: "hrms_reimbursement" } }), "Reimbursements claimed in the HRMS and paid through finance, by employee."),
      planned("EXP-11", "Petty cash"),
      planned("EXP-12", "Budget variance"),
      live("EXP-13", "Growth", spent("month", "line", "year", { columns: ["change"] }), "Expenses month by month, and how each month moved against the one before."),
      none("EXP-14", "Unusual expenses", "Finance has no rule for what counts as unusual."),
      live("EXP-15", "Approvals", spent("status", "bar"), "Expenses approved against those still waiting for approval. Finance's report does not say who approved each."),
      none("EXP-16", "Prepayments", NO_LEDGER),
      none("EXP-17", "Depreciation and amortization", NO_LEDGER),
    ],
  },
  {
    slug: "profitability",
    name: "Profitability",
    reports: [
      planned("PRF-01", "Company"),
      planned("PRF-02", "By department"),
      none("PRF-03", "By course", "Finance does not record what a course costs to run."),
      none("PRF-04", "By branch", NO_BRANCH),
      none("PRF-05", "By brand", NO_BRAND),
      none("PRF-06", "By revenue stream", "Finance does not record costs against a revenue stream."),
      planned("PRF-07", "Employee contribution"),
      none("PRF-08", "Gross margin", NO_COST_SPLIT),
      planned("PRF-09", "Operating margin"),
      planned("PRF-10", "Net margin"),
      none("PRF-11", "Break-even", NO_COST_SPLIT),
      none("PRF-12", "Contribution margin", NO_COST_SPLIT),
      planned("PRF-13", "Trend"),
    ],
  },
  {
    slug: "treasury",
    name: "Cash flow and treasury",
    reports: [
      planned("TRE-01", "Daily cash position"),
      planned("TRE-02", "Bank balances"),
      planned("TRE-03", "Physical cash"),
      planned("TRE-04", "Inflows and outflows"),
      planned("TRE-05", "Internal transfers"),
      none("TRE-06", "POS settlements", "Finance keeps no POS terminals or their settlement batches."),
      planned("TRE-07", "PSP settlements"),
      none("TRE-08", "Restricted cash", "Finance does not mark cash as restricted."),
      none("TRE-09", "Commitments", NO_FORECAST),
      none("TRE-10", "7-day forecast", NO_FORECAST),
      none("TRE-11", "30-day forecast", NO_FORECAST),
      none("TRE-12", "90-day forecast", NO_FORECAST),
      none("TRE-13", "Cash runway", NO_FORECAST),
      planned("TRE-14", "Bank transaction history"),
    ],
  },
  {
    slug: "budget",
    name: "Budget and forecast",
    reports: [
      planned("BUD-01", "Company budget"),
      planned("BUD-02", "Department budget"),
      planned("BUD-03", "Expense budget"),
      none("BUD-04", "Revenue target variance", NO_TARGETS),
      planned("BUD-05", "Utilization"),
      planned("BUD-06", "Overspending"),
      none("BUD-07", "Revenue forecast", NO_FORECAST),
      none("BUD-08", "Expense forecast", NO_FORECAST),
      none("BUD-09", "Profit forecast", NO_FORECAST),
      none("BUD-10", "Cash forecast", NO_FORECAST),
    ],
  },
  {
    slug: "payroll",
    name: "Commission and payroll",
    reports: [
      none("COM-01", "Estimated commission", NOT_IN_FINANCE),
      none("COM-02", "Pending eligibility", NOT_IN_FINANCE),
      none("COM-03", "Eligible", NOT_IN_FINANCE),
      none("COM-04", "Accrued expense", NO_LEDGER),
      live("COM-05", "Approved", listed("commission", "month", "summary", "year"), "Commission finance approved, by the month it is for: the sales CRMs' payouts and CS Portal's, paid or not."),
      live("COM-06", "Paid", listed("commission", "person", "records", "month", { params: { when: "paid" }, only: { state: "Paid" } }), "Commission paid in the period, by the day it was paid, with how and under which expense."),
      live("COM-07", "Payable", listed("commission", "person", "records", "year", { only: { state: "Approved, not paid" } }), "Commission approved but not yet paid."),
      none("COM-08", "Reversed", "Finance keeps no record of a commission taken back."),
      planned("COM-09", "By department", "A commission payout carries the CRM and the person's roles, not a department. It needs a rule for which department each belongs to."),
      live("COM-10", "By employee", listed("commission", "person", "summary"), "Each person's commission for the period: approved, paid and still to pay."),
      planned("COM-11", "Commission ratio"),
      live("PAY-01", "Payroll summary", listed("payroll", "month", "summary", "year"), "Each month's payroll: gross, deductions, net from the HRMS, finance's additions and deductions, what is payable, paid and left."),
      live("PAY-02", "Department cost", listed("payroll", "department", "summary"), "Payroll by department."),
      live("PAY-03", "Salary payable", listed("payroll", "person", "records", "month", { params: { due: "1" } }), "The people still owed part of their pay."),
      live("PAY-04", "Payment history", listed("payroll", "month", "records", "month", { params: { kind: "payments" } }), "Each payroll payment made: when, how, from which account. Reversed payments are left out."),
      live("PAY-05", "Total employee cost", listed("payroll", "person", "summary"), "What each person is paid: gross, deductions, additions and what is payable."),
    ],
  },
  {
    slug: "tax",
    name: "VAT and tax",
    reports: [
      planned("TAX-01", "VAT summary"),
      planned("TAX-02", "Output VAT"),
      planned("TAX-03", "Input VAT"),
      planned("TAX-04", "Net VAT"),
      planned("TAX-05", "Tax invoices"),
      planned("TAX-06", "Credit notes"),
      none("TAX-07", "Adjustments", "Finance records no VAT adjustments apart from credit notes."),
      none("TAX-08", "VAT reconciliation", NO_LEDGER),
      planned("TAX-09", "VAT return working"),
      planned("TAX-10", "Exempt and zero-rated"),
      none("TAX-11", "Reverse charge", "Finance records no reverse-charge VAT."),
      none("TAX-12", "Corporate tax working", NO_LEDGER),
    ],
  },
];

export const ALL_REPORTS: (Report & { category: Category })[] = CATEGORIES.flatMap((category) =>
  category.reports.map((r) => ({ ...r, category })),
);

/** A report by its ID, however it was typed in the address — "rev-04" finds REV-04. */
export const reportById = (id: string) => ALL_REPORTS.find((r) => r.id.toLowerCase() === id.toLowerCase()) ?? null;

export const hrefOf = (r: Report) => `/report-org/finance/${r.id.toLowerCase()}`;

export const COUNTS = {
  all: ALL_REPORTS.length,
  live: ALL_REPORTS.filter((r) => r.state === "live").length,
  planned: ALL_REPORTS.filter((r) => r.state === "planned").length,
  none: ALL_REPORTS.filter((r) => r.state === "none").length,
};

export const STATE_LABEL: Record<Report["state"], string> = { live: "Live", planned: "Not connected yet", none: "Not available" };
