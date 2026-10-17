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
