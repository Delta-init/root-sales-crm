import { Router } from "express";
import { overview, recording } from "../controllers/callsController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();

/*
 * Every portal's 3CX calls and their recordings (2026-10-14) — root admins
 * only, like the Salespeople page: it is everybody's calls, in every portal.
 * Guarded here as well as hidden in the menu.
 */
router.use(authenticate, requireRole("root_admin"));

router.get("/", overview);
router.get("/:portal/:id/recording-link", recording);

export default router;
