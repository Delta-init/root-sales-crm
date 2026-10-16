import type { Response, NextFunction } from "express";
import { pendingOverview } from "../services/pendingService.js";
import { enrolmentFlow } from "../services/enrolmentFlowService.js";
import { csPending } from "../services/cseService.js";
import { sendSuccess, sendError } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

/** Every portal's pending counts, and who they are waiting on. */
export const overview = async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Pending", await pendingOverview());
  } catch (error) {
    next(error);
  }
};

/** Every sales CRM's enrolment workflow: where each unfinished close stands, and whom it waits on. */
export const enrolments = async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Enrolment workflow", await enrolmentFlow());
  } catch (error) {
    next(error);
  }
};

/** What waits on each Tetra Commission CS, and which students (Pending → CS portal). */
export const cs = async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "CS pending", await csPending());
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
};
