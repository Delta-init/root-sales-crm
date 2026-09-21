import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  login, refresh, me, logout, requestLoginCode, loginWithCode,
} from "../controllers/authController.js";
import { authenticate } from "../middleware/auth.js";

// This login guards three production CRMs — brute force has to be expensive.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many login attempts. Try again in 15 minutes." },
});

/*
 * Asking for a code is rationed harder than guessing a password.
 *
 * Each request sends real mail to a real person, so an unthrottled endpoint is
 * a way to fill somebody's inbox using this portal's own address — a nuisance
 * to them and a reputation problem for the sending domain. Counted per IP over
 * a long window, because a person signing in legitimately needs one or two.
 */
const codeRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many code requests. Try again in 15 minutes." },
});

const router = Router();

router.post("/login", loginLimiter, login);

/*
 * Signing in with a code instead of a password.
 *
 * Verifying shares the password limiter deliberately: both end in a session,
 * and six digits are worth guessing at, so the two paths should not add up to
 * twice as many attempts as either allows on its own.
 */
router.post("/request-code", codeRequestLimiter, requestLoginCode);
router.post("/code-login", loginLimiter, loginWithCode);
router.post("/refresh", refresh);
router.get("/me", authenticate, me);
router.post("/logout", authenticate, logout);

export default router;
