import type { Request, Response, NextFunction } from "express";
import { sendSuccess, sendError } from "../utils/response.js";
import { crmCommission, validMonth } from "../services/crmCommissionService.js";

/* GET /service/crm-commission?month=YYYY-MM — finance asking each sales CRM's counted commission (2026-10-21). */
export const crmCommissionForFinance = async (req: Request, res: Response, next: NextFunction) => {
  const month = req.query.month;
  if (!validMonth(month)) {
    sendError(res, "month is required as YYYY-MM", 400);
    return;
  }
  try {
    sendSuccess(res, "CRM commission", await crmCommission(month));
  } catch (error) {
    next(error);
  }
};
