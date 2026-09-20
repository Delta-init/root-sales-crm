import type { Response, NextFunction } from "express";
import { orgService } from "../services/orgService.js";
import { record } from "../services/auditService.js";
import { sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

export const listOrgs = async (
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    sendSuccess(res, "Organizations fetched", await orgService.list());
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
