import { resolveTarget } from "../lib/targetClient.js";
import { isPastTvMonth, salesTv, salesTvMonth, type SalesTvOptions } from "./salesTvService.js";

/*
 * Manager TV (the user, 2026-10-23): "same as the Sales TV, only a new card for the CS, exactly like the CS
 * leaderboard" — Dubai Sales, Draw and Remote as the Sales TV has them (salesTvService.ts, its own cache), with the
 * team leaders, Sales Managers and Super Admins the Sales TV hides (and no On break / Latest closes cards), and a
 * fourth card: the CS team, as CS Portal's own CS leaderboard / CS TV ranks it — each CS by the course
 * payments they collected this month (approved, AED), with today's and how many, their HRMS photos and teams.
 *
 * The CS figures are CS Portal's open CS board (GET /api/public/cs-tv?location=dubai — the one behind its
 * /cs/dubai TV link: names, teams and amounts, never a student or an email), asked at most every 20 seconds
 * however many screens there are. A course payment approved since the screen opened is announced like a sale
 * ("CS payment"): it joins the closes with crm "cs".
 *
 * Asked with `real=1` (2026-11-14): the board without the amounts typed for the CS TV (the CS TV amounts page,
 * csTvAmountsService.ts) — managers read what was collected. A CS Portal server from before that takes no notice.
 */

const CODE = "commission";
const CS_LOCATION = "dubai";
const EVERY_MS = 20_000;
const TIMEOUT_MS = 8_000;
const WAIT_MS = 3_000;
const KEEP_MS = 2 * 3_600_000;
/**
 * Not listed on the Manager TV (the user, 2026-10-31: "hide dilshad from the managers tv") — his money still counts in
 * the Remote card's total and the header's (salesTv `hide`). MANAGER_TV_HIDE (names or emails, comma-separated)
 * replaces the list on a server.
 */
const hidden = () => (process.env.MANAGER_TV_HIDE ?? "dilshad").split(",").map((v) => v.trim()).filter(Boolean);

interface CsPerson {
  id: string; name: string; team_id?: string; team: string; month_aed: number; today_aed: number;
  payments: number; today_payments: number; photo: string | null; rank?: number;
}
interface CsPayment { id: string; cs: string; team: string; aed: number; product: string; at: string }
interface CsAnswer {
  location?: string; month?: string; generated_at?: string;
  cs?: CsPerson[];
  teams?: Array<{ id?: string; team: string; month_aed: number; today_aed: number; payments: number; cs_count: number }>;
  totals?: { month_aed: number; today_aed: number; payments: number };
  recent?: CsPayment[];
}

const state: {
  data: CsAnswer | null; at: number; askedAt: number; error: string | null; inflight: Promise<void> | null;
  /** Each payment, and when Root first saw it — a screen asks only for what is new since its last answer. */
  seen: Map<string, { p: CsPayment; seenAt: string }>;
} = { data: null, at: 0, askedAt: 0, error: null, inflight: null, seen: new Map() };

const within = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise((ok) => setTimeout(ok, ms))]);

async function refreshCs(now: number): Promise<void> {
  if (state.inflight) return state.inflight;
  if (now - state.askedAt < EVERY_MS) return;
  state.askedAt = now;
  state.inflight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const target = await resolveTarget(CODE);
      const res = await fetch(`${target.base}/api/public/cs-tv?location=${CS_LOCATION}&real=1`, { signal: controller.signal });
      const body = (await res.json().catch(() => ({}))) as CsAnswer & { error?: string; message?: string };
      if (res.status === 404) throw new Error("CS Portal's server needs updating — it has no CS board yet");
      if (!res.ok || !Array.isArray(body.cs)) throw new Error(body.error ?? body.message ?? `CS Portal answered ${res.status}`);
      state.data = body;
      state.at = Date.now();
      state.error = null;
      const seenAt = new Date().toISOString();
      for (const p of body.recent ?? []) if (p?.id && !state.seen.has(p.id)) state.seen.set(p.id, { p, seenAt });
      for (const [id, s] of state.seen) if (Date.now() - Date.parse(s.p.at) > KEEP_MS) state.seen.delete(id);
    } catch (err) {
      state.error = (err as Error)?.name === "AbortError" ? "CS Portal didn't answer in time" : (err as Error)?.message || "CS Portal can't be reached";
    } finally {
      clearTimeout(timer);
      state.inflight = null;
    }
  })();
  return state.inflight;
}

const validIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** The CS card. A public screen gets a plain sentence for an error, never Root's own. */
function csCard(pub: boolean, from: { data: CsAnswer | null; error: string | null; at: number } = state) {
  const d = from.data;
  const status = from.error ? "error" : d ? "ok" : "loading";
  return {
    code: "cs",
    // The CS team on the Manager TV (the user, 2026-11-06).
    name: "Team Mafia",
    status,
    error: from.error ? (pub ? "The CS figures can't be reached right now." : from.error) : null,
    month: d?.month ?? null,
    updatedAt: from.at ? new Date(from.at).toISOString() : null,
    people: (d?.cs ?? []).map((p) => ({
      id: p.id, name: p.name, team: p.team, monthAed: p.month_aed, todayAed: p.today_aed,
      payments: p.payments, todayPayments: p.today_payments, photoUrl: p.photo ?? null,
    })),
    teams: (d?.teams ?? []).map((t) => ({ team: t.team, monthAed: t.month_aed, todayAed: t.today_aed, payments: t.payments, csCount: t.cs_count })),
    totals: { monthAed: d?.totals?.month_aed ?? 0, todayAed: d?.totals?.today_aed ?? 0, payments: d?.totals?.payments ?? 0 },
  };
}

/** The CS payments as closes — the board announces and lists them with the sales. */
function csCloses(since: number | null) {
  return [...state.seen.values()]
    .filter((s) => since === null || Date.parse(s.seenAt) > since)
    .map(({ p, seenAt }) => ({
      key: `cs:${p.id}`, id: p.id, crm: "cs", crmName: "Team Mafia", closer: p.cs, courses: p.product ? [p.product] : [],
      amount: p.aed, academy: "dubai" as const, currency: "AED" as const, at: p.at, seenAt, kind: "cs_payment" as const,
    }));
}

/** A month gone by: CS Portal's board for it, asked once and kept a few minutes. */
const csPast = new Map<string, { data: CsAnswer | null; error: string | null; at: number }>();
async function csMonth(month: string): Promise<{ data: CsAnswer | null; error: string | null; at: number }> {
  const had = csPast.get(month);
  if (had && !had.error && Date.now() - had.at < 5 * 60_000) return had;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let out: { data: CsAnswer | null; error: string | null; at: number };
  try {
    const target = await resolveTarget(CODE);
    const res = await fetch(`${target.base}/api/public/cs-tv?location=${CS_LOCATION}&month=${month}&real=1`, { signal: controller.signal });
    const body = (await res.json().catch(() => ({}))) as CsAnswer & { error?: string; message?: string };
    if (!res.ok || !Array.isArray(body.cs)) throw new Error(body.error ?? body.message ?? `CS Portal answered ${res.status}`);
    // A CS Portal from before the month switch answers with this month: not shown as if it were the one asked for.
    if (body.month !== month) throw new Error("CS Portal's server needs updating to show a past month");
    out = { data: { ...body, recent: [] }, error: null, at: Date.now() };
  } catch (err) {
    out = { data: null, error: (err as Error)?.name === "AbortError" ? "CS Portal didn't answer in time" : (err as Error)?.message || "CS Portal can't be reached", at: 0 };
  } finally {
    clearTimeout(timer);
  }
  csPast.set(month, out);
  return out;
}

/**
 * The whole Manager TV: the Sales TV's answer, the CS card, and the CS payments among the closes. With `month` (a
 * month gone by, 2026-11-01: "switch months"), that month's standings as it ended — no closes, nothing of today.
 */
export async function managerTv(opts: SalesTvOptions & { month?: unknown } = {}) {
  if (isPastTvMonth(opts.month)) {
    const [sales, cs] = await Promise.all([salesTvMonth(opts.month, { ...opts, withBosses: true, hide: hidden() }), csMonth(opts.month)]);
    return { ...sales, serverTime: new Date().toISOString(), past: true, cs: csCard(opts.publicView === true, cs) };
  }
  // Everybody in the CRMs' tables — dilshad, the Sales Managers and the team leaders too (2026-10-23); the Sales TV
  // hides them.
  const [sales] = await Promise.all([salesTv({ ...opts, withBosses: true, hide: hidden() }), within(refreshCs(Date.now()), WAIT_MS)]);
  const since = validIso(opts.since) ? Date.parse(opts.since) : null;
  const closes = [...sales.closes, ...csCloses(since)].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  // Stamped after both: a payment Root first saw while the Sales TV was answering is in this answer, so the
  // screen's next ?since= must not bring it again.
  return { ...sales, serverTime: new Date().toISOString(), past: false, closes, cs: csCard(opts.publicView === true) };
}

/** For the check script: forget what was asked. */
export function resetManagerTvForTests(): void {
  state.data = null; state.at = 0; state.askedAt = 0; state.error = null; state.inflight = null; state.seen.clear(); csPast.clear();
}
