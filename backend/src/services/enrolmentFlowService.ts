import { Organization } from "../models/Organization.js";
import { callTarget, resolveTarget } from "../lib/targetClient.js";

/*
 * The enrolment workflow, every sales CRM at once (the user, 2026-10-14: "show
 * the my enrolments workflow of every sales portal … the workflow chart … where
 * is the more pending — finance or broker admin or salesperson"). Each CRM
 * answers for itself — GET /api/v1/service/enrolment-flow with the portal
 * secret Root already holds: every close handed to finance, the step it stands
 * at as its own My Enrolments shows it (finance approved → LMS account → CS
 * assigned → onboarded → MT5 bonus; Banglore only the first two), and whom that
 * waits on. Root adds them up per CRM and in all, and ranks who holds the most:
 * finance, the LMS, CS Portal's CS managers, each CS, the broker admins,
 * each salesperson (a close sent back to them). Read only.
 */

export const STEP_KEYS = ["finance", "lms", "cs", "onboarded", "bonus"] as const;
export type StepKey = (typeof STEP_KEYS)[number];
export const ROLES = ["finance", "salesperson", "lms", "cs_manager", "cs", "broker_admin", "tetra"] as const;
export type Role = (typeof ROLES)[number];

export interface FlowClose {
  portal: string;
  portalName: string;
  id: string;
  name: string;
  enrollmentNumber: string;
  course: string;
  academy: string;
  closedBy: { id: string; name: string; email: string };
  team: string;
  closedAt: string;
  invoiceNumber: string;
  stage: StepKey;
  stageState: string;
  detail: string;
  waitingOn: { role: Role; name: string };
  cs: string;
  since: string;
  steps: { key: StepKey; state: string }[];
}

export interface FlowCounts {
  total: number;
  finished: number;
  open: number;
  /** Open closes stopped at each step: waiting there, or failed there (sent back, refused). */
  atStep: Record<StepKey, { waiting: number; failed: number }>;
  byRole: Record<Role, number>;
}

const zero = (): FlowCounts => ({
  total: 0, finished: 0, open: 0,
  atStep: Object.fromEntries(STEP_KEYS.map((k) => [k, { waiting: 0, failed: 0 }])) as FlowCounts["atStep"],
  byRole: Object.fromEntries(ROLES.map((r) => [r, 0])) as FlowCounts["byRole"],
});
const isStep = (v: unknown): v is StepKey => STEP_KEYS.includes(v as StepKey);
const isRole = (v: unknown): v is Role => ROLES.includes(v as Role);
const str = (v: unknown) => (typeof v === "string" ? v : "");

function countInto(c: FlowCounts, row: FlowClose) {
  c.open++;
  const at = c.atStep[row.stage];
  if (row.stageState === "failed") at.failed++; else at.waiting++;
  c.byRole[row.waitingOn.role]++;
}

/** One person (or desk) the open closes wait on, and how many in each CRM. */
export interface WaitingOn {
  key: string;
  role: Role;
  name: string;
  email: string;
  count: number;
  portals: Record<string, number>;
}

/**
 * Every sales CRM's workflow, and all of them together. A CRM that cannot answer says why and leaves the rest.
 * `only`: just that CRM (its Pending → Sales tab, 2026-10-29).
 */
export async function enrolmentFlow(only?: string) {
  const crms = await Organization.find({ isActive: true, kind: "crm", ...(only ? { code: only } : {}) })
    .select("code name accent sortOrder").sort({ sortOrder: 1 }).lean();
  const answers = await Promise.all(crms.map(async (org) => {
    try {
      const target = await resolveTarget(org.code);
      const data = await callTarget<Record<string, unknown>>(target, "/enrolment-flow", { method: "GET", verb: "share its enrolments" });
      return { org, data, error: "" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not be read";
      return { org, data: null, error: /404|not found/i.test(message) ? `${org.name}'s server needs updating — it has no enrolment workflow yet` : message };
    }
  }));

  const all = zero();
  const rows: FlowClose[] = [];
  const waiting = new Map<string, WaitingOn>();
  const portals = answers.map(({ org, data, error }) => {
    const c = zero();
    if (!data) return { code: org.code, name: org.name, accent: org.accent ?? "", available: false, error, financeAnswered: false, counts: c };
    c.total = Number(data.total) || 0;
    c.finished = Number(data.finished) || 0;
    for (const x of (Array.isArray(data.open) ? data.open : []) as Record<string, any>[]) {
      if (!isStep(x.stage)) continue;
      const role: Role = isRole(x.waitingOn?.role) ? x.waitingOn.role : "tetra";
      const row: FlowClose = {
        portal: org.code,
        portalName: org.name,
        id: str(x.id),
        name: str(x.name),
        enrollmentNumber: str(x.enrollmentNumber),
        course: str(x.course),
        academy: str(x.academy),
        closedBy: { id: str(x.closedBy?.id), name: str(x.closedBy?.name), email: str(x.closedBy?.email).toLowerCase() },
        team: str(x.team),
        closedAt: str(x.closedAt),
        invoiceNumber: str(x.invoiceNumber),
        stage: x.stage,
        stageState: str(x.stageState),
        detail: str(x.detail),
        waitingOn: { role, name: str(x.waitingOn?.name) },
        cs: str(x.cs),
        since: str(x.since),
        steps: (Array.isArray(x.steps) ? x.steps : []).filter((s: any) => isStep(s?.key)).map((s: any) => ({ key: s.key, state: str(s.state) })),
      };
      rows.push(row);
      countInto(c, row);
      countInto(all, row);
      // A desk is one entry; a CS or a salesperson is themself (a salesperson by email where there is one).
      const named = role === "cs" || role === "salesperson";
      const key = named ? `${role}:${role === "salesperson" && row.closedBy.email ? row.closedBy.email : row.waitingOn.name.toLowerCase()}` : role;
      const w = waiting.get(key) ?? { key, role, name: named ? row.waitingOn.name : "", email: role === "salesperson" ? row.closedBy.email : "", count: 0, portals: {} };
      w.count++;
      w.portals[org.code] = (w.portals[org.code] ?? 0) + 1;
      waiting.set(key, w);
    }
    all.total += c.total;
    all.finished += c.finished;
    return { code: org.code, name: org.name, accent: org.accent ?? "", available: true, error: "", financeAnswered: data.financeAnswered !== false, counts: c };
  });

  // The oldest waiting first.
  rows.sort((a, b) => (a.since || a.closedAt).localeCompare(b.since || b.closedAt));
  return {
    generatedAt: new Date().toISOString(),
    portals,
    all,
    waitingOn: [...waiting.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    open: rows,
  };
}
