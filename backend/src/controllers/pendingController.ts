import type { Response, NextFunction } from "express";
import { pendingOverview } from "../services/pendingService.js";
import { enrolmentFlow } from "../services/enrolmentFlowService.js";
import { csPending } from "../services/cseService.js";
import { salesPortals, salesPending, financeWatch, hrmsWatch, mediaWatch } from "../services/salesPendingService.js";
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

/** A route that answers a service's result, or its error with the status it carries. */
const answer = (message: string, fn: (req: AuthenticatedRequest) => Promise<unknown>) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      sendSuccess(res, message, await fn(req));
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status) return sendError(res, (error as Error).message, status);
      next(error);
    }
  };

/** The sales CRMs, for the Sales tab's own tabs. */
export const salesList = answer("Sales CRMs", async (req) => {
  const all = await salesPortals();
  // Somebody given only some sales CRMs (2026-10-24) gets their tabs, not the rest.
  if (req.admin?.role === "root_admin") return all;
  const mine = new Set(req.admin?.pendingAccess ?? []);
  return all.filter((p) => mine.has(`sales:${p.code}` as never));
});
/** One sales CRM: inactive leads, overdue reminders, not connected, lost (with reasons) and calls, per salesperson. */
export const sales = answer("Sales pending", (req) => salesPending(String(req.params.code), req.query));
/** Finance: approvals waiting (30 minutes = delayed) and entries typed with an old date. */
export const finance = answer("Finance pending", () => financeWatch());
/** HRMS: what waits, with departments, and who is on leave today. */
export const hrms = answer("HRMS pending", () => hrmsWatch());
/** Media ERP: Media Schedule, tasks and the Leader Desk. */
export const media = answer("Media ERP pending", () => mediaWatch());

