import { randomBytes } from "node:crypto";
import { SsoToken } from "../models/SsoToken.js";
import { orgService } from "./orgService.js";
import type { JwtPayload, OrgCode } from "../types/index.js";

/** Deliberately short. The token is only in flight for one redirect. */
const TOKEN_TTL_MS = 60_000;

const httpError = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

export const ssoService = {
  /**
   * Mint a handoff token and build the URL that lands the admin inside the CRM.
   *
   * The CRM is not called here. It calls back to `verify` once the browser
   * arrives, which keeps the portal's admin identity off the wire except over
   * the CRM's own outbound request.
   */
  async launch(admin: JwtPayload, orgCode: string, ip: string) {
    const org = await orgService.getWithSecrets(orgCode);
    if (!org) throw httpError(`Unknown organisation: ${orgCode}`, 404);
    if (!org.isActive) throw httpError(`${org.name} is not active`, 409);

    if (!org.serviceEmail) {
      throw httpError(
        `${org.name} has no service account configured. Set serviceEmail on the org registry.`,
        503
      );
    }
    if (!org.appUrl) {
      throw httpError(`${org.name} has no appUrl configured`, 503);
    }

    const token = randomBytes(32).toString("hex");

    await SsoToken.create({
      token,
      admin: admin.adminId,
      adminEmail: admin.email,
      org: org.code,
      subjectEmail: org.serviceEmail,
      subjectName: "Root Admin",
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      issuedToIp: ip,
    });

    const base = org.appUrl.replace(/\/+$/, "");
    return {
      url: `${base}/sso?token=${token}`,
      org: { code: org.code as OrgCode, name: org.name },
      expiresInSeconds: TOKEN_TTL_MS / 1000,
    };
  },

  /**
   * Redeem a handoff token. Called by the CRM backend, not the browser.
   *
   * The find-and-mark is a single atomic update filtered on `usedAt: null`, so
   * two simultaneous redemptions cannot both succeed — a read-then-write would
   * let a leaked token be replayed inside the race window.
   */
  async verify(token: string) {
    if (!token) throw httpError("token is required", 400);

    const record = await SsoToken.findOneAndUpdate(
      { token, usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { new: true }
    );

    // One message for expired, already-spent and never-existed. Distinguishing
    // them would tell an attacker holding a stale token which case they hit.
    if (!record) throw httpError("Invalid or expired SSO token", 401);

    return {
      id: record.admin.toString(),
      email: record.subjectEmail,
      name: record.subjectName,
      role: "Super Admin",
    };
  },
};
