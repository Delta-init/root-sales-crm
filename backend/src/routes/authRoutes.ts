import { Router } from "express";
import rateLimit from "express-rate-limit";
import { login, refresh, me, logout } from "../controllers/authController.js";
import { authenticate } from "../middleware/auth.js";

// This login guards three production CRMs — brute force has to be expensive.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many login attempts. Try again in 15 minutes." },
});

const router = Router();

router.post("/login", loginLimiter, login);
router.post("/refresh", refresh);
router.get("/me", authenticate, me);
router.post("/logout", authenticate, logout);

export default router;
