import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { JwtPayload } from "../types/index.js";

export const signAccessToken = (payload: JwtPayload): string =>
  jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });

export const signRefreshToken = (payload: JwtPayload): string =>
  jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });

/**
 * Half an hour, and not a minute of it renewable.
 *
 * Long enough to look around somebody's account and find whatever you went in
 * for; short enough that a tab left open over lunch stops being a way into
 * their account. There is deliberately no refresh counterpart — an
 * impersonation able to renew itself would be a second permanent session for
 * as long as nobody noticed, which is the opposite of the point.
 */
export const IMPERSONATION_TTL_SECONDS = 30 * 60;

/**
 * A session that is somebody else, and says who is really holding it.
 *
 * Signed with the ordinary access secret on purpose: this is a normal session
 * everywhere it is read, which is what makes the impersonated view honest
 * rather than a special case every screen has to remember to handle.
 */
export const signImpersonationToken = (payload: JwtPayload): string =>
  jwt.sign(payload, env.JWT_SECRET, { expiresIn: IMPERSONATION_TTL_SECONDS });

export const verifyAccessToken = (token: string): JwtPayload =>
  jwt.verify(token, env.JWT_SECRET) as JwtPayload;

export const verifyRefreshToken = (token: string): JwtPayload =>
  jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
