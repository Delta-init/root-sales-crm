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

    req.admin = {
      adminId: admin._id.toString(),
      email: admin.email,
      role: admin.role,
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
