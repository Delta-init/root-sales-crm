import { Router, type Response, type NextFunction } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { csReport } from "../services/cseService.js";
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

export default router;
