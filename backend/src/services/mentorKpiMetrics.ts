/*
 * Mentor KPIs (the user, 2026-11-09: "edit only from Root — weightage, targets, and Root works out the points"):
 * what Root can measure about a mentor, and the plan it starts from.
 *
 * A KPI in a plan always points at one of these metrics. A metric fixes where its number comes from, its unit and
 * which way is good; a plan only chooses which metrics count, where they sit (category → subcategory), their weights,
 * their targets and whether they are scored or only watched. A metric whose data no system sends yet is listed with
 * `available: false` — it can be in a plan, and shows "not available yet" instead of a score, never a zero.
 *
 * Today every figure comes from one call: CS Portal's mentor report (GET /service/mentor-report), which carries the
 * LMS's classes, joins, bookings and reviews and the HRMS's clock-ins and leave, matched by address. The LMS, CS Portal
 * and HRMS feeds still to come (cancellation causes, assignments, meetings by who booked them, verified payments) only
 * switch metrics below to available.
 */

export const KPI_ROLES = ["junior_mentor", "senior_mentor", "chief_mentor"] as const;
export type KpiRole = (typeof KPI_ROLES)[number];
export const ROLE_LABELS: Record<KpiRole, string> = {
  junior_mentor: "Junior mentor",
  senior_mentor: "Senior mentor",
  chief_mentor: "Chief mentor",
};

export type KpiSource = "lms" | "cs_portal" | "hrms";
export const SOURCE_LABELS: Record<KpiSource, string> = { lms: "LMS", cs_portal: "CS Portal", hrms: "HRMS" };

/** One mentor's month as CS Portal's mentor report gives it (`total`), plus whether each system knew them. */
export interface FeedRow {
  id: string;
  name: string;
  email: string;
  role: string;
  in_lms: boolean;
  in_hrms: boolean;
  total: Record<string, number | null | undefined>;
}

/** A metric's month for one mentor: the value, and how many things it was worked out from. */
export interface Reading {
  value: number;
  sample: number;
}

