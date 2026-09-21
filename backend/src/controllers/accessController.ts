import type { Response, NextFunction } from "express";
import { randomBytes } from "node:crypto";
import { AdminUser } from "../models/AdminUser.js";
import { Access } from "../models/Access.js";
import { Organization } from "../models/Organization.js";
import { accessService } from "../services/accessService.js";
import { provisionService } from "../services/provisionService.js";
import { directoryService } from "../services/directoryService.js";
import { record } from "../services/auditService.js";
import { sendError, sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest, TargetCode } from "../types/index.js";

/**
 * Who may open what, as a screen can show it.
 *
 * One row per person with their grants attached, rather than a grants endpoint
 * somebody has to call once per person: the question this answers is "who can
 * get into what", and answering it a person at a time makes the screen do the
 * joining.
 */
export const listPeople = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const q = String(req.query["q"] ?? "").trim();
    const filter: Record<string, unknown> = {};
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter["$or"] = [{ name: rx }, { email: rx }];
    }

    const people = await AdminUser.find(filter).sort({ name: 1 }).lean();
    const grants = await Access.find({ user: { $in: people.map((p) => p._id) } }).lean();

    const byUser = new Map<string, { target: string; roleInTarget: string }[]>();
    for (const g of grants) {
      const key = String(g.user);
      byUser.set(key, [...(byUser.get(key) ?? []), { target: g.target, roleInTarget: g.roleInTarget }]);
    }

    sendSuccess(
      res,
      "People fetched",
      people.map((p) => ({
        id: String(p._id),
        name: p.name,
        email: p.email,
        role: p.role,
        status: p.status,
        lastLoginAt: p.lastLoginAt ?? null,
        access: (byUser.get(String(p._id)) ?? []).sort((a, b) => a.target.localeCompare(b.target)),
      }))
    );
  } catch (err) { next(err); }
};

/** Everywhere a person could be sent, for the picker. */
export const listTargets = async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const orgs = await Organization.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();
    sendSuccess(
      res,
      "Targets fetched",
      orgs.map((o) => ({ code: o.code, name: o.name, kind: o.kind ?? "crm" }))
    );
  } catch (err) { next(err); }
};

export const grant = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { userId, target, roleInTarget } = req.body as {
      userId?: string; target?: string; roleInTarget?: string;
    };
    if (!userId || !target || !roleInTarget?.trim()) {
      sendError(res, "userId, target and roleInTarget are all required", 400);
      return;
    }

    const person = await AdminUser.findById(userId).select("name email role");
    if (!person) { sendError(res, "No such person", 404); return; }

    // Only somewhere that is actually registered: a grant naming a target the
    // portal does not know would sit there looking valid and open nothing.
    const org = await Organization.findOne({ code: target }).select("name isActive");
    if (!org) { sendError(res, `Unknown target: ${target}`, 404); return; }
    if (!org.isActive) { sendError(res, `${org.name} is not active`, 409); return; }

    const row = await accessService.grant({
      userId, target: target as TargetCode,
      roleInTarget: roleInTarget.trim(),
      grantedBy: req.admin!.adminId,
    });

    /*
     * Worth a line in the audit log. A grant is the moment somebody gains
     * reach into another system, and "who opened this door, and when" is the
     * question asked afterwards rather than at the time.
     */
    await record(req, "access_granted", {
      adminId: req.admin!.adminId,
      adminEmail: req.admin!.email,
      org: null,
      detail: `Granted ${person.email} access to ${org.name} as ${roleInTarget.trim()}`,
    });

    /*
     * What the rules say this also means — applied, and named in the answer.
     * Access appearing that nobody asked for is alarming even when it is
     * right, so the screen is told what was added and why.
     */
    const sourceName = org.name;
    const alsoGave: { target: string; roleInTarget: string }[] = [];
    for (const extra of await accessService.implied({
      userId, target: target as TargetCode, roleInTarget: roleInTarget.trim(),
    })) {
      const org = await Organization.findOne({ code: extra.target }).select("name isActive");
      if (!org?.isActive) continue;
      await accessService.grant({
        userId, target: extra.target,
        roleInTarget: extra.roleInTarget,
        grantedBy: req.admin!.adminId,
      });
      alsoGave.push({ target: org.name, roleInTarget: extra.roleInTarget });
      await record(req, "access_granted", {
        adminId: req.admin!.adminId,
        adminEmail: req.admin!.email,
        org: null,
        detail: `Granted ${person.email} access to ${org.name} as ${extra.roleInTarget}, implied by being ${roleInTarget.trim()} in ${sourceName}`,
      });
    }

    sendSuccess(res, "Access granted", {
      target: row.target,
      roleInTarget: row.roleInTarget,
      alsoGave,
    });
  } catch (err) { next(err); }
};

