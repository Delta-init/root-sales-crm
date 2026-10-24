import { Router } from "express";
import { overview, recording } from "../controllers/callsController.js";
import { authenticate, requirePendingTab, requireRole } from "../middleware/auth.js";

const router = Router();

/*
 * Every portal's 3CX calls and their recordings (2026-10-14) — root admins
 * only, like the Salespeople page: it is everybody's calls, in every portal.
 * Guarded here as well as hidden in the menu.
 */
router.use(authenticate);

router.get("/", requireRole("root_admin"), overview);
// A recording also plays for somebody given that sales CRM's Pending tab, where its calls are listed (2026-10-24).
router.get("/:portal/:id/recording-link", requirePendingTab((req) => `sales:${String(req.params.portal)}`), recording);

export default router;
