import { timingSafeEqual } from "node:crypto";
import type { Response, NextFunction } from "express";
import { Organization } from "../models/Organization.js";
import { allServiceSecrets } from "../config/targets.js";
import { sendError } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // secret's length, so compare lengths in constant-ish time first.
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
};

/**
 * Authenticate a CRM backend calling on behalf of one of its own users.
 *
 * The org is derived from WHICH secret matched, never from the request body.
 * That is the whole security property here: Banglore's CRM holds only
 * Banglore's secret, so it can only ever read or write Banglore's rows, no
 * matter what org or user id it sends.
 */
export const authenticateOrgService = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const presented = req.headers["x-org-secret"];

  if (typeof presented !== "string" || !presented) {
    sendError(res, "Missing service credential", 401);
    return;
  }

  try {
    /*
     * The secrets come from the environment now, not from the database. The
     * property that matters is unchanged: the org is decided by WHICH secret
     * matched, never by anything in the request.
     *
     * Only active organizations are considered, so deactivating one in the
     * portal closes this door too rather than leaving its secret working.
     */
    const orgs = await Organization.find({ isActive: true })
      .select("code name timezone currency")
      .lean();

    const candidates = allServiceSecrets(orgs.map((o) => o.code));
    const hit = candidates.find((c) => safeEqual(c.secret, presented));

    if (!hit) {
      sendError(res, "Invalid service credential", 401);
      return;
    }
    const matched = orgs.find((o) => o.code === hit.code)!;

    req.serviceOrg = {
      code: matched.code,
      name: matched.name,
      timezone: matched.timezone,
      currency: matched.currency,
    };
    next();
  } catch (error) {
    next(error);
  }
};
