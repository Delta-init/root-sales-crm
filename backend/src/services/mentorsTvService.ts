import { resolveTarget } from "../lib/targetClient.js";
import { isPastTvMonth } from "./salesTvService.js";

/*
 * The Mentors TV (the user, 2026-11-17: "a mentors revenue leaderboard — a separate link, not on the Sales TV or the
 * Manager TV"): CS Portal's open mentor board (GET /api/public/mentor-tv?location=, functions/mentorTv.ts there) in
 * the Sales TV's shape, so the same board draws it — one card, the mentors, with their meetings beside — and each
 * mentor's new payment among the closes, for the pop-up. A mentor's revenue is the course payments that name them as
 * the meeting's mentor, approved, AED.
 *
 * One shared answer per location however many screens: CS Portal is asked at most every 20 seconds; a month gone by is
 * asked once and kept a few minutes. A public screen gets a plain sentence for an error, never Root's own.
 */

const CODE = "commission";
const EVERY_MS = 20_000;
const TIMEOUT_MS = 8_000;
const WAIT_MS = 3_000;
const KEEP_MS = 2 * 3_600_000;

export type MentorsTvLocation = "dubai" | "bangalore";
export const locationOf = (v: unknown): MentorsTvLocation => (v === "bangalore" ? "bangalore" : "dubai");

interface Mentor {
  id: string; name: string; role: string; team: string; month_aed: number; today_aed: number;
  payments: number; today_payments: number; meetings: number | null; photo: string | null; rank?: number;
}
interface Payment { id: string; mentor: string; team: string; aed: number; product: string; at: string }
interface Answer {
  location?: string; month?: string; past?: boolean; generated_at?: string; meetings_available?: boolean;
  mentors?: Mentor[];
  totals?: { month_aed: number; today_aed: number; payments: number; meetings: number | null };
  recent?: Payment[];
}
interface State {
  data: Answer | null; at: number; askedAt: number; error: string | null; inflight: Promise<void> | null;
  /** Each payment, and when Root first saw it — a screen asks only for what is new since its last answer. */
  seen: Map<string, { p: Payment; seenAt: string }>;
}
const states = new Map<MentorsTvLocation, State>();
const stateOf = (loc: MentorsTvLocation): State => {
  let s = states.get(loc);
  if (!s) { s = { data: null, at: 0, askedAt: 0, error: null, inflight: null, seen: new Map() }; states.set(loc, s); }
  return s;
};

const within = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise((ok) => setTimeout(ok, ms))]);
const validIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

async function ask(loc: MentorsTvLocation, month?: string): Promise<Answer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const target = await resolveTarget(CODE);
    const res = await fetch(`${target.base}/api/public/mentor-tv?location=${loc}${month ? `&month=${month}` : ""}`, { signal: controller.signal });
    const body = (await res.json().catch(() => ({}))) as Answer & { error?: string; message?: string };
    if (res.status === 404) throw new Error("CS Portal's server needs updating — it has no mentor board yet");
    if (!res.ok || !Array.isArray(body.mentors)) throw new Error(body.error ?? body.message ?? `CS Portal answered ${res.status}`);
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

/** The mentors' card, in the Sales TV's CS-card shape (SalesTvBoard draws it), each mentor with their meetings. */
function card(pub: boolean, from: { data: Answer | null; error: string | null; at: number }) {
  const d = from.data;
  return {
    code: "cs" as const,
    name: "Mentors",
    status: from.error ? "error" : d ? "ok" : "loading",
    error: from.error ? (pub ? "The mentors' figures can't be reached right now." : from.error) : null,
    month: d?.month ?? null,
    updatedAt: from.at ? new Date(from.at).toISOString() : null,
    people: (d?.mentors ?? []).map((m) => ({
      id: m.id, name: m.name, team: [m.role, m.team].filter(Boolean).join(" · "), monthAed: m.month_aed, todayAed: m.today_aed,
      payments: m.payments, todayPayments: m.today_payments, photoUrl: m.photo ?? null, meetings: m.meetings,
    })),
    teams: [],
    totals: { monthAed: d?.totals?.month_aed ?? 0, todayAed: d?.totals?.today_aed ?? 0, payments: d?.totals?.payments ?? 0, meetings: d?.totals?.meetings ?? null },
  };
}

const pastCache = new Map<string, { data: Answer | null; error: string | null; at: number }>();

/**
 * The Mentors TV for a location: the mentors' card and their new payments as closes. With `month` (a month gone by),
 * that month's standings as it ended — no closes, nothing of today.
 */
export async function mentorsTv(opts: { location?: unknown; since?: unknown; month?: unknown; publicView?: boolean } = {}) {
  const loc = locationOf(opts.location);
  const pub = opts.publicView === true;
  const base = { crms: [], onBreak: [], location: loc };
  if (isPastTvMonth(opts.month)) {
    const key = `${loc}:${opts.month}`;
    let got = pastCache.get(key);
    if (!got || got.error || Date.now() - got.at > 5 * 60_000) {
      try { got = { data: await ask(loc, opts.month), error: null, at: Date.now() }; } catch (err) { got = { data: null, error: (err as Error).message, at: 0 }; }
      pastCache.set(key, got);
    }
    return { ...base, serverTime: new Date().toISOString(), past: true, month: opts.month, closes: [], cs: card(pub, got) };
  }
  await within(refresh(loc, Date.now()), WAIT_MS);
  const s = stateOf(loc);
  const since = validIso(opts.since) ? Date.parse(opts.since) : null;
  const closes = [...s.seen.values()]
    .filter((x) => since === null || Date.parse(x.seenAt) > since)
    .map(({ p, seenAt }) => ({
      key: `mentor:${p.id}`, id: p.id, crm: "mentors", crmName: "Mentors", closer: p.mentor, courses: p.product ? [p.product] : [],
      amount: p.aed, academy: loc, currency: "AED" as const, at: p.at, seenAt, kind: "mentor_payment" as const,
    }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  // Stamped after the answer: a payment first seen while answering is in it, so the next ?since= won't bring it again.
  return { ...base, serverTime: new Date().toISOString(), past: false, month: s.data?.month, closes, cs: card(pub, s) };
}

/** For the check script: forget what was asked. */
export function resetMentorsTvForTests(): void { states.clear(); pastCache.clear(); }
