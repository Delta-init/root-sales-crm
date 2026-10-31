import type { Response, NextFunction } from "express";
import { z } from "zod";
import { engineInputs, planForCrm } from "../services/commissionPlanService.js";
import { payRows, resolveSale, slabsOfMonth } from "../services/commissionEngine.js";
import { validMonth } from "../services/crmCommissionService.js";
import { sendSuccess, sendError } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

/*
 * A sales CRM asking Root for its commission figures (2026-11-01, stage 2; the CRMs are switched to these in stage
 * 3). The CRM is the one whose secret matched (x-org-secret) — never anything it sends — so it only ever gets its own.
 */

const failed = (res: Response, next: NextFunction, error: unknown) => {
  const status = (error as { statusCode?: number }).statusCode;
  if (status) sendError(res, (error as Error).message, status);
  else next(error);
};

/* GET /service/commission/plan?month= — the CRM's plan as kept in Root, with that month's slabs. */
export const plan = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const month = req.query.month;
  if (!validMonth(month)) {
    sendError(res, "month is required as YYYY-MM", 400);
    return;
  }
  try {
    sendSuccess(res, "Commission plan", await planForCrm(req.serviceOrg!.code, month));
  } catch (error) {
    failed(res, next, error);
  }
};

const idish = z.string().max(64).nullable().optional();
const amount = z.number().min(0).max(1_000_000);
const resolveSchema = z.object({
  closer: idish, team: idish, course: idish,
  courses: z.array(z.string().max(64)).max(20).nullable().optional(),
  // A held sale is settled at the amounts it was held at, not the course's row now.
  amounts: z.object({ sales: amount, tl: amount, sm: amount, creditUsd: amount.optional() }).nullable().optional(),
});

/* POST /service/commission/resolve — who earns what on one sale, under Root's plan. Nothing is written. */
export const resolve = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, parsed.error.issues[0]?.message ?? "Invalid input", 400);
    return;
  }
  try {
    const { plan: p, src } = await engineInputs(req.serviceOrg!.code);
    sendSuccess(res, "Commission resolved", await resolveSale(src.conn, p, parsed.data));
  } catch (error) {
    failed(res, next, error);
  }
};

/* GET /service/commission/pay?month= — the CRM's My Pay for a month, worked out by Root. */
export const pay = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const month = req.query.month;
  if (!validMonth(month)) {
    sendError(res, "month is required as YYYY-MM", 400);
    return;
  }
  try {
    const { plan: p, src } = await engineInputs(req.serviceOrg!.code);
    const { from, slabs } = slabsOfMonth(p, month);
    sendSuccess(res, "Pay", { month, slabsFrom: from, slabs, people: await payRows(src.conn, p, month) });
  } catch (error) {
    failed(res, next, error);
  }
};
