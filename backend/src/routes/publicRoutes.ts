import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { salesTv } from "../services/salesTvService.js";
import { sendSuccess } from "../utils/response.js";

/*
 * Open to anybody with the link — no sign-in (2026-10-20). Only what an office
 * TV may show: names, teams, counts, break photos and close amounts; never an
 * email, a secret or a CRM's own error text.
 *
 * The CRMs are never asked on a visitor's behalf: salesTvService answers from
 * one shared cache (people every 30 s, live parts every 5 s at most), so the
 * number of screens doesn't change their load. The limiter only stops one
 * address hammering this process — generous, because every TV in an office
 * shares one address and polls every 5 seconds.
 */
const router = Router();

const tvLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Try again in a minute." },
});

router.get("/sales-tv", tvLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const since = typeof req.query.since === "string" ? req.query.since.slice(0, 40) : undefined;
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-store");
    sendSuccess(res, "Sales TV", await salesTv({ since, publicView: true }));
  } catch (error) {
    next(error);
  }
});

export default router;
