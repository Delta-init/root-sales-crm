import { callTarget, resolveTarget, httpError } from "../lib/targetClient.js";
import { targetConfig } from "../config/targets.js";

/**
 * Work raised in Media ERP, from here.
 *
 * A pass-through, deliberately. Media ERP has teams, a leader's review desk, a
 * verification gate and its own notifications; every rule about who may assign
 * to whom and who may approve what lives there and stays there. Deciding any of
 * it here would be a second opinion that goes stale the moment somebody does
 * the same thing in Media ERP instead.
 *
 * What this side owns is identity. Media ERP has no idea who is signed in to
 * the portal, so every call carries the person — and, for the many portal users
 * with no account over there, the service account that stands in for them.
 */

export interface TaskTeam {
  id: string;
  name: string;
  color: string;
  members: { id: string; name: string; email: string; role: string }[];
}

export interface PendingTask {
  id?: string;
  _id?: string;
  title?: string;
  status?: string;
  priority?: string;
  due_date?: string;
  assigned_to_name?: string;
  teamName?: string;
}

/**
 * The account Media ERP falls back to when the person has none of their own.
 *
 * Read from the registry rather than named here: it is the same address the
 * portal already signs in as when a root admin launches into Media ERP, and
 * having two settings for one identity is how they end up disagreeing.
 */
const standIn = () => targetConfig("media-erp").serviceEmail;

export const taskService = {
  /** The teams work can be put on, and who is in them. */
  async teams(): Promise<{ teams: TaskTeam[] }> {
    const target = await resolveTarget("media-erp");
    return callTarget<{ teams: TaskTeam[] }>(target, "/task-teams", {
      method: "GET",
      verb: "list its teams",
    });
  },

  /**
   * Raise work on somebody's plate.
   *
   * The stand-in address travels with the request rather than being configured
   * on the far side, so which account speaks for the portal is decided in one
   * place — here, where the rest of what this portal is to Media ERP is set.
   */
  async create(input: {
    actorEmail: string;
    title: string;
    description?: string;
    priority?: string;
    teamId: string;
    assignedTo: string;
    dueDate: string;
  }): Promise<{ createdAs: string; stoodIn: boolean; task: unknown }> {
    const target = await resolveTarget("media-erp");
    const fallbackEmail = standIn();
    if (!fallbackEmail) {
      throw httpError(
        "Media ERP has no service account configured here — set MEDIA_ERP_SERVICE_EMAIL",
        503,
      );
    }

    return callTarget(target, "/tasks", {
      method: "POST",
      verb: "create that task",
      body: { ...input, fallbackEmail },
    });
  },

  /**
   * What is waiting on this person to approve.
   *
   * Only works for somebody with a Media ERP account, and that refusal comes
   * from there: approving turns on leading a team, which the portal has no way
   * of knowing and no business guessing.
   */
  async approvals(actorEmail: string): Promise<{ reviewerEmail: string; tasks: PendingTask[] }> {
    const target = await resolveTarget("media-erp");
    const params = new URLSearchParams({ actorEmail });
    return callTarget(target, `/task-approvals?${params.toString()}`, {
      method: "GET",
      verb: "list what is waiting on you",
    });
  },

  /** Approve a task, or send it back for another pass. */
  async decide(input: {
    taskId: string;
    actorEmail: string;
    approve: boolean;
    note?: string;
  }): Promise<{ decidedAs: string; approved: boolean }> {
    const target = await resolveTarget("media-erp");
    return callTarget(target, `/tasks/${encodeURIComponent(input.taskId)}/decide`, {
      method: "POST",
      verb: "record that decision",
      body: { actorEmail: input.actorEmail, approve: input.approve, note: input.note },
    });
  },
};
