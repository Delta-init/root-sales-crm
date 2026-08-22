import { AdminUser } from "../models/AdminUser.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt.js";
import type { JwtPayload } from "../types/index.js";

const httpError = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

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