/**
 * Create the account in the target, for somebody who has none.
 *
 * Separate from granting, and on purpose. A grant says where somebody may go;
 * this makes them exist there. Rolling the two together would mean every grant
 * silently creating accounts in production systems, which is a much bigger
 * thing than deciding who may open what.
 */
export const provision = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { userId, target, roleInTarget } = req.body as {
      userId?: string; target?: string; roleInTarget?: string;
    };
    if (!userId || !target || !roleInTarget?.trim()) {
      sendError(res, "userId, target and roleInTarget are all required", 400);
      return;
    }

    const result = await provisionService.provision({
      userId, targetCode: target, roleInTarget: roleInTarget.trim(),
    });

    await record(req, "account_provisioned", {
      adminId: req.admin!.adminId,
      adminEmail: req.admin!.email,
      org: null,
      detail: result.created
        ? `Created an account for ${result.email} in ${result.targetName} as ${roleInTarget.trim()}`
        : `${result.email} already had an account in ${result.targetName}`,
    });

    sendSuccess(res, result.created ? "Account created" : "They already had one", result);
  } catch (err) { next(err); }
};

/**
 * Everybody HRMS knows, and whether the portal already has them.
 *
 * HRMS is where a person first exists — HR creates the employee, and this
 * reads them from there rather than asking somebody to type the same staff in
 * twice. Two lists of one workforce drift, and since email is what every
 * handoff matches on, a second spelling of an address is a person who cannot
 * sign in rather than a cosmetic difference.
 */
export const hrmsDirectory = async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { listEmployees, listDepartments } = await import("../lib/hrmsClient.js");

    /*
     * The roster, and the department names it refers to by id.
     *
     * Settled rather than awaited together: a directory that arrives without
     * department names is still the list somebody came here to read, and
     * failing the whole screen because one of two calls did not answer would
     * trade something useful for nothing.
     */
    const [staff, departments] = await Promise.all([
      listEmployees(),
      listDepartments().catch(() => []),
    ]);
    const deptName = new Map(departments.map((d) => [d.id, d.name]));

    const existing = await AdminUser.find({}).select("email").lean();
    const have = new Set(existing.map((u) => String(u.email).toLowerCase()));

    sendSuccess(
      res,
      "Directory fetched",
      staff
        // Somebody with no address cannot be imported: there would be nothing
        // to sign them in with, here or anywhere they were then sent.
        .filter((e) => e.email?.trim())
        .map((e) => ({
          employeeCode: e.employeeCode,
          name: e.name,
          email: e.email.toLowerCase(),
          designation: e.designation,
          status: e.status,
          department: e.departmentId ? deptName.get(e.departmentId) ?? "" : "",
          alreadyHere: have.has(e.email.toLowerCase()),
        })),
    );
  } catch (err) { next(err); }
};

/**
 * Bring people in from HRMS, optionally with their systems already granted.
 *
 * Name and email come from HRMS and are not editable here — that is the point
 * of importing rather than typing. A password is generated and returned once:
 * they sign in to the portal with it, and there is nowhere else it is kept.
 */
