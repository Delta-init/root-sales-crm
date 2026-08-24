import { Router } from "express";
import { getMine, saveMine } from "../controllers/serviceTrackerController.js";
import { authenticateOrgService } from "../middleware/orgServiceAuth.js";

const router = Router();

// Server-to-server only: a CRM backend acting for its own signed-in user.
// Never reachable from a browser — the secret lives in the CRM's environment.
router.use(authenticateOrgService);

router.get("/tracker/me", getMine);
router.put("/tracker/me", saveMine);

export default router;
