import { Router } from "express";
import { group, org, user, getTargets, putTargets, putEntry } from "../controllers/trackerController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(authenticate);

// Reading is open to any admin, same as the group report.
router.get("/group", group);
router.get("/org/:code", org);
router.get("/user/:code/:userId", user);
router.get("/targets/:code", getTargets);

// Writing is not: targets change how every team is scored, and a daily entry
// is a claim about someone's work. Both are root_admin only.
router.put("/targets/:code", requireRole("root_admin"), putTargets);
router.put("/entry", requireRole("root_admin"), putEntry);

export default router;
