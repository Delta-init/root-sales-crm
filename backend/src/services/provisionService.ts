import { Organization } from "../models/Organization.js";
import { AdminUser } from "../models/AdminUser.js";

/**
 * Making somebody an account in another system.
 *
 * SSO deliberately will not create one: the target trusts whatever this portal
 * says, so an account appearing because a token arrived would turn a spoofed
 * portal into an instant account with whatever role it asked for. The refusal
 * is right, but it left a root admin with nowhere to go — they granted access
 * and the person still could not get in.
 *
 * So this is the other half, and it is deliberately a different act: an
 * administrator decides, on purpose, one person at a time, and it is written
 * to the audit log. Nothing about a sign-in creates anything.
 *
 * The target is asked over its own service endpoint, authenticated with the
 * shared secret already held for it in the registry. No secret configured
 * means no provisioning, rather than an unauthenticated call.
 */

const TIMEOUT_MS = 15_000;

const httpError = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

export interface ProvisionResult {
  created: boolean;
  userId: string;
  detail: string;
}

export const provisionService = {
  async provision(input: {
    userId: string;
    targetCode: string;
    roleInTarget: string;
  }): Promise<ProvisionResult & { targetName: string; email: string }> {
    const person = await AdminUser.findById(input.userId).select("name email status");
    if (!person) throw httpError("No such person", 404);
    if (person.status !== "active") {
      throw httpError("That account is deactivated here, so it should not be created elsewhere", 409);
    }

    const org = await Organization.findOne({ code: input.targetCode }).select("+ssoSecret");
    if (!org) throw httpError(`Unknown target: ${input.targetCode}`, 404);
    if (!org.isActive) throw httpError(`${org.name} is not active`, 409);
    if (!org.apiUrl) throw httpError(`${org.name} has no API address configured`, 503);
    if (!org.ssoSecret) {
      throw httpError(
        `${org.name} has no shared secret configured, so this portal cannot ask it to create anything`,
        503,
      );
    }

    const base = org.apiUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${base}/api/v1/service/provision-user`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-portal-secret": org.ssoSecret },
        body: JSON.stringify({
          email: person.email,
          name: person.name,
          role: input.roleInTarget,
          // Blank where the target is one organization per deployment; the
          // target decides whether it needs it.
          remoteOrgId: org.remoteOrgId || undefined,
        }),
        signal: controller.signal,
      });

      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: ProvisionResult;
        message?: string;
        error?: { message?: string };
      };

      if (!res.ok) {
        // The target's own words. It knows why far better than this does —
        // an unknown role, a name that fails its own validation.
        const why = body.error?.message ?? body.message ?? `refused with ${res.status}`;
        throw httpError(`${org.name} would not create the account: ${why}`, res.status === 401 ? 502 : 409);
      }
      if (!body.data) throw httpError(`${org.name} returned nothing`, 502);

      return { ...body.data, targetName: org.name, email: person.email };
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode) throw err;
      throw httpError(`${org.name} could not be reached`, 502);
    } finally {
      clearTimeout(timer);
    }
  },
};
