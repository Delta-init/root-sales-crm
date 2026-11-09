import { Types } from "mongoose";
import { MentorKpiPlan, type IMentorKpiPlan } from "../models/MentorKpiPlan.js";
import { MentorKpiSnapshot, type IMentorKpiSnapshot } from "../models/MentorKpiSnapshot.js";
import { MentorKpiCorrection, type IMentorKpiCorrection } from "../models/MentorKpiCorrection.js";
import { mentorReport } from "./cseService.js";
import {
  DEFAULT_CATEGORIES, KPI_ROLES, METRICS, METRIC_BY_KEY, ROLE_LABELS, SOURCE_LABELS, emptyTargets,
  type FeedRow, type KpiSource, type MentorTarget, type PlanCategory, type RoleTargets,
} from "./mentorKpiMetrics.js";
import {
  STATUS_LABELS, monthElapsed, planMetrics, planProblems, planShares, scoreMentor, targetsFromHistory,
  type Adjustment, type MentorResult, type SourceState,
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

/** When a Dubai month ends, as an instant. */
const monthEnds = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return Date.UTC(y!, m!, 1) - 4 * 3_600_000;
};

/**
 * The current month is kept 10 minutes; a finished one 6 hours — but only a copy read after it ended (one read on its
 * last day misses that evening).
 */
const fresh = (f: Feed, month: string) =>
  month < currentMonth() ? f.at >= monthEnds(month) && Date.now() - f.at < 6 * 3_600_000 : Date.now() - f.at < 10 * 60_000;

export function forgetFeeds() {
  cache.clear();
}

async function feed(month: string, force = false): Promise<Feed> {
  const hit = cache.get(month);
  if (hit && !force && fresh(hit, month)) return hit;
  const running = inFlight.get(month);
  if (running && !force) return running;
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

/* ── Scores: live for the current month, frozen for a finished one ─────────────────────────────────────────────── */

const checkMonth = (month: string) => {
  if (month < FIRST_MONTH) throw httpError(`Scores start from ${FIRST_MONTH}`, 400);
  if (month > currentMonth()) throw httpError("That month hasn't started", 400);
};

interface PlanLike { _id?: unknown; id?: string; from: string; approvedBy?: { email?: string } | string | null; approvedAt?: Date | string | null; categories: PlanCategory[]; targets: RoleTargets; overrides: MentorTarget[] }
const planRef = (p: PlanLike) => ({
  id: String(p.id ?? p._id), from: p.from,
  approvedBy: typeof p.approvedBy === "string" ? p.approvedBy : p.approvedBy?.email ?? "",
  approvedAt: p.approvedAt ?? null,
});
const contextOf = (plan: PlanLike, sources: Record<KpiSource, SourceState>, elapsed: number, adjust?: Map<string, Map<string, Adjustment>>) => ({
  categories: plan.categories,
  targets: { ...emptyTargets(), ...(plan.targets ?? {}) },
  overrides: plan.overrides ?? [],
  sources,
  elapsed,
  adjust,
});
const rank = (mentors: MentorResult[]) =>
  mentors.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.coverage - a.coverage || a.name.localeCompare(b.name));

interface MonthView {
  month: string;
  plan: (ReturnType<typeof planRef> & { categories: PlanCategory[] }) | null;
  mentors: MentorResult[];
  sources: Record<KpiSource, SourceState> | null;
  elapsed: number;
  to: string | null;
  snapshot: { version: number; frozenAt: Date; frozenBy: string; reason: string } | null;
  freezable: boolean;
}

/** Worked out now from CS Portal's report, with the plan approved for the month. */
async function liveMonth(month: string, force = false): Promise<MonthView> {
  const plan = await planFor(month);
  if (!plan) return { month, plan: null, mentors: [], sources: null, elapsed: 0, to: null, snapshot: null, freezable: false };
  const f = await feed(month, force);
  const elapsed = monthElapsed(month, dubaiToday());
  const mentors = rank(f.rows.map((r) => scoreMentor(r, contextOf(plan, f.sources, elapsed))));
  return {
    month, plan: { ...planRef(plan), categories: plan.categories }, mentors, sources: f.sources, elapsed, to: f.to,
    snapshot: null, freezable: month < currentMonth(),
  };
}

const currentSnapshot = (month: string) =>
  MentorKpiSnapshot.findOne({ month, current: true }).lean<IMentorKpiSnapshot>();

