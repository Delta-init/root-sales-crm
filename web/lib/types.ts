export type OrgCode = "delta" | "banglore" | "draw";

export interface Organization {
  id: string;
  code: OrgCode;
  name: string;
  appUrl: string;
  timezone: string;
  currency: string;
  accent: string;
  dataStartsAt: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface Admin {
  _id: string;
  name: string;
  email: string;
  role: "root_admin" | "viewer";
  status: "active" | "inactive";
  lastLoginAt: string | null;
}

// ─── Group report ─────────────────────────────────────────────────────────────
export type Stage = "new" | "working" | "unreachable" | "won" | "lost";

export interface OrgRef {
  code: OrgCode;
  name: string;
  accent: string;
}

export interface OrgOverview {
  org: OrgRef;
  currency: string;
  timezone: string;
  dataStartsAt: string | null;
  leads: number;
  byStage: Record<Stage, number>;
  won: number;
  conversionRate: number;
  revenue: { native: number; base: number; payments: number };
}

export interface ReportFailure {
  code: string;
  name: string;
  error: string;
}

export interface GroupOverview {
  baseCurrency: string;
  orgs: OrgOverview[];
  totals: { leads: number; won: number; conversionRate: number; revenueBase: number };
  failures: ReportFailure[];
}

export interface GroupTimeline {
  granularity: "day" | "month";
  buckets: string[];
  series: {
    org: OrgRef;
    timezone: string;
    points: { bucket: string; leads: number; won: number }[];
  }[];
  failures: ReportFailure[];
}

export interface GroupSources {
  orgs: {
    org: OrgRef;
    unattributedPct: number;
    rows: { source: string; leads: number; won: number; conversionRate: number }[];
  }[];
  failures: ReportFailure[];
}

// ─── Daily tracker ────────────────────────────────────────────────────────────
export interface MetricDef {
  key: string;
  label: string;
  group: string;
  source: "auto" | "manual";
  money?: boolean;
  computed?: boolean;
  snapshot?: boolean;
  reliableIn?: string[];
  note?: string;
}

export interface TrackerRow {
  userId: string;
  name: string;
  email: string;
  accountStatus: string;
  values: Record<string, number>;
  remarks: string;
  actionRequired: string;
  score: number;
  reportedManual: boolean;
  lastActiveOn: string | null;
  daysSinceActive: number | null;
  dormant: boolean;
}

export interface TrackerCounts {
  total: number;
  working: number;
  dormant: number;
  reported: number;
  deactivated: number;
}

export interface OrgTracker {
  org: { code: OrgCode; name: string; accent: string; currency: string; timezone: string };
  date: string;
  metrics: MetricDef[];
  targets: Record<string, number>;
  rows: TrackerRow[];
  totals: Record<string, number>;
  achieved: Record<string, number | null>;
  teamScore: number;
  callsUnattributed: number;
  dormantAfterDays: number;
  repTargets: Record<string, number>;
  counts: TrackerCounts;
}

export interface GroupTracker {
  date: string;
  metrics: MetricDef[];
  orgs: {
    org: { code: OrgCode; name: string; accent: string; currency: string; timezone: string };
    targets: Record<string, number>;
    totals: Record<string, number>;
    achieved: Record<string, number | null>;
    teamScore: number;
    repCount: number;
    callsUnattributed: number;
    counts: TrackerCounts;
  }[];
  failures: ReportFailure[];
}

export interface UserTrackerDay {
  date: string;
  values: Record<string, number>;
  remarks: string;
  actionRequired: string;
  score: number;
}

export interface UserTracker {
  org: { code: OrgCode; name: string; accent: string; currency: string; timezone: string };
  user: { userId: string; name: string; email: string; status: string };
  from: string;
  to: string;
  metrics: MetricDef[];
  targets: Record<string, number>;
  rows: UserTrackerDay[];
  totals: Record<string, number>;
  averageScore: number;
  activeDays: number;
}

export interface TargetsDetail {
  metrics: Record<string, number>;
  defaults: Record<string, number>;
  isCustom: boolean;
  updatedAt: string | null;
}