export const importFromHrms = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { emails, grants } = req.body as {
      emails?: string[];
      grants?: { target: string; roleInTarget: string }[];
    };
    if (!Array.isArray(emails) || emails.length === 0) {
      sendError(res, "Choose at least one person", 400);
      return;
    }

    const { listEmployees } = await import("../lib/hrmsClient.js");
    const staff = await listEmployees();
    const byEmail = new Map(staff.filter((e) => e.email).map((e) => [e.email.toLowerCase(), e]));

    const results: { email: string; name: string; created: boolean; password?: string; note?: string }[] = [];

    for (const raw of emails) {
      const email = String(raw).toLowerCase().trim();
      const person = byEmail.get(email);
      if (!person) {
        results.push({ email, name: "", created: false, note: "HRMS does not have this address" });
        continue;
      }

      let user = await AdminUser.findOne({ email });
      let password: string | undefined;

      if (!user) {
        // Long and random. Nobody memorises it; it is shown once so an
        // administrator can pass it on, and stored only as a hash.
        password = `Dl-${randomBytes(9).toString("base64url")}`;
        user = await AdminUser.create({
          name: person.name,
          email,
          password,
          role: "member",
          status: person.status === "active" ? "active" : "inactive",
        });
      }

      for (const g of grants ?? []) {
        if (!g?.target || !g.roleInTarget?.trim()) continue;
        const org = await Organization.findOne({ code: g.target }).select("_id");
        if (!org) continue;
        await accessService.grant({
          userId: String(user._id),
          target: g.target as TargetCode,
          roleInTarget: g.roleInTarget.trim(),
          grantedBy: req.admin!.adminId,
        });
      }

      results.push({
        email,
        name: person.name,
        created: Boolean(password),
        ...(password ? { password } : {}),
        ...(password ? {} : { note: "Already in the portal — access updated" }),
      });
    }

    await record(req, "people_imported", {
      adminId: req.admin!.adminId,
      adminEmail: req.admin!.email,
      org: null,
      detail: `Imported ${results.filter((r) => r.created).length} of ${results.length} from HRMS`,
    });

    sendSuccess(res, "Imported", results);
  } catch (err) { next(err); }
};

// ── The role map ──────────────────────────────────────────────────────────────

export const listRoleMap = async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { RoleMap } = await import("../models/RoleMap.js");
    const rules = await RoleMap.find({}).sort({ fromTarget: 1, fromRole: 1 }).lean();
    sendSuccess(
      res,
      "Rules fetched",
      rules.map((r) => ({
        id: String(r._id),
        fromTarget: r.fromTarget,
        fromRole: r.label || r.fromRole,
        toTarget: r.toTarget,
        toRole: r.toRole,
      })),
    );
  } catch (err) { next(err); }
};

export const addRoleMap = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { fromTarget, fromRole, toTarget, toRole } = req.body as Record<string, string>;
    if (!fromTarget || !fromRole?.trim() || !toTarget || !toRole?.trim()) {
      sendError(res, "A rule needs a system and role on both sides", 400);
      return;
    }
    if (fromTarget === toTarget) {
      sendError(res, "A rule has to point at a different system", 400);
      return;
    }

    const { RoleMap } = await import("../models/RoleMap.js");
    // Upserted: writing the same rule twice is the same rule, and a second row
    // would be a second answer to one question.
    const rule = await RoleMap.findOneAndUpdate(
      { fromTarget, fromRole: fromRole.trim().toLowerCase(), toTarget },
      {
        $set: { toRole: toRole.trim(), label: fromRole.trim(), createdBy: req.admin!.adminId },
        $setOnInsert: { fromTarget, fromRole: fromRole.trim().toLowerCase(), toTarget },
      },
      { new: true, upsert: true },
    );

    await record(req, "role_map_changed", {
      adminId: req.admin!.adminId,
      adminEmail: req.admin!.email,
      org: null,
      detail: `${fromRole.trim()} in ${fromTarget} now means ${toRole.trim()} in ${toTarget}`,
    });

    sendSuccess(res, "Rule saved", { id: String(rule!._id) });
  } catch (err) { next(err); }
};

