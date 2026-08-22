import type { Response, NextFunction } from "express";
import { z } from "zod";
import * as tracker from "../services/trackerService.js";
import { sendSuccess, sendError } from "../utils/response.js";
import type { AuthenticatedRequest, OrgCode } from "../types/index.js";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

/** Today in Gulf time — the same boundary the report range picker uses. */
const defaultDate = () =>
  new Date(Date.now() + 4 * 60 * 60_000).toISOString().slice(0, 10);

export const group = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const date = req.query.date ? String(req.query.date) : defaultDate();
  if (!DATE.safeParse(date).success) {
    sendError(res, "date must be YYYY-MM-DD", 400);
    return;
  }
  try {
    sendSuccess(res, "Group tracker", await tracker.groupTracker(date));
  } catch (error) {
    next(error);
  }
};

export const org = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const date = req.query.date ? String(req.query.date) : defaultDate();
  if (!DATE.safeParse(date).success) {
    sendError(res, "date must be YYYY-MM-DD", 400);
    return;
  }
  try {
    sendSuccess(res, "Org tracker", await tracker.orgTracker(req.params.code, date));
  } catch (error) {
    next(error);
  }
};

export const user = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const to = req.query.to ? String(req.query.to) : defaultDate();
  // Two weeks reads as a trend without becoming a wall of numbers.
  const from = req.query.from
    ? String(req.query.from)
    : new Date(new Date(`${to}T12:00:00Z`).getTime() - 13 * 86_400_000).toISOString().slice(0, 10);

  if (!DATE.safeParse(from).success || !DATE.safeParse(to).success) {
    sendError(res, "from and to must be YYYY-MM-DD", 400);
    return;
  }
  if (from > to) {
    sendError(res, "'from' is after 'to'", 400);
    return;
  }

  try {
    sendSuccess(
      res,
      "User tracker",
      await tracker.userTracker(req.params.code, req.params.userId, from, to)
    );
  } catch (error) {
    next(error);
  }
};

const targetsSchema = z.object({
  metrics: z.record(z.string(), z.number().min(0)),
});

export const getTargets = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Targets", await tracker.getTargets(req.params.code as OrgCode));
  } catch (error) {
    next(error);
  }
};

export const putTargets = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const parsed = targetsSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "Validation failed", 400, z.treeifyError(parsed.error));
    return;
  }
  try {
    const saved = await tracker.saveTargets(
      req.params.code as OrgCode,
      parsed.data.metrics,
      req.admin!.adminId
    );
    sendSuccess(res, "Targets saved", saved);
  } catch (error) {
    next(error);
  }
};

const entrySchema = z.object({
  org: z.enum(["delta", "banglore", "draw"]),
  userId: z.string().min(1),
  userName: z.string().optional(),
  date: DATE,
  metrics: z.record(z.string(), z.number()).default({}),
  remarks: z.string().max(500).optional(),
  actionRequired: z.string().max(500).optional(),
});

export const putEntry = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "Validation failed", 400, z.treeifyError(parsed.error));
    return;
  }
  try {
    const saved = await tracker.saveEntry({ ...parsed.data, adminId: req.admin!.adminId });
    sendSuccess(res, "Entry saved", saved);
  } catch (error) {
    next(error);
  }
};
