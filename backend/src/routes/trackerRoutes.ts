import { Router } from "express";
import { group, org, user, getTargets, putTargets, putEntry } from "../controllers/trackerController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(authenticate);

/*
 * Reading is root_admin only, same as the group report.
 *
 * It was open to any admin. A day's tracker names every rep in a team and
 * says how each of them did against a target — who is behind, who has logged
 * nothing — and that is a thing about people, not a total. The people it is
 * about can see their own through /rep, which is a different surface with a
 * different sign-in and is untouched by this.
 */
router.get("/group", requireRole("root_admin"), group);
router.get("/org/:code", requireRole("root_admin"), org);
router.get("/user/:code/:userId", requireRole("root_admin"), user);
router.get("/targets/:code", requireRole("root_admin"), getTargets);

// Writing is not: targets change how every team is scored, and a daily entry
// is a claim about someone's work. Both are root_admin only.
router.put("/targets/:code", requireRole("root_admin"), putTargets);
router.put("/entry", requireRole("root_admin"), putEntry);

export default router;