export interface KpiMetric {
  key: string;
  name: string;
  source: KpiSource;
  unit: string;
  /** "up": more is better; "down": fewer is better. */
  direction: "up" | "down";
  /** A count grows through the month (and shrinks with leave), so its target is pro-rated; a rate never is. */
  kind: "count" | "rate" | "average";
  /** Fewer things than this to work it out from and it is "not enough data", not a score. */
  minSample: number;
  /** What the sample counts, for the screen ("5 reviews"). */
  sampleOf: string;
  available: boolean;
  /** Why it isn't available yet, or what it includes. */
  note?: string;
  read?: (row: FeedRow) => Reading | null;
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const pct = (part: number, whole: number) => (whole > 0 ? (100 * part) / whole : 0);

/* The catalogue. Keys are stored in plans: never rename one, add a new one instead. */
export const METRICS: KpiMetric[] = [
  // ── Teaching ──
  {
    key: "classes_held", name: "Classes held", source: "lms", unit: "classes", direction: "up", kind: "count",
    minSample: 0, sampleOf: "classes", available: true,
    read: (r) => ({ value: n(r.total.held), sample: n(r.total.held) }),
  },
  {
    key: "mentor_cancellations", name: "Mentor-caused class cancellations", source: "lms", unit: "classes", direction: "down",
    kind: "count", minSample: 0, sampleOf: "classes", available: false,
    note: "Needs the cancellation cause in the LMS (who caused it)",
  },
  {
    key: "on_time_start", name: "On-time class start", source: "lms", unit: "%", direction: "up", kind: "rate",
    minSample: 5, sampleOf: "classes joined", available: true,
    note: "Joined within 5 minutes of the start, of the classes with a recorded join",
    read: (r) => {
      const joined = Math.max(0, n(r.total.held) - n(r.total.notJoined));
      return { value: pct(Math.max(0, joined - n(r.total.lateJoins)), joined), sample: joined };
    },
  },
  {
    key: "class_attendance", name: "Class attendance", source: "lms", unit: "%", direction: "up", kind: "rate",
    minSample: 10, sampleOf: "bookings", available: true,
    note: "Students who came, of those booked. Includes Program classes until the LMS splits them",
    read: (r) => {
      const booked = n(r.total.attended) + n(r.total.missed);
      return { value: pct(n(r.total.attended), booked), sample: booked };
    },
  },
  {
    key: "program_attendance", name: "Program auto-booking attendance", source: "lms", unit: "%", direction: "up",
    kind: "rate", minSample: 10, sampleOf: "bookings", available: false, note: "Needs the LMS to split Program classes",
  },
  {
    key: "student_rating", name: "Student rating", source: "lms", unit: "stars", direction: "up", kind: "average",
    minSample: 5, sampleOf: "reviews", available: true,
    read: (r) => {
      const reviews = n(r.total.reviews);
      return reviews && r.total.avgRating != null ? { value: n(r.total.avgRating), sample: reviews } : { value: 0, sample: reviews };
    },
  },
  {
    key: "low_ratings", name: "Low ratings (1–2 stars)", source: "lms", unit: "ratings", direction: "down", kind: "count",
    minSample: 5, sampleOf: "reviews", available: true,
    read: (r) => ({ value: n(r.total.lowRatings), sample: n(r.total.reviews) }),
  },
  {
    key: "classes_cancelled", name: "Classes cancelled (any cause)", source: "lms", unit: "classes", direction: "down",
    kind: "count", minSample: 0, sampleOf: "classes", available: true,
    note: "Every cancellation, whoever caused it — better watched than scored until causes are recorded",
    read: (r) => ({ value: n(r.total.classesCancelled), sample: n(r.total.classes) }),
  },
  // ── Student work ──
  {
    key: "assignments_reviewed", name: "Assignments reviewed", source: "lms", unit: "%", direction: "up", kind: "rate",
    minSample: 5, sampleOf: "assignments", available: false, note: "Needs the LMS assignment feed",
  },
  {
    key: "review_turnaround", name: "Review turnaround", source: "lms", unit: "hours", direction: "down", kind: "average",
    minSample: 5, sampleOf: "assignments", available: false, note: "Needs the LMS assignment feed",
  },
  // ── Meetings ──
  {
    key: "cse_meetings_held", name: "CSE-generated meetings held", source: "cs_portal", unit: "meetings", direction: "up",
    kind: "count", minSample: 0, sampleOf: "meetings", available: false, note: "Needs CS Portal to say who booked each meeting",
  },
  {
    key: "mentor_meetings_held", name: "Mentor-generated meetings held", source: "cs_portal", unit: "meetings", direction: "up",
    kind: "count", minSample: 0, sampleOf: "meetings", available: false, note: "Needs CS Portal to say who booked each meeting",
  },
  {
    key: "meeting_cancellations", name: "Mentor-caused meeting cancellations", source: "cs_portal", unit: "meetings",
    direction: "down", kind: "count", minSample: 0, sampleOf: "meetings", available: false,
    note: "Needs \"cancelled by\" on the meeting-status answer",
  },
  {
    key: "report_24h", name: "Meeting report within 24 hours", source: "lms", unit: "%", direction: "up", kind: "rate",
    minSample: 3, sampleOf: "meetings", available: false, note: "Needs the LMS meeting-outcome feed",
  },
  {
    key: "interested_rate", name: "Interested rate", source: "lms", unit: "%", direction: "up", kind: "rate",
    minSample: 3, sampleOf: "meetings", available: false, note: "Needs the LMS meeting-outcome feed",
  },
  {
    key: "meetings_held", name: "Meetings held (all)", source: "lms", unit: "meetings", direction: "up", kind: "count",
    minSample: 0, sampleOf: "meetings", available: true, note: "Every 1:1 meeting not cancelled, whoever booked it",
    read: (r) => {
      const held = Math.max(0, n(r.total.meetings) - n(r.total.meetingsCancelled));
      return { value: held, sample: n(r.total.meetings) };
    },
  },
  // ── Revenue ──
  {
    key: "verified_collections", name: "Meeting-linked verified collections", source: "cs_portal", unit: "AED",
    direction: "up", kind: "count", minSample: 0, sampleOf: "payments", available: false,
    note: "Needs CS Portal's meeting-linked Paid payments",
  },
  {
    key: "payment_conversion", name: "Meeting to verified payment", source: "cs_portal", unit: "%", direction: "up",
    kind: "rate", minSample: 3, sampleOf: "meetings", available: false, note: "Needs CS Portal's meeting-linked Paid payments",
  },
  {
    key: "eligible_commission", name: "Eligible 2% commission", source: "cs_portal", unit: "AED", direction: "up",
    kind: "count", minSample: 0, sampleOf: "payments", available: false, note: "Needs CS Portal's 2% commission by mentor",
  },
  {
    key: "commission_credited", name: "Commission credited", source: "cs_portal", unit: "USD", direction: "up",
    kind: "count", minSample: 0, sampleOf: "credits", available: true,
    note: "Everything CS Portal credited them in the month, their own and pool shares",
    read: (r) => ({ value: n(r.total.commission_usd), sample: 1 }),
  },
  // ── Discipline ──
  {
    key: "days_present", name: "Days present vs scheduled", source: "hrms", unit: "%", direction: "up", kind: "rate",
    minSample: 5, sampleOf: "working days", available: true, note: "Approved leave left out",
    read: (r) => {
      const scheduled = n(r.total.daysPresent) + n(r.total.daysAbsent);
      return { value: pct(n(r.total.daysPresent), scheduled), sample: scheduled };
    },
  },
  {
    key: "late_clockins", name: "Late clock-ins", source: "hrms", unit: "days", direction: "down", kind: "count",
    minSample: 5, sampleOf: "working days", available: true,
    read: (r) => ({ value: n(r.total.lateClockIns), sample: n(r.total.daysPresent) + n(r.total.daysAbsent) }),
  },
  {
    key: "hours_worked", name: "Hours worked", source: "hrms", unit: "hours", direction: "up", kind: "count",
    minSample: 0, sampleOf: "working days", available: true,
    read: (r) => ({ value: n(r.total.workedMinutes) / 60, sample: n(r.total.daysPresent) }),
  },
];

export const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

/* ── The plan's shape ─────────────────────────────────────────────────────────────────────────────────────────── */

export type KpiMode = "scored" | "monitoring" | "off";
export interface PlanKpi { metric: string; weight: number; mode: KpiMode }
export interface PlanSub { key: string; name: string; weight: number; kpis: PlanKpi[] }
export interface PlanCategory { key: string; name: string; weight: number; subs: PlanSub[] }
/** A target per role per metric, and a mentor's own where one was set (by address). */
export type RoleTargets = Record<KpiRole, Record<string, number>>;
export interface MentorTarget { email: string; name: string; metric: string; value: number; reason: string }

const k = (metric: string, weight: number, mode: KpiMode = "scored"): PlanKpi => ({ metric, weight, mode });

/** The structure the user approved on 2026-11-09 — where a first draft starts. No targets: those come from history. */
export const DEFAULT_CATEGORIES: PlanCategory[] = [
  {
    key: "teaching", name: "Teaching", weight: 35, subs: [
      { key: "delivery", name: "Delivery", weight: 50, kpis: [k("classes_held", 40), k("mentor_cancellations", 30), k("on_time_start", 30)] },
      { key: "attendance", name: "Attendance", weight: 25, kpis: [k("class_attendance", 100), k("program_attendance", 0, "monitoring")] },
      { key: "quality", name: "Quality", weight: 25, kpis: [k("student_rating", 70), k("low_ratings", 30)] },
    ],
  },
  {
    key: "student_work", name: "Student work", weight: 15, subs: [
      { key: "assignments", name: "Assignments", weight: 100, kpis: [k("assignments_reviewed", 60), k("review_turnaround", 40)] },
    ],
  },
  {
    key: "meetings", name: "Meetings", weight: 20, subs: [
      { key: "volume", name: "Volume", weight: 50, kpis: [k("cse_meetings_held", 60), k("mentor_meetings_held", 40)] },
      { key: "reliability", name: "Reliability", weight: 50, kpis: [k("meeting_cancellations", 50), k("report_24h", 50), k("interested_rate", 0, "monitoring")] },
    ],
  },
  {
    key: "revenue", name: "Revenue", weight: 20, subs: [
      { key: "collections", name: "Collections", weight: 60, kpis: [k("verified_collections", 100)] },
      { key: "conversion", name: "Conversion", weight: 40, kpis: [k("payment_conversion", 100), k("eligible_commission", 0, "monitoring")] },
    ],
  },
  {
    key: "discipline", name: "Discipline", weight: 10, subs: [
      { key: "attendance", name: "Attendance", weight: 100, kpis: [k("days_present", 60), k("late_clockins", 40), k("hours_worked", 0, "monitoring")] },
    ],
  },
];

export const emptyTargets = (): RoleTargets => ({ junior_mentor: {}, senior_mentor: {}, chief_mentor: {} });

/** CS Portal's role for a mentor, as a KPI role — or null when they have none there (an LMS-only instructor). */
export const kpiRoleOf = (appRole: string): KpiRole | null =>
  (KPI_ROLES as readonly string[]).includes(appRole) ? (appRole as KpiRole) : null;
