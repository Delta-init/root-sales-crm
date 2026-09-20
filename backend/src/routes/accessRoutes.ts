import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import {
  listPeople, listTargets, hrmsDirectory, importFromHrms, grant, provision, revoke, setRole,
} from "../controllers/accessController.js";

const router = Router();

/*
 * Root admins only, all of it.
 *
 * Deciding who may open which production system is the portal's most
 * consequential act, and it was decided that it stays with the people who
 * administer the portal — a CRM's own admin cannot hand out reach into
 * finance.
 */
router.use(authenticate, requireRole("root_admin"));

router.get("/people", listPeople);
router.get("/targets", listTargets);
router.get("/hrms-directory", hrmsDirectory);
router.post("/import", importFromHrms);
router.post("/grant", grant);
router.post("/provision", provision);
router.delete("/:userId/:target", revoke);
router.patch("/:userId/role", setRole);

export default router;
