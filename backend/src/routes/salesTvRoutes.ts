import { Router, type Response, type NextFunction } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { salesTv } from "../services/salesTvService.js";
import { sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

/*
 * Sales TV, signed in (2026-10-20): the Dubai Sales CRM, Draw and Remote on one
 * screen. Root admins only, like Reports. The open copy for the office TVs is
 * /public/sales-tv (publicRoutes.ts) — same data, no emails.
 */
const router = Router();
router.use(authenticate, requireRole("root_admin"));

router.get("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Sales TV", await salesTv({ since: req.query.since }));
  } catch (error) {
    next(error);
  }
});

export default router;
