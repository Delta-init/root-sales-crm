import type { Response, NextFunction } from "express";
import { commissionPlans } from "../services/commissionPlanService.js";
import { sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

/** Every sales CRM's commission plan, read only. */
export const plans = async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Commission plans", await commissionPlans());
  } catch (error) {
    next(error);
  }
};