export const removeRoleMap = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { RoleMap } = await import("../models/RoleMap.js");
    const rule = await RoleMap.findByIdAndDelete(String(req.params["id"] ?? ""));
    if (!rule) { sendError(res, "No such rule", 404); return; }

    await record(req, "role_map_changed", {
      adminId: req.admin!.adminId,
      adminEmail: req.admin!.email,
      org: null,
      detail: `Removed: ${rule.label || rule.fromRole} in ${rule.fromTarget} meant ${rule.toRole} in ${rule.toTarget}`,
    });

    // Deliberately leaves alone the access it has already implied. Those were
    // real grants somebody can see and revoke; withdrawing them because a rule
    // changed would take away access nobody asked to remove.
    sendSuccess(res, "Rule removed", { id: String(rule._id) });
  } catch (err) { next(err); }
};

export const revoke = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params["userId"] ?? "");
    const target = String(req.params["target"] ?? "");

    const person = await AdminUser.findById(userId).select("email");
    const removed = await accessService.revoke(userId, target as TargetCode);
    if (!removed) { sendError(res, "They do not have that access", 404); return; }

    await record(req, "access_revoked", {
      adminId: req.admin!.adminId,
      adminEmail: req.admin!.email,
      org: null,
      detail: `Revoked ${person?.email ?? userId}'s access to ${target}`,
    });

    sendSuccess(res, "Access revoked", { target });
  } catch (err) { next(err); }
};

/**
 * What somebody is in the portal itself — member, viewer or root admin.
 *
 * Separate from the grants because it is a different decision: the grants say
 * where they may go, this says whether they administer the portal at all.
 */
export const setRole = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params["userId"] ?? "");
    const role = String((req.body as { role?: string })?.role ?? "");
    if (!["root_admin", "member", "viewer"].includes(role)) {
      sendError(res, "role must be root_admin, member or viewer", 400);
      return;
    }

    // Nobody removes their own administrator rights: the likeliest outcome is
    // an installation with no root admin left and no way to make another.
    if (userId === req.admin!.adminId && role !== "root_admin") {
      sendError(res, "You cannot take away your own administrator rights", 409);
      return;
    }

    const person = await AdminUser.findByIdAndUpdate(userId, { $set: { role } }, { new: true });
    if (!person) { sendError(res, "No such person", 404); return; }

    await record(req, "portal_role_changed", {
      adminId: req.admin!.adminId,
      adminEmail: req.admin!.email,
      org: null,
      detail: `Set ${person.email} to ${role}`,
    });

    sendSuccess(res, "Role updated", { id: String(person._id), role: person.role });
  } catch (err) { next(err); }
};

/**
 * The roles a target actually has, so the screen can offer them.
 *
 * Asked of the target every time. A root admin picking a role from a list the
 * system itself just supplied cannot invent one that does not exist, which is
 * the whole point — the box they used to type into accepted anything and only
 * failed later, at provisioning time, in a system they were not looking at.
 */
export const targetRoles = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params as { code: string };
    const { targetName, roles } = await directoryService.listRoles(code);
    sendSuccess(res, `${targetName} roles`, { targetName, roles });
  } catch (err) { next(err); }
};

/**
 * One person, as every system actually sees them.
 *
 * The portal's own record sits beside what each target reports, and where
 * they disagree the disagreement is named. Showing only the grants would be
 * showing what somebody once intended, not what is true now.
 */
export const describePerson = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params as { userId: string };
    sendSuccess(res, "Access", await directoryService.describe(userId));
  } catch (err) { next(err); }
};

/**
 * Change the role somebody holds inside a target — in that target, not just here.
 *
 * Distinct from granting. A grant is this portal deciding somebody may go
 * somewhere; this reaches into that system and changes what they are once
 * they arrive, which is a larger act and audited as one.
 */
