import { Router, type Response, type NextFunction } from "express";
import { authenticate } from "../middleware/auth.js";
import { walletByEmail } from "../lib/hrmsClient.js";
import { sendError, sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

/*
 * My Wallet (2026-11-04: "the wallet on every portal"). The HRMS keeps it — salary a day at a time, what came off and
 * why, commission, what finance has paid — and finds the person by the email they sign in here with. Everyone signed
 * in, their own only: not while looking at the portal as somebody else, whose pay is not the viewer's to read.
 */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const router = Router();
router.use(authenticate);

// GET /wallet?month=YYYY-MM — this month when none is given
router.get("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const month = String(req.query.month ?? "");
    if (month && !MONTH.test(month)) { sendError(res, "month must be YYYY-MM", 400); return; }
    if (req.admin!.impersonatedBy) { sendError(res, "Your wallet isn't shown while you're viewing the portal as someone else.", 403); return; }
    const email = String(req.admin!.email ?? "").trim().toLowerCase();
    if (!email) { sendError(res, "Your account has no email to find your HRMS record with.", 400); return; }
    sendSuccess(res, "Your wallet", await walletByEmail(email, month || undefined));
  } catch (error) {
    next(error);
  }
});

export default router;
