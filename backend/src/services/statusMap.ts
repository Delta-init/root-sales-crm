/**
 * Canonical funnel stages.
 *
 * All three CRMs use the same eleven lead statuses in practice. Banglore's
 * schema additionally declares `booking` and `partialbooking`, which currently
 * have zero records but are mapped anyway so the report does not silently drop
 * them the day someone starts using them.
 *
 * Everything cross-org is grouped by STAGE, never by raw status — the group
 * report must not imply the three orgs share a status vocabulary just because
 * they happen to today.
 */
export const STAGES = ["new", "working", "unreachable", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  new: "New",
  working: "In progress",
  unreachable: "Unreachable",
  won: "Won",
  lost: "Lost",
};

const STATUS_TO_STAGE: Record<string, Stage> = {
  new: "new",

  assigned: "working",
  pending_response: "working",
  followup: "working",
  callback: "working",

  not_connected: "unreachable",
  mia: "unreachable",
  cnc: "unreachable",
  repeated: "unreachable",

  closed: "won",
  booking: "won",
  partialbooking: "won",

  lost: "lost",
};

export const stageOf = (status: string | null | undefined): Stage =>
  STATUS_TO_STAGE[String(status ?? "").toLowerCase()] ?? "working";

/** A $switch branch list for use inside an aggregation pipeline. */
export const stageSwitchExpr = () => ({
  $switch: {
    branches: Object.entries(STATUS_TO_STAGE).map(([status, stage]) => ({
      case: { $eq: ["$status", status] },
      then: stage,
    })),
    default: "working",
  },
});
