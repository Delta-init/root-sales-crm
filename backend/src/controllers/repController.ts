import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as repAuth from "../services/repAuthService.js";
import * as tracker from "../services/trackerService.js";
import { record } from "../services/auditService.js";
import { sendSuccess, sendError } from "../utils/response.js";
import type { AuthenticatedRequest, OrgCode } from "../types/index.js";

const loginSchema = z.object({
  email: z.email("A valid email is required"),
  password: z.string().min(1, "Password is required"),
  org: z.enum(["delta", "banglore", "draw"]).optional(),
});

export const login = async (req: Request, res: Response, next: NextFunction) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "Validation failed", 400, z.treeifyError(parsed.error));
    return;
  }

  try {
    const result = await repAuth.repLogin(
      parsed.data.email,
      parsed.data.password,
      parsed.data.org
    );
    await record(req, "login", {
      adminEmail: result.rep.email,
      org: result.rep.org.code as OrgCode,
      detail: `Rep sign-in: ${result.rep.name}`,
    });
    sendSuccess(res, "Signed in", result);
  } catch (error) {
    // A 409 carries the list of orgs the email matched, so the client can ask
    // which one rather than failing outright.
    const orgs = (error as { orgs?: unknown }).orgs;
    if (orgs) {
      sendError(res, (error as Error).message, 409, { orgs });
      return;
    }
    await record(req, "login_failed", { adminEmail: parsed.data.email, detail: "rep" });
    next(error);
  }
};

export const refresh = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) {
      sendError(res, "Refresh token is required", 400);
      return;
    }
    sendSuccess(res, "Token refreshed", await repAuth.repRefresh(refreshToken));
  } catch (error) {
    next(error);
  }
};

export const me = async (req: AuthenticatedRequest, res: Response) => {
  sendSuccess(res, "Rep fetched", req.rep);
};

/** The rep's own row for a day — never anybody else's. */
export const myTracker = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const rep = req.rep!;
  const date = req.query.date ? String(req.query.date) : tracker.todayIn(rep.org.timezone);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    sendError(res, "date must be YYYY-MM-DD", 400);
    return;
  }

  try {
    sendSuccess(
      res,
      "My tracker",
      await tracker.repDay(rep.org.code, rep.repId, date)
    );
  } catch (error) {
    next(error);
  }
};

const entrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  metrics: z.record(z.string(), z.number().min(0).finite()).default({}),
  texts: z.record(z.string(), z.string().max(1000)).default({}),
});

export const saveMine = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const rep = req.rep!;
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "Validation failed", 400, z.treeifyError(parsed.error));
    return;
  }

  // The day locks at midnight in the rep's own timezone. userId comes from the
  // session and is never read from the body, so a rep cannot file against a
  // colleague no matter what they post.
  const today = tracker.todayIn(rep.org.timezone);
  if (parsed.data.date !== today) {
    sendError(
      res,
      parsed.data.date < today
        ? `${parsed.data.date} is closed. Entries lock at midnight ${rep.org.timezone.split("/").pop()} time.`
        : "That date has not started yet.",
      403
    );
    return;
  }

  try {
    const saved = await tracker.saveEntry({
      org: rep.org.code as OrgCode,
      userId: rep.repId,
      userName: rep.name,
      date: parsed.data.date,
      metrics: parsed.data.metrics,
      texts: parsed.data.texts,
      // Remarks and action-required belong to the manager, not the rep, so a
      // rep's save must not blank what a manager wrote.
      preserveManagerNotes: true,
      adminId: rep.repId,
    });
    sendSuccess(res, "Saved", saved);
  } catch (error) {
    next(error);
  }
};
