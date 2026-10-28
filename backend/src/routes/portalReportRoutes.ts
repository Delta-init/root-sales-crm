import { Router, type Response, type NextFunction } from "express";
import { authenticate, requireReportTab } from "../middleware/auth.js";
import { salesPortals } from "../services/salesPendingService.js";
import { csReport, csStudentWorkflow, csStudentWorkflowStudents, mentorReport, mentorReportDetails, mentorReviews } from "../services/cseService.js";
import { salesLeadWorkflow, salesLeadWorkflowLeads, salesReport } from "../services/salesReportService.js";
import { financeReport } from "../services/financeReportService.js";
import { hrmsReport } from "../services/hrmsReportService.js";
import { sendSuccess, sendError } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

/*
 * Reports, a tab per portal (the user, 2026-10-17: "same as the pending page,
 * each portal its own tab") — what got done in a period, where Pending is what
 * waits now. Root admins, and since 2026-10-27 anybody given a tab (Users → their page → Reports access) — as Pending.
 */
const router = Router();
router.use(authenticate);
const salesTab = (req: AuthenticatedRequest) => `sales:${String(req.params.code)}`;

/* The sales CRMs for the Sales tab's own tabs — a root admin's every one, anybody else's the ones they were given. */
router.get("/sales", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const all = await salesPortals();
    const mine = new Set<string>(req.admin?.reportAccess ?? []);
    const list = req.admin?.role === "root_admin" ? all : all.filter((p) => mine.has(`sales:${p.code}`));
    if (req.admin?.role !== "root_admin" && !list.length) return sendError(res, "You do not have access to this report", 403);
    sendSuccess(res, "Sales CRMs", list);
  } catch (error) { next(error); }
});

router.get("/cs", requireReportTab("cs"), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "CS report", await csReport(req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

/* The CS portal's student workflow: where the period's students went, as CS Portal counts them (2026-10-20). */
router.get("/cs/workflow", requireReportTab("cs"), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Student workflow", await csStudentWorkflow(req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

/* The students behind one box or stage of that workflow (2026-10-20). */
router.get("/cs/workflow/students", requireReportTab("cs"), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Workflow students", await csStudentWorkflowStudents(req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

/* A sales CRM's tab: leads, follow-ups, closings, revenue, lost (with reasons), calls, commission (2026-10-17). */
router.get("/sales/:code", requireReportTab(salesTab), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Sales report", await salesReport(String(req.params.code), req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

/* A sales CRM's lead workflow: where the period's leads went, as its Inactive Leads → Workflow tab counts (2026-10-17). */
router.get("/sales/:code/workflow", requireReportTab(salesTab), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Lead workflow", await salesLeadWorkflow(String(req.params.code), req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

/* The leads behind one box of a sales CRM's workflow map (2026-10-19). */
router.get("/sales/:code/workflow/leads", requireReportTab(salesTab), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Workflow leads", await salesLeadWorkflowLeads(String(req.params.code), req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

/* Mentors: every mentor's classes, bookings, meetings, reviews and commission, day by day — CS Portal's own
   Mentor Report (2026-10-24) — and one mentor's reviews. */
router.get("/mentors", requireReportTab("mentors"), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Mentors report", await mentorReport(req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});
/* What is behind one number of it, and the Programs and Meetings tabs (2026-10-27). */
router.get("/mentors/details", requireReportTab("mentors"), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Mentor report details", await mentorReportDetails(req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});
router.get("/mentors/reviews", requireReportTab("mentors"), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Mentor reviews", await mentorReviews(req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

/* Finance: one organization's expenses, approvals decided, invoices and budget (2026-10-17). */
router.get("/finance", requireReportTab("finance"), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Finance report", await financeReport(req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

/* HRMS: one organization's attendance, leave, regularization, hiring, joiners and leavers, payroll, requests, claims (2026-10-18). */
router.get("/hrms", requireReportTab("hrms"), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "HRMS report", await hrmsReport(req.query as Record<string, unknown>));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

export default router;
