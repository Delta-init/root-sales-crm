import { Router } from "express";
import rateLimit from "express-rate-limit";
import { launch } from "../controllers/ssoController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

// A launch is a deliberate click, never a burst.
const launchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many launch attempts. Wait a minute." },
});

const router = Router();

// requireRole, not just authenticate: a viewer may read the group report but
// must never be handed a session inside a production CRM.
router.post("/launch", authenticate, requireRole("root_admin"), launchLimiter, launch);

export default router;