/** A month as it stands: its frozen version once there is one, else live. */
async function monthView(month: string): Promise<MonthView> {
  checkMonth(month);
  const snap = await currentSnapshot(month);
  if (!snap) return liveMonth(month);
  const plan = snap.plan as PlanLike & { id: string };
  return {
    month,
    plan: { ...planRef(plan), categories: plan.categories },
    mentors: snap.mentors as MentorResult[],
    sources: snap.sources as Record<KpiSource, SourceState>,
    elapsed: 1,
    to: lastDay(month),
    snapshot: { version: snap.version, frozenAt: snap.createdAt, frozenBy: snap.frozenBy, reason: snap.reason },
    freezable: false,
  };
}

/** Every mentor's month: the ranking, each with their total, coverage and the systems that knew them. */
export async function scores(month: string) {
  const s = await monthView(month);
  const pending = await MentorKpiCorrection.countDocuments({ month, status: "pending" });
  if (!s.plan) return { month, plan: null, mentors: [], sources: null, elapsed: 0, to: null, categories: [], statusLabels: STATUS_LABELS, snapshot: null, freezable: false, pendingCorrections: pending };
  const shares = planShares(s.plan.categories);
  return {
    month,
    plan: { id: s.plan.id, from: s.plan.from, approvedBy: s.plan.approvedBy, approvedAt: s.plan.approvedAt },
    elapsed: Math.round(s.elapsed * 100),
    to: s.to,
    sources: s.sources,
    snapshot: s.snapshot,
    freezable: s.freezable,
    pendingCorrections: pending,
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

const correctionDTO = (c: IMentorKpiCorrection) => ({
  id: String(c._id), month: c.month, email: c.email, name: c.name, metric: c.metric, metricName: c.metricName,
  action: c.action, value: c.value, was: c.was, reason: c.reason, evidence: c.evidence, status: c.status,
  raisedBy: c.raisedBy, raisedAt: c.createdAt, decidedBy: c.decidedBy, decidedAt: c.decidedAt, decisionNote: c.decisionNote,
  version: c.version,
});

/** One mentor: every KPI against its target, their last three months, and the corrections asked for this month. */
export async function mentorScores(email: string, month: string) {
  const who = email.trim().toLowerCase();
  const s = await monthView(month);
  if (!s.plan) throw httpError("No approved plan covers that month", 404);
  const mine = s.mentors.find((m) => m.email === who);
  if (!mine) throw httpError("No such mentor in CS Portal's mentor report for that month", 404);
  const trend = [];
  for (const m of [addMonths(month, -2), addMonths(month, -1)]) {
    if (m < FIRST_MONTH) continue;
    try {
      const other = await monthView(m);
      const r = other.mentors.find((x) => x.email === who);
      trend.push({ month: m, score: r?.score ?? null, coverage: r?.coverage ?? 0, plan: other.plan ? other.plan.from : null, frozen: !!other.snapshot });
    } catch {
      trend.push({ month: m, score: null, coverage: 0, plan: null, frozen: false });
    }
  }
  trend.push({ month, score: mine.score, coverage: mine.coverage, plan: s.plan.from, frozen: !!s.snapshot });
  const corrections = await MentorKpiCorrection.find({ month, email: who }).sort({ createdAt: -1 }).lean<IMentorKpiCorrection[]>();
  return {
    month, plan: { id: s.plan.id, from: s.plan.from, approvedBy: s.plan.approvedBy, approvedAt: s.plan.approvedAt },
    elapsed: Math.round(s.elapsed * 100), to: s.to, sources: s.sources, snapshot: s.snapshot,
    statusLabels: STATUS_LABELS, mentor: mine, trend, corrections: corrections.map(correctionDTO),
  };
}

/* ── Freezing a finished month ─────────────────────────────────────────────────────────────────────────────────── */

const versionDTO = (v: IMentorKpiSnapshot) => ({
  version: v.version, current: v.current, frozenAt: v.createdAt, frozenBy: v.frozenBy, reason: v.reason,
  corrections: v.corrections.length, plan: (v.plan as { from: string }).from,
});

export async function snapshots(month: string) {
  checkMonth(month);
  const list = await MentorKpiSnapshot.find({ month }).select("-rows -mentors").sort({ version: -1 }).lean<IMentorKpiSnapshot[]>();
  return list.map(versionDTO);
}

/**
 * Freeze a finished month as version 1: CS Portal's report read again, then scored with the plan approved for it.
 * Automatic on the 1st (`by` "automatic"), or a root admin's "Freeze now". Refused if it already has a version.
 */
export async function freezeMonth(month: string, by: string, opts: { requireAllSources?: boolean } = {}) {
  checkMonth(month);
  if (month >= currentMonth()) throw httpError("Only a finished month can be frozen", 400);
  if (await MentorKpiSnapshot.exists({ month })) throw httpError(`${month} is already frozen — a figure changes only through a correction`, 409);
  const plan = await planFor(month);
  if (!plan) throw httpError("No approved plan covers that month", 404);
  const f = await feed(month, true);
  const down = (Object.keys(f.sources) as KpiSource[]).filter((k) => !f.sources[k].available);
  if (opts.requireAllSources && down.length) {
    throw httpError(`Not frozen yet: ${down.map((k) => SOURCE_LABELS[k]).join(" and ")} didn't answer`, 503);
  }
  const mentors = rank(f.rows.map((r) => scoreMentor(r, contextOf(plan, f.sources, 1))));
  try {
    const snap = await MentorKpiSnapshot.create({
      month, version: 1, current: true,
      plan: { id: String(plan._id), from: plan.from, approvedBy: plan.approvedBy?.email ?? "", approvedAt: plan.approvedAt, categories: plan.categories, targets: plan.targets, overrides: plan.overrides },
      sources: f.sources, rows: f.rows, mentors, corrections: [], frozenBy: by,
      reason: by === "automatic" ? "Frozen on the 1st" : "Frozen by hand",
    });
    return versionDTO(snap.toObject() as IMentorKpiSnapshot);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw httpError(`${month} is already frozen`, 409);
    throw error;
  }
}

/**
 * On the 1st (from 03:00 Dubai, after the backups), last month is frozen — once every system answers, or on the 4th
 * whatever answered then. Checked every 30 minutes, so a server that was down on the 1st catches up. One process:
 * MENTOR_KPI_WORKER=false on any other. The unique version keeps two from freezing it twice.
 */
export async function autoFreeze(at = new Date()): Promise<string> {
  const dubai = new Date(at.getTime() + 4 * 3_600_000);
  if (dubai.getUTCDate() === 1 && dubai.getUTCHours() < 3) return "too early";
  const month = addMonths(currentMonth(), -1);
  if (month < FIRST_MONTH) return "nothing to freeze";
  if (await MentorKpiSnapshot.exists({ month })) return "already frozen";
  if (!(await planFor(month))) return "no plan";
  const v = await freezeMonth(month, "automatic", { requireAllSources: dubai.getUTCDate() < 4 });
  return `${month} frozen as version ${v.version}`;
}

export function startMentorKpiWorker() {
  if (process.env.MENTOR_KPI_WORKER === "false") return;
  const tick = async () => {
    try {
      const out = await autoFreeze();
      if (/frozen as/.test(out)) console.log(`📊 mentor KPIs: ${out}`);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status !== 409) console.error("📊 mentor KPIs: freezing last month failed —", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(tick, 60_000).unref?.();
  setInterval(tick, 30 * 60_000).unref?.();
}

/* ── Corrections ───────────────────────────────────────────────────────────────────────────────────────────────── */

export async function listCorrections(q: { status?: string; month?: string }) {
  const filter: Record<string, unknown> = {};
  if (q.status === "pending") filter.status = "pending";
  else if (q.status === "decided") filter.status = { $in: ["approved", "rejected"] };
  if (q.month && validKpiMonth(q.month)) filter.month = q.month;
  const rows = await MentorKpiCorrection.find(filter).sort({ createdAt: -1 }).limit(300).lean<IMentorKpiCorrection[]>();
  return rows.map(correctionDTO);
}

/** Ask for a correction to a frozen month: one mentor, one KPI, the right value or leave it out — with why. */
export async function raiseCorrection(
  by: { source: "root" | "cs_portal"; email: string; name: string },
  body: { month: string; email: string; metric: string; action: "set_value" | "leave_out"; value?: number | null; reason: string; evidence?: string },
) {
  const snap = await currentSnapshot(body.month);
  if (!snap) throw httpError("Only a frozen month can be corrected — this month's figures still move with the systems", 409);
  const who = body.email.trim().toLowerCase();
  const mentor = (snap.mentors as MentorResult[]).find((m) => m.email === who);
  if (!mentor) throw httpError("No such mentor in that month", 404);
  const kpi = mentor.categories.flatMap((c) => c.subs.flatMap((s) => s.kpis)).find((k) => k.metric === body.metric);
  if (!kpi) throw httpError("That KPI isn't in the month's plan for them", 404);
  const m = METRIC_BY_KEY.get(body.metric);
  if (!m?.available) throw httpError(`${m?.name ?? body.metric} isn't measured yet — nothing to correct`, 400);
  if (body.action === "set_value" && (typeof body.value !== "number" || !Number.isFinite(body.value) || body.value < 0)) {
    throw httpError("Give the right value (0 or more)", 400);
  }
  if (!body.reason.trim()) throw httpError("Say why", 400);
  try {
    const c = await MentorKpiCorrection.create({
      month: body.month, email: who, name: mentor.name, metric: body.metric, metricName: m.name,
      action: body.action, value: body.action === "set_value" ? body.value : null,
      was: { value: kpi.value, score: kpi.score, status: kpi.status, version: snap.version },
      reason: body.reason.trim(), evidence: (body.evidence ?? "").trim(), raisedBy: by,
    });
    return correctionDTO(c.toObject() as IMentorKpiCorrection);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw httpError(`There is already an open correction for ${m.name} for them in ${body.month}`, 409);
    throw error;
  }
}

/**
 * Approve: the month's next version — the frozen inputs re-scored with every approved correction for the month,
 * this one included. The version before is kept, marked replaced.
 */
export async function approveCorrection(id: string, by: string, note: string) {
  const c = await MentorKpiCorrection.findById(id);
  if (!c) throw httpError("No such correction", 404);
  if (c.status !== "pending") throw httpError(`It was already ${c.status}`, 409);
  const snap = await currentSnapshot(c.month);
  if (!snap) throw httpError("The month isn't frozen", 409);
  const approved = await MentorKpiCorrection.find({ month: c.month, status: "approved" }).sort({ decidedAt: 1 }).lean<IMentorKpiCorrection[]>();
  const adjust = new Map<string, Map<string, Adjustment>>();
  for (const x of [...approved, c.toObject() as IMentorKpiCorrection]) {
    const mine = adjust.get(x.email) ?? new Map<string, Adjustment>();
    mine.set(x.metric, { action: x.action, value: x.value, reason: x.reason });
    adjust.set(x.email, mine);
  }
  const plan = snap.plan as PlanLike;
  const sources = snap.sources as Record<KpiSource, SourceState>;
  const mentors = rank((snap.rows as FeedRow[]).map((r) => scoreMentor(r, contextOf(plan, sources, 1, adjust))));
  const version = snap.version + 1;
  // Claim the version first (unique month + version): two approvals at once can't both make version N.
  const next = await MentorKpiSnapshot.create({
    month: c.month, version, current: false, plan: snap.plan, sources: snap.sources, rows: snap.rows, mentors,
    corrections: [...approved.map((x) => x._id), c._id], frozenBy: by,
    reason: `Correction: ${c.name} — ${c.metricName} (${c.action === "leave_out" ? "left out" : `set to ${c.value}`})`,
  }).catch((error) => {
    if ((error as { code?: number }).code === 11000) throw httpError("Another correction was approved at the same moment — try again", 409);
    throw error;
  });
  await MentorKpiSnapshot.updateMany({ month: c.month, _id: { $ne: next._id } }, { $set: { current: false } });
  await MentorKpiSnapshot.updateOne({ _id: next._id }, { $set: { current: true } });
  c.status = "approved";
  c.decidedBy = by;
  c.decidedAt = new Date();
  c.decisionNote = note.trim();
  c.version = version;
  await c.save();
  return correctionDTO(c.toObject() as IMentorKpiCorrection);
}

export async function rejectCorrection(id: string, by: string, note: string) {
  if (!note.trim()) throw httpError("Say why it's rejected", 400);
  const c = await MentorKpiCorrection.findOneAndUpdate(
    { _id: id, status: "pending" },
    { $set: { status: "rejected", decidedBy: by, decidedAt: new Date(), decisionNote: note.trim() } },
    { new: true },
  ).lean<IMentorKpiCorrection>();
  if (!c) throw httpError("No such open correction", 404);
  return correctionDTO(c);
}
