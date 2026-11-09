import {
  KPI_ROLES, METRIC_BY_KEY, ROLE_LABELS, SOURCE_LABELS, kpiRoleOf,
  type FeedRow, type KpiMetric, type KpiMode, type KpiRole, type KpiSource, type MentorTarget, type PlanCategory, type RoleTargets,
} from "./mentorKpiMetrics.js";

/*
 * How Root works out a mentor's points (2026-11-09) — no database, no network, so the check can prove every rule.
 *
 *   KPI           0–100 against its target. More is better: actual ÷ target, capped at 100. Fewer is better: 100 at or
 *                 under the target, falling to 0 at double it.
 *   Subcategory   the KPIs' scores, weighted by their relative weights.
 *   Category      the subcategories' scores, weighted the same way.
 *   Total         the categories' scores, weighted by their percentages (which total 100).
 *
 * At every level only what has a score counts: a KPI with no data (the system doesn't send it yet, the mentor isn't
 * found there, too few classes or reviews to judge) is left out and its weight spread over the rest — never scored as
 * zero. Coverage says how much of the plan's weight was actually scored.
 *
 * Counts (classes held, late clock-ins…) grow through a month and shrink with leave, so their targets are pro-rated:
 * by how much of the month has gone, and by the mentor's working days left after approved leave. Rates never are.
 */

export type KpiStatus =
  | "scored" | "monitoring" | "not_available" | "source_down" | "not_matched" | "not_enough" | "no_target" | "no_role" | "left_out";

export const STATUS_LABELS: Record<KpiStatus, string> = {
  scored: "Scored",
  monitoring: "Monitoring",
  not_available: "Not available yet",
  source_down: "Source didn't answer",
  not_matched: "Not found in the source",
  not_enough: "Not enough data",
  no_target: "No target",
  no_role: "No CS Portal role",
  left_out: "Left out by a correction",
};

/** An approved correction to a frozen month (2026-11-09): the right value, or leave this KPI out for the mentor. */
export interface Adjustment { action: "set_value" | "leave_out"; value: number | null; reason: string }

export interface SourceState { available: boolean; message?: string }
export type SourceQuality = "complete" | "not_matched" | "unavailable";

export interface KpiResult {
  metric: string; name: string; unit: string; direction: "up" | "down"; source: KpiSource; kind: KpiMetric["kind"];
  mode: KpiMode; weight: number; share: number;
  value: number | null; sample: number; sampleOf: string; minSample: number;
  target: number | null; targetFrom: "role" | "mentor" | null; effectiveTarget: number | null;
  score: number | null; status: KpiStatus; note: string;
  /** What an approved correction changed: the value the systems sent (`was`), and why. */
  corrected: { action: Adjustment["action"]; reason: string; was: number | null } | null;
}
export interface SubResult { key: string; name: string; weight: number; share: number; score: number | null; kpis: KpiResult[] }
export interface CategoryResult { key: string; name: string; weight: number; share: number; score: number | null; subs: SubResult[] }
export interface MentorResult {
  id: string; email: string; name: string; role: KpiRole | null; roleLabel: string;
  score: number | null; coverage: number;
  quality: Record<KpiSource, SourceQuality>;
  categories: CategoryResult[];
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** A KPI's 0–100 against an (already pro-rated) target. Null when it can't be judged. */
export function kpiScore(direction: "up" | "down", value: number, target: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(target) || target < 0) return null;
  if (direction === "up") {
    if (target <= 0) return null;
    return Math.min(100, (100 * value) / target);
  }
  if (value <= target) return 100;
  return Math.max(0, 100 * (1 - (value - target) / Math.max(target, 1)));
}

/** How much of a month has gone, as a fraction: 1 for a finished month. `today` is a Dubai day (YYYY-MM-DD). */
export function monthElapsed(month: string, today: string): number {
  if (today.slice(0, 7) > month) return 1;
  if (today.slice(0, 7) < month) return 0;
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return Math.min(1, Number(today.slice(8, 10)) / days);
}

/** The share of a month's working days a mentor had, approved leave left out (1 when the HRMS doesn't know). */
export function workingShare(row: FeedRow): number {
  const t = row.total;
  const present = Number(t.daysPresent) || 0, absent = Number(t.daysAbsent) || 0, leave = Number(t.daysLeave) || 0;
  const all = present + absent + leave;
  return all > 0 ? (present + absent) / all : 1;
}

/* ── Plan shares ───────────────────────────────────────────────────────────────────────────────────────────────── */

const scoredWeight = (sub: PlanCategory["subs"][number]) =>
  sub.kpis.reduce((a, k) => a + (k.mode === "scored" ? k.weight : 0), 0);

