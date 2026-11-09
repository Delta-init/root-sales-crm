import mongoose, { Schema, type Types } from "mongoose";

/*
 * A finished month's mentor KPIs, frozen (2026-11-09): on the 1st, last month's numbers and scores are kept as version
 * 1 and that is what the month shows from then on — later changes in the LMS, CS Portal or HRMS no longer move it. A
 * figure changes only through an approved correction, which makes the next version; every version is kept.
 *
 * Holds what was scored (the CS Portal report's rows and the plan version used) as well as the results, so a
 * correction re-scores exactly the same inputs.
 */
export interface IMentorKpiSnapshot {
  _id: Types.ObjectId;
  month: string;
  version: number;
  current: boolean;
  plan: { id: string; from: string; approvedBy: string; approvedAt: Date | null; categories: unknown; targets: unknown; overrides: unknown };
  sources: unknown;
  rows: unknown[];
  mentors: unknown[];
  /** The corrections this version applies (all approved ones for the month up to it). */
  corrections: Types.ObjectId[];
  /** "automatic" on the 1st, or the root admin who froze it or approved the correction. */
  frozenBy: string;
  reason: string;
  createdAt: Date;
}

const snapshotSchema = new Schema<IMentorKpiSnapshot>(
  {
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    version: { type: Number, required: true, min: 1 },
    current: { type: Boolean, required: true },
    plan: { type: Schema.Types.Mixed, required: true },
    sources: { type: Schema.Types.Mixed, required: true },
    rows: { type: [Schema.Types.Mixed], default: [] },
    mentors: { type: [Schema.Types.Mixed], default: [] },
    corrections: [{ type: Schema.Types.ObjectId, ref: "MentorKpiCorrection" }],
    frozenBy: { type: String, required: true },
    reason: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, minimize: false },
);

// One version number per month — also what stops two servers freezing the same month twice.
snapshotSchema.index({ month: 1, version: 1 }, { unique: true });
snapshotSchema.index({ month: 1, current: 1 });

export const MentorKpiSnapshot = mongoose.model<IMentorKpiSnapshot>("MentorKpiSnapshot", snapshotSchema);
