import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest, AdminRole } from "../types/index.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { sendError } from "../utils/response.js";
import { AdminUser } from "../models/AdminUser.js";

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      sendError(res, "Access token is required", 401);
      return;
    }

    const decoded = verifyAccessToken(authHeader.split(" ")[1]);

    // Reject rep tokens explicitly. Admin and rep sessions are signed with the
    // same secret, so without this a rep token fell through to the AdminUser
    // lookup and was refused only because its adminId happened to be
    // undefined — the right outcome for the wrong reason, and one that a
    // future payload change could quietly undo.
    if ((decoded as unknown as { kind?: string }).kind === "rep") {
      sendError(res, "This endpoint is for portal admins", 403);
      return;
    }

    // Hit the DB on every request rather than trusting the token alone. This
    // endpoint set can open three production CRMs, so revoking an admin has to
    // take effect immediately, not whenever their token happens to expire.
    const admin = await AdminUser.findById(decoded.adminId).select("status role email");
    if (!admin) {
      sendError(res, "Admin no longer exists", 401);
      return;
    }
    if (admin.status === "inactive") {
      sendError(res, "Your account has been deactivated", 403);
      return;
    }

    /*
     * Identity, standing and role all come from the record rather than the
     * token, which is what makes an impersonation token safe to hand out at
     * all: it can say who to be, and it cannot say what they may do. A root
     * admin looking at the portal as a member has exactly a member's reach,
     * because that is what the member's own row says.
     *
     * The one claim carried through untouched is who is really holding it.
     * Rebuilding this object from the database would otherwise drop it, and
     * every impersonated action would be recorded as the impersonated person
     * doing it themselves — which is the one thing this must never do.
     */
    req.admin = {
      adminId: admin._id.toString(),
      email: admin.email,
      role: admin.role,
      ...(decoded.impersonatedBy ? { impersonatedBy: decoded.impersonatedBy } : {}),
    };

    next();
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.name === "TokenExpiredError") {
        sendError(res, "Access token expired", 401);
        return;
      }
      if (error.name === "JsonWebTokenError") {
        sendError(res, "Invalid access token", 401);
        return;
      }
    }
    sendError(res, "Authentication failed", 401);
  }
};

/** Gate for actions a viewer must not perform — SSO launches, above all. */
export const requireRole =
  (...roles: AdminRole[]) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      sendError(res, "You do not have permission to perform this action", 403);
      return;
    }
    next();
  };
