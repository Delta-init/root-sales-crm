import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { readFileSync } from "node:fs";
import { playlist } from "../services/tvMediaService.js";
import { sendError, sendSuccess } from "../utils/response.js";

/*
 * What the office TVs read for their photos and videos (2026-11-02) — open to any site, because the TVs are pages of
 * other portals (the CRMs' leaderboards, the CS Portal, HRMS) and none of them signs in. Mounted ahead of helmet and the
 * CORS allow-list in index.ts: those would refuse another site's page, and stop it loading the overlay script. Only
 * links to the files and their timing go out — never who added them.
 *
 *   GET /api/v1/public/tv/overlay.js?screen=<key>   the slideshow a TV page loads with one <script>
 *   GET /api/v1/public/tv/<key>                       that TV's list and timing
 */
const router = Router();

const tvLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Try again in a minute." },
});

const open = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
};
router.use(open);

// Read once a process: the file ships with this code. A short cache, so a change reaches the TVs within minutes.
const overlay = readFileSync(new URL("../../static/tv-overlay.js", import.meta.url), "utf8");
router.get("/overlay.js", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(overlay);
});

router.get("/:screen", tvLimiter, async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    sendSuccess(res, "TV playlist", await playlist(String(req.params.screen).slice(0, 40)));
  } catch (error) {
    const e = error as Error & { statusCode?: number };
    // A TV only needs to know there's nothing to show; a fault here mustn't reach its page as anything more.
    sendError(res, e.statusCode === 404 ? "No such TV" : "Unavailable", e.statusCode === 404 ? 404 : 503);
  }
});

export default router;
