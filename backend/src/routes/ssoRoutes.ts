import { Router } from "express";
import rateLimit from "express-rate-limit";
import { launch } from "../controllers/ssoController.js";
import { authenticate } from "../middleware/auth.js";

// A launch is a deliberate click, never a burst.
const launchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many launch attempts. Wait a minute." },
});

const router = Router();

/*
 * Open to members as well as root admins.
 *
 * The gate moved rather than went: `ssoService.launch` refuses a member with no
 * access row for the target, and a viewer has none by definition. Keeping the
 * role check here too would have meant deciding the same question in two
 * places, and the one further from the token minting would have been the one
 * somebody forgot.
 */
router.post("/launch", authenticate, launchLimiter, launch);

export default router;
