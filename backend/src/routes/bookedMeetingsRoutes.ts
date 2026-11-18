import { Router, type Response, type NextFunction } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/index.js";
import { sendSuccess, sendError } from "../utils/response.js";
import { periodOf } from "../controllers/salespersonController.js";
import { bookedMeetings } from "../services/bookedMeetingsService.js";

/*
 * GET /meetings-booked?email=&from=&to= — the meetings this person booked with the mentors (2026-11-18), for the
 * salesperson and CS pages. Root admins only, like those pages. The period as theirs (Gulf time).
 */
const router = Router();
router.use(authenticate, requireRole("root_admin"));

router.get("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { email, ...rest } = req.query as Record<string, unknown>;
  const period = periodOf(rest);
  if ("error" in period) return sendError(res, period.error, 400);
  try {
    sendSuccess(res, "Meetings booked", await bookedMeetings(String(email ?? ""), period));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status) return sendError(res, (error as Error).message, status);
    next(error);
  }
});

export default router;
