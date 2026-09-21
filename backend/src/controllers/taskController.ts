import type { Response, NextFunction } from "express";
import { AdminUser } from "../models/AdminUser.js";
import { taskService } from "../services/taskService.js";
import { record } from "../services/auditService.js";
import { sendError, sendSuccess } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

/*
 * Who is acting, taken from the session and never from the request.
 *
 * Under impersonation it is the root admin really at the keyboard. The name
 * against a task should be whoever raised it, and a borrowed session is still
 * somebody's hand on the keys.
 */
const actorEmail = (req: AuthenticatedRequest) =>
  req.admin!.impersonatedBy?.email ?? req.admin!.email;

/** The teams work can be put on, and who is in them. */
export const taskTeams = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Teams", await taskService.teams());
  } catch (error) { next(error); }
};

/**
 * Raise work in Media ERP.
 *
 * Audited here whoever it was recorded as over there. For most people the task
 * will carry the portal's service account, so this row is the only place their
 * name survives — which makes it the answer to "who asked for this", and worth
 * writing before anything else.
 */
export const createTask = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const title = String(b["title"] ?? "").trim();
    const teamId = String(b["teamId"] ?? "").trim();
    const assignedTo = String(b["assignedTo"] ?? "").trim();
    const dueDate = String(b["dueDate"] ?? "").trim();

    if (!title) { sendError(res, "Give the task a name", 400); return; }
    if (!teamId) { sendError(res, "Choose a team", 400); return; }
    if (!assignedTo) { sendError(res, "Choose who it is for", 400); return; }
    if (!dueDate) { sendError(res, "Set a due date", 400); return; }

    /* Their real name, because Media ERP may be about to create an account
       with it. Without this the account ends up called "abshar" — whatever is
       in front of the @ — which is what somebody over there would then see
       against every task they raise. */
    const raiser = await AdminUser.findById(
      req.admin!.impersonatedBy?.id ?? req.admin!.adminId,
    ).select("name");

    const result = await taskService.create({
      actorEmail: actorEmail(req),
      actorName: raiser?.name ?? "",
      title,
      description: String(b["description"] ?? ""),
      priority: String(b["priority"] ?? "medium"),
      teamId,
      assignedTo,
      dueDate,
    });

    await record(req, "task_created", {
      adminId: req.admin!.impersonatedBy?.id ?? req.admin!.adminId,
      adminEmail: actorEmail(req),
      org: "media-erp",
      detail: `Raised "${title}" as ${result.createdAs}`,
    });

    sendSuccess(res, "Task created", result);
  } catch (error) { next(error); }
};

/** One task in full — where it is, how it got there, what is attached. */
export const taskDetail = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId } = req.params as { taskId: string };
    sendSuccess(res, "Task", await taskService.detail(taskId, actorEmail(req)));
  } catch (error) { next(error); }
};

/** What this person has asked for, whatever became of it. */
export const tasksRaised = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Raised", await taskService.raised(actorEmail(req)));
  } catch (error) { next(error); }
};

/** What is waiting on this person to verify. */
export const verifications = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Verifications", await taskService.verifications(actorEmail(req)));
  } catch (error) { next(error); }
};

/**
 * Pass a task, or say what is wrong with it.
 *
 * Verifying is not approving, and the audit line says which: this records that
 * somebody looked at what came back and judged it, which is a different act
 * from a leader signing the work off.
 */
export const verifyTask = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId } = req.params as { taskId: string };
    const b = (req.body ?? {}) as Record<string, unknown>;
    const passed = b["passed"] === true;

    const result = await taskService.verify({
      taskId,
      actorEmail: actorEmail(req),
      passed,
      reason: b["reason"] ? String(b["reason"]) : undefined,
    });

    await record(req, passed ? "task_verified" : "task_rejected", {
      adminId: req.admin!.impersonatedBy?.id ?? req.admin!.adminId,
      adminEmail: actorEmail(req),
      org: "media-erp",
      detail: `${passed ? "Verified" : "Sent back"} task ${taskId}`,
    });

    sendSuccess(res, passed ? "Verified" : "Sent back", result);
  } catch (error) { next(error); }
};