export const setRoleInTarget = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { userId, target } = req.params as { userId: string; target: string };
    const { roleInTarget } = req.body as { roleInTarget?: string };
    if (!roleInTarget?.trim()) { sendError(res, "roleInTarget is required", 400); return; }

    const person = await AdminUser.findById(userId).select("email");
    if (!person) { sendError(res, "No such person", 404); return; }

    const before = await Access.findOne({ user: userId, target }).select("roleInTarget").lean();

    const result = await directoryService.setRoleInTarget({
      userId, targetCode: target,
      roleInTarget: roleInTarget.trim(),
      grantedBy: req.admin!.adminId,
    });

    await record(req, "access_granted", {
      adminId: req.admin!.adminId,
      adminEmail: req.admin!.email,
      org: null,
      detail: `Changed ${person.email} in ${result.targetName} from ${before?.roleInTarget ?? "no recorded role"} to ${result.roleKey}`,
    });

    sendSuccess(res, result.detail, result);
  } catch (err) { next(err); }
};

/**
 * Give one person one system, with whatever the role map says that implies.
 *
 * Shared by the single grant and the bulk one so the two cannot drift: a rule
 * that fired when granting one person and not when granting ten would be the
 * kind of difference nobody notices until somebody is missing an account.
 */
async function applyGrant(
  req: AuthenticatedRequest,
  person: { _id: unknown; email: string },
  target: string,
  roleInTarget: string,
): Promise<{ target: string; targetName: string; roleInTarget: string;
            alsoGave: { target: string; roleInTarget: string }[] }> {
  const org = await Organization.findOne({ code: target }).select("name isActive");
  if (!org) throw Object.assign(new Error(`Unknown target: ${target}`), { statusCode: 404 });
  if (!org.isActive) throw Object.assign(new Error(`${org.name} is not active`), { statusCode: 409 });

  const userId = String(person._id);
  const role = roleInTarget.trim();

  await accessService.grant({
    userId, target: target as TargetCode, roleInTarget: role,
    grantedBy: req.admin!.adminId,
  });
  await record(req, "access_granted", {
    adminId: req.admin!.adminId, adminEmail: req.admin!.email, org: null,
    detail: `Granted ${person.email} access to ${org.name} as ${role}`,
  });

  const alsoGave: { target: string; roleInTarget: string }[] = [];
  for (const extra of await accessService.implied({
    userId, target: target as TargetCode, roleInTarget: role,
  })) {
    const other = await Organization.findOne({ code: extra.target }).select("name isActive");
    if (!other?.isActive) continue;
    await accessService.grant({
      userId, target: extra.target, roleInTarget: extra.roleInTarget,
      grantedBy: req.admin!.adminId,
    });
    alsoGave.push({ target: other.name, roleInTarget: extra.roleInTarget });
    await record(req, "access_granted", {
      adminId: req.admin!.adminId, adminEmail: req.admin!.email, org: null,
      detail: `Granted ${person.email} access to ${other.name} as ${extra.roleInTarget}, implied by being ${role} in ${org.name}`,
    });
  }

  return { target, targetName: org.name, roleInTarget: role, alsoGave };
}

/**
 * Several people, several systems, one action.
 *
 * Each pairing is applied on its own and reported on its own. One person
 * failing — a system switched off, a role that system does not have — must not
 * silently drop the other nineteen, and an administrator needs to know which
 * of the twenty did not happen rather than being told "some errors occurred".
 */
export const grantMany = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { userIds, grants } = req.body as {
      userIds?: string[];
      grants?: { target?: string; roleInTarget?: string }[];
    };
    if (!Array.isArray(userIds) || userIds.length === 0) {
      sendError(res, "Choose at least one person", 400); return;
    }
    const wanted = (grants ?? []).filter((g) => g.target && g.roleInTarget?.trim());
    if (wanted.length === 0) {
      sendError(res, "Choose at least one system and role", 400); return;
    }

    const people = await AdminUser.find({ _id: { $in: userIds } }).select("name email role");
    const results: {
      email: string; name: string;
      given: { targetName: string; roleInTarget: string }[];
      alsoGave: { target: string; roleInTarget: string }[];
      failed: { target: string; why: string }[];
    }[] = [];

    for (const person of people) {
      const row = { email: person.email, name: person.name,
                    given: [] as { targetName: string; roleInTarget: string }[],
                    alsoGave: [] as { target: string; roleInTarget: string }[],
                    failed: [] as { target: string; why: string }[] };

      /*
       * A root admin already opens everything without a grant, so giving them
       * one records a permission they do not need and did not gain.
       */
      if (person.role === "root_admin") {
        row.failed.push({ target: "—", why: "Root admins already open every system" });
        results.push(row);
        continue;
      }

      for (const g of wanted) {
        try {
          const done = await applyGrant(req, person, g.target!, g.roleInTarget!);
          row.given.push({ targetName: done.targetName, roleInTarget: done.roleInTarget });
          row.alsoGave.push(...done.alsoGave);
        } catch (err) {
          row.failed.push({ target: g.target!, why: (err as Error).message });
        }
      }
      results.push(row);
    }

    const total = results.reduce((n, r) => n + r.given.length, 0);
    sendSuccess(res, total === 1 ? "1 grant made" : `${total} grants made`, results);
  } catch (err) { next(err); }
};

