import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { salesTv } from "../services/salesTvService.js";
import { managerTv } from "../services/managerTvService.js";
import { sendSuccess } from "../utils/response.js";
import { giftPhoto } from "../services/rewardsService.js";
import { classTv, voiceAudio } from "../services/classTvService.js";

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

// The Manager TV (2026-10-23): the same, with the CS team as a fourth card — one shared cache for it too.
router.get("/manager-tv", tvLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const since = typeof req.query.since === "string" ? req.query.since.slice(0, 40) : undefined;
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-store");
    sendSuccess(res, "Manager TV", await managerTv({ since, publicView: true, month: req.query.month }));
  } catch (error) {
    next(error);
  }
});

// The gift rewards' photos (2026-11-04): open, since an <img> sends no sign-in — the Rewards page shows them, and each
// CRM's API passes them on to its pop-up. Only a gift's photo, by its id; versioned in the link, so kept a day.
router.get("/rewards/photos/:id", tvLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const p = await giftPhoto(String(req.params.id));
    if (!p) { res.status(404).end(); return; }
    res.setHeader("Content-Type", p.type);
    res.setHeader("Cache-Control", "public, max-age=86400");
    // Another site's page shows it: helmet's same-origin default would refuse that.
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.end(p.photo);
  } catch (error) {
    next(error);
  }
});

// The Class TV (2026-11-14): an academy's classes today and who teaches them — names, courses, times and places, never
// an email. One shared answer however many screens: the LMS is asked at most once a minute for each academy.
router.get("/class-tv", tvLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-store");
    sendSuccess(res, "Class TV", await classTv(req.query.academy, { publicView: true }));
  } catch (error) {
    next(error);
  }
});

// A line the Class TV plays, by its id: a short WAV recorded on the Mentor voices page. Versioned in the link (a new
// recording is a new address), so a screen keeps its copy.
router.get("/class-tv/voice/:id", tvLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const audio = await voiceAudio(String(req.params.id));
    if (!audio) { res.status(404).end(); return; }
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", String(audio.length));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.end(audio);
  } catch (error) {
    next(error);
  }
});

export default router;
