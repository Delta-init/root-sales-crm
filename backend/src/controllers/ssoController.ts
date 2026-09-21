import type { Request, Response, NextFunction } from "express";
import { ssoService } from "../services/ssoService.js";
import { record } from "../services/auditService.js";
import { sendSuccess, sendError } from "../utils/response.js";
import type { AuthenticatedRequest, OrgCode } from "../types/index.js";

const clientIp = (req: Request): string => {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "";
};

/** POST /api/v1/sso/launch — portal admin asks to be dropped into a CRM. */
export const launch = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const orgCode = String(req.body?.org ?? "").trim();
  const admin = req.admin!;

  if (!orgCode) {
    sendError(res, "org is required", 400);
    return;
  }

  try {
    const result = await ssoService.launch(admin, orgCode, clientIp(req));
    /*
     * Recorded against whoever is really holding the session.
     *
     * `admin` here is the account the session belongs to, which under
     * impersonation is the person being looked at — so logging that alone
     * would file a root admin's launch under somebody else's name, in the one
     * record that exists to prevent exactly that.
     */
    const by = admin.impersonatedBy;
    await record(req, by ? "impersonation_launch" : "sso_launch", {
      adminId: by ? by.id : admin.adminId,
      adminEmail: by ? by.email : admin.email,
      org: result.org.code,
      detail: by
        ? `Launched into ${result.org.name} as ${admin.email}, while viewing the portal as them`
        : `Launched into ${result.org.name}`,
    });
    sendSuccess(res, "SSO launch ready", result);
  } catch (error) {
    // Attributed the same way as a success. A refusal is as much a thing
    // somebody did as an opening.
    await record(req, "sso_launch_failed", {
      adminId: admin.impersonatedBy?.id ?? admin.adminId,
      adminEmail: admin.impersonatedBy?.email ?? admin.email,
      org: (orgCode as OrgCode) || null,
      detail: admin.impersonatedBy
        ? `As ${admin.email}: ${error instanceof Error ? error.message : "unknown error"}`
        : error instanceof Error ? error.message : "unknown error",
    });
    next(error);
  }
};

/**
 * GET /api/auth/verify-sso-token?token=…
 *
 * Called server-to-server by a CRM backend. The path and the response envelope
 * are fixed by the CRM side, which already reads `data.{id,email,name,role}` —
 * changing the shape here would silently break Delta's existing ssoLogin.
 */
export const verify = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = String(req.query.token ?? "");
    sendSuccess(res, "SSO token verified", await ssoService.verify(token));
  } catch (error) {
    next(error);
  }
};
