import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import {
  listPeople, listTargets, hrmsDirectory, importFromHrms,
  listRoleMap, addRoleMap, removeRoleMap,
  grant, provision, revoke, setRole,
  targetRoles, describePerson, setRoleInTarget, grantMany,
  setStatus, deletePerson, setStatusMany, deleteMany,
  peoplePresence,
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
router.get("/targets/:code/roles", targetRoles);
router.get("/person/:userId", describePerson);
/*
 * POST for a read, deliberately: it carries a page of addresses, and those do
 * not belong in a query string where every proxy in front of this would log
 * them.
 */
router.post("/presence", peoplePresence);
router.get("/hrms-directory", hrmsDirectory);
router.post("/import", importFromHrms);
router.get("/role-map", listRoleMap);
router.post("/role-map", addRoleMap);
router.delete("/role-map/:id", removeRoleMap);
router.post("/grant", grant);
router.post("/grant-many", grantMany);
router.post("/status-many", setStatusMany);
router.post("/delete-many", deleteMany);
router.post("/provision", provision);
/*
 * Before the two-segment routes below, and that ordering is load-bearing.
 *
 * Express matches in order, so `/person/<id>` would otherwise be read as
 * `/:userId/:target` — a revoke for a user called "person" — and the delete
 * would never be reached.
 */
router.delete("/person/:userId", deletePerson);
router.patch("/:userId/status", setStatus);

router.delete("/:userId/:target", revoke);
router.patch("/:userId/role", setRole);
router.patch("/:userId/:target/role", setRoleInTarget);

export default router;
