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
       * A viewer opens nothing, whatever accounts they happen to hold.
       *
       * Checked before anything is asked of the target, because this is a
       * decision about the role somebody was given here, not about what
       * exists elsewhere. Their definition is the group report and no doors.
       */
      if (admin.role === "viewer") {
        throw httpError("Your account can read the group report but cannot open these systems", 403);
      }

      /*
       * The target is asked whether this person has an account, and the
       * answer is taken live.
       *
       * This used to be an access row written in this portal. The rule was
       * right when a grant was the only thing that could be true, and it
       * stopped being right once the portal could see the systems themselves:
       * somebody with an account in a CRM can already sign into that CRM with
       * their own password, so refusing to send them there protected nothing
       * and cost them a tab. The grant still decides provisioning, and it is
       * still what the users screen reports.
       *
       * Asked at the moment of launching rather than read from whatever the
       * dashboard was told. That list is a minute old and cached; this is an
       * authorization decision, and an account removed in the meantime has to
       * close the door on the next click rather than the next refresh.
       *
       * A target that cannot answer refuses the launch. Not knowing is not
       * the same as yes, and the alternative — opening the door because the
       * lock could not be reached — is the wrong way for this to fail.
       */
      const { resolveTarget, callTarget } = await import("../lib/targetClient.js");
      const target = await resolveTarget(org.code);

      const params = new URLSearchParams({ email: admin.email });
      if (target.remoteOrgId) params.set("remoteOrgId", target.remoteOrgId);

      const account = await callTarget<{
        exists: boolean;
        inOrganization: boolean;
        status: string;
        membershipStatus: string | null;
      }>(target, `/user?${params.toString()}`, { method: "GET", verb: "confirm your account" });

      if (!account.exists || !account.inOrganization) {
        throw httpError(`You do not have an account in ${org.name}`, 403);
      }

      /*
       * Refused here as well as there. The target's own sign-in would reject
       * a deactivated account anyway, but it would do it after the redirect,
       * as an error on a screen they did not expect to see.
       */
      const standing = account.membershipStatus ?? account.status;
      if (standing && standing !== "active") {
        throw httpError(`Your account in ${org.name} is ${standing}`, 403);
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
