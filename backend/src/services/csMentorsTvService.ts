import { resolveTarget } from "../lib/targetClient.js";
import { isPastTvMonth } from "./salesTvService.js";
import { locationOf, mentorsTv, type MentorsTvLocation } from "./mentorsTvService.js";

/*
 * The CS & Mentors TV (the user, 2026-11-18: "split screen — one side CS and one side mentors, and the team leaders
 * too"): two halves of one screen, a location at a time —
 *
 *   the CS    CS Portal's open CS board for that location (GET /api/public/cs-tv?location=, the one behind its own
 *             CS TV — the same figures the office CS TV shows, the amounts typed for the TV included), each CS by the
 *             course payments they collected this month, and each team with its leader (2026-11-18);
 *   mentors   the Mentors TV's card (mentorsTvService.ts), each team with its Chief Mentor.
 *
 * Each half's new payments come among the closes, for the pop-up. One shared answer per location however many
 * screens: CS Portal asked at most every 20 seconds per board; a month gone by asked once and kept a few minutes.
 * A public screen gets a plain sentence for an error, never Root's own.
 */

const CODE = "commission";
const EVERY_MS = 20_000;
const TIMEOUT_MS = 8_000;
const WAIT_MS = 3_000;
const KEEP_MS = 2 * 3_600_000;

interface CsPerson {
  id: string; name: string; team_id?: string; team: string; month_aed: number; today_aed: number;
  payments: number; today_payments: number; photo: string | null; rank?: number;
}
interface CsPayment { id: string; cs: string; team: string; aed: number; product: string; at: string }
interface CsTeam {
  id?: string; team: string; leader?: string | null; leader_photo?: string | null;
  month_aed: number; today_aed: number; payments: number; cs_count: number;
}
interface CsAnswer {
  location?: string; month?: string; generated_at?: string;
  cs?: CsPerson[];
  teams?: CsTeam[];
  totals?: { month_aed: number; today_aed: number; payments: number };
  recent?: CsPayment[];
}
interface Got { data: CsAnswer | null; error: string | null; at: number }
interface State extends Got {
  askedAt: number; inflight: Promise<void> | null;
  /** Each payment, and when Root first saw it — a screen asks only for what is new since its last answer. */
  seen: Map<string, { p: CsPayment; seenAt: string }>;
}
const states = new Map<MentorsTvLocation, State>();
const stateOf = (loc: MentorsTvLocation): State => {
  let s = states.get(loc);
  if (!s) { s = { data: null, at: 0, askedAt: 0, error: null, inflight: null, seen: new Map() }; states.set(loc, s); }
  return s;
};
const pastCache = new Map<string, Got>();

const within = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise((ok) => setTimeout(ok, ms))]);
const validIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

async function ask(loc: MentorsTvLocation, month?: string): Promise<CsAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const target = await resolveTarget(CODE);
    const res = await fetch(`${target.base}/api/public/cs-tv?location=${loc}${month ? `&month=${month}` : ""}`, { signal: controller.signal });
    const body = (await res.json().catch(() => ({}))) as CsAnswer & { error?: string; message?: string };
    if (res.status === 404) throw new Error("CS Portal's server needs updating — it has no CS board yet");
    if (!res.ok || !Array.isArray(body.cs)) throw new Error(body.error ?? body.message ?? `CS Portal answered ${res.status}`);
    // A CS Portal from before the month switch answers with this month: not shown as if it were the one asked for.
    if (month && body.month !== month) throw new Error("CS Portal's server needs updating to show a past month");
    return body;
  } catch (err) {
    throw new Error((err as Error)?.name === "AbortError" ? "CS Portal didn't answer in time" : (err as Error)?.message || "CS Portal can't be reached");
  } finally {
    clearTimeout(timer);
  }
}