/** Each level's share of the whole score, as the plan sets it (percent) — before any data is missing. */
export function planShares(categories: PlanCategory[]) {
  return categories.map((c) => {
    const subsTotal = c.subs.reduce((a, s) => a + (scoredWeight(s) > 0 ? s.weight : 0), 0);
    return {
      key: c.key,
      share: c.weight,
      subs: c.subs.map((s) => {
        const sw = scoredWeight(s);
        const subShare = subsTotal > 0 && sw > 0 ? (c.weight * s.weight) / subsTotal : 0;
        return {
          key: s.key,
          share: subShare,
          kpis: s.kpis.map((k) => (k.mode === "scored" && sw > 0 ? (subShare * k.weight) / sw : 0)),
        };
      }),
    };
  });
}

/* ── One mentor ────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface ScoreContext {
  categories: PlanCategory[];
  targets: RoleTargets;
  overrides: MentorTarget[];
  sources: Record<KpiSource, SourceState>;
  /** Fraction of the month gone (1 when finished). */
  elapsed: number;
  /** Approved corrections, by mentor address then metric — only ever for a frozen month. */
  adjust?: Map<string, Map<string, Adjustment>>;
}

const weighted = (items: { weight: number; score: number | null }[]): number | null => {
  let w = 0, s = 0;
  for (const it of items) {
    if (it.score == null || it.weight <= 0) continue;
    w += it.weight;
    s += it.weight * it.score;
  }
  return w > 0 ? s / w : null;
};

function sourceQuality(row: FeedRow, source: KpiSource, sources: Record<KpiSource, SourceState>): SourceQuality {
  if (!sources[source].available) return "unavailable";
  if (source === "lms") return row.in_lms ? "complete" : "not_matched";
  if (source === "hrms") return row.in_hrms ? "complete" : "not_matched";
  return row.id ? "complete" : "not_matched";
}

export function scoreMentor(row: FeedRow, ctx: ScoreContext): MentorResult {
  const role = kpiRoleOf(row.role);
  const email = String(row.email ?? "").trim().toLowerCase();
  const quality = {
    lms: sourceQuality(row, "lms", ctx.sources),
    cs_portal: sourceQuality(row, "cs_portal", ctx.sources),
    hrms: sourceQuality(row, "hrms", ctx.sources),
  };
  const shares = planShares(ctx.categories);
  const working = workingShare(row);
  let planned = 0, covered = 0;

  const categories: CategoryResult[] = ctx.categories.map((c, ci) => {
    const subs: SubResult[] = c.subs.map((s, si) => {
      const kpis: KpiResult[] = s.kpis.filter((k) => k.mode !== "off").map((k) => {
        const m = METRIC_BY_KEY.get(k.metric);
        const share = shares[ci]!.subs[si]!.kpis[s.kpis.indexOf(k)] ?? 0;
        const base = {
          metric: k.metric, name: m?.name ?? k.metric, unit: m?.unit ?? "", direction: m?.direction ?? "up",
          source: m?.source ?? "lms", kind: m?.kind ?? "count", mode: k.mode, weight: k.weight, share,
          sampleOf: m?.sampleOf ?? "", minSample: m?.minSample ?? 0,
        } as const;
        const own = ctx.overrides.find((o) => o.email === email && o.metric === k.metric);
        const roleTarget = role ? ctx.targets[role]?.[k.metric] : undefined;
        const target = own ? own.value : typeof roleTarget === "number" ? roleTarget : null;
        const targetFrom = own ? "mentor" : target != null ? "role" : null;
        const out = (patch: Partial<KpiResult> & { status: KpiStatus }): KpiResult => ({
          ...base, value: null, sample: 0, target, targetFrom, effectiveTarget: null, score: null, note: m?.note ?? "", corrected: null, ...patch,
        });
        if (k.mode === "scored" && share > 0) planned += share;

        if (!m || !m.available || !m.read) return out({ status: "not_available" });
        const sourceOk = ctx.sources[m.source].available && quality[m.source] !== "not_matched";
        const original = sourceOk ? m.read(row) : null;
        // A correction wins over what the systems sent: the right value (enough to judge — a person checked it), or out.
        const fix = ctx.adjust?.get(email)?.get(k.metric) ?? null;
        const corrected = fix ? { action: fix.action, reason: fix.reason, was: original ? round1(original.value) : null } : null;
        if (fix?.action === "leave_out") {
          return out({ status: "left_out", corrected, value: original ? round1(original.value) : null, sample: original?.sample ?? 0, note: `Left out by a correction: ${fix.reason}` });
        }
        const reading = fix?.action === "set_value" && fix.value != null
          ? { value: fix.value, sample: Math.max(original?.sample ?? 0, m.minSample) }
          : original;
        if (!reading) {
          if (!ctx.sources[m.source].available) return out({ status: "source_down", note: ctx.sources[m.source].message ?? `${SOURCE_LABELS[m.source]} didn't answer` });
          if (quality[m.source] === "not_matched") return out({ status: "not_matched", note: `Not found in ${SOURCE_LABELS[m.source]} by their address` });
          return out({ status: "not_available", note: m.missing ?? m.note ?? "" });
        }
        const value = round1(reading.value);
        const effective = target == null ? null : round1(m.kind === "count" ? target * ctx.elapsed * working : target);
        const read = { value, sample: reading.sample, effectiveTarget: effective, corrected };
        if (reading.sample < m.minSample) return out({ ...read, status: "not_enough", note: `Fewer than ${m.minSample} ${m.sampleOf}` });
        if (k.mode === "monitoring") return out({ ...read, status: "monitoring" });
        if (!role && !own) return out({ ...read, status: "no_role" });
        if (effective == null) return out({ ...read, status: "no_target" });
        const score = kpiScore(m.direction, reading.value, effective);
        if (score == null) return out({ ...read, status: "no_target" });
        if (share > 0) covered += share;
        return out({ ...read, score, status: "scored" });
      });
      const subScore = weighted(kpis.filter((x) => x.mode === "scored"));
      return { key: s.key, name: s.name, weight: s.weight, share: shares[ci]!.subs[si]!.share, score: subScore, kpis };
    });
    const catScore = weighted(subs);
    return { key: c.key, name: c.name, weight: c.weight, share: c.weight, score: catScore, subs };
  });

  // Worked out unrounded at every level; rounded once, for the screen.
  const total = weighted(categories);
  const r = (v: number | null) => (v == null ? null : round1(v));
  for (const c of categories) {
    for (const s of c.subs) {
      for (const k of s.kpis) { k.score = r(k.score); k.share = round1(k.share); }
      s.score = r(s.score);
      s.share = round1(s.share);
    }
    c.score = r(c.score);
  }
  return {
    id: row.id ?? "",
    email,
    name: row.name || email,
    role,
    roleLabel: role ? ROLE_LABELS[role] : "No CS Portal role",
    score: r(total),
    coverage: planned > 0 ? Math.round((100 * covered) / planned) : 0,
    quality,
    categories,
  };
}

