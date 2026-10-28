import { Router, type Response, type NextFunction } from "express";
import { overview, recording } from "../controllers/callsController.js";
import { authenticate, requirePendingTab, requireRole } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/index.js";

const router = Router();

/*
 * Every portal's 3CX calls and their recordings (2026-10-14) — root admins
 * only, like the Salespeople page: it is everybody's calls, in every portal.
 * Guarded here as well as hidden in the menu.
 */
router.use(authenticate);

router.get("/", requireRole("root_admin"), overview);
// A recording also plays for somebody given that sales CRM's Pending tab, where its calls are listed (2026-10-24) — or
// its Reports tab, and CS Portal's for the CS portal's report (2026-10-27).
const mayPlay = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const portal = String(req.params.portal);
  const report = req.admin?.reportAccess ?? [];
  if (report.includes(`sales:${portal}` as never) || (portal === "commission" && report.includes("cs"))) return next();
  requirePendingTab(`sales:${portal}`)(req, res, next);
};
router.get("/:portal/:id/recording-link", mayPlay, recording);

export default router;
