import type { Response, NextFunction } from "express";
import { z } from "zod";
import * as tracker from "../services/trackerService.js";
import { sendSuccess, sendError } from "../utils/response.js";
import type { AuthenticatedRequest, OrgCode } from "../types/index.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** GET a rep's own row, on behalf of the CRM they are logged into. */
export const getMine = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const org = req.serviceOrg!;
  const userId = String(req.query.userId ?? "");
  const date = req.query.date ? String(req.query.date) : tracker.todayIn(org.timezone);

  if (!userId) {
    sendError(res, "userId is required", 400);
    return;
  }
  if (!DATE.test(date)) {
    sendError(res, "date must be YYYY-MM-DD", 400);
    return;
  }

  try {
    sendSuccess(res, "My tracker", await tracker.repDay(org.code, userId, date));
  } catch (error) {
    next(error);
  }
};

const saveSchema = z.object({
  userId: z.string().min(1),
  userName: z.string().optional(),
  date: z.string().regex(DATE),
  metrics: z.record(z.string(), z.number().min(0).finite()).default({}),
  texts: z.record(z.string(), z.string().max(1000)).default({}),
});

export const saveMine = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const org = req.serviceOrg!;
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "Validation failed", 400, z.treeifyError(parsed.error));
    return;
  }

  // Same midnight lock the portal applies, cut in this org's own timezone.
  const today = tracker.todayIn(org.timezone);
  if (parsed.data.date !== today) {
    sendError(
      res,
      parsed.data.date < today
        ? `${parsed.data.date} is closed. Entries lock at midnight ${org.timezone.split("/").pop()} time.`
        : "That date has not started yet.",
      403
    );
    return;
  }

  try {
    const saved = await tracker.saveEntry({
      // From the matched secret, never the body.
      org: org.code as OrgCode,
      userId: parsed.data.userId,
      userName: parsed.data.userName,
      date: parsed.data.date,
      metrics: parsed.data.metrics,
      texts: parsed.data.texts,
      preserveManagerNotes: true,
      adminId: parsed.data.userId,
    });
    sendSuccess(res, "Saved", saved);
  } catch (error) {
    next(error);
  }
};
