import type { Response, NextFunction } from "express";
import { orgService } from "../services/orgService.js";
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
