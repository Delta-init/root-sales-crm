import { resolveTarget, callTarget } from "../lib/targetClient.js";
import { targetConfig } from "../config/targets.js";
import type { Period } from "./salespersonService.js";

/*
 * CSEs (the user, 2026-10-11): Tetra Commission's customer success people —
 * their students, the period's deposits and commission, and what waits on them —
 * asked of Tetra Commission itself (GET /api/v1/service/cs-overview, its own
 * rules), with the portal secret Root holds for it. The period is cut in Gulf
 * time here and passed as instants; it bounds deposits and commission only.
 */
const CODE = "commission";

const query = (p: Period) => {
  const q = new URLSearchParams();
  if (p.from) q.set("from", p.from.toISOString());
  if (p.to) q.set("to", p.to.toISOString());
  const s = q.toString();
  return s ? `?${s}` : "";
};

async function ask<T>(path: string, missing = "it has no CSE overview yet"): Promise<T> {
  const target = await resolveTarget(CODE);
  try {
    return await callTarget<T>(target, path, { method: "GET", verb: "share its CSEs" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not be read";
    if (/No such person/i.test(message)) throw Object.assign(new Error("No such CSE in Tetra Commission"), { statusCode: 404 });
    // Its server from before this page: the route is not there yet.
    if (/404|not found/i.test(message)) throw Object.assign(new Error(`Tetra Commission's server needs updating — ${missing}`), { statusCode: 409 });
    throw error;
  }
}

/** Where a student's page is in Tetra Commission, for the links. "" when the app's address is not set. */
const studentLink = () => {
  const app = targetConfig(CODE).appUrl.replace(/\/+$/, "");
  return app ? `${app}/StudentDetail?id=` : "";
};

export const listCses = async (p: Period) => ({ ...(await ask<Record<string, unknown>>(`/cs-overview${query(p)}`)), studentLink: studentLink() });
export const getCse = async (userId: string, p: Period) => {
  if (!/^[0-9a-f]{24}$/i.test(userId)) throw Object.assign(new Error("No such CSE in Tetra Commission"), { statusCode: 404 });
  return { ...(await ask<Record<string, unknown>>(`/cs-overview/${userId}${query(p)}`)), studentLink: studentLink() };
};

/*
 * Pending → CS portal (the user, 2026-10-17): what waits on each CS and exactly
 * which students — onboarding, bonuses by where they are stuck, LMS tickets,
 * follow-ups due, class completions to call — as Tetra Commission counts them
 * (GET /api/v1/service/cs-pending). Nothing is changed.
 */
export const csPending = async () => ({ ...(await ask<Record<string, unknown>>("/cs-pending", "it has no CS pending list yet")), studentLink: studentLink() });

/*
 * Reports → CS portal (the user, 2026-10-17): what the CSs did in a period —
 * revenue, follow-ups and contacted, calls, program scheduling, onboarded
 * clients, bonuses, commission, course upgrades — per CS, team and month, as
 * Tetra Commission's own Reports section counts them (GET /service/cs-report).
 * The period arrives as instants (the range picker's) and goes as Gulf days;
 * none is all time. Read-only.
 */
const gulfDay = (iso: string) => new Date(Date.parse(iso) + 4 * 3_600_000).toISOString().slice(0, 10);
export const csReport = async (q: Record<string, unknown>) => {
  const from = typeof q.from === "string" && q.from ? q.from : "", to = typeof q.to === "string" && q.to ? q.to : "";
  for (const v of [from, to]) if (v && !Number.isFinite(Date.parse(v))) throw Object.assign(new Error("from / to must be dates"), { statusCode: 400 });
  const params = new URLSearchParams();
  if (from || to) {
    params.set("period", "custom");
    params.set("from", gulfDay(from || to));
    params.set("to", gulfDay(to || new Date().toISOString()));
  } else params.set("period", "all");
  if (q.location === "dubai" || q.location === "bangalore") params.set("location", q.location);
  for (const k of ["team", "cs"] as const) if (typeof q[k] === "string" && /^[0-9a-f]{24}$/i.test(q[k] as string)) params.set(k, q[k] as string);
  return { ...(await ask<Record<string, unknown>>(`/cs-report?${params}`, "it has no CS report yet")), studentLink: studentLink() };
};

/*
 * Reports → CS portal → Student workflow (the user, 2026-10-20): the period's
 * students and where each went — came in (finance, LMS, sheet, by hand) →
 * assigned to a CS or left in the open pool → onboarded / waiting (within
 * 6 h) / late → enrolled in the LMS, contacted, first deposit, moved by hand —
 * and their follow-up stage now, per team and CS, as Tetra Commission counts
 * them (GET /service/student-workflow); the students behind one box or stage
 * (GET /service/student-workflow/students). The period arrives as instants or
 * days and goes as Gulf days; none is all time. Read-only.
 */
export const WORKFLOW_BOXES = [
  "came", "assigned", "pool", "onboarded", "waiting", "late", "enrolled", "contacted", "deposited", "moved", "moved_inactivity",
  // Bonus pending, and each reason it waits (2026-10-20)
  "bonus_pending", "bonus_sent_back", "bonus_after_payment", "bonus_needs_call", "bonus_with_finance", "bonus_waiting_broker",
] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f]{24}$/i;
const bad = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

function workflowParams(q: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const asDay = (v: string) => {
    if (!v) return "";
    if (!Number.isFinite(Date.parse(v))) throw bad("from / to must be dates");
    return DAY.test(v) ? v : gulfDay(v);
  };
  let from = asDay(str(q.from)), to = asDay(str(q.to));
  const params = new URLSearchParams();
  if (from || to) {
    from ||= to;
    to ||= gulfDay(new Date().toISOString());
    if (from > to) throw bad("from must be on or before to");
    params.set("from", from);
    params.set("to", to);
  } else params.set("period", "all");
  const location = str(q.location);
  if (location) {
    if (location !== "dubai" && location !== "bangalore") throw bad("location must be dubai or bangalore");
    params.set("location", location);
  }
  for (const k of ["team", "cs"] as const) {
    const v = str(q[k]);
    if (!v) continue;
    if (!ID.test(v)) throw bad(`${k === "team" ? "team" : "cs"} is not an id`);
    params.set(k, v);
  }
  return params;
}

export const csStudentWorkflow = async (q: Record<string, unknown>) =>
  ({ ...(await ask<Record<string, unknown>>(`/student-workflow?${workflowParams(q)}`, "it has no student workflow yet")), studentLink: studentLink() });

export const csStudentWorkflowStudents = async (q: Record<string, unknown>) => {
  const params = workflowParams(q);
  const box = typeof q.box === "string" ? q.box.trim() : "";
  const stage = typeof q.stage === "string" ? q.stage.trim() : "";
  if (box && !(WORKFLOW_BOXES as readonly string[]).includes(box)) throw bad(`box must be one of ${WORKFLOW_BOXES.join(", ")}`);
  if (!box && !stage) throw bad("Say which box or stage");
  if (stage.length > 40) throw bad("stage is too long");
  if (box) params.set("box", box);
  if (stage) params.set("stage", stage);
  // A team's row: its id, or empty for the open pool (students with no CS) — so "present but empty" is passed on.
  if (typeof q.teamId === "string") {
    const v = q.teamId.trim();
    if (v && !ID.test(v)) throw bad("teamId is not an id");
    params.set("teamId", v);
  }
  if (typeof q.csId === "string" && q.csId.trim()) {
    if (!ID.test(q.csId.trim())) throw bad("csId is not an id");
    params.set("csId", q.csId.trim());
  }
  return { ...(await ask<Record<string, unknown>>(`/student-workflow/students?${params}`, "it can't list a workflow box's students yet")), studentLink: studentLink() };
};

/*
 * Reports → Mentors (the user, 2026-10-24: "the mentors report, same as the commission portal's"): every mentor, day
 * by day — classes held and cancelled, students' bookings and cancellations, attended, missed, 1:1 meetings and the
 * reviews students left, from the LMS, with the commission Tetra Commission credited them — as its own Mentor Report
 * shows a Super Admin (GET /service/mentor-report). Gulf days, at most three months. Read-only.
 */
export const mentorReport = async (q: Record<string, unknown>) => {
  const from = String(q.from ?? ""), to = String(q.to ?? "");
  if (!DAY.test(from) || !DAY.test(to)) throw bad("from and to are days (YYYY-MM-DD)");
  if (to < from) throw bad("from is after to");
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 92 * 86_400_000) throw bad("At most three months at a time");
  return ask<Record<string, unknown>>(`/mentor-report?${new URLSearchParams({ from, to })}`, "it has no mentors' report yet");
};

