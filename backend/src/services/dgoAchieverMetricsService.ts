import type { Types } from "mongoose";
import { getSources, type CrmSource } from "./crmConnections.js";
import { bangaloreUnion, COUNTED_PAYMENT } from "./bangaloreRevenue.js";
import { RewardClaim } from "../models/RewardClaim.js";
import { Organization } from "../models/Organization.js";
import { resolveTarget } from "../lib/targetClient.js";
import { listCses } from "./cseService.js";
import { scores as mentorKpiScores } from "./mentorKpiService.js";
import { KPI_ROLES, type KpiRole } from "./mentorKpiMetrics.js";

/*
 * DGO Points' monthly achievers (HRMS, 2026-11-21): one month's figures per person, for HRMS to rank the elite
 * categories — Sales first/second, the best sales team leader, CS first/second, the CS Manager, and the chief,
 * senior and junior mentors. HRMS matches people by email and decides who wins; Root only counts, read-only:
 *
 *   sales    Dubai's three sales CRMs (Delta, Draw, Remote — Banglore's staff are in HRMS's separate Bangalore
 *            organisation), each person's month counted exactly as their CRM's gift rewards count it
 *            (services/rewardsService.ts in each CRM: `tierOf` + `closedBy`): payments dated in the Dubai month on
 *            the leads they hold, a balance payment once finance approved it, a Bangalore enrolment's rupees in AED at
 *            the CRM's own rate (and in Remote any rupee payment) — bangaloreRevenue.ts, read from each CRM's
 *            database as the Salespeople page reads it. Left out as gift rewards leave them out: anybody not active,
 *            Super Admins, the CRM's Sales Manager, the logins its commission plan excludes, anybody in no active team.
 *            A leader of an active team is a team leader (the `teams` rows), never a salesperson row.
 *   teams    one row per team leader: every person in the active teams they lead (leaders and members), together.
 *   gifts    a live gift claim (RewardClaim) for that CRM and month — HRMS gives the elite Sales and team-leader
 *            awards only to people who did not already take a gift.
 *   cs       each Dubai CS's approved course payments in the month — CS Portal's own CS board with `real=1`, the figure
 *            the Manager TV shows (never the amounts typed for the TV); emails and CS Managers from CS Portal's
 *            CS overview for the month (the board carries no email). csDepartment is the board's Dubai total.
 *   mentors  the month's mentor KPI score per mentor (mentorKpiService), with the share of the plan that could be
 *            scored, for the chief / senior / junior mentors.
 *
 * A source that can't be read is named in `problems` and the rest still answers. Kept 10 minutes for the current
 * month and 6 hours for a finished one; an answer with problems only 2 minutes, so a source back up is seen soon.
 */

export const DGO_SALES_CRMS = ["delta", "draw", "remote"] as const;
type SalesCrm = (typeof DGO_SALES_CRMS)[number];
const CRM_NAMES: Record<SalesCrm, string> = { delta: "Dubai Sales", draw: "Draw", remote: "Remote" };

const MONTH = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;
const DUBAI_OFFSET_MS = 4 * 3_600_000;
const QUERY_MS = 20_000;
const CS_TIMEOUT_MS = 15_000;
const CURRENT_KEEP_MS = 10 * 60_000;
const PAST_KEEP_MS = 6 * 3_600_000;
const PROBLEM_KEEP_MS = 2 * 60_000;

export interface SalesRow { email: string; name: string; crm: SalesCrm; team: string | null; salesAed: number; giftClaimed: boolean }
export interface TeamRow { crm: SalesCrm; team: string; leaderEmail: string; leaderName: string; salesAed: number; leaderGiftClaimed: boolean }
export interface CsRow { email: string; name: string; role: "cs" | "cs_manager"; collectedAed: number }
export interface MentorRow { email: string; name: string; role: KpiRole; score: number | null; coverage: number | null }
export interface AchieverMetrics {
  month: string;
  generatedAt: string;
  sales: SalesRow[];
  teams: TeamRow[];
  cs: CsRow[];
  csDepartment: { collectedAed: number };
  mentors: MentorRow[];
  problems: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const emailOf = (v: unknown) => String(v ?? "").trim().toLowerCase();
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e ?? "could not be read"));

/** This Dubai month, "2026-11". */
export const dubaiMonthNow = (at = Date.now()) => new Date(at + DUBAI_OFFSET_MS).toISOString().slice(0, 7);

/** A real month, not after this Dubai month. */
export const validAchieverMonth = (v: unknown): v is string => typeof v === "string" && MONTH.test(v) && v <= dubaiMonthNow();