/**
 * Switch somebody off, or back on.
 *
 * The status was displayed from the beginning and nothing could set it, so a
 * person who left could be seen to be inactive and never actually made so.
 *
 * Deactivating is the ordinary answer when somebody leaves, and it is the one
 * to reach for first: every door closes at once — signing in here, and every
 * launch from here, because SSO refuses an inactive account — and none of the
 * record is lost. It is also undoable, which deleting is not.
 */
export const setStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params as { userId: string };
    const { status } = req.body as { status?: string };
    if (status !== "active" && status !== "inactive") {
      sendError(res, "status must be active or inactive", 400); return;
    }

    const person = await AdminUser.findById(userId).select("name email role status");
    if (!person) { sendError(res, "No such person", 404); return; }

    // Locking yourself out of the portal is not something to discover after
    // the fact, and there may be nobody else who can undo it.
    if (String(person._id) === req.admin!.adminId && status === "inactive") {
      sendError(res, "You cannot deactivate your own account", 409); return;
    }
    if (status === "inactive" && person.role === "root_admin") {
      const others = await AdminUser.countDocuments({
        role: "root_admin", status: "active", _id: { $ne: person._id },
      });
      if (others === 0) {
        sendError(res, "That is the last active root admin — somebody has to be able to administer this", 409);
        return;
      }
    }

    person.status = status;
    await person.save();

    await record(req, "account_deactivated", {
      adminId: req.admin!.adminId, adminEmail: req.admin!.email, org: null,
      detail: `${status === "inactive" ? "Deactivated" : "Reactivated"} ${person.email}`,
    });

    sendSuccess(res, status === "inactive" ? "Deactivated" : "Reactivated", { status });
  } catch (err) { next(err); }
};

/**
 * Remove somebody from the portal entirely.
 *
 * Deliberately separate from deactivating, and the heavier of the two: this
 * cannot be undone, and deactivating achieves the same closure while keeping
 * the record. It is here for people who should never have been imported —
 * a duplicate, a wrong address — rather than for people who have left.
 *
 * Their grants go with them; a grant naming somebody who no longer exists is
 * a row nobody can read. Audit entries stay: they are the record of what was
 * done and by whom, and deleting an account should not quietly edit history.
 *
 * Nothing is touched in any other system. This says who may use the portal,
 * not who has an account in finance — somebody removed here can still sign in
 * to those directly, and closing that is a separate act in each of them.
 */
export const deletePerson = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params as { userId: string };
    const person = await AdminUser.findById(userId).select("name email role");
    if (!person) { sendError(res, "No such person", 404); return; }

    if (String(person._id) === req.admin!.adminId) {
      sendError(res, "You cannot delete your own account", 409); return;
    }
    if (person.role === "root_admin") {
      const others = await AdminUser.countDocuments({
        role: "root_admin", _id: { $ne: person._id },
      });
      if (others === 0) {
        sendError(res, "That is the last root admin — somebody has to be able to administer this", 409);
        return;
      }
    }

    const grants = await Access.countDocuments({ user: person._id });
    await Access.deleteMany({ user: person._id });
    await AdminUser.deleteOne({ _id: person._id });

    await record(req, "account_deleted", {
      adminId: req.admin!.adminId, adminEmail: req.admin!.email, org: null,
      detail: `Deleted ${person.email} from the portal${grants ? `, with ${grants} grant${grants === 1 ? "" : "s"}` : ""}`,
    });

    sendSuccess(res, `${person.name} removed from the portal`, { grantsRemoved: grants });
  } catch (err) { next(err); }
};

