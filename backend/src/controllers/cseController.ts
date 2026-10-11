import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { sendSuccess, sendError } from "../utils/response.js";
import { periodOf } from "./salespersonController.js";
import { listCses, getCse } from "../services/cseService.js";
import type { Period } from "../services/salespersonService.js";

/* CSEs, root admins only; the period in Gulf time, as on Salespeople. */
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

export const list = run((_req, period) => listCses(period), "CSEs");
export const detail = run((req, period) => getCse(String(req.params.userId), period), "CSE");
