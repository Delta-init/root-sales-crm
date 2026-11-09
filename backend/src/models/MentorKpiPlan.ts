import mongoose, { Schema, type Types } from "mongoose";
import type { MentorTarget, PlanCategory, RoleTargets } from "../services/mentorKpiMetrics.js";

/*
 * Mentor KPI plans (the user, 2026-11-09: "weightage and targets edited only in Root"). One document per version:
 * the categories → subcategories → KPIs with their weights, a target per role for each metric, any mentor's own
 * target, and the month it applies from. A version is a draft until a root admin approves it; an approved version is
 * never edited again — a change is a new draft. The version in force for a month is the latest approved one starting
 * on or before it, so approving a plan from December leaves November's scores as they were.
 *
 * At most one draft at a time (a partial unique index on status "draft").
 */
export type PlanStatus = "draft" | "approved" | "superseded";

export interface IMentorKpiPlan {
  _id: Types.ObjectId;
  from: string;
  status: PlanStatus;
  categories: PlanCategory[];
  targets: RoleTargets;
  overrides: MentorTarget[];
  note: string;
  /** Where the targets came from, when they were suggested from history: the months and mentor-months behind each. */
  targetsBasis: { months: string[]; counts: Record<string, Record<string, number>> } | null;
  createdBy: { id: Types.ObjectId | null; email: string };
  updatedBy: { id: Types.ObjectId | null; email: string };
  approvedBy: { id: Types.ObjectId | null; email: string } | null;
  approvedAt: Date | null;
  supersededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const who = { id: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null }, email: { type: String, default: "" } };

const planSchema = new Schema<IMentorKpiPlan>(
  {
    from: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    status: { type: String, enum: ["draft", "approved", "superseded"], required: true },
    // Checked in the service (planProblems) — stored as given so a draft can be unfinished.
    categories: { type: Schema.Types.Mixed, required: true },
    targets: { type: Schema.Types.Mixed, default: () => ({ junior_mentor: {}, senior_mentor: {}, chief_mentor: {} }) },
    overrides: { type: Schema.Types.Mixed, default: () => [] },
    note: { type: String, default: "", maxlength: 500 },
    targetsBasis: { type: Schema.Types.Mixed, default: null },
    createdBy: who,
    updatedBy: who,
    approvedBy: { type: new Schema(who, { _id: false }), default: null },
    approvedAt: { type: Date, default: null },
    supersededAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, minimize: false },
);

planSchema.index({ status: 1, from: -1 });
planSchema.index({ status: 1 }, { unique: true, partialFilterExpression: { status: "draft" } });

export const MentorKpiPlan = mongoose.model<IMentorKpiPlan>("MentorKpiPlan", planSchema);
