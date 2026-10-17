import { Router } from "express";
import { link, overview, runNow, summary } from "../controllers/backupController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();

/*
 * Backups (2026-10-16) — root admins only: a download is every record of a
 * whole portal. Guarded here as well as hidden in the menu.
 */
router.use(authenticate, requireRole("root_admin"));

router.get("/", overview);
router.get("/summary", summary);
router.post("/run", runNow);
router.get("/:id/link", link);

export default router;
