/* Mentor KPIs (2026-11-09) — what /api/v1/mentor-kpis answers, and the small helpers its pages share. */

export type KpiRole = "junior_mentor" | "senior_mentor" | "chief_mentor";
export type KpiSource = "lms" | "cs_portal" | "hrms";
export type KpiMode = "scored" | "monitoring" | "off";

export interface PlanKpi { metric: string; weight: number; mode: KpiMode }
export interface PlanSub { key: string; name: string; weight: number; kpis: PlanKpi[] }
export interface PlanCategory { key: string; name: string; weight: number; subs: PlanSub[] }
export type RoleTargets = Record<KpiRole, Record<string, number>>;
export interface MentorTarget { email: string; name: string; metric: string; value: number; reason: string }

export interface KpiPlan {
  id: string;
  from: string;
  status: "draft" | "approved" | "superseded";
  categories: PlanCategory[];
  targets: RoleTargets;
  overrides: MentorTarget[];
  note: string;
  targetsBasis: { months: string[]; counts: Record<string, Record<string, number>> } | null;
  createdBy: string;
  updatedBy: string;
  updatedAt: string;
  approvedBy: string;
  approvedAt: string | null;
  supersededAt: string | null;
}

export interface KpiMetric {
  key: string; name: string; source: KpiSource; sourceLabel: string; unit: string; direction: "up" | "down";
  kind: "count" | "rate" | "average"; minSample: number; sampleOf: string; available: boolean; note: string;
}

export interface PlansOverview {
  month: string;
  inForce: KpiPlan | null;
  draft: KpiPlan | null;
  versions: KpiPlan[];
  metrics: KpiMetric[];
  roles: { key: KpiRole; label: string }[];
  defaults: PlanCategory[];
}

export interface SourceState { available: boolean; message?: string }
export type SourceQuality = "complete" | "not_matched" | "unavailable";
export type KpiStatus = "scored" | "monitoring" | "not_available" | "source_down" | "not_matched" | "not_enough" | "no_target" | "no_role" | "left_out";

/** A frozen month's version (2026-11-09). */
export interface SnapshotRef { version: number; frozenAt: string; frozenBy: string; reason: string }
export interface SnapshotVersion extends SnapshotRef { current: boolean; corrections: number; plan: string }
export interface Correction {
  id: string; month: string; email: string; name: string; metric: string; metricName: string;
  action: "set_value" | "leave_out"; value: number | null;
  was: { value: number | null; score: number | null; status: string; version: number };
  reason: string; evidence: string; status: "pending" | "approved" | "rejected";
  raisedBy: { source: "root" | "cs_portal" | "lms"; email: string; name: string }; raisedAt: string;
  decidedBy: string; decidedAt: string | null; decisionNote: string; version: number | null;
}

export interface PlanRef { id: string; from: string; approvedBy: string; approvedAt: string | null }

export interface ScoresRow {
  rank: number | null; id: string; email: string; name: string; role: KpiRole | null; roleLabel: string;
  score: number | null; coverage: number; quality: Record<KpiSource, SourceQuality>;
  categories: { key: string; score: number | null }[];
}
export interface ScoresAnswer {
  month: string;
  plan: PlanRef | null;
  elapsed: number;
  to: string | null;
  sources: Record<KpiSource, SourceState> | null;
  categories: { key: string; name: string; share: number }[];
  statusLabels: Record<KpiStatus, string>;
  mentors: ScoresRow[];
  snapshot: SnapshotRef | null;
  freezable: boolean;
  pendingCorrections: number;
}

