import { AdminUser } from "../models/AdminUser.js";
import { callTarget, resolveTarget, httpError } from "../lib/targetClient.js";

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

    const target = await resolveTarget(input.targetCode);

    const data = await callTarget<ProvisionResult>(target, "/provision-user", {
      method: "POST",
      verb: "create the account",
      body: {
        email: person.email,
        name: person.name,
        role: input.roleInTarget,
        // Blank where the target is one organization per deployment; the
        // target decides whether it needs it.
        remoteOrgId: target.remoteOrgId || undefined,
      },
    });

    return { ...data, targetName: target.name, email: person.email };
  },
};
