import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { sendError } from "../utils/response.js";

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // key's length, so lengths are compared first.
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
};

/**
 * The lead sheet's script, posting leads in.
 *
 * Its own key, `x-traffic-key`, and nothing else: no admin session is involved,
 * and none would be accepted in its place. Unset, the door is shut and says
 * which variable would open it — an empty key must never match an empty header.
 */
export const requireSheetKey = (req: Request, res: Response, next: NextFunction): void => {
  if (!env.LEAD_TRAFFIC_SHEET_KEY) {
    sendError(res, "Lead traffic is not configured on this server — set LEAD_TRAFFIC_SHEET_KEY", 503);
    return;
  }
  const presented = req.headers["x-traffic-key"];
  if (typeof presented !== "string" || !presented || !safeEqual(presented, env.LEAD_TRAFFIC_SHEET_KEY)) {
    sendError(res, "Invalid or missing traffic key", 401);
    return;
  }
  next();
};
