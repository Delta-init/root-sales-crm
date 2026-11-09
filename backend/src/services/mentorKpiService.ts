import { Types } from "mongoose";
import { MentorKpiPlan, type IMentorKpiPlan } from "../models/MentorKpiPlan.js";
import { mentorReport } from "./cseService.js";
import {
  DEFAULT_CATEGORIES, KPI_ROLES, METRICS, ROLE_LABELS, SOURCE_LABELS, emptyTargets,
  type FeedRow, type KpiSource, type MentorTarget, type PlanCategory, type RoleTargets,
} from "./mentorKpiMetrics.js";
import {
  STATUS_LABELS, monthElapsed, planMetrics, planProblems, planShares, scoreMentor, targetsFromHistory,
  type MentorResult, type SourceState,
} from "./mentorKpiScoring.js";

/*
 * Mentor KPIs in Root (2026-11-09). Root keeps the plan — categories, subcategories, KPIs, weights, targets — and works
 * out every mentor's points from what the other systems send; nobody edits any of it anywhere else. Root admins only
 * for now (a preview): the CS Portal's view-only pages, snapshots and corrections come in later stages.
 *
 * Where the numbers come from: CS Portal's mentor report for the month (Root's /service/mentor-report call, the same
 * one Reports → Mentors uses), which brings the LMS's classes, joins, bookings and reviews and the HRMS's clock-ins
 * and leave by address. Months are Dubai months.
 */

const httpError = (message: string, statusCode: number, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { statusCode, ...extra });

export const FIRST_MONTH = "2026-01";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const validKpiMonth = (m: unknown): m is string => typeof m === "string" && MONTH.test(m);

