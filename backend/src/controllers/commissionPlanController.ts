import type { Response, NextFunction } from "express";
import { z } from "zod";
import {
  applySlabsFrom, clearTeamCourse, commissionPlans, compareMonth, previewSlabsFrom, saveCourse, saveSettings, saveSlabs, saveTeamCourse, saveTeamSlabs,
} from "../services/commissionPlanService.js";
import { validMonth } from "../services/crmCommissionService.js";
import { record } from "../services/auditService.js";
import { sendSuccess, sendError } from "../utils/response.js";
import type { AuthenticatedRequest, OrgCode } from "../types/index.js";

/** Every sales CRM's commission plan: the CRM's own, and the one kept in Root (2026-11-01). */
export const plans = async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Commission plans", await commissionPlans());
  } catch (error) {
    next(error);
  }
};

/* GET /commission-plans/:code/compare?month= — a month of a portal, the CRM's figures beside Root's (2026-11-01). */
export const compare = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const month = req.query.month;
  if (!validMonth(month)) {
    sendError(res, "month is required as YYYY-MM", 400);
    return;
  }
  try {
    sendSuccess(res, "Compared", await compareMonth(req.params.code, month));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) {
      sendError(res, (error as Error).message, status);
      return;
    }
    next(error);
  }
};

const AED = z.number().min(0, "Amounts can't be negative").max(1_000_000);
/* The rupee amounts (2026-11-13) are left out by a page from before them: what is kept then stays as it is. */
const INR = z.number().min(0, "Amounts can't be negative").max(100_000_000).optional();
const courseSchema = z.object({ sales: AED, tl: AED, sm: AED, creditUsd: AED, salesInr: INR, tlInr: INR, smInr: INR });
const slabRowSchema = z.object({
  name: z.string().trim().min(1, "Each level needs a name").max(40),
  target: z.number().min(0).max(100_000_000),
  salary: z.number().min(0).max(1_000_000),
  percent: z.number().min(0).max(100),
});
const slabSchema = z.object({ rows: z.array(slabRowSchema).min(1, "A slab needs its base row").max(12) });
const settingsSchema = z.object({
  salesManager: z.string().nullable(),
  excluded: z.array(z.string()).max(100),
});

/** A change saved, recorded against the root admin who made it, then the plans as they now stand. */
const save = (
  parse: (body: unknown) => { success: true; data: unknown } | { success: false; error: z.ZodError },
  run: (req: AuthenticatedRequest, data: never, by: string) => Promise<string>,
) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const parsed = parse(req.body);
    if (!parsed.success) {
      sendError(res, parsed.error.issues[0]?.message ?? "Invalid input", 400);
      return;
    }
    try {
      const detail = await run(req, parsed.data as never, req.admin!.email);
      await record(req, "commission_plan_changed", {
        adminId: req.admin!.adminId,
        adminEmail: req.admin!.email,
        org: req.params.code as OrgCode,
        detail,
      });
      sendSuccess(res, "Commission plan saved", await commissionPlans());
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status) {
        sendError(res, (error as Error).message, status);
        return;
      }
      next(error);
    }
  };

export const putCourse = save(
  (b) => courseSchema.safeParse(b),
  (req, data: z.infer<typeof courseSchema>, by) => saveCourse(req.params.code, req.params.courseId, data, by),
);
export const putSlabs = save(
  (b) => slabSchema.safeParse(b),
  (req, data: z.infer<typeof slabSchema>, by) => saveSlabs(req.params.code, req.params.role, data.rows, by),
);
/* A team on a plan of its own (2026-11-03): a course's amounts for the team, a position's slab for the team — or back
   on the portal's. */
const teamCourseSchema = z.object({ sales: AED, tl: AED, sm: AED, salesInr: INR, tlInr: INR, smInr: INR });
const nothing = z.object({}).passthrough();
export const putTeamCourse = save(
  (b) => teamCourseSchema.safeParse(b),
  (req, data: z.infer<typeof teamCourseSchema>, by) => saveTeamCourse(req.params.code, req.params.teamId, req.params.courseId, data, by),
);
export const deleteTeamCourse = save(
  (b) => nothing.safeParse(b ?? {}),
  (req, _data: unknown, by) => clearTeamCourse(req.params.code, req.params.teamId, req.params.courseId, by),
);
export const putTeamSlabs = save(
  (b) => slabSchema.safeParse(b),
  (req, data: z.infer<typeof slabSchema>, by) => saveTeamSlabs(req.params.code, req.params.teamId, req.params.role, data.rows, by),
);
export const deleteTeamSlabs = save(
  (b) => nothing.safeParse(b ?? {}),
  (req, _data: unknown, by) => saveTeamSlabs(req.params.code, req.params.teamId, req.params.role, null, by),
);
export const putSettings = save(
  (b) => settingsSchema.safeParse(b),
  (req, data: z.infer<typeof settingsSchema>, by) => saveSettings(req.params.code, data, by),
);

/* GET /commission-plans/:code/slabs/apply-from?month= — what that month's pay would be with today's slabs (2026-11-01). */
export const previewApplyFrom = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const month = req.query.month;
  if (!validMonth(month)) {
    sendError(res, "month is required as YYYY-MM", 400);
    return;
  }
  try {
    sendSuccess(res, "Preview", await previewSlabsFrom(req.params.code, month));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) {
      sendError(res, (error as Error).message, status);
      return;
    }
    next(error);
  }
};

const applyFromSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month is YYYY-MM") });
/* POST /commission-plans/:code/slabs/apply-from { month } — today's slabs in force from that month on. */
export const applyFrom = save(
  (b) => applyFromSchema.safeParse(b),
  (req, data: z.infer<typeof applyFromSchema>, by) => applySlabsFrom(req.params.code, data.month, by),
);
