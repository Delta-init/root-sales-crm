import type { Response, NextFunction } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../types/index.js";
import { sendSuccess, sendError } from "../utils/response.js";
import { listSalespeople, getSalesperson, salespersonBreakdown, salespersonLeads, type Period } from "../services/salespersonService.js";

/*
 * Salespeople, root admins only. The period is cut in Gulf time (UTC+4): a
 * bare date is that whole Gulf day — ?from=2026-10-01&to=2026-10-31 is October
 * as Dubai lives it — and a full timestamp is taken as given (the page's
 * presets send those). Neither: all time.
 */
const GST = "+04:00";
const query = z.object({ from: z.string().optional(), to: z.string().optional(), status: z.string().max(40).optional() });
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function periodOf(q: unknown): Period | { error: string } {
  const parsed = query.safeParse(q);
  if (!parsed.success) return { error: "Invalid query parameters" };
  const { from, to } = parsed.data;
  const f = from ? new Date(DAY.test(from) ? `${from}T00:00:00.000${GST}` : from) : undefined;
  const t = to ? new Date(DAY.test(to) ? `${to}T23:59:59.999${GST}` : to) : undefined;
  if (f && Number.isNaN(f.getTime())) return { error: `Invalid 'from' date: ${from}` };
  if (t && Number.isNaN(t.getTime())) return { error: `Invalid 'to' date: ${to}` };
  if (f && t && f > t) return { error: "'from' is after 'to'" };
  return { from: f, to: t };
}

const run = (fn: (req: AuthenticatedRequest, period: Period) => Promise<unknown>, message: string) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const period = periodOf(req.query);
    if ("error" in period) return sendError(res, period.error, 400);
    try {
      sendSuccess(res, message, await fn(req, period));
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status) return sendError(res, (error as Error).message, status);
      next(error);
    }
  };

export const list = run((_req, period) => listSalespeople(period), "Salespeople");
export const detail = run((req, period) => getSalesperson(String(req.params.code), String(req.params.userId), period), "Salesperson");
export const leads = run(
  (req, period) => salespersonLeads(String(req.params.code), String(req.params.userId), String(req.query.status ?? ""), period),
  "Salesperson's leads",
);

/** GET /salespeople/:code/:userId/breakdown/:kind — what one stat card is made of (leads, followups, pending). */
export const breakdown = run(
  (req, period) => salespersonBreakdown(String(req.params.code), String(req.params.userId), String(req.params.kind), period),
  "Breakdown",
);
