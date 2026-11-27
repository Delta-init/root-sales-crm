import { Organization } from "../models/Organization.js";
import { resolveTarget, callTarget } from "../lib/targetClient.js";
import { targetConfig } from "../config/targets.js";

/*
 * Report Org → Finance and revenue (the user, 2026-11-26: "first I need report finance and revenue").
 *
 * Root works nothing out here. Each call is finance's own answer (GET /service/reports/…), which finance builds from
 * the functions its own pages use — so a figure in the Report Org is the figure on finance's screen. One finance
 * organization per call, in its own currency: Root never adds two together. Read-only.
 */
const httpError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

/** The Revenue report's dimensions — what it can be grouped by, and kept to. */
const DIMENSIONS = ["salesperson", "department", "course", "customer", "crm", "academy", "method", "bank", "status", "month"] as const;

/** The Expense report's. */
const EXPENSE_DIMENSIONS = ["category", "subcategory", "employee", "submittedBy", "department", "method", "bank", "source", "status", "paid", "month"] as const;

/** A table's page of rows: how many, from where, sorted by which column and which way, and the words searched for. */
const PAGING = ["limit", "offset", "sort", "dir", "q"] as const;

/** Only what finance's route reads is passed on, as short strings — nothing else from the browser reaches it. */
function passOn(q: Record<string, unknown>, keys: readonly string[]): string {
  const params = new URLSearchParams();
  for (const key of keys) {
    // One value, or several of the same filter (a table's multi-select): each is passed on under the same name.
    const v = q[key];
    for (const one of (Array.isArray(v) ? v : [v]).slice(0, 50)) {
      if (typeof one === "string" && one.trim()) params.append(key, one.trim().slice(0, 200));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Finance's answer to one question, and where finance's own pages are (for the links to an invoice; "" when not set). */
async function ask<T>(path: string, verb: string): Promise<{ data: T; appUrl: string }> {
  const portal = await Organization.findOne({ isActive: true, $or: [{ kind: "finance" }, { code: /^finance/ }] }).select("code name").sort({ sortOrder: 1 }).lean();
  if (!portal) throw httpError("Finance is not set up in Root", 404);
  const target = await resolveTarget(portal.code);
  try {
    const data = await callTarget<T>(target, path, { method: "GET", verb });
    return { data, appUrl: targetConfig(portal.code).appUrl.replace(/\/+$/, "") };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not be read";
    if (/404|not found/i.test(message)) throw httpError("Finance's server needs updating — it does not have the Report Org's reports yet", 409);
    throw error;
  }
}

/** Finance's organizations, each with its currency — the Report Org's legal entities. */
export async function financeOrganizations() {
  const { data, appUrl } = await ask<unknown[]>("/reports/organizations", "list its organizations");
  return { organizations: Array.isArray(data) ? data : [], appUrl };
}

/** One organization's headline figures for a period, each beside the period before. */
export async function financeOverview(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/overview${passOn(q, ["org", "from", "to", "crm"])}`, "share its overview");
  return { ...data, appUrl };
}

/** The Revenue report: invoiced or collected, grouped by a dimension (or by day) and kept to any of them. */
export async function financeRevenue(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/revenue${passOn(q, ["org", "from", "to", "basis", "groupBy", "paidIn", ...PAGING, ...DIMENSIONS])}`, "share its revenue report");
  return { ...data, appUrl };
}

/**
 * The Expense report: approved expenses and those waiting for approval, by expense date or the day paid, grouped by a
 * dimension (or by day) and kept to any of them. Profit-and-loss expenses only unless pnl=0; one currency at a time.
 */
export async function financeExpenses(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/expenses${passOn(q, ["org", "from", "to", "basis", "groupBy", "pnl", "currency", ...PAGING, ...EXPENSE_DIMENSIONS])}`, "share its expense report");
  return { ...data, appUrl };
}

/**
 * What is still owed on open invoices (kind=receivables) or open bills (kind=payables), as of now: by how late, or by
 * student or vendor, with every open one as a row. Finance keeps no balances as of a past date, so there is no period.
 */
export async function financeAging(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/aging${passOn(q, ["org", "kind", "due", "groupBy", "crm", "party", "band", "salesperson", "department", ...PAGING])}`, "share what is still owed");
  return { ...data, appUrl };
}

/** Commission finance approved and paid — the sales CRMs' monthly payouts and CS Portal's — by the month it is for, or by the day paid. */
export async function financeCommission(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/commission${passOn(q, ["org", "from", "to", "when", "groupBy", "source", "person", "state", "kind", "method", "month", ...PAGING])}`, "share its commission report");
  return { ...data, appUrl };
}

/** Payroll runs: a row per person per run, or per payment made. Finance sends nobody's bank details. */
export async function financePayroll(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/payroll${passOn(q, ["org", "from", "to", "kind", "due", "groupBy", "month", "department", "person", "status", "runState", "method", "bank", ...PAGING])}`, "share its payroll report");
  return { ...data, appUrl };
}