/** A Dubai month as instants: its first moment and the next month's. */
export function dubaiMonthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1) - DUBAI_OFFSET_MS), to: new Date(Date.UTC(y, m, 1) - DUBAI_OFFSET_MS) };
}

/* ── Sales: one CRM, as its gift rewards count ─────────────────────────────────────────────────────────────────── */

interface CrmUser { _id: Types.ObjectId; name?: string; email?: string; role?: unknown }
interface CrmTeam { _id: Types.ObjectId; name?: string; leaders?: unknown[]; members?: unknown[] }

/** Each person's counted payments in the month, AED, by CRM user id. */
async function revenueBy(src: CrmSource, month: string): Promise<Map<string, number>> {
  const { from, to } = dubaiMonthRange(month);
  const inMonth = { $gte: from, $lt: to };
  const rows = await src.conn.collection("leads").aggregate<{ _id: unknown; n: number }>([
    ...(await bangaloreUnion(src)),
    { $match: { "payments.paidAt": inMonth } },
    { $unwind: "$payments" },
    { $match: COUNTED_PAYMENT },
    { $match: { "payments.paidAt": inMonth } },
    { $group: { _id: "$assignedTo", n: { $sum: "$payments.amount" } } },
  ], { maxTimeMS: QUERY_MS }).toArray();
  return new Map(rows.filter((r) => r._id != null).map((r) => [String(r._id), Number(r.n) || 0]));
}

/**
 * One CRM's salespeople and team leaders for the month. The same people and the same sums as the CRM's own gift
 * rewards: `tierOf` decides who is a team leader (leads an active team), a salesperson (in an active team) or nobody,
 * and `closedBy` adds the people's counted payments.
 */
export async function crmSales(src: CrmSource, code: SalesCrm, month: string): Promise<{ sales: SalesRow[]; teams: TeamRow[] }> {
  const db = src.conn;
  const opts = { maxTimeMS: QUERY_MS };
  const [users, roles, settings, teams, revenue, claims] = await Promise.all([
    db.collection("users").find({ status: "active" }, { projection: { name: 1, email: 1, role: 1 }, ...opts }).toArray() as Promise<unknown[]> as Promise<CrmUser[]>,
    db.collection("roles").find({ isSystemRole: true, roleName: "Super Admin" }, { projection: { _id: 1 }, ...opts }).toArray(),
    db.collection("commissionsettings").findOne({}, { projection: { salesManager: 1, excludedUsers: 1 }, ...opts }),
    db.collection("teams").find({ status: "active" }, { projection: { name: 1, leaders: 1, members: 1 }, ...opts }).toArray() as Promise<unknown[]> as Promise<CrmTeam[]>,
    revenueBy(src, month),
    RewardClaim.find({ portal: code, month, live: true }).select("userId").lean<Array<{ userId: string }>>(),
  ]);
  const superAdmin = new Set(roles.map((r) => String(r._id)));
  const s = settings as { salesManager?: unknown; excludedUsers?: unknown[] } | null;
  const leftOut = new Set([s?.salesManager, ...(s?.excludedUsers ?? [])].filter(Boolean).map(String));
  const gift = new Set(claims.map((c) => String(c.userId)));
  const sumOf = (ids: Iterable<string>) => round2([...ids].reduce((a, id) => a + (revenue.get(id) ?? 0), 0));

  const salesRows: SalesRow[] = [];
  const teamRows: TeamRow[] = [];
  for (const u of users) {
    const id = String(u._id);
    if (u.role != null && superAdmin.has(String(u.role))) continue;
    if (leftOut.has(id)) continue;
    const led = teams.filter((t) => (t.leaders ?? []).some((l) => String(l) === id));
    if (led.length) {
      const people = new Set<string>();
      for (const t of led) for (const p of [...(t.leaders ?? []), ...(t.members ?? [])]) people.add(String(p));
      teamRows.push({
        crm: code, team: led.map((t) => text(t.name)).filter(Boolean).join(", "), leaderEmail: emailOf(u.email), leaderName: text(u.name),
        salesAed: sumOf(people), leaderGiftClaimed: gift.has(id),
      });
      continue;
    }
    const memberOf = teams.filter((t) => (t.members ?? []).some((m) => String(m) === id));
    if (!memberOf.length) continue;
    salesRows.push({
      email: emailOf(u.email), name: text(u.name), crm: code, team: memberOf.map((t) => text(t.name)).filter(Boolean).join(", ") || null,
      salesAed: sumOf([id]), giftClaimed: gift.has(id),
    });
  }
  return { sales: salesRows, teams: teamRows };
}

