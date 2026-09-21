import type { Response, NextFunction } from "express";
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

    const result = await taskService.create({
      actorEmail: actorEmail(req),
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
      detail: `Raised "${title}"${result.stoodIn ? ` (recorded in Media ERP as ${result.createdAs})` : ""}`,
    });

    sendSuccess(res, "Task created", result);
  } catch (error) { next(error); }
};

/** What is waiting on the signed-in person to approve. */
export const taskApprovals = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, "Approvals", await taskService.approvals(actorEmail(req)));
  } catch (error) { next(error); }
};

/** Approve a task, or send it back. */
export const decideTask = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId } = req.params as { taskId: string };
    const b = (req.body ?? {}) as Record<string, unknown>;
    const approve = b["approve"] === true;

    const result = await taskService.decide({
      taskId,
      actorEmail: actorEmail(req),
      approve,
      note: b["note"] ? String(b["note"]) : undefined,
    });

    await record(req, approve ? "task_approved" : "task_returned", {
      adminId: req.admin!.impersonatedBy?.id ?? req.admin!.adminId,
      adminEmail: actorEmail(req),
      org: "media-erp",
      detail: `${approve ? "Approved" : "Sent back"} task ${taskId}`,
    });

    sendSuccess(res, approve ? "Approved" : "Sent back", result);
  } catch (error) { next(error); }
};