/**
 * What is behind one number of it (2026-10-27, GET /service/mentor-report/details): the classes, cancelled classes,
 * bookings (all / cancelled / attended / missed), students, meetings (all / cancelled), Programs or commission —
 * every mentor's, one mentor's (portal or LMS id) or one Program's.
 */
const DETAIL_KINDS = ["classes", "cancelled_classes", "bookings", "cancelled_bookings", "attended", "missed", "students", "meetings", "cancelled_meetings", "programs", "commission"];
export const mentorReportDetails = async (q: Record<string, unknown>) => {
  const kind = String(q.kind ?? "");
  if (!DETAIL_KINDS.includes(kind)) throw bad(`kind is one of ${DETAIL_KINDS.join(", ")}`);
  const from = String(q.from ?? ""), to = String(q.to ?? "");
  if (!DAY.test(from) || !DAY.test(to)) throw bad("from and to are days (YYYY-MM-DD)");
  if (to < from) throw bad("from is after to");
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 92 * 86_400_000) throw bad("At most three months at a time");
  const params = new URLSearchParams({ kind, from, to });
  for (const k of ["mentorId", "programId"] as const) {
    const v = typeof q[k] === "string" ? (q[k] as string).trim() : "";
    if (!v) continue;
    if (!/^[0-9a-f]{24}$/i.test(v)) throw bad(`${k} is not an id`);
    params.set(k, v);
  }
  return ask<Record<string, unknown>>(`/mentor-report/details?${params}`, "it can't break the mentors' report down yet");
};

/** One mentor's reviews in the dates, 50 a page (GET /service/mentor-reviews) — the LMS instructor's id. */
export const mentorReviews = async (q: Record<string, unknown>) => {
  const instructorId = String(q.instructorId ?? "");
  if (!/^[0-9a-f]{24}$/i.test(instructorId)) throw bad("instructorId is required");
  const params = new URLSearchParams({ instructorId, page: String(Math.max(1, Math.min(200, Number(q.page) || 1))) });
  for (const k of ["from", "to"] as const) if (typeof q[k] === "string" && DAY.test(q[k] as string)) params.set(k, q[k] as string);
  return ask<Record<string, unknown>>(`/mentor-reviews?${params}`, "it has no mentors' reviews yet");
};
