import { Router } from "express";
import { overview } from "../controllers/pendingController.js";
import { byPerson } from "../controllers/callsController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();

/*
 * Root admins only, like the group report: it is every portal's queue, and who
 * each item waits on, in one place. Guarded here as well as hidden in the menu.
 */
router.use(authenticate, requireRole("root_admin"));

router.get("/", overview);
// Each person's 3CX calls and talk time in a period, beside what waits on them (2026-10-14).
router.get("/calls", byPerson);

export default router;