/** The rows behind the VAT position (kind=output|input) and the income in "Income less expenses" (kind=income). */
export async function financeVat(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/vat${passOn(q, ["org", "from", "to", "kind", "groupBy", "crm", "salesperson", "month", "status", "vendor", ...PAGING])}`, "share its VAT report");
  return { ...data, appUrl };
}


/** Profit & Loss: the statement with the period before (view=statement) or month by month (view=months), either basis. */
/** The records behind one Profit & Loss line (?line=income | bills | expenses | cat:<category>, ?basis=). */
export async function financePlLines(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/pl-lines${passOn(q, ["org", "from", "to", "basis", "line", "groupBy", "crm", "salesperson", "method", "month", "category", "subcategory", "department", ...PAGING])}`, "share the records behind a profit and loss line");
  return { ...data, appUrl };
}

export async function financePl(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/pl${passOn(q, ["org", "from", "to", "basis", "view"])}`, "share its profit and loss");
  return { ...data, appUrl };
}

/** Management profitability (Phase 3, 2026-11-27): ?view=invoice | collection | cash — figures per currency, month by month. */
export async function financeManagementProfit(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/management-profit${passOn(q, ["org", "from", "to", "view"])}`, "share its management profitability");
  return { ...data, appUrl };
}

/** The records behind one management profitability figure (?line=income | payroll | commission | supplier | other | expenses). */
export async function financeManagementLines(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/management-profit-lines${passOn(q, ["org", "from", "to", "view", "line", "groupBy", "category", "status", "crm", "method", "month", ...PAGING])}`, "share the records behind a management profitability figure");
  return { ...data, appUrl };
}

/** Cash flow and financial position (Phase 4, 2026-11-27): ?report=cashflow | cash | receivables | obligations | advances | position. */
export async function financeFinancial(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/financial${passOn(q, ["org", "from", "to", "report"])}`, "share its cash flow and financial position");
  return { ...data, appUrl };
}

/** The records behind one of its figures (?line=<section>:<line> | <section> | all). */
export async function financeFinancialLines(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/financial-lines${passOn(q, ["org", "from", "to", "report", "line", "groupBy", "category", "account", "status", "month", "kind", "band", "crm", ...PAGING])}`, "share the records behind a cash flow or financial position figure");
  return { ...data, appUrl };
}

/** Reconciliation and data integrity (Phase 5, 2026-11-27): ?report=bank | psp | invoices | expenses | payroll | advances | historical | exceptions | summary. */
export async function financeReconciliation(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/reconciliation${passOn(q, ["org", "from", "to", "report"])}`, "share its reconciliation reports");
  return { ...data, appUrl };
}

/** The records behind one reconciliation figure (?line=<section>:<line> | <section> | all). */
export async function financeReconciliationLines(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/reconciliation-lines${passOn(q, ["org", "from", "to", "report", "line", "groupBy", "category", "severityName", "status", "module", "account", "month", ...PAGING])}`, "share the records behind a reconciliation figure");
  return { ...data, appUrl };
}

/** Financial controls (Phase 6, 2026-11-28): ?report=overview | approvals | risks | liquidity | expenses | payroll | vat | closing | audit. */
export async function financeControls(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/controls${passOn(q, ["org", "from", "to", "report"])}`, "share its financial controls");
  return { ...data, appUrl };
}

/** The records behind one financial-controls figure (?line=<section>:<line> | <section> | all). */
export async function financeControlsLines(q: Record<string, unknown>) {
  const { data, appUrl } = await ask<Record<string, unknown>>(`/reports/controls-lines${passOn(q, ["org", "from", "to", "report", "line", "groupBy", "category", "status", "severityName", "module", "account", "stage", "month", ...PAGING])}`, "share the records behind a financial-controls figure");
  return { ...data, appUrl };
}
