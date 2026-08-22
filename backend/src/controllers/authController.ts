import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authService } from "../services/authService.js";
import { record } from "../services/auditService.js";
import { sendSuccess, sendError } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

const loginSchema = z.object({
  email: z.email("A valid email is required"),
  password: z.string().min(1, "Password is required"),
});

export const login = async (req: Request, res: Response, next: NextFunction) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "Validation failed", 400, z.treeifyError(parsed.error));
    return;
  }

  const { email, password } = parsed.data;

  try {
    const result = await authService.login(email, password);
    await record(req, "login", {
      adminId: result.admin._id?.toString(),
      adminEmail: result.admin.email,
    });
    sendSuccess(res, "Logged in successfully", result);
  } catch (error) {
    await record(req, "login_failed", { adminEmail: email });
    next(error);
  }
};

export const refresh = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) {
      sendError(res, "Refresh token is required", 400);
      return;
    }
    sendSuccess(res, "Token refreshed", await authService.refresh(refreshToken));
  } catch (error) {
    next(error);
  }
};

export const me = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Admin fetched", await authService.me(req.admin!.adminId));
  } catch (error) {
    next(error);
  }
};

export const logout = async (req: AuthenticatedRequest, res: Response) => {
  await record(req, "logout", {
    adminId: req.admin!.adminId,
    adminEmail: req.admin!.email,
  });
  // Tokens are stateless; the client discards them. The audit row is the point.
  sendSuccess(res, "Logged out successfully");
};
