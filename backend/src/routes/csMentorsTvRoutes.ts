import { Router, type Response, type NextFunction } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { csMentorsTv } from "../services/csMentorsTvService.js";
import { sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

/* The CS & Mentors TV (2026-11-18) for root admins — CS Portal's own words when it can't be reached. Open: publicRoutes. */
const router = Router();
router.use(authenticate, requireRole("root_admin"));

router.get("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "CS & Mentors TV", await csMentorsTv({ location: req.query.location, since: req.query.since, month: req.query.month }));
  } catch (error) {
    next(error);
  }
});

export default router;