export interface KpiResult {
  metric: string; name: string; unit: string; direction: "up" | "down"; source: KpiSource; kind: string;
  mode: KpiMode; weight: number; share: number; value: number | null; sample: number; sampleOf: string; minSample: number;
  target: number | null; targetFrom: "role" | "mentor" | null; effectiveTarget: number | null;
  score: number | null; status: KpiStatus; note: string;
  corrected: { action: "set_value" | "leave_out"; reason: string; was: number | null } | null;
}
export interface MentorDetail {
  month: string; plan: PlanRef; elapsed: number; to: string | null;
  sources: Record<KpiSource, SourceState>;
  statusLabels: Record<KpiStatus, string>;
  mentor: {
    id: string; email: string; name: string; role: KpiRole | null; roleLabel: string; score: number | null; coverage: number;
    quality: Record<KpiSource, SourceQuality>;
    categories: { key: string; name: string; weight: number; share: number; score: number | null;
      subs: { key: string; name: string; weight: number; share: number; score: number | null; kpis: KpiResult[] }[] }[];
  };
  trend: { month: string; score: number | null; coverage: number; plan: string | null; frozen?: boolean }[];
  snapshot: SnapshotRef | null;
  corrections: Correction[];
}

/* ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────── */

export const SOURCE_SHORT: Record<KpiSource, string> = { lms: "LMS", cs_portal: "CS Portal", hrms: "HRMS" };
export const QUALITY_LABEL: Record<SourceQuality, string> = { complete: "Found", not_matched: "Not found", unavailable: "Didn't answer" };
/** One colour per category, in order. */
export const CATEGORY_COLOURS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];

export const monthLabel = (m: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
export const dubaiMonth = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 7);
export const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
/** The months scores can be looked at: from January 2026 to this one, newest first (at most 12). */
export const scoreMonths = () => {
  const out: string[] = [];
  for (let m = dubaiMonth(); m >= "2026-01" && out.length < 12; m = addMonths(m, -1)) out.push(m);
  return out;
};
export const fmtScore = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));
export const fmtValue = (v: number | null | undefined, unit: string) => {
  if (v == null) return "—";
  const n = unit === "AED" || unit === "USD" ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(Math.round(v * 10) / 10);
  if (unit === "%") return `${n}%`;
  if (unit === "AED" || unit === "USD") return `${unit} ${n}`;
  return `${n} ${unit}`;
};
/** Score colour: good, fair, poor. */
export const scoreTone = (v: number | null) =>
  v == null ? "text-muted-foreground" : v >= 85 ? "text-emerald-500" : v >= 60 ? "text-amber-500" : "text-red-500";
export const scoreBar = (v: number | null) => (v == null ? "bg-muted" : v >= 85 ? "bg-emerald-500" : v >= 60 ? "bg-amber-500" : "bg-red-500");

/** The slider's range for a target, by its unit — typing can go past it. */
export const TARGET_RANGE: Record<string, [number, number, number]> = {
  "%": [0, 100, 1], stars: [0, 5, 0.1], hours: [0, 250, 1], classes: [0, 150, 1], meetings: [0, 60, 1],
  AED: [0, 500_000, 5_000], USD: [0, 20_000, 100], days: [0, 31, 1], ratings: [0, 20, 1],
};

/** Each KPI's share of the whole score, as the plan sets it (the same sum Root does). */
export function planShares(categories: PlanCategory[]) {
  return categories.map((c) => {
    const scoredW = (s: PlanSub) => s.kpis.reduce((a, k) => a + (k.mode === "scored" ? k.weight : 0), 0);
    const subsTotal = c.subs.reduce((a, s) => a + (scoredW(s) > 0 ? s.weight : 0), 0);
    return {
      share: c.weight,
      subs: c.subs.map((s) => {
        const sw = scoredW(s);
        const subShare = subsTotal > 0 && sw > 0 ? (c.weight * s.weight) / subsTotal : 0;
        const ofCategory = subsTotal > 0 && sw > 0 ? s.weight / subsTotal : 0;
        return {
          share: subShare, ofCategory,
          kpis: s.kpis.map((k) => (k.mode === "scored" && sw > 0 ? { share: (subShare * k.weight) / sw, ofSub: k.weight / sw } : { share: 0, ofSub: 0 })),
        };
      }),
    };
  });
}
export const pct1 = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)}%`;

/** Whether the CS Portal shows the scores (2026-11-09), since when, and the 60-day observation. */
export interface PortalSettings { open: boolean; since: string | null; observationUntil: string | null; changedBy: string; changedAt: string | null }

export const dubaiWhen = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";
