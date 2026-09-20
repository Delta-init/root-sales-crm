import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import {
  listPeople, listTargets, hrmsDirectory, importFromHrms,
  listRoleMap, addRoleMap, removeRoleMap,
  grant, provision, revoke, setRole,
  targetRoles, describePerson, setRoleInTarget, grantMany,
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
router.get("/hrms-directory", hrmsDirectory);
router.post("/import", importFromHrms);
router.get("/role-map", listRoleMap);
router.post("/role-map", addRoleMap);
router.delete("/role-map/:id", removeRoleMap);
router.post("/grant", grant);
router.post("/grant-many", grantMany);
router.post("/provision", provision);
router.delete("/:userId/:target", revoke);
router.patch("/:userId/role", setRole);
router.patch("/:userId/:target/role", setRoleInTarget);

export default router;
