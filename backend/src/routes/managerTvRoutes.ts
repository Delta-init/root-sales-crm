import { Router, type Response, type NextFunction } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { managerTv } from "../services/managerTvService.js";
import { managerTvExport } from "../services/managerTvExport.js";
import { sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

/*
 * Manager TV, signed in (2026-10-23): the Sales TV's three CRMs and the CS team
 * (services/managerTvService.ts). Root admins only, like the Sales TV. The open
 * copy for the office TVs is /public/manager-tv (publicRoutes.ts) — no emails.
 */
const router = Router();
router.use(authenticate, requireRole("root_admin"));

router.get("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Manager TV", await managerTv({ since: req.query.since, month: req.query.month }));
  } catch (error) {
    next(error);
  }
});

// The month as an Excel's worth of figures (2026-11-25): the TV's overview and each person's payments
// (services/managerTvExport.ts). Signed in only — the public screen has no export.
router.get("/export", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Manager TV export", await managerTvExport(req.query.month));
  } catch (error) {
    next(error);
  }
});

export default router;
