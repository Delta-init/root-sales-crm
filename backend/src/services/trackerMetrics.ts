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
 * Only metrics with a target above zero count. A metric with no target has no
 * notion of achievement, and including it as 0% would punish a team for a
 * target nobody set. Each metric is capped at 100 before averaging so one
 * enormous day on a single line cannot mask everything else being missed.
 */
export const dailyScore = (
  values: Record<string, number>,
  targets: Record<string, number>
): number => {
  const pcts = Object.entries(targets)
    .filter(([, t]) => t > 0)
    .map(([k, t]) => Math.min(100, ((values[k] ?? 0) / t) * 100));

  if (!pcts.length) return 0;
  return Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10;
};

export const achievedPct = (value: number, target: number): number | null => {
  if (!target || target <= 0) return null;
  return Math.round((value / target) * 1000) / 10;
};
