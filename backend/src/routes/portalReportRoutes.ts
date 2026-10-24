import { Router, type Response, type NextFunction } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { csReport, csStudentWorkflow, csStudentWorkflowStudents, mentorReport, mentorReviews } from "../services/cseService.js";
import { salesLeadWorkflow, salesLeadWorkflowLeads, salesReport } from "../services/salesReportService.js";
import { financeReport } from "../services/financeReportService.js";
import { hrmsReport } from "../services/hrmsReportService.js";
import { sendSuccess, sendError } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

/*
 * Reports, a tab per portal (the user, 2026-10-17: "same as the pending page,
 * each portal its own tab") — what got done in a period, where Pending is what
 * waits now. Root admins only, like Pending. The CS portal's first.
 */
const router = Router();
router.use(authenticate, requireRole("root_admin"));

router.get("/cs", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "CS report", await csReport(req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

/* The CS portal's student workflow: where the period's students went, as Tetra Commission counts them (2026-10-20). */
router.get("/cs/workflow", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Student workflow", await csStudentWorkflow(req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

/* The students behind one box or stage of that workflow (2026-10-20). */
router.get("/cs/workflow/students", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Workflow students", await csStudentWorkflowStudents(req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

/* A sales CRM's tab: leads, follow-ups, closings, revenue, lost (with reasons), calls, commission (2026-10-17). */
router.get("/sales/:code", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Sales report", await salesReport(String(req.params.code), req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

/* A sales CRM's lead workflow: where the period's leads went, as its Inactive Leads → Workflow tab counts (2026-10-17). */
router.get("/sales/:code/workflow", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Lead workflow", await salesLeadWorkflow(String(req.params.code), req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

/* The leads behind one box of a sales CRM's workflow map (2026-10-19). */
router.get("/sales/:code/workflow/leads", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Workflow leads", await salesLeadWorkflowLeads(String(req.params.code), req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

/* Mentors: every mentor's classes, bookings, meetings, reviews and commission, day by day — Tetra Commission's own
   Mentor Report (2026-10-24) — and one mentor's reviews. */
router.get("/mentors", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Mentors report", await mentorReport(req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});
router.get("/mentors/reviews", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Mentor reviews", await mentorReviews(req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

/* Finance: one organization's expenses, approvals decided, invoices and budget (2026-10-17). */
router.get("/finance", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Finance report", await financeReport(req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

/* HRMS: one organization's attendance, leave, regularization, hiring, joiners and leavers, payroll, requests, claims (2026-10-18). */
router.get("/hrms", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "HRMS report", await hrmsReport(req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

export default router;