/** Today in Dubai, YYYY-MM-DD. */
export const dubaiToday = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
export const currentMonth = () => dubaiToday().slice(0, 7);
const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, "0")}`;
};

interface Who { adminId: string; email: string }
const by = (a: Who) => ({ id: Types.ObjectId.isValid(a.adminId) ? new Types.ObjectId(a.adminId) : null, email: a.email });

/* ── The month's numbers, from CS Portal ───────────────────────────────────────────────────────────────────────── */

interface Feed { rows: FeedRow[]; sources: Record<KpiSource, SourceState>; to: string; at: number }
const cache = new Map<string, Feed>();
const inFlight = new Map<string, Promise<Feed>>();

/** A finished month is kept 6 hours, the current one 10 minutes. */
const fresh = (f: Feed, month: string) => Date.now() - f.at < (month < currentMonth() ? 6 * 3_600_000 : 10 * 60_000);

export function forgetFeeds() {
  cache.clear();
}

async function feed(month: string): Promise<Feed> {
  const hit = cache.get(month);
  if (hit && fresh(hit, month)) return hit;
  const running = inFlight.get(month);
  if (running) return running;
  const today = dubaiToday();
  const to = month === today.slice(0, 7) ? today : lastDay(month);
  const p = (async () => {
    const report = (await mentorReport({ from: `${month}-01`, to })) as {
      mentors?: FeedRow[]; lms?: SourceState; hrms?: SourceState;
    };
    const f: Feed = {
      rows: (report.mentors ?? []).filter((r) => r && (r.email || r.id)),
      sources: {
        lms: { available: report.lms?.available !== false, ...(report.lms?.message ? { message: report.lms.message } : {}) },
        hrms: { available: report.hrms?.available !== false, ...(report.hrms?.message ? { message: report.hrms.message } : {}) },
        cs_portal: { available: true },
      },
      to,
      at: Date.now(),
    };
    cache.set(month, f);
    return f;
  })().finally(() => inFlight.delete(month));
  inFlight.set(month, p);
  return p;
}

/* ── Plans ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

const planDTO = (p: IMentorKpiPlan) => ({
  id: String(p._id),
  from: p.from,
  status: p.status,
  categories: p.categories,
  targets: { ...emptyTargets(), ...(p.targets ?? {}) },
  overrides: p.overrides ?? [],
  note: p.note ?? "",
  targetsBasis: p.targetsBasis ?? null,
  createdBy: p.createdBy?.email ?? "",
  updatedBy: p.updatedBy?.email ?? "",
  updatedAt: p.updatedAt,
  approvedBy: p.approvedBy?.email ?? "",
  approvedAt: p.approvedAt,
  supersededAt: p.supersededAt,
});
export type PlanDTO = ReturnType<typeof planDTO>;

/** The approved version a month is scored with: the latest one starting on or before it. */
export async function planFor(month: string) {
  return MentorKpiPlan.findOne({ status: "approved", from: { $lte: month } }).sort({ from: -1, approvedAt: -1 }).lean<IMentorKpiPlan>();
}

const catalogue = () =>
  METRICS.map((m) => ({
    key: m.key, name: m.name, source: m.source, sourceLabel: SOURCE_LABELS[m.source], unit: m.unit, direction: m.direction,
    kind: m.kind, minSample: m.minSample, sampleOf: m.sampleOf, available: m.available, note: m.note ?? "",
  }));

/** The page: the plan in force this month, the draft if there is one, every version, and what can be measured. */
export async function overview() {
  const month = currentMonth();
  const [inForce, draft, versions] = await Promise.all([
    planFor(month),
    MentorKpiPlan.findOne({ status: "draft" }).lean<IMentorKpiPlan>(),
    MentorKpiPlan.find({ status: { $in: ["approved", "superseded"] } }).sort({ from: -1, approvedAt: -1 }).limit(36).lean<IMentorKpiPlan[]>(),
  ]);
  return {
    month,
    inForce: inForce ? planDTO(inForce) : null,
    draft: draft ? planDTO(draft) : null,
    versions: versions.map(planDTO),
    metrics: catalogue(),
    roles: KPI_ROLES.map((key) => ({ key, label: ROLE_LABELS[key] })),
    defaults: DEFAULT_CATEGORIES,
  };
}

/** Start the one draft: from the plan in force (or the approved structure when there is none yet). */
export async function startDraft(admin: Who, body: { from?: unknown; start?: unknown }) {
  const month = currentMonth();
  const from = validKpiMonth(body.from) ? body.from : addMonths(month, 1);
  if (from < month) throw httpError("A plan can start this month or later — earlier months keep the plan they had", 400);
  if (await MentorKpiPlan.exists({ status: "draft" })) throw httpError("There is already a draft — finish or discard it first", 409);
  const base = body.start === "default" ? null : await planFor(month);
  try {
    const created = await MentorKpiPlan.create({
      from,
      status: "draft",
      categories: base?.categories ?? DEFAULT_CATEGORIES,
      targets: base?.targets ?? emptyTargets(),
      overrides: base?.overrides ?? [],
      note: "",
      targetsBasis: null,
      createdBy: by(admin),
      updatedBy: by(admin),
    });
    return planDTO(created.toObject() as IMentorKpiPlan);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw httpError("There is already a draft — finish or discard it first", 409);
    throw error;
  }
}

async function theDraft() {
  const d = await MentorKpiPlan.findOne({ status: "draft" });
  if (!d) throw httpError("There is no draft — start one first", 404);
  return d;
}

/** A draft may be unfinished; only its shape and values are checked here (approval checks the rest). */
export async function saveDraft(
  admin: Who,
  body: { from: string; categories: PlanCategory[]; targets: RoleTargets; overrides: MentorTarget[]; note: string },
) {
  if (body.from < currentMonth()) throw httpError("A plan can start this month or later — earlier months keep the plan they had", 400);
  const overrides = body.overrides.map((o) => ({ ...o, email: o.email.trim().toLowerCase(), name: o.name.trim(), reason: o.reason.trim() }));
  const problems = planProblems(body.categories, body.targets, overrides, false);
  if (problems.length) throw httpError(problems[0]!, 400, { problems });
  const d = await theDraft();
  d.from = body.from;
  d.categories = body.categories;
  d.targets = { ...emptyTargets(), ...body.targets };
  d.overrides = overrides;
  d.note = body.note.trim();
  d.updatedBy = by(admin);
  d.markModified("categories");
  d.markModified("targets");
  d.markModified("overrides");
  await d.save();
  return planDTO(d.toObject() as IMentorKpiPlan);
}

/**
 * Each role's targets suggested from the last three finished months (the median mentor-month), for every metric the
 * draft uses that Root can measure. Replaces those targets in the draft — nothing is approved by it.
 */
export async function suggestTargets(admin: Who) {
  const d = await theDraft();
  const month = currentMonth();
  const months = [addMonths(month, -3), addMonths(month, -2), addMonths(month, -1)];
  const feeds = await Promise.all(months.map((m) => feed(m)));
  const { targets, basis } = targetsFromHistory(feeds.map((f) => f.rows), planMetrics(d.categories as PlanCategory[]));
  const merged = emptyTargets();
  for (const role of KPI_ROLES) merged[role] = { ...((d.targets as RoleTargets)?.[role] ?? {}), ...targets[role] };
  d.targets = merged;
  d.targetsBasis = { months, counts: basis };
  d.updatedBy = by(admin);
  d.markModified("targets");
  d.markModified("targetsBasis");
  await d.save();
  const suggested = KPI_ROLES.reduce((a, r) => a + Object.keys(targets[r]).length, 0);
  return { draft: planDTO(d.toObject() as IMentorKpiPlan), suggested, months };
}

/** Approve the draft: everything checked, then it applies from its month; a version from the same month is replaced. */
export async function approveDraft(admin: Who) {
  const d = await theDraft();
  if (d.from < currentMonth()) throw httpError(`The draft starts in ${d.from}, which has begun — move it to this month or later`, 400);
  const problems = planProblems(d.categories as PlanCategory[], d.targets as RoleTargets, d.overrides as MentorTarget[], true);
  if (problems.length) throw httpError(`Not approved: ${problems[0]}`, 400, { problems });
  const now = new Date();
  await MentorKpiPlan.updateMany({ status: "approved", from: d.from }, { $set: { status: "superseded", supersededAt: now } });
  d.status = "approved";
  d.approvedBy = by(admin);
  d.approvedAt = now;
  d.updatedBy = by(admin);
  await d.save();
  return planDTO(d.toObject() as IMentorKpiPlan);
}

export async function discardDraft() {
  const d = await theDraft();
  await d.deleteOne();
  return { from: d.from };
}

/* ── Scores ────────────────────────────────────────────────────────────────────────────────────────────────────── */

const checkMonth = (month: string) => {
  if (month < FIRST_MONTH) throw httpError(`Scores start from ${FIRST_MONTH}`, 400);
  if (month > currentMonth()) throw httpError("That month hasn't started", 400);
};

async function scoreMonth(month: string) {
  checkMonth(month);
  const plan = await planFor(month);
  if (!plan) return { month, plan: null, mentors: [] as MentorResult[], sources: null, elapsed: 0, to: null };
  const f = await feed(month);
  const elapsed = monthElapsed(month, dubaiToday());
  const ctx = {
    categories: plan.categories,
    targets: { ...emptyTargets(), ...(plan.targets ?? {}) },
    overrides: plan.overrides ?? [],
    sources: f.sources,
    elapsed,
  };
  const mentors = f.rows.map((r) => scoreMentor(r, ctx)).sort(
    (a, b) => (b.score ?? -1) - (a.score ?? -1) || b.coverage - a.coverage || a.name.localeCompare(b.name),
  );
  return { month, plan, mentors, sources: f.sources, elapsed, to: f.to };
}

const planSummary = (p: IMentorKpiPlan) => ({
  id: String(p._id), from: p.from, approvedBy: p.approvedBy?.email ?? "", approvedAt: p.approvedAt,
});

/** Every mentor's month: the ranking, each with their total, coverage and the systems that knew them. */
export async function scores(month: string) {
  const s = await scoreMonth(month);
  if (!s.plan) return { month, plan: null, mentors: [], sources: null, elapsed: 0, to: null, categories: [], statusLabels: STATUS_LABELS };
  const shares = planShares(s.plan.categories);
  return {
    month,
    plan: planSummary(s.plan),
    elapsed: Math.round(s.elapsed * 100),
    to: s.to,
    sources: s.sources,
    categories: s.plan.categories.map((c, i) => ({ key: c.key, name: c.name, share: shares[i]!.share })),
    statusLabels: STATUS_LABELS,
    mentors: s.mentors.map((m, i) => ({
      rank: m.score == null ? null : i + 1,
      id: m.id, email: m.email, name: m.name, role: m.role, roleLabel: m.roleLabel,
      score: m.score, coverage: m.coverage, quality: m.quality,
      categories: m.categories.map((c) => ({ key: c.key, score: c.score })),
    })),
  };
}

/** One mentor: every KPI against its target, and their last three months. */
export async function mentorScores(email: string, month: string) {
  const who = email.trim().toLowerCase();
  const s = await scoreMonth(month);
  if (!s.plan) throw httpError("No approved plan covers that month", 404);
  const mine = s.mentors.find((m) => m.email === who);
  if (!mine) throw httpError("No such mentor in CS Portal's mentor report for that month", 404);
  const trend = [];
  for (const m of [addMonths(month, -2), addMonths(month, -1)]) {
    if (m < FIRST_MONTH) continue;
    try {
      const other = await scoreMonth(m);
      const r = other.mentors.find((x) => x.email === who);
      trend.push({ month: m, score: r?.score ?? null, coverage: r?.coverage ?? 0, plan: other.plan ? other.plan.from : null });
    } catch {
      trend.push({ month: m, score: null, coverage: 0, plan: null });
    }
  }
  trend.push({ month, score: mine.score, coverage: mine.coverage, plan: s.plan.from });
  return {
    month, plan: planSummary(s.plan), elapsed: Math.round(s.elapsed * 100), to: s.to, sources: s.sources,
    statusLabels: STATUS_LABELS, mentor: mine, trend,
  };
}
