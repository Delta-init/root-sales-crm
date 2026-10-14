export type OrgCode = "delta" | "banglore" | "draw" | "remote";

export interface Organization {
  id: string;
  code: OrgCode;
  kind: TargetKind;
  name: string;
  appUrl: string;
  timezone: string;
  currency: string;
  accent: string;
  dataStartsAt: string | null;
  isActive: boolean;
  sortOrder: number;
  /**
   * Whether this person can actually walk through this door, and if not, why.
   *
   * Three different facts rather than shades of one: `open` means the system
   * says they have an account, `pending` means this portal granted it but
   * nothing exists there yet to arrive at, and `unavailable` means the system
   * could not be asked — which is not the same as no, and must never be shown
   * as though it were.
   */
  reach: "open" | "pending" | "unavailable";
  /** Why it is not open, in words, when it is not. */
  note: string | null;
}

export interface Admin {
  /**
   * Set when this session is somebody else's, borrowed by a root admin.
   *
   * Everything else on this object is the person being looked at, because an
   * impersonated session is deliberately indistinguishable from that person
   * signing in. This is the only thing that says otherwise, and the banner
   * that stops somebody forgetting whose account they are in depends on it.
   */
  impersonatedBy?: { id: string; email: string } | null;
  _id: string;
  name: string;
  email: string;
  /** `member` is most people now — see PortalRole. */
  role: "root_admin" | "member" | "viewer";
  status: "active" | "inactive";
  /** Lead traffic: nothing, look, or also change the split. Root admins have it all. */
  trafficAccess?: TrafficAccess;
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
  | "delta" | "banglore" | "draw" | "remote"
  | "finance-hq" | "finance-banglore" | "hrms"
  | "lms" | "media-erp" | "commission";

export type TargetKind = "crm" | "finance" | "hrms" | "lms" | "erp" | "commission";

export interface Target {
  code: TargetCode;
  name: string;
  kind: TargetKind;
}

export type PortalRole = "root_admin" | "member" | "viewer";

/** Somebody's reach on the Lead traffic page when they are not a root admin. */
export type TrafficAccess = "none" | "view" | "manage";

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
 * A role, as the system that owns it describes it.
 *
 * The permissions come with it deliberately. Choosing somebody's role is a
 * decision about what they will be able to do, and a list of bare names asks
 * an administrator to make that decision from memory of another application.
 */
export interface TargetRole {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
}

/** What a target says about an account, as opposed to what the portal granted. */
export interface TargetAccount {
  exists: boolean;
  inOrganization: boolean;
  name: string;
  status: string;
  membershipStatus: string | null;
  roleKey: string | null;
  roleName: string | null;
  permissions: string[];
  lastLoginAt: string | null;
}

/**
 * One system's view of one person, next to the portal's own record.
 *
 * `drift` is the point of the whole thing: where the grant this portal holds
 * and the account that system actually has disagree, said in words rather
 * than left for somebody to spot by comparing two columns.
 */
export interface TargetView {
  target: TargetCode;
  targetName: string;
  kind: string;
  granted: boolean;
  roleInTarget: string | null;
  grantedAt: string | null;
  account: TargetAccount | null;
  unreachable: string | null;
  drift: string | null;
}

export interface PersonDetail {
  person: {
    id: string;
    name: string;
    email: string;
    role: PortalRole;
    status: "active" | "inactive";
    trafficAccess?: TrafficAccess;
  };
  targets: TargetView[];
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
  /** `finance-hq` → `FINANCE_HQ`: the prefix of its environment variables. */
  envPrefix: string;
  /** Variables still unset, by name, so the screen can name them. */
  missing: string[];
  /** Kept for the registry row; comes from the environment, not the record. */
  remoteOrgId: string;
}

/** Somebody HRMS knows about, and whether the portal already has them. */
export interface DirectoryPerson {
  employeeCode: string;
  name: string;
  email: string;
  designation: string;
  status: string;
  /** Resolved from HRMS's department id; blank where none is set there. */
  department: string;
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

// ─── Lead traffic ─────────────────────────────────────────────────────────────
export type TrafficOrg = "delta" | "draw" | "remote";
/** A lead sheet that posts into lead traffic; each has its own split. */
export type TrafficSheetKey = "abhin" | "shoaib" | "trading-leads-nitro";
export type TrafficStatus =
  | "queued" | "held" | "sending" | "sent" | "duplicate" | "invalid" | "retrying" | "failed";

/** One team's share of a segment: the CRM its leads go to, and how many of them. */
export interface TrafficShare {
  key: string;
  name: string;
  org: TrafficOrg;
  /** Percent of the segment, to two decimals. */
  percent: number;
  /** One person in that CRM who takes this team's leads; null lets the CRM share them out. */
  assignTo: { id: string; name: string } | null;
}

export interface TrafficSegmentRule {
  key: string;
  label: string;
  /** What each CRM records as these leads' source. */
  source: string;
  version: number;
  shares: TrafficShare[];
}

export interface TrafficSheetRules {
  key: TrafficSheetKey;
  name: string;
  about: string;
  paused: boolean;
  /** The CRMs this sheet's split sends to. */
  uses: TrafficOrg[];
  segments: TrafficSegmentRule[];
  updatedByEmail: string;
  updatedAt: string | null;
}

export interface TrafficRules {
  sheets: TrafficSheetRules[];
  crms: { code: TrafficOrg; name: string; active: boolean; missing: string[] }[];
  sheetKeySet: boolean;
}

export interface TrafficShareStats {
  key: string;
  name: string;
  org: TrafficOrg;
  /** The CRM's name. */
  crm: string;
  assignTo: { id: string; name: string } | null;
  target: number;
  /** Had leads in the period, and has since been taken out of the split. */
  removed: boolean;
  /** Leads this team got from the split in the period. */
  split: number;
  /** Its share of the split, in percent; null when nothing was split. */
  actual: number | null;
  sent: number;
  duplicates: number;
  invalid: number;
  waiting: number;
  failed: number;
}

export interface TrafficSummary {
  sheet: TrafficSheetKey;
  from: string;
  to: string;
  paused: boolean;
  segments: {
    key: string;
    label: string;
    received: number;
    split: number;
    invalid: number;
    /** People already in a CRM, sent back to it outside the split. */
    known: { org: TrafficOrg; name: string; count: number }[];
    shares: TrafficShareStats[];
  }[];
  totals: { received: number; sent: number; duplicates: number; invalid: number; waiting: number; failed: number };
}

/** A tab on the Lead traffic page: one sheet, or all of them together. */
export type TrafficTab = TrafficSheetKey | "all";

export type TrafficTotals = TrafficSummary["totals"];

/** Every sheet together, for the All tab: the totals, and each sheet's with the CRMs its leads went to. */
export interface TrafficAllSummary {
  sheet: "all";
  from: string;
  to: string;
  totals: TrafficTotals;
  sheets: {
    key: TrafficSheetKey;
    name: string;
    paused: boolean;
    totals: TrafficTotals;
    /** Only CRMs that got any of its leads in the period. */
    crms: ({ org: TrafficOrg; name: string } & TrafficTotals)[];
  }[];
}

export interface TrafficLeadRow {
  id: string;
  sheet: TrafficSheetKey;
  receivedAt: string;
  name: string;
  phone: string;
  tab: string;
  segment: string;
  segmentLabel: string;
  /** The team the split chose; blank when the lead went back to where the person already was. */
  team: string;
  destination: TrafficOrg | null;
  reason: "split" | "known" | "invalid";
  status: TrafficStatus;
  label: string;
  assignTo: string;
  crmLeadId: string;
  note: string;
  lastError: string;
  attempts: number;
  nextAttemptAt: string | null;
  canRetry: boolean;
}

export interface TrafficLeadPage {
  total: number;
  page: number;
  limit: number;
  items: TrafficLeadRow[];
}

export interface CrmPerson {
  id: string;
  name: string;
  email: string;
}

// ── Pending: every portal's sidebar counts, and who they wait on ──────────────

export interface PendingKind {
  key: string;
  label: string;
  total: number;
  /** Of those, how many are past their time (reminders). */
  overdue?: number;
  /** Waits on anyone holding a permission: every holder is shown with all of it. */
  shared?: boolean;
}

export interface PendingPerson {
  id: string;
  name: string;
  email: string;
  /** Still active in that portal; somebody who left can still have work sitting with them. */
  active: boolean;
  counts: Record<string, number>;
  total: number;
}

export interface PendingPortal {
  code: string;
  name: string;
  accent: string;
  available: boolean;
  error?: string;
  kinds: PendingKind[];
  people: PendingPerson[];
  total: number;
  /** A sales CRM: its people have a salesperson page. */
  crm?: boolean;
}

/** One person across every portal, matched by email. */
export interface PendingEveryone {
  key: string;
  name: string;
  email: string;
  total: number;
  items: { portal: string; portalName: string; personId: string; crm?: boolean; key: string; label: string; count: number; overdue?: number; shared?: boolean }[];
}

export interface PendingOverview {
  generatedAt: string;
  portals: PendingPortal[];
  people: PendingEveryone[];
  /** In the registry, not on the page yet. */
  comingNext: { code: string; name: string }[];
}

/** One course's commission in a sales CRM, in AED per sale (creditUsd: the MT5 credit). */
export interface CommissionPlanRow {
  id: string;
  name: string;
  fee: number;
  status: string;
  sales: number;
  tl: number;
  sm: number;
  creditUsd: number;
}
export interface CommissionSlabRow {
  name: string;
  target: number;
  salary: number;
  percent: number;
}
/** A sales CRM's commission plan, read only (2026-10-09). */
export interface CrmCommissionPlan {
  code: string;
  name: string;
  available: boolean;
  error?: string;
  tlRule: "zero_if_sm" | "never" | "always";
  tlRuleLabel: string;
  courses: CommissionPlanRow[];
  salesManager: string | null;
  excluded: string[];
  /** The slabs in force this month; null while the CRM still uses its built-in ones. */
  slabs: { from: string; sales: CommissionSlabRow[]; tl: CommissionSlabRow[]; sm: CommissionSlabRow[] } | null;
}

// ── Salespeople: each sales CRM's people, and one person's figures ────────────

export interface SalespersonRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  teams: string[];
  leads: number;
  closings: number;
  revenue: number;
}

export interface SalespeopleList {
  crms: { code: string; name: string; currency: string; people: SalespersonRow[] }[];
  failures: { code: string; name: string; error: string }[];
}

export interface SalespersonDetail {
  crm: { code: string; name: string; currency: string };
  person: { id: string; name: string; email: string; designation: string; active: boolean; teams: string[] };
  period: { from: string | null; to: string | null };
  summary: { leads: number; closings: number; revenue: number; followUps: number; conversion: number };
  pendingNow: { newLeads: number; reminders: number; overdue: number };
  statuses: { status: string; label: string; count: number; percent: number }[];
  closings: { id: string; name: string; course: string; fee: number; paid: number; balance: number; date: string | null; status: string }[];
  payments: { leadId: string; name: string; amount: number; date: string | null; note: string }[];
  truncated: { closings: boolean; payments: boolean };
}

export interface SalespersonLead {
  id: string;
  name: string;
  phone: string;
  email: string;
  source: string;
  status: string;
  statusLabel: string;
  createdAt: string | null;
  updatedAt: string | null;
}

// ── CSEs: Tetra Commission's customer success people (GET /cses) ─────────────

export type MoneyByCurrency = Record<string, number>;

export interface CseFigures {
  students: number;
  deposits: { count: number; usd: number };
  commissionUsd: number;
  followupsToday: number;
  followupsOverdue: number;
  upcoming: { count: number; amount: MoneyByCurrency };
  overdueDues: { count: number; amount: MoneyByCurrency };
  balance: { students: number; amount: MoneyByCurrency };
  bonus: { clients: number; usd: number; needsCall: number; withFinance: number; waitingBroker: number };
  notOnboarded: number;
  notOnboardedLate: number;
  /** Started in the period, and the AED finance approved on them in it. Missing from a Tetra Commission before 2026-10-11. */
  upgrades?: { count: number; paidAed: number; payments: number };
  /** Funding requests waiting and where (2026-10-14). Missing from a Tetra Commission before then. */
  funding?: CseFundingSummary;
}

/** Funding requests waiting — sent back, with finance, with a broker admin — and those raised in the period. */
export interface CseFundingSummary {
  pending: number;
  pendingUsd: number;
  pendingAed: number;
  sentBack: number;
  withFinance: number;
  waitingBroker: number;
  raised: number;
}

export type CseFundingStage = "sent_back" | "with_finance" | "waiting_broker" | "approved" | "rejected";

/** One funding request: where it is paused, USD and AED, and the commission it earned. */
export interface CseFundingRow {
  id: string;
  type: string;
  label: string;
  stage: CseFundingStage;
  reason: string;
  studentId: string;
  student: string;
  code: string;
  csId: string;
  cs: string;
  usd: number;
  aed: number;
  /** What the student paid with it, in AED (a course payment); 0 when none. */
  receivedAed: number;
  requestedAt: string;
  decidedAt: string;
  commissionUsd: number;
  /** On one CSE's page: their own share of it. */
  mineUsd?: number;
}

export interface CseUpgradeRow extends CseStudentRef {
  course: string;
  plan: string;
  status: string;
  dueAed: number;
  paidAed: number;
  at: string;
  csId: string;
  cs: string;
}

export interface CsePerson { id: string; name: string; email: string; role: string; active: boolean; team: string }

export interface CseList {
  today: string;
  upcomingDays: number;
  rows: (CsePerson & CseFigures)[];
  /** The team's figures, each student once however many CSEs share them. Missing from a Tetra Commission before 2026-10-11. */
  totals?: CseFigures;
  /** The period's funding requests and every one still waiting (at most 300), and how many there are. Since 2026-10-14. */
  funding?: { rows: CseFundingRow[]; total: number };
  /** The period's course upgrades, newest first, with who started them. Since 2026-10-14. */
  recentUpgrades?: CseUpgradeRow[];
  /** Prefix for a student's page in Tetra Commission; "" when its address is not set. */
  studentLink: string;
}

export interface CseStudentRef { studentId: string; student: string; code: string }

export interface CseDetail {
  person: CsePerson;
  today: string;
  upcomingDays: number;
  summary: CseFigures;
  followups: (CseStudentRef & { stage: string; title: string; due: string; overdue: boolean })[];
  dues: (CseStudentRef & { course: string; currency: string; balance: number; nextDueOn: string | null; state: string; daysLeft: number | null })[];
  bonus: (CseStudentRef & { count: number; usd: number; stage: string; since: string | null })[];
  notOnboarded: (CseStudentRef & { since: string; late: boolean })[];
  deposits: { studentId: string; student: string; usd: number; at: string }[];
  commission: (CseStudentRef & { usd: number; level: number | null; type: string; status: string; at: string })[];
  /** Started or paid on in the period. Missing from a Tetra Commission before 2026-10-11. */
  upgrades?: (CseStudentRef & { course: string; plan: string; status: string; dueAed: number; paidAed: number; at: string; startedBy: string })[];
  /** Their funding requests: the period's and every one still waiting. Since 2026-10-14. */
  funding?: { rows: CseFundingRow[]; total: number };
  studentLink: string;
}

// ── 3CX calls, every portal (2026-10-14) ──────────────────────────────────────
// The Sales CRM, Draw and Tetra Commission sync calls from 3CX; Banglore's come
// from a phone call-recorder app (nobody's). One person's are put together by email.

export interface CallTotals {
  calls: number;
  outgoing: number;
  incoming: number;
  connected: number;
  missed: number;
  notAnswered: number;
  talkSeconds: number;
  recorded: number;
  avgTalkSeconds: number;
}

export interface PortalCallsSummary {
  code: string;
  name: string;
  accent: string;
  kind: "3cx" | "recorder";
  available: boolean;
  error?: string;
  stats: CallTotals;
}

export interface CallEveryone extends CallTotals {
  key: string;
  name: string;
  email: string;
  /** Where their calls are: each portal, with the key that picks them there. */
  portals: { code: string; name: string; person: string; calls: number; connected: number; talkSeconds: number }[];
}

export interface CallRow {
  portal: string;
  portalName: string;
  id: string;
  startedAt: string;
  direction: "in" | "out";
  status: "answered" | "missed" | "no_answer";
  talkSeconds: number;
  ringSeconds: number;
  number: string;
  extension: string;
  person: string;
  personName: string;
  personEmail: string;
  contact: string;
  contactKind: string;
  recordings: number;
}

export interface CallsByPerson {
  period: { from: string; to: string };
  portals: PortalCallsSummary[];
  stats: CallTotals;
  people: CallEveryone[];
}

export interface CallsOverview extends CallsByPerson {
  calls: CallRow[];
  total: number;
  page: number;
  limit: number;
  capped: boolean;
}
