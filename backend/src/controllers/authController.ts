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

const requestCodeSchema = z.object({ email: z.email("A valid email is required") });
const codeLoginSchema = z.object({
  email: z.email("A valid email is required"),
  code: z.string().regex(/^\d{6}$/, "Enter the six digits from the email"),
});

const clientIp = (req: Request): string => {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "";
};

/**
 * Ask for a sign-in code.
 *
 * Answers the same whether or not the address belongs to anybody. This is
 * reachable without signing in, so an honest answer would turn it into a way
 * to ask who works here, one address at a time. The only failure it will admit
 * to is the server having no mailer, which is about this server rather than
 * about the person.
 */
export const requestLoginCode = async (req: Request, res: Response, next: NextFunction) => {
  const parsed = requestCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "Validation failed", 400, z.treeifyError(parsed.error));
    return;
  }

  try {
    await authService.requestLoginCode(parsed.data.email, clientIp(req));
    sendSuccess(res, "If that address has an account, a code is on its way", {});
  } catch (error) {
    // A missing mailer is worth saying out loud; anything else is swallowed
    // into the same reassuring sentence, for the reason above.
    if ((error as { statusCode?: number }).statusCode === 503) {
      next(error);
      return;
    }
    sendSuccess(res, "If that address has an account, a code is on its way", {});
  }
};

/** Exchange the code for the same session a password would have given. */
export const loginWithCode = async (req: Request, res: Response, next: NextFunction) => {
  const parsed = codeLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "Validation failed", 400, z.treeifyError(parsed.error));
    return;
  }

  const { email, code } = parsed.data;

  try {
    const result = await authService.loginWithCode(email, code);
    await record(req, "login", {
      adminId: result.admin._id?.toString(),
      adminEmail: result.admin.email,
      detail: "Signed in with an emailed code",
    });
    sendSuccess(res, "Logged in successfully", result);
  } catch (error) {
    await record(req, "login_failed", {
      adminEmail: email,
      detail: "Emailed code was wrong or expired",
    });
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
    /*
     * Who this session is, and — when it is borrowed — who borrowed it.
     *
     * The browser cannot work this out for itself: an impersonated session is
     * indistinguishable from that person signing in, which is the point. It
     * has to be told, or it cannot show the banner that stops somebody
     * forgetting whose account they are looking at.
     */
    const person = await authService.me(req.admin!.adminId);
    sendSuccess(res, "Admin fetched", {
      ...person,
      impersonatedBy: req.admin!.impersonatedBy ?? null,
    });
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
