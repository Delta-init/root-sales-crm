import { Organization } from "../models/Organization.js";
import { resolveTarget, callTarget } from "../lib/targetClient.js";
import { targetConfig } from "../config/targets.js";

/*
 * Reports → Finance (the user, 2026-10-17): one finance organization over a
 * period, in its own currency — expenses, approvals decided, invoices,
 * budget allocation (commission later) — as finance counts them
 * (GET /service/finance-report). The period goes as the picker's instants;
 * none is all time. Read-only.
 */
const httpError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

export async function financeReport(q: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const from = str(q.from), to = str(q.to), org = str(q.org);
  for (const v of [from, to]) if (v && !Number.isFinite(Date.parse(v))) throw httpError("from / to must be dates", 400);
  if (org && !/^[0-9a-f]{24}$/i.test(org)) throw httpError("Not an organization", 400);
  const portal = await Organization.findOne({ isActive: true, $or: [{ kind: "finance" }, { code: /^finance/ }] }).select("code name").sort({ sortOrder: 1 }).lean();
  if (!portal) throw httpError("Finance is not set up in Root", 404);
  const target = await resolveTarget(portal.code);
  const params = new URLSearchParams();
  if (from) params.set("from", new Date(from).toISOString());
  if (to) params.set("to", new Date(to).toISOString());
  if (org) params.set("org", org);
  try {
    const data = await callTarget<Record<string, unknown>>(target, `/finance-report?${params}`, { method: "GET", verb: "share its report" });
    // Where finance's pages are, for the links ("" when its address is not set).
    return { ...data, appUrl: targetConfig(portal.code).appUrl.replace(/\/+$/, "") };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not be read";
    if (/404|not found/i.test(message)) throw httpError("Finance's server needs updating — it has no finance report yet", 409);
    throw error;
  }
}
