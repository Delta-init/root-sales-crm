import { Router } from "express";
import { overview } from "../controllers/pendingController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();

/*
 * Root admins only, like the group report: it is every portal's queue, and who
 * each item waits on, in one place. Guarded here as well as hidden in the menu.
 */
router.use(authenticate, requireRole("root_admin"));

router.get("/", overview);

export default router;