/* ── Checking a plan ───────────────────────────────────────────────────────────────────────────────────────────── */

const KEY = /^[a-z0-9_]{1,40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isInt = (v: unknown) => typeof v === "number" && Number.isInteger(v);

/**
 * What is wrong with a plan. A draft may be unfinished (weights not yet 100, targets missing); `strict` is the check
 * before approval, which also wants the categories to total 100, something scored where there is weight, and every
 * role's target for every scored metric Root can measure today.
 */
export function planProblems(categories: PlanCategory[], targets: RoleTargets, overrides: MentorTarget[], strict: boolean): string[] {
  const p: string[] = [];
  if (!Array.isArray(categories) || !categories.length) return ["Add at least one category"];
  if (categories.length > 12) p.push("At most 12 categories");
  const catKeys = new Set<string>(), used = new Set<string>();
  for (const c of categories) {
    if (!KEY.test(c.key ?? "")) p.push(`"${c.name}" has an invalid key`);
    if (catKeys.has(c.key)) p.push(`Two categories share the key "${c.key}"`);
    catKeys.add(c.key);
    if (!c.name?.trim() || c.name.length > 60) p.push("Every category needs a name of up to 60 characters");
    if (!isInt(c.weight) || c.weight < 0 || c.weight > 100) p.push(`${c.name}: its weight is a whole number from 0 to 100`);
    if (!Array.isArray(c.subs) || c.subs.length > 12) { p.push(`${c.name}: at most 12 subcategories`); continue; }
    const subKeys = new Set<string>();
    for (const s of c.subs) {
      if (!KEY.test(s.key ?? "")) p.push(`${c.name} › "${s.name}" has an invalid key`);
      if (subKeys.has(s.key)) p.push(`${c.name}: two subcategories share the key "${s.key}"`);
      subKeys.add(s.key);
      if (!s.name?.trim() || s.name.length > 60) p.push(`${c.name}: every subcategory needs a name of up to 60 characters`);
      if (!isInt(s.weight) || s.weight < 0 || s.weight > 100) p.push(`${c.name} › ${s.name}: its weight is a whole number from 0 to 100`);
      if (!Array.isArray(s.kpis) || s.kpis.length > 20) { p.push(`${c.name} › ${s.name}: at most 20 KPIs`); continue; }
      for (const k of s.kpis) {
        const m = METRIC_BY_KEY.get(k.metric);
        if (!m) { p.push(`${c.name} › ${s.name}: "${k.metric}" isn't a metric Root knows`); continue; }
        if (used.has(k.metric)) p.push(`${m.name} is in the plan twice`);
        used.add(k.metric);
        if (!isInt(k.weight) || k.weight < 0 || k.weight > 100) p.push(`${m.name}: its weight is a whole number from 0 to 100`);
        if (!["scored", "monitoring", "off"].includes(k.mode)) p.push(`${m.name}: scored, monitoring or off`);
      }
    }
  }
  for (const role of KPI_ROLES) {
    for (const [metric, v] of Object.entries(targets?.[role] ?? {})) {
      if (!METRIC_BY_KEY.has(metric)) p.push(`A ${ROLE_LABELS[role].toLowerCase()} target is for an unknown metric "${metric}"`);
      else if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 10_000_000) p.push(`${METRIC_BY_KEY.get(metric)!.name}: the ${ROLE_LABELS[role].toLowerCase()} target is a number from 0 to 10,000,000`);
    }
  }
  const seen = new Set<string>();
  for (const o of overrides ?? []) {
    const m = METRIC_BY_KEY.get(o.metric);
    if (!EMAIL.test(o.email ?? "")) p.push(`A mentor's own target has an invalid address "${o.email}"`);
    if (!m) p.push(`A mentor's own target is for an unknown metric "${o.metric}"`);
    if (typeof o.value !== "number" || !Number.isFinite(o.value) || o.value < 0 || o.value > 10_000_000) p.push(`${o.name || o.email}: their own target is a number from 0 to 10,000,000`);
    if (seen.has(`${o.email}|${o.metric}`)) p.push(`${o.name || o.email} has two own targets for ${m?.name ?? o.metric}`);
    seen.add(`${o.email}|${o.metric}`);
    if (strict && !o.reason?.trim()) p.push(`${o.name || o.email}: say why they have their own ${m?.name ?? o.metric} target`);
  }
  if (!strict || p.length) return p;

  const total = categories.reduce((a, c) => a + c.weight, 0);
  if (total !== 100) p.push(`The categories total ${total}%, not 100%`);
  for (const c of categories) {
    if (c.weight > 0 && !c.subs.some((s) => s.weight > 0 && scoredWeight(s) > 0)) p.push(`${c.name} has weight but nothing scored in it`);
    for (const s of c.subs) for (const k of s.kpis) {
      const m = METRIC_BY_KEY.get(k.metric)!;
      if (k.mode !== "scored" || !m.available) continue;
      for (const role of KPI_ROLES) {
        const t = targets?.[role]?.[k.metric];
        if (typeof t !== "number" || (m.direction === "up" && t <= 0)) p.push(`${m.name} has no ${ROLE_LABELS[role].toLowerCase()} target`);
      }
    }
  }
  return p;
}

