import { randomBytes } from "node:crypto";
import { SsoToken } from "../models/SsoToken.js";
import { orgService } from "./orgService.js";
import type { JwtPayload, OrgCode } from "../types/index.js";
import { targetConfig, missingFor, envKeyFor } from "../config/targets.js";

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

    /*
     * Who is going, and as whom.
     *
     * A root admin arrives as the org's shared service account, which is what
     * this portal has always done: they are there to administer, the account
     * exists for the purpose, and every use of it is in the audit log.
     *
     * Everybody else arrives as themselves. That is the whole difference
     * between a control tower and somewhere staff sign in: a rep landing in a
     * CRM as "Root Admin" would own every record they touched, and the CRM
     * would have no idea who had actually been in it.
     */
    const isRootAdmin = admin.role === "root_admin";

    /*
     * The name is read from the record rather than carried in the token: a
     * session minted before somebody was renamed would otherwise walk into
     * another system under the old one, and the status check below is the same
     * gate a password login applies — deactivating somebody has to lock every
     * door, not only the one with the password on it.
     */
    let subjectName = "Root Admin";
    if (!isRootAdmin) {
      const { AdminUser } = await import("../models/AdminUser.js");
      const user = await AdminUser.findById(admin.adminId).select("name status");
      if (!user) throw httpError("Your account no longer exists", 401);
      if (user.status !== "active") throw httpError("Your account has been deactivated", 403);
      subjectName = user.name || admin.email;
    }

    if (!isRootAdmin) {
      /*
       * Listed, not inferred. A member may open exactly what somebody wrote an
       * access row for — the rule that keeps a Banglore rep out of Delta's CRM.
       */
      const { accessService } = await import("./accessService.js");
      const grant = await accessService.find(admin.adminId, org.code);
      if (!grant) {
        throw httpError(`You do not have access to ${org.name}`, 403);
      }
    }

    const cfg = targetConfig(org.code);
    if (isRootAdmin && !cfg.serviceEmail) {
      throw httpError(
        `${org.name} has no service account configured — set ${envKeyFor(org.code)}_SERVICE_EMAIL`,
        503
      );
    }
    const missing = missingFor(org.code, ["appUrl"]);
    if (missing.length) {
      throw httpError(`${org.name} is not configured on this server — set ${missing[0]}`, 503);
    }

    const token = randomBytes(32).toString("hex");

    await SsoToken.create({
      token,
      admin: admin.adminId,
      adminEmail: admin.email,
      org: org.code,
      subjectEmail: isRootAdmin ? cfg.serviceEmail : admin.email,
      subjectName,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      issuedToIp: ip,
    });

    const base = cfg.appUrl.replace(/\/+$/, "");
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
