import { Router, type Response, type NextFunction } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { mentorsTv } from "../services/mentorsTvService.js";
import { sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

/* The Mentors TV (2026-11-17) for root admins — CS Portal's own words when it can't be reached. Open: publicRoutes. */
const router = Router();
router.use(authenticate, requireRole("root_admin"));

router.get("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Mentors TV", await mentorsTv({ location: req.query.location, since: req.query.since, month: req.query.month }));
  } catch (error) {
    next(error);
  }
});

export default router;
