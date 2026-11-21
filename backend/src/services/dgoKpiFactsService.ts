import { getSources } from "./crmConnections.js";
import { orgTracker } from "./trackerService.js";
import { METRICS, scorableKeys, reportedManualKeys } from "./trackerMetrics.js";
import { DGO_SALES_CRMS } from "./dgoAchieverMetricsService.js";
import { Organization } from "../models/Organization.js";
import { resolveTarget, callTarget } from "../lib/targetClient.js";

/*
 * DGO Points' daily sales KPI facts (HRMS, 2026-11-21): one Dubai day of the daily tracker per salesperson, for HRMS
 * to award KPI met (20 points) at 100% and KPI exceeded (30) at 120%. HRMS matches people by email and decides who is
 * paid; Root only counts, read-only:
 *
 *   people   Dubai's three sales CRMs (Delta, Draw, Remote — Banglore's staff are in HRMS's separate Bangalore
 *            organisation), each person's row of the tracker for the day exactly as the Tracker page shows it
 *            (trackerService.orgTracker: their share of the desk's targets, the metrics the org can be scored on plus
 *            any typed-in figure they filed). `score` is the tracker's own (each metric capped at 100%). `achievedPct`
 *            is the same metrics averaged with each capped at 200% instead — the tracker's cap would make 120% (KPI
 *            exceeded) impossible, and a cap still stops one enormous line from carrying a day. A metric with no
 *            target is left out, as the tracker leaves it out.
 *   reviews  the LMS's verified student ratings of a mentor (InstructorReview: only a class the student attended can
 *            be rated) left that Dubai day with five stars and some words — the LMS's own review feed
 *            (/service/instructor-reviews/feed, with the secret Root already holds for the LMS). First names only.
 *
 * A source that can't be read is named in `problems` and the rest still answers. Kept 10 minutes for today and 6 hours
 * for an earlier day; an answer with problems only 2 minutes. The tracker is live, so a day can still move after it —
 * HRMS asks again for yesterday and never takes points back.
 */

type SalesCrm = (typeof DGO_SALES_CRMS)[number];
const CRM_NAMES: Record<SalesCrm, string> = { delta: "Dubai Sales", draw: "Draw", remote: "Remote" };
const DAY = /^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DUBAI_OFFSET_MS = 4 * 3_600_000;
const CAP_PCT = 200;
const REVIEW_PAGES = 10;
const REVIEWS_PER_PAGE = 100;
const TODAY_KEEP_MS = 10 * 60_000;
const PAST_KEEP_MS = 6 * 3_600_000;
const PROBLEM_KEEP_MS = 2 * 60_000;

export interface KpiMetric { key: string; label: string; actual: number; target: number; pct: number }
export interface KpiPerson { email: string; name: string; crm: SalesCrm; achievedPct: number; score: number; metrics: KpiMetric[] }
export interface KpiReview { id: string; mentorEmail: string; mentorName: string; rating: number; comment: string; className: string | null; studentName: string | null; at: string }
export interface KpiFacts { date: string; generatedAt: string; people: KpiPerson[]; reviews: KpiReview[]; problems: string[] }

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const emailOf = (v: unknown) => String(v ?? "").trim().toLowerCase();
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e ?? "could not be read"));
const LABEL = new Map(METRICS.map((m) => [m.key, m.label]));

/** Today in Dubai, "2026-11-21". */
export const dubaiToday = (at = Date.now()) => new Date(at + DUBAI_OFFSET_MS).toISOString().slice(0, 10);

/** A real day, not after today in Dubai. */
export const validKpiDate = (v: unknown): boolean =>
  typeof v === "string" && DAY.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v && v <= dubaiToday();