async function allSales(month: string, problems: string[]): Promise<{ sales: SalesRow[]; teams: TeamRow[] }> {
  const { sources, failures } = await getSources();
  const sales: SalesRow[] = [];
  const teams: TeamRow[] = [];
  const known = await Organization.find({ code: { $in: [...DGO_SALES_CRMS] } }).select("code name isActive kind").lean<Array<{ code: string; name: string; isActive: boolean; kind?: string }>>();
  await Promise.all(DGO_SALES_CRMS.map(async (code) => {
    const name = known.find((o) => o.code === code)?.name || CRM_NAMES[code];
    const src = sources.find((x) => x.org.code === code);
    if (!src) {
      const failed = failures.find((f) => f.code === code);
      problems.push(failed ? `${name}: ${failed.error}` : `${name} isn't an active sales CRM on this server`);
      return;
    }
    try {
      const out = await crmSales(src, code, month);
      sales.push(...out.sales);
      teams.push(...out.teams);
    } catch (e) {
      problems.push(`${name}: its sales couldn't be counted — ${errorText(e)}`);
    }
  }));
  const order = DGO_SALES_CRMS as readonly string[];
  sales.sort((a, b) => b.salesAed - a.salesAed || order.indexOf(a.crm) - order.indexOf(b.crm) || a.name.localeCompare(b.name));
  teams.sort((a, b) => b.salesAed - a.salesAed || order.indexOf(a.crm) - order.indexOf(b.crm) || a.leaderName.localeCompare(b.leaderName));
  return { sales, teams };
}

/* ── CS: CS Portal's real board, with emails from its overview ─────────────────────────────────────────────────── */

interface CsBoard { month?: string; cs?: Array<{ id?: string; name?: string; month_aed?: number }>; totals?: { month_aed?: number } }
interface CsOverviewRow { id?: string; name?: string; email?: string; role?: string; location?: string; active?: boolean }

