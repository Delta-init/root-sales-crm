import { Router } from "express";
import { listOrgs, listAllOrgs, createOrg, updateOrg } from "../controllers/orgController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();

router.get("/", authenticate, listOrgs);

/*
 * The registry itself — root admins only.
 *
 * A target's address and service account decide where the portal sends people
 * and as whom, so changing one is as consequential as granting access to it.
 * Before "/:code", so an unlucky code cannot shadow it.
 */
router.get("/all", authenticate, requireRole("root_admin"), listAllOrgs);
router.post("/", authenticate, requireRole("root_admin"), createOrg);
router.patch("/:code", authenticate, requireRole("root_admin"), updateOrg);

export default router;
