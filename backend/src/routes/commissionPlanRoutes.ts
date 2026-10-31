import { Router } from "express";
import { plans, putCourse, putSettings, putSlabs } from "../controllers/commissionPlanController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();

/*
 * Root admins only (the user, 2026-10-09). Since 2026-11-01 the plan kept in Root is edited here — by portal, a
 * course's row, a position's slabs, the Sales Manager and who earns nothing. The CRMs' own plans stay read only.
 */
router.use(authenticate, requireRole("root_admin"));

router.get("/", plans);
router.put("/:code/courses/:courseId", putCourse);
router.put("/:code/slabs/:role", putSlabs);
router.put("/:code/settings", putSettings);

export default router;
