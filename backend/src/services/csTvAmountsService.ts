import { callTarget, httpError, resolveTarget, type ResolvedTarget } from "../lib/targetClient.js";

/*
 * CS TV amounts (the user, 2026-11-14: "we need an option in the Root portal… the Bangalore employees… this is needed
 * in the Dubai TV"): amounts a root admin types for a Bangalore CS, which CS Portal's CS TV shows like the course
 * payments its CSs collect — on Dubai's board, Bangalore's, or both; ranking, totals, latest payments, pop-up and
 * voice, told apart from a payment by nothing on the screen. They are not payments and count nowhere else: not in
 * CS Portal's reports, commission or finance, and not on this portal's Manager TV, which asks CS Portal for the real
 * board (services/managerTvService.ts).
 *
 * Nothing is kept here. CS Portal keeps them (its functions/csTvExtras.ts) and answers through
 * /api/v1/service/cs-tv-amounts — Bangalore's CSs only, whatever is asked of it.
 *
 * Somebody who is not a CS there (the user, 2026-11-14: "add … also in the Bangalore team TV amount") is added by
 * name: CS Portal keeps the name and the team to show them under, makes nobody an account, and from then on they are
 * picked like the team's CSs. Taken away again with their amounts.
 */

const CODE = "commission";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID = /^[a-f\d]{24}$/i;
export const SHOW_ON = ["dubai", "bangalore", "both"] as const;
export type ShowOn = (typeof SHOW_ON)[number];

interface PortalAmount { id: string; cs_id: string; cs_name: string; aed: number; product: string; at: string; show_on: ShowOn; added_by?: string; added_at?: string }
interface PortalList {
  month: string; extras?: PortalAmount[]; cs?: Array<{ id: string; name: string; team: string; tv_only?: boolean }>; products?: string[]; total_aed?: number;
  /** From a CS Portal that takes people by name (2026-11-14); absent from one before that. */
  people?: Array<{ id: string; name: string; team: string; added_by?: string; added_at?: string }>; teams?: Array<{ id: string; name: string }>;
}

const view = (e: PortalAmount) => ({
  id: e.id, employeeId: e.cs_id, employee: e.cs_name, aed: Number(e.aed) || 0, course: e.product, at: e.at,
  showOn: (SHOW_ON as readonly string[]).includes(e.show_on) ? e.show_on : "bangalore", addedBy: e.added_by ?? "", addedAt: e.added_at ?? "",
});

/** CS Portal asked, its own refusal kept; a server from before these routes says so plainly. */
async function ask<T>(path: string, init: { method: "GET" | "POST"; body?: unknown; verb: string }): Promise<T> {
  let target: ResolvedTarget;
  try {
    target = await resolveTarget(CODE);
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) throw httpError("CS Portal is not set up in Root", 409);
    throw error;
  }
  try {
    return await callTarget<T>(target, path, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/No such service route/i.test(message)) throw httpError("CS Portal's server needs updating — it has no CS TV amounts yet", 409);
    throw error;
  }
}

/** A month's amounts (YYYY-MM, Dubai's; this month when it isn't one), with the Bangalore CSs and the courses to pick from. */
export async function csTvAmounts(month: unknown) {
  const m = typeof month === "string" && MONTH.test(month) ? month : "";
  const d = await ask<PortalList>(`/cs-tv-amounts${m ? `?month=${m}` : ""}`, { method: "GET", verb: "list the TV amounts" });
  return {
    month: d.month,
    amounts: (d.extras ?? []).map(view),
    employees: (d.cs ?? []).map((c) => ({ id: c.id, name: c.name, team: c.team, addedByName: c.tv_only === true })),
    courses: d.products ?? [],
    totalAed: Number(d.total_aed) || 0,
    // The people added by name, and the teams one can be shown under. `canAddPeople`: CS Portal's server knows how.
    people: (d.people ?? []).map((p) => ({ id: p.id, name: p.name, team: p.team, addedBy: p.added_by ?? "", addedAt: p.added_at ?? "" })),
    teams: (d.teams ?? []).map((t) => ({ id: t.id, name: t.name })),
    canAddPeople: Array.isArray(d.people),
  };
}

/** What a root admin typed, as CS Portal takes it. CS Portal checks it again — this only keeps nonsense from leaving. */
function fields(body: Record<string, unknown>, all: boolean) {
  const out: Record<string, unknown> = {};
  if (all || body.aed !== undefined) {
    const aed = Number(body.aed);
    if (!Number.isFinite(aed) || aed <= 0) throw httpError("Give an amount in AED, more than 0", 400);
    out.aed = aed;
  }
  if (all || body.course !== undefined) {
    const course = String(body.course ?? "").trim();
    if (!course) throw httpError("Give the course", 400);
    out.product = course.slice(0, 60);
  }
  if (all || body.showOn !== undefined) {
    if (!(SHOW_ON as readonly unknown[]).includes(body.showOn)) throw httpError("Show it on the Dubai TV, the Bangalore TV, or both", 400);
    out.show_on = body.showOn;
  }
  if (body.at !== undefined && body.at !== null && body.at !== "") {
    const at = new Date(String(body.at));
    if (Number.isNaN(at.getTime())) throw httpError("That date isn't right", 400);
    out.at = at.toISOString();
  }
  return out;
}

/** { employeeId, aed, course, showOn, at? } — `at` left out: now, so it pops up on the TV. */
export async function addCsTvAmount(body: Record<string, unknown>, by: string) {
  const employeeId = String(body.employeeId ?? "");
  if (!ID.test(employeeId)) throw httpError("Pick the employee", 400);
  return ask<{ id: string }>("/cs-tv-amounts", { method: "POST", body: { cs_id: employeeId, ...fields(body, true), by }, verb: "add the amount" });
}

/** { aed?, course?, showOn?, at? } — whose it is stays: remove it and add another. */
export async function updateCsTvAmount(id: string, body: Record<string, unknown>, by: string) {
  if (!ID.test(id)) throw httpError("No such amount", 404);
  const set = fields(body, false);
  if (!Object.keys(set).length) throw httpError("Nothing to change", 400);
  return ask<{ id: string }>("/cs-tv-amounts/update", { method: "POST", body: { id, ...set, by }, verb: "change the amount" });
}

/** { name, teamId?, email? } — somebody with no CS account in CS Portal, to be picked like the team's CSs. */
export async function addCsTvPerson(body: Record<string, unknown>, by: string) {
  const name = String(body.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2) throw httpError("Give the name", 400);
  if (name.length > 80) throw httpError("That name is too long", 400);
  const teamId = String(body.teamId ?? "").trim();
  if (teamId && !ID.test(teamId)) throw httpError("Pick the team", 400);
  const email = String(body.email ?? "").trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError("That email isn't right", 400);
  return ask<{ id: string }>("/cs-tv-people", { method: "POST", body: { name, ...(teamId ? { team_id: teamId } : {}), ...(email ? { email } : {}), by }, verb: "add them" });
}

/** Takes them off the list, with every amount added for them. */
export async function removeCsTvPerson(id: string) {
  if (!ID.test(id)) throw httpError("No such person", 404);
  return ask<{ removed: boolean }>("/cs-tv-people/remove", { method: "POST", body: { id }, verb: "remove them" });
}

export async function removeCsTvAmount(id: string) {
  if (!ID.test(id)) throw httpError("No such amount", 404);
  return ask<{ removed: boolean }>("/cs-tv-amounts/remove", { method: "POST", body: { id }, verb: "remove the amount" });
}
