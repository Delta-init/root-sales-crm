import type { Response, NextFunction } from "express";
import { randomBytes } from "node:crypto";
import { AdminUser } from "../models/AdminUser.js";
import { Access } from "../models/Access.js";
import { Organization } from "../models/Organization.js";
import { accessService } from "../services/accessService.js";
import { provisionService } from "../services/provisionService.js";
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

    sendSuccess(res, "Access granted", { target: row.target, roleInTarget: row.roleInTarget });
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
    const { listEmployees } = await import("../lib/hrmsClient.js");
    const staff = await listEmployees();

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
