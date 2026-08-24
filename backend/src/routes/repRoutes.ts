import { Router } from "express";
import rateLimit from "express-rate-limit";
import { login, refresh, me, myTracker, saveMine } from "../controllers/repController.js";
import { authenticateRep } from "../middleware/repAuth.js";

// This endpoint tests passwords against three production CRMs, so it is the
// most attackable surface in the portal.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many sign-in attempts. Try again in 15 minutes." },
});

const router = Router();

router.post("/login", loginLimiter, login);
router.post("/refresh", refresh);

router.get("/me", authenticateRep, me);
router.get("/me/tracker", authenticateRep, myTracker);
router.put("/me/entry", authenticateRep, saveMine);

export default router;
