import type { Response, NextFunction } from "express";
import { orgService } from "../services/orgService.js";
import { record } from "../services/auditService.js";
import { sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

/**
 * The systems this person should be shown.
 *
 * Answered per signed-in account rather than as one list for everybody: a
 * member has no use for the systems they are not on, and listing them told
 * anybody who signed in the shape of the whole estate.
 */
export const listOrgs = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const admin = req.admin!;
    sendSuccess(
      res,
      "Organizations fetched",
      await orgService.listForAdmin({
        adminId: admin.adminId,
        email: admin.email,
        role: admin.role,
      }),
    );
  } catch (error) {
    next(error);
  }
};

/** Everything in the registry, switched off included. Administrators only. */
export const listAllOrgs = async (
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    sendSuccess(res, "Registry fetched", await orgService.listAll());
  } catch (error) {
    next(error);
  }
};

export const createOrg = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const org = await orgService.create(req.body as Record<string, unknown>);
    await record(req, "target_registered", {
      adminId: req.admin!.adminId,
      adminEmail: req.admin!.email,
      org: null,
      detail: `Registered ${org.name} (${org.code})`,
    });
    sendSuccess(res, "Target registered", org, 201);
  } catch (error) {
    next(error);
  }
};

export const updateOrg = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const code = String(req.params["code"] ?? "");
    const org = await orgService.update(code, req.body as Record<string, unknown>);
    await record(req, "target_updated", {
      adminId: req.admin!.adminId,
      adminEmail: req.admin!.email,
      org: null,
      detail: `Updated ${org.name} (${org.code})`,
    });
    sendSuccess(res, "Target updated", org);
  } catch (error) {
    next(error);
  }
};