/** CS Portal's Dubai CS board for the month, without the amounts typed for the TV. */
async function csBoard(month: string): Promise<CsBoard> {
  const target = await resolveTarget("commission");
  const current = month === dubaiMonthNow();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CS_TIMEOUT_MS);
  try {
    const res = await fetch(`${target.base}/api/public/cs-tv?location=dubai&real=1${current ? "" : `&month=${month}`}`, { signal: controller.signal });
    const body = (await res.json().catch(() => ({}))) as CsBoard & { error?: string; message?: string };
    if (res.status === 404) throw new Error("CS Portal's server needs updating — it has no CS board yet");
    if (!res.ok || !Array.isArray(body.cs)) throw new Error(body.error ?? body.message ?? `CS Portal answered ${res.status}`);
    // A CS Portal from before the month switch answers with this month: not passed on as the one asked for.
    if (!current && body.month !== month) throw new Error("CS Portal's server needs updating to show a past month");
    return body;
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw new Error("CS Portal didn't answer in time");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function csFigures(month: string, problems: string[]): Promise<{ cs: CsRow[]; csDepartment: { collectedAed: number } }> {
  const range = dubaiMonthRange(month);
  const [board, overview] = await Promise.allSettled([csBoard(month), listCses({ from: range.from, to: range.to })]);
  const listed = overview.status === "fulfilled" ? (overview.value as Record<string, unknown>).rows : undefined;
  const rows: CsOverviewRow[] = Array.isArray(listed) ? (listed as CsOverviewRow[]) : [];
  if (overview.status === "rejected") problems.push(`CS: CS Portal's overview couldn't be read, so the CSs have no emails and no CS Manager is named — ${errorText(overview.reason)}`);
  const byId = new Map(rows.filter((r) => r.id).map((r) => [String(r.id), r]));

  const cs: CsRow[] = [];
  let departmentAed = 0;
  if (board.status === "fulfilled") {
    const noEmail: string[] = [];
    for (const p of board.value.cs ?? []) {
      const email = emailOf(byId.get(String(p.id))?.email);
      if (!email) noEmail.push(text(p.name) || String(p.id));
      cs.push({ email, name: text(p.name), role: "cs", collectedAed: round2(Number(p.month_aed) || 0) });
    }
    departmentAed = round2(Number(board.value.totals?.month_aed) || cs.reduce((a, r) => a + r.collectedAed, 0));
    if (noEmail.length && overview.status === "fulfilled") {
      problems.push(`CS: CS Portal gave no email for ${noEmail.length} CS (${noEmail.slice(0, 10).join(", ")}${noEmail.length > 10 ? ", …" : ""}), so HRMS can't match them`);
    }
  } else {
    problems.push(`CS: CS Portal's board couldn't be read — ${errorText(board.reason)}`);
  }

  if (overview.status === "fulfilled") {
    const managers = rows.filter((r) => r.role === "cs_manager" && r.active !== false && (r.location ?? "dubai") === "dubai" && emailOf(r.email));
    // A CS Manager collects on the board too only if CS Portal lists them there; otherwise their own figure is 0 —
    // HRMS judges the CS Manager on csDepartment.
    for (const m of managers) {
      if (cs.some((c) => c.email === emailOf(m.email))) continue;
      cs.push({ email: emailOf(m.email), name: text(m.name), role: "cs_manager", collectedAed: 0 });
    }
    if (!managers.length) problems.push("CS: CS Portal's overview names no active Dubai CS Manager this month");
  }
  cs.sort((a, b) => b.collectedAed - a.collectedAed || a.name.localeCompare(b.name));
  return { cs, csDepartment: { collectedAed: departmentAed } };
}

/* ── Mentors: the month's mentor KPI scores ────────────────────────────────────────────────────────────────────── */

async function mentorFigures(month: string, problems: string[]): Promise<MentorRow[]> {
  try {
    const s = await mentorKpiScores(month);
    if (!s.plan) {
      problems.push(`Mentors: no approved mentor KPI plan covers ${month}, so there are no mentor scores`);
      return [];
    }
    for (const [key, state] of Object.entries((s.sources ?? {}) as Record<string, { available?: boolean; message?: string }>)) {
      if (state && state.available === false) problems.push(`Mentors: ${key.toUpperCase()} wasn't available for the scores${state.message ? ` — ${state.message}` : ""}`);
    }
    return s.mentors
      .filter((m) => m.role && (KPI_ROLES as readonly string[]).includes(m.role) && emailOf(m.email))
      .map((m) => ({
        email: emailOf(m.email), name: text(m.name), role: m.role as KpiRole,
        score: typeof m.score === "number" ? m.score : null,
        coverage: typeof m.coverage === "number" ? m.coverage : null,
      }));
  } catch (e) {
    problems.push(`Mentors: the mentor KPI scores couldn't be read — ${errorText(e)}`);
    return [];
  }
}

/* ── The answer, kept per month ────────────────────────────────────────────────────────────────────────────────── */

const cache = new Map<string, { at: number; data: AchieverMetrics }>();
const inFlight = new Map<string, Promise<AchieverMetrics>>();

const keepFor = (data: AchieverMetrics) =>
  data.problems.length ? PROBLEM_KEEP_MS : data.month < dubaiMonthNow() ? PAST_KEEP_MS : CURRENT_KEEP_MS;

/** One month's figures for HRMS's monthly achievers. Never throws for a source that is down: it is named in `problems`. */
export async function achieverMetrics(month: string): Promise<AchieverMetrics> {
  const hit = cache.get(month);
  if (hit && Date.now() - hit.at < keepFor(hit.data)) return hit.data;
  const running = inFlight.get(month);
  if (running) return running;
  const p = (async () => {
    const problems: string[] = [];
    const salesProblems: string[] = [], csProblems: string[] = [], mentorProblems: string[] = [];
    const [sales, cs, mentors] = await Promise.all([
      allSales(month, salesProblems).catch((e) => { salesProblems.push(`Sales: ${errorText(e)}`); return { sales: [], teams: [] }; }),
      csFigures(month, csProblems).catch((e) => { csProblems.push(`CS: ${errorText(e)}`); return { cs: [] as CsRow[], csDepartment: { collectedAed: 0 } }; }),
      mentorFigures(month, mentorProblems),
    ]);
    problems.push(...salesProblems.sort(), ...csProblems, ...mentorProblems);
    const data: AchieverMetrics = {
      month, generatedAt: new Date().toISOString(),
      sales: sales.sales, teams: sales.teams, cs: cs.cs, csDepartment: cs.csDepartment, mentors, problems,
    };
    cache.set(month, { at: Date.now(), data });
    return data;
  })().finally(() => inFlight.delete(month));
  inFlight.set(month, p);
  return p;
}

/** For the check script: forget every month. */
export function resetAchieverMetricsForTests(): void {
  cache.clear();
  inFlight.clear();
}
