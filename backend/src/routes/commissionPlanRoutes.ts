import { Router } from "express";
import {
  applyFrom, compare, deleteTeamCourse, deleteTeamSlabs, plans, previewApplyFrom, putCourse, putSettings, putSlabs, putTeamCourse, putTeamSlabs,
} from "../controllers/commissionPlanController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();

/*
 * Root admins only (the user, 2026-10-09). Since 2026-11-01 the plan kept in Root is edited here — by portal, a
 * course's row, a position's slabs, the Sales Manager and who earns nothing. The CRMs' own plans stay read only.
 */
router.use(authenticate, requireRole("root_admin"));

router.get("/", plans);
// Root's figures beside the CRM's for a month (stage 2) — before a CRM is switched to Root's.
router.get("/:code/compare", compare);
router.put("/:code/courses/:courseId", putCourse);
router.put("/:code/slabs/:role", putSlabs);
// Today's slabs applied to an earlier month: a preview of whose pay moves, then the change (2026-11-01).
router.get("/:code/slabs/apply-from", previewApplyFrom);
router.post("/:code/slabs/apply-from", applyFrom);
router.put("/:code/settings", putSettings);
// A team on a plan of its own (2026-11-03): its amounts for a course, its slab for a position — or back on the portal's.
router.put("/:code/teams/:teamId/courses/:courseId", putTeamCourse);
router.delete("/:code/teams/:teamId/courses/:courseId", deleteTeamCourse);
router.put("/:code/teams/:teamId/slabs/:role", putTeamSlabs);
router.delete("/:code/teams/:teamId/slabs/:role", deleteTeamSlabs);

export default router;
