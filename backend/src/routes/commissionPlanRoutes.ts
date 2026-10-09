import { Router } from "express";
import { plans } from "../controllers/commissionPlanController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();

/* Root admins only (the user, 2026-10-09). Read only: there is nothing to change here. */
router.use(authenticate, requireRole("root_admin"));

router.get("/", plans);

export default router;
