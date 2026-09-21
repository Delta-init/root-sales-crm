import { AdminUser } from "../models/AdminUser.js";
import { Organization } from "../models/Organization.js";
import { Access } from "../models/Access.js";
import { callTarget, resolveTarget, httpError } from "../lib/targetClient.js";
import type { TargetCode } from "../types/index.js";

/**
 * One person, as every system actually sees them.
 *
 * The portal has always known what it granted. What it could not tell you is
 * what any of those systems did with it — whether the account exists, what
 * role it really holds, whether somebody changed it there last month. So a
 * grant saying "salesperson" could sit next to an account that had been an
 * accountant since March, and the portal would keep showing the grant.
 *
 * Asking the target is the only honest answer, so that is what this does.
 */

export interface TargetRole {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
}

export interface TargetAccount {
  exists: boolean;
  inOrganization: boolean;
  name: string;
  status: string;
  membershipStatus: string | null;
  roleKey: string | null;
  roleName: string | null;
  permissions: string[];
  lastLoginAt: string | null;
}

export interface TargetView {
  target: TargetCode;
  targetName: string;
  kind: string;
  /** What this portal granted, if anything. */
  granted: boolean;
  roleInTarget: string | null;
  grantedAt: string | null;
  /** What the target says, or why it could not be asked. */
  account: TargetAccount | null;
  unreachable: string | null;
  /** The grant and the target disagree about the role. */
  drift: string | null;
}

/** One system's answer about one person, as the list column needs it. */
export interface PresenceEntry {
  roleKey: string | null;
  roleName: string | null;
  status: string;
}

/** What a target's bulk endpoint returns per address. */
interface PortalAccountSummary {
  email: string;
  exists: boolean;
  inOrganization?: boolean;
  name?: string;
  status?: string;
  roleKey?: string | null;
  roleName?: string | null;
}

/**
 * The most people this portal will ask about in one sweep.
 *
 * A page of the user list is twenty-five. The cap is far above that so the
 * page never has to think about it, and it matches what the targets accept,
 * so a request this portal allows cannot be one they will refuse.
 */
const MAX_EMAILS = 500;

const qs = (params: Record<string, string>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const s = search.toString();
  return s ? `?${s}` : "";
};

