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
  /** `member` is most people now — see PortalRole. */
  role: "root_admin" | "member" | "viewer";
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
  text?: boolean;
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
  texts: Record<string, string>;
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
  texts?: Record<string, string>;
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

// ─── Rep self-service ─────────────────────────────────────────────────────────
export interface Rep {
  repId: string;
  name: string;
  email: string;
  org: { code: string; name: string; timezone: string; currency: string };
}

export interface MyTracker {
  org: { code: OrgCode; name: string; accent: string; currency: string; timezone: string };
  date: string;
  row: TrackerRow;
  metrics: MetricDef[];
  targets: Record<string, number>;
  repTargets: Record<string, number>;
  isToday: boolean;
}

// ─── Access ───────────────────────────────────────────────────────────────────

/**
 * Somewhere a person may be sent.
 *
 * The three CRM codes plus finance and HRMS. Kept as a wider type than
 * `OrgCode`, which the dashboard and the reports still use to mean "one of the
 * three sales CRMs" — widening that would oblige every colour map and every
 * report filter to have an opinion about HRMS.
 */
export type TargetCode =
  | "delta" | "banglore" | "draw"
  | "finance-hq" | "finance-banglore" | "hrms";

export type TargetKind = "crm" | "finance" | "hrms";

export interface Target {
  code: TargetCode;
  name: string;
  kind: TargetKind;
}

export type PortalRole = "root_admin" | "member" | "viewer";

export interface PersonAccess {
  target: TargetCode;
  roleInTarget: string;
}

export interface Person {
  id: string;
  name: string;
  email: string;
  role: PortalRole;
  status: "active" | "inactive";
  lastLoginAt: string | null;
  access: PersonAccess[];
}

/**
 * A registered target, as an administrator sees it.
 *
 * The connection string and the SSO secret are never sent — only whether they
 * are set, which is what somebody configuring a target needs to know. A value
 * that never reaches the browser cannot leak from it.
 */
export interface RegistryTarget {
  id: string;
  code: TargetCode;
  kind: TargetKind;
  name: string;
  appUrl: string;
  apiUrl: string;
  timezone: string;
  currency: string;
  fxToBase: number;
  serviceEmail: string;
  accent: string;
  isActive: boolean;
  sortOrder: number;
  hasMongoUri: boolean;
  hasSsoSecret: boolean;
}

/** Somebody HRMS knows about, and whether the portal already has them. */
export interface DirectoryPerson {
  employeeCode: string;
  name: string;
  email: string;
  designation: string;
  status: string;
  alreadyHere: boolean;
}

/** What came of importing one person. The password is shown once and kept nowhere. */
export interface ImportResult {
  email: string;
  name: string;
  created: boolean;
  password?: string;
  note?: string;
}

/** What a role in one system makes somebody in another. */
export interface RoleRule {
  id: string;
  fromTarget: TargetCode;
  fromRole: string;
  toTarget: TargetCode;
  toRole: string;
}
