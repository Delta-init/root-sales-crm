/**
 * The daily tracker's metric catalogue.
 *
 * Mirrors the "DELTA FOREX — DAILY" sheet. Each metric declares where its
 * number comes from, which is the whole point: the sheet mixes figures the CRM
 * already knows with figures only a person can supply, and blurring the two
 * would present typed-in numbers as if they were measured.
 *
 *   auto   — derived from the org's CRM database
 *   manual — entered by the rep; the CRM has no source for it
 */
export type MetricSource = "auto" | "manual";

export interface MetricDef {
  key: string;
  label: string;
  group: string;
  source: MetricSource;
  /** Money is summed in the org's own currency, not counted. */
  money?: boolean;
  /** Derived from other metrics rather than stored. */
  computed?: boolean;
  /** A running total rather than a same-day flow — see pendingPayments. */
  snapshot?: boolean;
  /** Only trustworthy where the org actually captures it. */
  reliableIn?: string[];
  note?: string;
}

export const METRICS: MetricDef[] = [
  // ── Sales activity ────────────────────────────────────────────────────
  {
    key: "callsMade",
    label: "Calls Made",
    group: "Sales Activity",
    source: "auto",
    // Banglore's Android dialer logs every call; the other two have 81 and 2
    // rows in total. Shown per-org only — a group comparison would read as
    // Delta and Draw not calling, when really they do not record calls.
    reliableIn: ["banglore"],
    note:
      "Only Banglore logs calls. The dialer records no operator, so calls are " +
      "credited to the owner of the lead they concern; calls with no lead are " +
      "shown separately as unattributed.",
  },
  { key: "leadsContacted", label: "Leads Contacted", group: "Sales Activity", source: "auto" },
  { key: "followUpsDone", label: "Follow-ups Done", group: "Sales Activity", source: "auto" },
  {
    key: "demos",
    label: "Demos / Pitches",
    group: "Sales Activity",
    source: "manual",
    // demoScheduled exists but is set on 7 / 57 / 0 leads across the three
    // orgs, so deriving it would report near-zero for everyone.
    note: "CRM field exists but is effectively unused; entered by hand.",
  },
  { key: "closings", label: "Closings", group: "Sales Activity", source: "auto" },
  {
    key: "convRate",
    label: "Conv. Rate %",
    group: "Sales Activity",
    source: "auto",
    computed: true,
  },

  // ── Lead generation ───────────────────────────────────────────────────
  { key: "whatsappMsgs", label: "WhatsApp Msgs", group: "Lead Generation", source: "manual" },
  { key: "clientReferences", label: "Client References", group: "Lead Generation", source: "manual" },
  { key: "selfGenLeads", label: "Self-Gen Leads", group: "Lead Generation", source: "manual" },
  { key: "communityInvites", label: "Community Invites", group: "Lead Generation", source: "manual" },
  { key: "newCommunityMembers", label: "New Community Members", group: "Lead Generation", source: "manual" },

  // ── Financials ────────────────────────────────────────────────────────
  {
    key: "revenueCollected",
    label: "Revenue Collected",
    group: "Financials",
    source: "auto",
    money: true,
  },
  {
    key: "pendingPayments",
    label: "Pending Payments",
    group: "Financials",
    source: "auto",
    money: true,
    snapshot: true,
    note: "Outstanding across this rep's leads right now, not a same-day figure.",
  },

  // ── Content & community ───────────────────────────────────────────────
  { key: "contentCreated", label: "Content Created", group: "Content & Community", source: "manual" },
  { key: "communityPosts", label: "Community Posts", group: "Content & Community", source: "manual" },
  { key: "egcContent", label: "EGC Content Created", group: "Content & Community", source: "manual" },

  // ── Learning ──────────────────────────────────────────────────────────
  { key: "techTopicsLearnt", label: "Tech Topics Learnt", group: "Learning", source: "manual" },
];

export const METRIC_KEYS = METRICS.map((m) => m.key);
export const MANUAL_KEYS = METRICS.filter((m) => m.source === "manual").map((m) => m.key);
export const AUTO_KEYS = METRICS.filter((m) => m.source === "auto").map((m) => m.key);

/** Targets from the source sheet, used to seed a new org. */
export const DEFAULT_TARGETS: Record<string, number> = {
  callsMade: 180,
  leadsContacted: 90,
  followUpsDone: 60,
  demos: 36,
  closings: 18,
  convRate: 20,
  whatsappMsgs: 180,
  clientReferences: 18,
  selfGenLeads: 18,
  communityInvites: 90,
  newCommunityMembers: 30,
  revenueCollected: 90000,
  contentCreated: 5,
  communityPosts: 10,
  egcContent: 5,
  techTopicsLearnt: 3,
};

/**
 * Daily score: the mean of achieved percentages.
 *
 * `keys` decides WHAT is averaged, and getting it wrong is what made this
 * meaningless before. Averaging over every target meant the ten manual metrics
 * nobody had entered counted as 0%, capping any rep at 37.5 — below the 40
 * threshold the UI paints amber at, so every rep rendered red every day
 * regardless of how they worked.
 *
 * A metric is only averaged when there is something to average: an auto metric
 * always counts, because a zero there is a real result; a manual metric counts
 * only once someone has filed a figure for that day, because a zero there is
 * absent data, not a bad day.
 */
export const dailyScore = (
  values: Record<string, number>,
  targets: Record<string, number>,
  keys?: string[]
): number => {
  const scored = (keys ?? Object.keys(targets)).filter((k) => (targets[k] ?? 0) > 0);

  const pcts = scored.map((k) =>
    // Capped so one enormous line cannot mask everything else being missed.
    Math.min(100, ((values[k] ?? 0) / targets[k]) * 100)
  );

  if (!pcts.length) return 0;
  return Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10;
};

/**
 * Which metrics a given org can be scored on at all.
 *
 * Excludes metrics this org does not capture — scoring Delta on calls it never
 * logs would hold a permanent zero against it.
 */
export const scorableKeys = (orgCode: string): string[] =>
  METRICS.filter(
    (m) => m.source === "auto" && (!m.reliableIn || m.reliableIn.includes(orgCode))
  ).map((m) => m.key);

/** Manual keys a rep actually filed a figure for on the day. */
export const reportedManualKeys = (values: Record<string, number>): string[] =>
  MANUAL_KEYS.filter((k) => (values[k] ?? 0) > 0);

export const achievedPct = (value: number, target: number): number | null => {
  if (!target || target <= 0) return null;
  return Math.round((value / target) * 1000) / 10;
};