export const directoryService = {
  /**
   * The roles a target actually has.
   *
   * Fetched live rather than cached. A cached list goes stale exactly when it
   * matters — somebody adds a role in finance and the portal keeps offering
   * yesterday's — and these are administrator-speed calls, not hot paths.
   */
  async listRoles(code: string): Promise<{ targetName: string; roles: TargetRole[] }> {
    const target = await resolveTarget(code);
    const data = await callTarget<{ organization: string; roles: TargetRole[] }>(
      target,
      `/roles${qs({ remoteOrgId: target.remoteOrgId })}`,
      { method: "GET", verb: "list its roles" },
    );
    return { targetName: target.name, roles: data.roles ?? [] };
  },

  /**
   * Everything about one person, across every registered system.
   *
   * Every target is asked, not only the ones with a grant. An account nobody
   * granted is the more interesting finding: it is somebody who can get in
   * through a door this portal does not know about.
   */
  async describe(userId: string): Promise<{
    person: { id: string; name: string; email: string; role: string; status: string };
    targets: TargetView[];
  }> {
    const person = await AdminUser.findById(userId).select("name email role status");
    if (!person) throw httpError("No such person", 404);

    const orgs = await Organization.find({ isActive: true })
      .select("code name kind")
      .sort({ name: 1 })
      .lean();
    const grants = await Access.find({ user: userId }).lean();
    const grantFor = new Map(grants.map((g) => [String(g.target), g]));

    /*
     * Asked in parallel, and one target being down must not hide the others.
     * A settled result per target means an unreachable finance server shows
     * as unreachable beside a perfectly readable HRMS, rather than the whole
     * screen failing because of one of them.
     */
    const views = await Promise.all(
      orgs.map(async (org): Promise<TargetView> => {
        const grant = grantFor.get(String(org.code));
        const base: TargetView = {
          target: org.code as TargetCode,
          targetName: org.name,
          kind: String(org.kind ?? ""),
          granted: Boolean(grant),
          roleInTarget: grant?.roleInTarget ?? null,
          grantedAt: grant?.createdAt ? new Date(grant.createdAt).toISOString() : null,
          account: null,
          unreachable: null,
          drift: null,
        };

        try {
          const target = await resolveTarget(String(org.code));
          const account = await callTarget<TargetAccount>(
            target,
            `/user${qs({ remoteOrgId: target.remoteOrgId, email: person.email })}`,
            { method: "GET", verb: "describe that account" },
          );
          base.account = account;

          /*
           * The two things worth flagging, in the order that matters: an
           * account the portal never granted, then a role that has moved.
           */
          if (account.inOrganization && !grant) {
            base.drift = `Has an account here as ${account.roleName ?? account.roleKey ?? "an unknown role"}, but this portal never granted it`;
          } else if (
            account.inOrganization &&
            grant &&
            account.roleKey &&
            account.roleKey.toLowerCase() !== String(grant.roleInTarget).trim().toLowerCase()
          ) {
            base.drift = `This portal recorded ${grant.roleInTarget}, but ${org.name} has them as ${account.roleName ?? account.roleKey}`;
          } else if (grant && account.exists && !account.inOrganization) {
            base.drift = "Granted here, but the account is not a member — it has not been created yet";
          } else if (grant && !account.exists) {
            base.drift = "Granted here, but no account exists — it has not been created yet";
          }
        } catch (err) {
          /*
           * Not an error for the whole request. A target that is not
           * configured yet is the normal state of a registry being filled in,
           * and it should read as "cannot say" rather than breaking the page.
           */
          base.unreachable = (err as Error).message;
        }

        return base;
      }),
    );

    return {
      person: {
        id: String(person._id),
        name: person.name,
        email: person.email,
        role: person.role,
        status: person.status,
      },
      targets: views,
    };
  },

  /**
   * Change the role somebody holds inside a target, for real.
   *
   * Both halves, in an order chosen on purpose: the target first, then the
   * portal's record. If the target refuses, the portal's record is left
   * alone and still matches reality. Writing the record first would leave it
   * claiming a change that never happened — which is the exact drift this
   * whole screen exists to surface.
   */
  async setRoleInTarget(input: {
    userId: string;
    targetCode: string;
    roleInTarget: string;
    grantedBy: string;
  }): Promise<{ detail: string; targetName: string; roleKey: string }> {
    const person = await AdminUser.findById(input.userId).select("name email status");
    if (!person) throw httpError("No such person", 404);
    if (person.status !== "active") {
      throw httpError("That account is deactivated here, so its access elsewhere should not be widened", 409);
    }

    const role = input.roleInTarget.trim();
    if (!role) throw httpError("A role is required", 400);

    const target = await resolveTarget(input.targetCode);
    const result = await callTarget<{ detail: string; roleKey: string; membershipStatus: string }>(
      target,
      "/set-user-role",
      {
        method: "POST",
        verb: "change that role",
        body: {
          email: person.email,
          role,
          remoteOrgId: target.remoteOrgId || undefined,
        },
      },
    );

    await Access.findOneAndUpdate(
      { user: input.userId, target: input.targetCode },
      {
        $set: { roleInTarget: result.roleKey || role, grantedBy: input.grantedBy },
        $setOnInsert: { user: input.userId, target: input.targetCode },
      },
      { upsert: true, new: true },
    );

    return { detail: result.detail, targetName: target.name, roleKey: result.roleKey || role };
  },

  /**
   * Which systems each of these people actually has an account on.
   *
   * `describe` answers this for one person by asking every system about them.
   * The user list needs the same answer for a page of twenty-five, and asking
   * per person would be twenty-five requests to each system for one screen.
   * So each system is asked once, about everybody on the page.
   *
   * What comes back is deliberately two separate things. `platforms` says
   * which systems were asked and which of them could not answer; `presence`
   * says what the ones that did answer said. A system that is unreachable has
   * no entry in anybody's presence, and the caller must read that as "not
   * known" rather than "no account" — the whole value of this column is that
   * it reports what is really there, and a column that quietly turns silence
   * into absence would be worse than no column at all.
   */
  async presenceFor(emails: string[]): Promise<{
    platforms: { target: TargetCode; targetName: string; kind: string; unreachable: string | null }[];
    presence: Record<string, Record<string, PresenceEntry>>;
  }> {
    const wanted: string[] = [];
    const seen = new Set<string>();
    for (const raw of emails) {
      const email = String(raw ?? "").toLowerCase().trim();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      wanted.push(email);
    }
    if (wanted.length === 0) return { platforms: [], presence: {} };
    if (wanted.length > MAX_EMAILS) {
      throw httpError(`At most ${MAX_EMAILS} people at a time`, 400);
    }

    const orgs = await Organization.find({ isActive: true })
      .select("code name kind")
      .sort({ name: 1 })
      .lean();

    const presence: Record<string, Record<string, PresenceEntry>> = {};
    for (const email of wanted) presence[email] = {};

    /*
     * Every system asked at once, and one being down must not hide the rest.
     * A settled result per system means an undeployed LMS shows as "cannot
     * say" beside a Finance that answered properly, rather than the column
     * failing as a whole because of one of them.
     */
    const platforms = await Promise.all(
      orgs.map(async (org) => {
        const row = {
          target: org.code as TargetCode,
          targetName: org.name,
          kind: String(org.kind ?? ""),
          unreachable: null as string | null,
        };

        try {
          const target = await resolveTarget(String(org.code));
          const data = await callTarget<{ accounts: PortalAccountSummary[] }>(
            target,
            "/accounts",
            {
              method: "POST",
              verb: "say who has an account",
              body: {
                emails: wanted,
                remoteOrgId: target.remoteOrgId || undefined,
              },
            },
          );

          for (const account of data.accounts ?? []) {
            const email = String(account.email ?? "").toLowerCase().trim();
            // Only record what was asked for. A system answering about
            // somebody else is not something to quietly put on a row.
            if (!presence[email]) continue;
            if (!account.exists || account.inOrganization === false) continue;
            presence[email][String(org.code)] = {
              roleKey: account.roleKey ?? null,
              roleName: account.roleName ?? null,
              status: account.status ?? "",
            };
          }
        } catch (err) {
          row.unreachable = (err as Error).message;
        }

        return row;
      }),
    );

    return { platforms, presence };
  },
};