/* ── Draft targets from history ────────────────────────────────────────────────────────────────────────────────── */

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** A suggested target, rounded the way it would be typed. */
export function roundTarget(m: KpiMetric, v: number): number {
  if (m.unit === "stars") return Math.round(v * 10) / 10;
  if (m.unit === "AED" || m.unit === "USD") return Math.round(v / 100) * 100;
  const r = Math.round(v);
  return m.direction === "up" && m.unit !== "%" ? Math.max(1, r) : r;
}

/**
 * Each role's typical month, metric by metric: the median over every mentor-month of the role that had enough data.
 * A count is taken as a full month's (divided by the share of working days they had) so leave doesn't drag it down.
 * Only metrics Root can measure; `basis` says how many mentor-months each suggestion stands on.
 */
export function targetsFromHistory(months: FeedRow[][], metrics: string[]) {
  const targets: RoleTargets = { junior_mentor: {}, senior_mentor: {}, chief_mentor: {} };
  const basis: Record<KpiRole, Record<string, number>> = { junior_mentor: {}, senior_mentor: {}, chief_mentor: {} };
  for (const key of metrics) {
    const m = METRIC_BY_KEY.get(key);
    if (!m?.available || !m.read) continue;
    for (const role of KPI_ROLES) {
      const values: number[] = [];
      for (const rows of months) for (const row of rows) {
        if (kpiRoleOf(row.role) !== role) continue;
        if (m.source === "lms" && !row.in_lms) continue;
        if (m.source === "hrms" && !row.in_hrms) continue;
        const r = m.read(row);
        if (!r || r.sample < m.minSample) continue;
        if (m.kind === "count") {
          const share = workingShare(row);
          if (share < 0.25) continue; // mostly on leave: says little about a normal month
          values.push(r.value / share);
        } else values.push(r.value);
      }
      if (!values.length) continue;
      const t = roundTarget(m, median(values));
      if (m.direction === "up" && t <= 0) continue;
      targets[role][key] = t;
      basis[role][key] = values.length;
    }
  }
  return { targets, basis };
}

/** Every metric a plan uses, whatever its mode. */
export const planMetrics = (categories: PlanCategory[]) => categories.flatMap((c) => c.subs.flatMap((s) => s.kpis.map((k) => k.metric)));
