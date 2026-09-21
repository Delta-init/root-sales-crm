import { callTarget, resolveTarget } from "../lib/targetClient.js";

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
   * The raiser's name travels with the request so Media ERP can make them an
   * account if they have none — which is what lets the work come back to them
   * to verify rather than stranding it with nobody able to sign it off.
   */
  async create(input: {
    actorEmail: string;
    actorName: string;
    title: string;
    description?: string;
    priority?: string;
    teamId: string;
    assignedTo: string;
    dueDate: string;
  }): Promise<{ createdAs: string; verifierNote: string; task: unknown }> {
    const target = await resolveTarget("media-erp");
    /* No stand-in address any more. Media ERP makes the person an account the
       first time they raise something, so they are themselves from then on —
       which is what lets the work come back to them to verify. */
    return callTarget(target, "/tasks", {
      method: "POST",
      verb: "create that task",
      body: input,
    });
  },

  /**
   * One task in full: where it is, how it got there, what is attached.
   *
   * Media ERP decides who may see it — elevated roles, the assignee, somebody
   * on the team. Asking that question again on this side could only ever
   * produce a second answer, and the one further from the data would be wrong.
   */
  async detail(taskId: string, actorEmail: string) {
    const target = await resolveTarget("media-erp");
    const params = new URLSearchParams({ actorEmail });
    return callTarget<Record<string, unknown>>(
      target, `/tasks/${encodeURIComponent(taskId)}?${params.toString()}`,
      { method: "GET", verb: "describe that task" },
    );
  },

  /** What this person has asked for, whatever became of it. */
  async raised(actorEmail: string): Promise<{ tasks: PendingTask[] }> {
    const target = await resolveTarget("media-erp");
    const params = new URLSearchParams({ actorEmail });
    return callTarget(target, `/tasks-raised?${params.toString()}`, {
      method: "GET",
      verb: "list what you have raised",
    });
  },

  /**
   * What is waiting on this person to verify.
   *
   * Verification rather than approval, deliberately. Approving is a leader's
   * job and this portal has no standing to do it; verifying is the question
   * whoever asked for the work is best placed to answer — is this what I
   * wanted — and Media ERP lets any role be named to it.
   */
  async verifications(actorEmail: string): Promise<unknown> {
    const target = await resolveTarget("media-erp");
    const params = new URLSearchParams({ actorEmail });
    return callTarget(target, `/verifications?${params.toString()}`, {
      method: "GET",
      verb: "list what is waiting on you",
    });
  },

  /** Pass it, or say what is wrong with it. */
  async verify(input: { taskId: string; actorEmail: string; passed: boolean; reason?: string }) {
    const target = await resolveTarget("media-erp");
    return callTarget<{ verifiedAs: string; passed: boolean }>(
      target, `/verifications/${encodeURIComponent(input.taskId)}`,
      { method: "POST", verb: "record that", body: {
        actorEmail: input.actorEmail, passed: input.passed, reason: input.reason,
      } },
    );
  },
};
