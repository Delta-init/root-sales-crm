import { createHash, randomInt } from "node:crypto";
import { AdminUser } from "../models/AdminUser.js";
import { LoginCode } from "../models/LoginCode.js";
import { mailer } from "../lib/mailer.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt.js";
import type { JwtPayload } from "../types/index.js";

const httpError = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

/**
 * Ten minutes: long enough for mail to arrive and be read, short enough that a
 * code sitting in an unattended inbox stops being a key fairly quickly.
 */
const CODE_TTL_MS = 10 * 60_000;

/** Wrong guesses a single code survives before it is spent. */
const MAX_ATTEMPTS = 5;

/**
 * The account is part of what is hashed.
 *
 * Six digits are not unique on their own — two people signing in at the same
 * moment could hold the same ones — and a bare hash of the digits would let a
 * code minted for one person be presented for another. Binding it to the id
 * makes the stored value meaningless anywhere but that one account.
 */
const hashCode = (userId: string, code: string): string =>
  createHash("sha256").update(`${userId}:${code}`).digest("hex");

export const authService = {
  async login(email: string, password: string) {
    const admin = await AdminUser.findOne({ email: email.toLowerCase() }).select(
      "+password"
    );

    // Same message for "no such admin" and "wrong password" so the response
    // cannot be used to enumerate which emails are portal admins.
    if (!admin) throw httpError("Invalid email or password", 401);

    if (admin.status === "inactive") {
      throw httpError("Your account has been deactivated", 403);
    }

    const matches = await admin.comparePassword(password);
    if (!matches) throw httpError("Invalid email or password", 401);

    admin.lastLoginAt = new Date();
    await admin.save();

    const payload: JwtPayload = {
      adminId: admin._id.toString(),
      email: admin.email,
      role: admin.role,
    };

    return {
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken(payload),
      admin: admin.toJSON(),
    };
  },

  /**
   * Send somebody a code, if there is anybody to send it to.
   *
   * Always answers the same way. The form would otherwise be a way to ask
   * "does this person work here" one address at a time, and it is reachable
   * without signing in — so an unknown address, a deactivated account and a
   * real one are indistinguishable from the outside. Whether anything was
   * actually sent is deliberately not in the answer.
   *
   * Any code already outstanding is spent first. Two live codes would mean an
   * older one lingering in an inbox after somebody asked for a new one because
   * the first went astray, and the whole point of one-time is one.
   */
  async requestLoginCode(email: string, ip: string): Promise<void> {
    const admin = await AdminUser.findOne({ email: email.toLowerCase().trim() }).select(
      "email status",
    );
    if (!admin || admin.status !== "active") return;

    if (!mailer.isConfigured()) {
      // Distinct from "no such account": this is the server being unable, not
      // the address being wrong, and the caller is told so by the controller.
      throw httpError("Signing in by code is not configured on this server", 503);
    }

    await LoginCode.updateMany(
      { user: admin._id, usedAt: null },
      { $set: { usedAt: new Date() } },
    );

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await LoginCode.create({
      user: admin._id,
      codeHash: hashCode(String(admin._id), code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      requestedFromIp: ip,
    });

    await mailer.sendLoginCode(admin.email, code, CODE_TTL_MS / 60_000);
  },

  /**
   * Exchange a code for the same session a password would have produced.
   *
   * The code is looked up by hash rather than compared after fetching, so a
   * wrong one costs a failed index lookup instead of a comparison somebody
   * could time.
   *
   * Spending it is a single atomic update filtered on `usedAt: null`. A
   * read-then-write would let two browsers racing the same code both succeed
   * inside the window between.
   */
  async loginWithCode(email: string, code: string) {
    const wrong = () => httpError("That code is wrong or has expired", 401);

    const admin = await AdminUser.findOne({ email: email.toLowerCase().trim() });
    if (!admin) throw wrong();
    if (admin.status === "inactive") {
      throw httpError("Your account has been deactivated", 403);
    }

    const digits = String(code ?? "").trim();
    if (!/^\d{6}$/.test(digits)) throw wrong();

    const spent = await LoginCode.findOneAndUpdate(
      {
        user: admin._id,
        codeHash: hashCode(String(admin._id), digits),
        usedAt: null,
        expiresAt: { $gt: new Date() },
      },
      { $set: { usedAt: new Date() } },
      { new: true },
    );

    if (!spent) {
      /*
       * A wrong guess counts against whatever code is outstanding, and enough
       * of them spend it. Six digits are guessable in a million tries, and
       * without this the rate limit on the endpoint would be the only thing
       * standing between somebody patient and an account.
       */
      await LoginCode.updateMany(
        { user: admin._id, usedAt: null, attempts: { $gte: MAX_ATTEMPTS - 1 } },
        { $set: { usedAt: new Date() } },
      );
      await LoginCode.updateMany(
        { user: admin._id, usedAt: null },
        { $inc: { attempts: 1 } },
      );
      throw wrong();
    }

    admin.lastLoginAt = new Date();
    await admin.save();

    const payload: JwtPayload = {
      adminId: admin._id.toString(),
      email: admin.email,
      role: admin.role,
    };

    return {
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken(payload),
      admin: admin.toJSON(),
    };
  },

  async refresh(token: string) {
    const decoded = verifyRefreshToken(token);

    // Re-read the admin: a token issued before deactivation must stop working.
    const admin = await AdminUser.findById(decoded.adminId);
    if (!admin) throw httpError("Invalid refresh token", 401);
    if (admin.status === "inactive") {
      throw httpError("Your account has been deactivated", 403);
    }

    const payload: JwtPayload = {
      adminId: admin._id.toString(),
      email: admin.email,
      role: admin.role,
    };

    return {
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken(payload),
    };
  },

  async me(adminId: string) {
    const admin = await AdminUser.findById(adminId);
    if (!admin) throw httpError("Admin not found", 404);
    return admin.toJSON();
  },
};