/**
 * Switch several people off, or back on.
 *
 * Each is decided on its own and reported on its own, as with granting: one
 * refusal must not silently drop the other nineteen, and an administrator
 * needs to know which of the twenty did not happen rather than being told
 * that some errors occurred.
 *
 * The last-root-admin rule is re-checked against the database on every pass
 * rather than counted once at the start. Deactivating four root admins in one
 * action would otherwise pass a check taken before any of them had been
 * deactivated, and lock everybody out of the thing that administers access.
 */
export const setStatusMany = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { userIds, status } = req.body as { userIds?: string[]; status?: string };
    if (!Array.isArray(userIds) || userIds.length === 0) {
      sendError(res, "Choose at least one person", 400); return;
    }
    if (status !== "active" && status !== "inactive") {
      sendError(res, "status must be active or inactive", 400); return;
    }

    const done: string[] = [];
    const skipped: { email: string; why: string }[] = [];

    for (const id of userIds) {
      const person = await AdminUser.findById(id).select("name email role status");
      if (!person) { skipped.push({ email: id, why: "No such person" }); continue; }
      if (String(person._id) === req.admin!.adminId && status === "inactive") {
        skipped.push({ email: person.email, why: "This is your own account" }); continue;
      }
      if (status === "inactive" && person.role === "root_admin") {
        const others = await AdminUser.countDocuments({
          role: "root_admin", status: "active", _id: { $ne: person._id },
        });
        if (others === 0) {
          skipped.push({ email: person.email, why: "The last active root admin" }); continue;
        }
      }
      if (person.status === status) { continue; }

      person.status = status;
      await person.save();
      done.push(person.email);
      await record(req, "account_deactivated", {
        adminId: req.admin!.adminId, adminEmail: req.admin!.email, org: null,
        detail: `${status === "inactive" ? "Deactivated" : "Reactivated"} ${person.email}`,
      });
    }

    const verb = status === "inactive" ? "Deactivated" : "Reactivated";
    sendSuccess(res, `${verb} ${done.length}`, { done, skipped });
  } catch (err) { next(err); }
};

/**
 * Remove several people from the portal.
 *
 * Same shape and the same re-check: whether somebody is the last root admin
 * is asked again for each one, against the database as it stands after the
 * previous deletions, not against how it looked when the request arrived.
 */
export const deleteMany = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { userIds } = req.body as { userIds?: string[] };
    if (!Array.isArray(userIds) || userIds.length === 0) {
      sendError(res, "Choose at least one person", 400); return;
    }

    const done: string[] = [];
    const skipped: { email: string; why: string }[] = [];
    let grantsRemoved = 0;

    for (const id of userIds) {
      const person = await AdminUser.findById(id).select("name email role");
      if (!person) { skipped.push({ email: id, why: "No such person" }); continue; }
      if (String(person._id) === req.admin!.adminId) {
        skipped.push({ email: person.email, why: "This is your own account" }); continue;
      }
      if (person.role === "root_admin") {
        const others = await AdminUser.countDocuments({
          role: "root_admin", _id: { $ne: person._id },
        });
        if (others === 0) {
          skipped.push({ email: person.email, why: "The last root admin" }); continue;
        }
      }

      const n = await Access.countDocuments({ user: person._id });
      await Access.deleteMany({ user: person._id });
      await AdminUser.deleteOne({ _id: person._id });
      grantsRemoved += n;
      done.push(person.email);

      await record(req, "account_deleted", {
        adminId: req.admin!.adminId, adminEmail: req.admin!.email, org: null,
        detail: `Deleted ${person.email} from the portal${n ? `, with ${n} grant${n === 1 ? "" : "s"}` : ""}`,
      });
    }

    sendSuccess(res, `${done.length} removed`, { done, skipped, grantsRemoved });
  } catch (err) { next(err); }
};