/** A Dubai day as instants: its first moment and the next day's. */
export function dubaiDayRange(day: string): { from: Date; to: Date } {
  const from = new Date(Date.parse(`${day}T00:00:00Z`) - DUBAI_OFFSET_MS);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

/**
 * One tracker row's facts: the metrics its score is made of (the org's scorable ones plus any typed-in figure filed),
 * each against the person's share of the target, uncapped; and their average with each capped at 200%. Pure.
 */
export function personMetrics(code: string, values: Record<string, number>, repTargets: Record<string, number>): { achievedPct: number; metrics: KpiMetric[] } {
  const keys = [...scorableKeys(code), ...reportedManualKeys(values)].filter((k) => (repTargets[k] ?? 0) > 0);
  const raw = keys.map((k) => ({ key: k, actual: values[k] ?? 0, target: repTargets[k], pct: ((values[k] ?? 0) / repTargets[k]) * 100 }));
  const achievedPct = raw.length ? round1(raw.reduce((a, m) => a + Math.min(CAP_PCT, m.pct), 0) / raw.length) : 0;
  return {
    achievedPct,
    metrics: raw.map((m) => ({ key: m.key, label: LABEL.get(m.key) ?? m.key, actual: round2(m.actual), target: round2(m.target), pct: round1(m.pct) })),
  };
}

/* ── People: the three Dubai sales CRMs' tracker for the day ─────────────────────────────────────────────────── */

async function crmPeople(code: SalesCrm, name: string, date: string, problems: string[]): Promise<KpiPerson[]> {
  const t = await orgTracker(code, date);
  const out: KpiPerson[] = [];
  const noEmail: string[] = [];
  for (const row of t.rows) {
    const email = emailOf(row.email);
    if (!email) {
      // Only somebody who can still work is worth naming: a closed account without an address can't earn anything.
      if (row.accountStatus === "active") noEmail.push(text(row.name) || row.userId);
      continue;
    }
    const facts = personMetrics(code, row.values, t.repTargets);
    out.push({ email, name: text(row.name), crm: code, achievedPct: facts.achievedPct, score: row.score, metrics: facts.metrics });
  }
  if (noEmail.length) {
    problems.push(`${name}: ${noEmail.length} ${noEmail.length === 1 ? "person has" : "people have"} no email (${noEmail.slice(0, 10).join(", ")}${noEmail.length > 10 ? ", …" : ""}), so HRMS can't match them`);
  }
  return out;
}

async function allPeople(date: string, problems: string[]): Promise<KpiPerson[]> {
  const { sources, failures } = await getSources();
  const known = await Organization.find({ code: { $in: [...DGO_SALES_CRMS] } }).select("code name").lean<Array<{ code: string; name: string }>>();
  const people: KpiPerson[] = [];
  const crmProblems: string[] = [];
  await Promise.all(DGO_SALES_CRMS.map(async (code) => {
    const name = known.find((o) => o.code === code)?.name || CRM_NAMES[code];
    if (!sources.some((s) => s.org.code === code)) {
      const failed = failures.find((f) => f.code === code);
      crmProblems.push(failed ? `${name}: ${failed.error}` : `${name} isn't an active sales CRM on this server`);
      return;
    }
    try {
      people.push(...(await crmPeople(code, name, date, crmProblems)));
    } catch (e) {
      crmProblems.push(`${name}: its tracker couldn't be read — ${errorText(e)}`);
    }
  }));
  problems.push(...crmProblems.sort());
  const order = DGO_SALES_CRMS as readonly string[];
  return people.sort((a, b) => b.achievedPct - a.achievedPct || order.indexOf(a.crm) - order.indexOf(b.crm) || a.name.localeCompare(b.name));
}

/* ── Reviews: the LMS's five-star ratings with words, that Dubai day ─────────────────────────────────────────── */

interface FeedItem {
  id?: string; kind?: string; rating?: number; comment?: string; createdAt?: string | Date;
  student?: { name?: string } | null; class?: { title?: string } | null; instructor?: { name?: string; email?: string } | null;
}
interface Feed { reviews?: FeedItem[]; total?: number }

const firstName = (full: unknown) => text(full).split(/\s+/)[0] || null;

async function dayReviews(date: string, problems: string[]): Promise<KpiReview[]> {
  let target;
  try {
    target = await resolveTarget("lms");
  } catch (e) {
    problems.push(`LMS: its reviews couldn't be read — ${errorText(e)}`);
    return [];
  }
  const { from, to } = dubaiDayRange(date);
  const items: FeedItem[] = [];
  try {
    for (let page = 1; page <= REVIEW_PAGES; page++) {
      const q = new URLSearchParams({ from: date, to: date, rating: "5", withComment: "1", kind: "mentor_rating", page: String(page), per_page: String(REVIEWS_PER_PAGE) });
      const feed = await callTarget<Feed>(target, `/instructor-reviews/feed?${q}`, { method: "GET", verb: "share its reviews" });
      const got = Array.isArray(feed.reviews) ? feed.reviews : [];
      items.push(...got);
      if (got.length < REVIEWS_PER_PAGE || items.length >= (Number(feed.total) || 0)) break;
      if (page === REVIEW_PAGES) problems.push(`LMS: more than ${REVIEW_PAGES * REVIEWS_PER_PAGE} five-star reviews on ${date}; only the newest ${items.length} are listed`);
    }
  } catch (e) {
    problems.push(`LMS: its reviews couldn't be read — ${errorText(e)}`);
    return [];
  }
  // The feed is asked for exactly these; checked again here, so an older or looser LMS can't slip others in.
  const out: KpiReview[] = [];
  let noMentorEmail = 0;
  for (const r of items) {
    const at = r.createdAt ? new Date(r.createdAt) : null;
    if (!at || Number.isNaN(at.getTime()) || at < from || at >= to) continue;
    if (Number(r.rating) !== 5 || !text(r.comment)) continue;
    if (r.kind && r.kind !== "mentor_rating") continue;
    const mentorEmail = emailOf(r.instructor?.email);
    if (!mentorEmail) { noMentorEmail++; continue; }
    out.push({
      id: String(r.id ?? ""), mentorEmail, mentorName: text(r.instructor?.name), rating: 5, comment: text(r.comment),
      className: text(r.class?.title) || null, studentName: firstName(r.student?.name), at: at.toISOString(),
    });
  }
  if (noMentorEmail) problems.push(`LMS: ${noMentorEmail} review${noMentorEmail === 1 ? " has" : "s have"} no mentor email, so HRMS can't match ${noMentorEmail === 1 ? "it" : "them"}`);
  return out.filter((r) => r.id).sort((a, b) => b.at.localeCompare(a.at));
}

/* ── The answer, kept per day ────────────────────────────────────────────────────────────────────────────────── */

const cache = new Map<string, { at: number; data: KpiFacts }>();
const inFlight = new Map<string, Promise<KpiFacts>>();

const keepFor = (data: KpiFacts) =>
  data.problems.length ? PROBLEM_KEEP_MS : data.date < dubaiToday() ? PAST_KEEP_MS : TODAY_KEEP_MS;

/** One Dubai day's KPI facts for HRMS. Never throws for a source that is down: it is named in `problems`. */
export async function kpiFacts(date: string): Promise<KpiFacts> {
  const hit = cache.get(date);
  if (hit && Date.now() - hit.at < keepFor(hit.data)) return hit.data;
  const running = inFlight.get(date);
  if (running) return running;
  const p = (async () => {
    const peopleProblems: string[] = [], reviewProblems: string[] = [];
    const [people, reviews] = await Promise.all([
      allPeople(date, peopleProblems).catch((e) => { peopleProblems.push(`Sales: ${errorText(e)}`); return [] as KpiPerson[]; }),
      dayReviews(date, reviewProblems),
    ]);
    const data: KpiFacts = { date, generatedAt: new Date().toISOString(), people, reviews, problems: [...peopleProblems, ...reviewProblems] };
    cache.set(date, { at: Date.now(), data });
    return data;
  })().finally(() => inFlight.delete(date));
  inFlight.set(date, p);
  return p;
}

/** For the check script: forget every day. */
export function resetKpiFactsForTests(): void {
  cache.clear();
  inFlight.clear();
}
