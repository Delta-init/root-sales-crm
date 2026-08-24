import type { Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { sendError } from "../utils/response.js";
import { repFromToken } from "../services/repAuthService.js";
import type { AuthenticatedRequest, RepJwtPayload } from "../types/index.js";

/**
 * Authenticate a sales rep.
 *
 * Rejects anything that is not a rep token. Admin and rep tokens are signed
 * with the same secret, so without the `kind` check an admin session would
 * satisfy these routes and — because every rep route scopes to
 * `req.rep.repId` — would write to whichever rep id the admin's payload
 * happened to carry.
 */
export const authenticateRep = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      sendError(res, "Access token is required", 401);
      return;
    }

    const decoded = verifyAccessToken(header.split(" ")[1]) as unknown as RepJwtPayload;
    if (decoded?.kind !== "rep") {
      sendError(res, "This endpoint is for sales reps", 403);
      return;
    }

    // Hit the CRM rather than trusting the token: deactivating a rep has to
    // take effect now, not whenever their token happens to expire.
    req.rep = await repFromToken(decoded);
    next();
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status) {
        sendError(res, error.message, status);
        return;
      }
      if (error.name === "TokenExpiredError") {
        sendError(res, "Session expired", 401);
        return;
      }
    }
    sendError(res, "Authentication failed", 401);
  }
};
