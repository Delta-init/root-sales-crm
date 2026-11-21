import type { Request, Response, NextFunction } from "express";
import { sendSuccess, sendError } from "../utils/response.js";
import { dubaiToday, kpiFacts, validKpiDate } from "../services/dgoKpiFactsService.js";

/*
 * GET /service/dgo/kpi-facts?date=YYYY-MM-DD — HRMS asking one Dubai day of the daily tracker per salesperson, and
 * that day's five-star LMS reviews, for DGO Points' automatic KPI points and its review suggestions (2026-11-21).
 * HRMS proves itself with the secret Root shares with it (HRMS_SSO_SECRET, its ROOT_ERP_SECRET). Read-only.
 */
export const dgoKpiFacts = async (req: Request, res: Response, next: NextFunction) => {
  const date = req.query.date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    sendError(res, "date is required as YYYY-MM-DD", 400);
    return;
  }
  if (!validKpiDate(date)) {
    sendError(res, date > dubaiToday() ? `${date} hasn't happened yet — today is ${dubaiToday()} in Dubai` : `${date} isn't a real day`, 400);
    return;
  }
  try {
    sendSuccess(res, "KPI facts", await kpiFacts(date));
  } catch (error) {
    next(error);
  }
};