async function refresh(loc: MentorsTvLocation, now: number): Promise<void> {
  const s = stateOf(loc);
  if (s.inflight) return s.inflight;
  if (now - s.askedAt < EVERY_MS) return;
  s.askedAt = now;
  s.inflight = (async () => {
    try {
      const body = await ask(loc);
      s.data = body;
      s.at = Date.now();
      s.error = null;
      const seenAt = new Date().toISOString();
      for (const p of body.recent ?? []) if (p?.id && !s.seen.has(p.id)) s.seen.set(p.id, { p, seenAt });
      for (const [id, x] of s.seen) if (Date.now() - Date.parse(x.p.at) > KEEP_MS) s.seen.delete(id);
    } catch (err) {
      s.error = (err as Error).message;
    } finally {
      s.inflight = null;
    }
  })();
  return s.inflight;
}

/** The CS half, in the Sales TV's CS-card shape — each team with its leader, as CS Portal names them. */
function csCard(pub: boolean, from: Got) {
  const d = from.data;
  return {
    code: "cs" as const,
    name: "CS",
    status: from.error ? "error" : d ? "ok" : "loading",
    error: from.error ? (pub ? "The CS figures can't be reached right now." : from.error) : null,
    month: d?.month ?? null,
    updatedAt: from.at ? new Date(from.at).toISOString() : null,
    people: (d?.cs ?? []).map((p) => ({
      id: p.id, name: p.name, team: p.team, monthAed: p.month_aed, todayAed: p.today_aed,
      payments: p.payments, todayPayments: p.today_payments, photoUrl: p.photo ?? null,
    })),
    // A CS Portal from before 2026-11-18 names no leaders: the teams still show, without one.
    teams: (d?.teams ?? []).map((t) => ({
      team: t.team, leader: t.leader ?? null, leaderPhotoUrl: t.leader_photo ?? null,
      monthAed: t.month_aed, todayAed: t.today_aed, payments: t.payments, csCount: t.cs_count,
    })),
    totals: { monthAed: d?.totals?.month_aed ?? 0, todayAed: d?.totals?.today_aed ?? 0, payments: d?.totals?.payments ?? 0 },
  };
}

/**
 * The whole screen for a location: both halves and both halves' new payments among the closes. With `month` (a month
 * gone by), each half's standings as that month ended — no closes, nothing of today.
 */
export async function csMentorsTv(opts: { location?: unknown; since?: unknown; month?: unknown; publicView?: boolean } = {}) {
  const loc = locationOf(opts.location);
  const pub = opts.publicView === true;
  const base = { crms: [], onBreak: [], location: loc };
  if (isPastTvMonth(opts.month)) {
    const key = `${loc}:${opts.month}`;
    let got = pastCache.get(key);
    if (!got || got.error || Date.now() - got.at > 5 * 60_000) {
      try { got = { data: { ...(await ask(loc, opts.month)), recent: [] }, error: null, at: Date.now() }; } catch (err) { got = { data: null, error: (err as Error).message, at: 0 }; }
      pastCache.set(key, got);
    }
    const mentors = await mentorsTv({ location: loc, month: opts.month, publicView: pub });
    return { ...base, serverTime: new Date().toISOString(), past: true, month: opts.month, closes: [], cs: csCard(pub, got), mentors: mentors.cs };
  }
  const [mentors] = await Promise.all([
    mentorsTv({ location: loc, since: opts.since, publicView: pub }),
    within(refresh(loc, Date.now()), WAIT_MS),
  ]);
  const s = stateOf(loc);
  const since = validIso(opts.since) ? Date.parse(opts.since) : null;
  const csCloses = [...s.seen.values()]
    .filter((x) => since === null || Date.parse(x.seenAt) > since)
    .map(({ p, seenAt }) => ({
      key: `cs:${p.id}`, id: p.id, crm: "cs", crmName: "CS", closer: p.cs, courses: p.product ? [p.product] : [],
      amount: p.aed, academy: loc, currency: "AED" as const, at: p.at, seenAt, kind: "cs_payment" as const,
    }));
  const closes = [...csCloses, ...mentors.closes].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  // Stamped after both: a payment first seen while answering is in this answer, so the next ?since= won't bring it again.
  return { ...base, serverTime: new Date().toISOString(), past: false, month: s.data?.month ?? mentors.month, closes, cs: csCard(pub, s), mentors: mentors.cs };
}

/** For the check script: forget what was asked. */
export function resetCsMentorsTvForTests(): void { states.clear(); pastCache.clear(); }
