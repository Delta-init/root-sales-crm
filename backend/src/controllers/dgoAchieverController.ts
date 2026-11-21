import type { Request, Response, NextFunction } from "express";
import { sendSuccess, sendError } from "../utils/response.js";
import { achieverMetrics, dubaiMonthNow, validAchieverMonth } from "../services/dgoAchieverMetricsService.js";

/*
 * GET /service/dgo/achiever-metrics?month=YYYY-MM — HRMS asking one month's figures per person for DGO Points' monthly
 * achievers (2026-11-21). HRMS proves itself with the secret Root shares with it (HRMS_SSO_SECRET, its
 * ROOT_ERP_SECRET). Read-only.
 */
export const dgoAchieverMetrics = async (req: Request, res: Response, next: NextFunction) => {
  const month = req.query.month;
  if (typeof month !== "string" || !/^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(month)) {
    sendError(res, "month is required as YYYY-MM", 400);
    return;
  }
  if (!validAchieverMonth(month)) {
    sendError(res, `${month} hasn't started — this month is ${dubaiMonthNow()}`, 400);
    return;
  }
  try {
    sendSuccess(res, "Achiever metrics", await achieverMetrics(month));
  } catch (error) {
    next(error);
  }
};
