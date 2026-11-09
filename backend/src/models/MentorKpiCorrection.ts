import mongoose, { Schema, type Types } from "mongoose";

/*
 * A correction to a frozen month's mentor KPI (2026-11-09): one mentor, one KPI — the right value, or leave it out of
 * that month — with the reason and the evidence. A root admin approves or rejects it; approving makes the month's next
 * version. Raised in Root by a root admin, or (a later stage) from the CS Portal by the mentor or their chief.
 */
export type CorrectionStatus = "pending" | "approved" | "rejected";

export interface IMentorKpiCorrection {
  _id: Types.ObjectId;
  month: string;
  email: string;
  name: string;
  metric: string;
  metricName: string;
  action: "set_value" | "leave_out";
  value: number | null;
  /** What the frozen version showed when it was asked for. */
  was: { value: number | null; score: number | null; status: string; version: number };
  reason: string;
  evidence: string;
  status: CorrectionStatus;
  raisedBy: { source: "root" | "cs_portal" | "lms"; email: string; name: string };
  decidedBy: string;
  decidedAt: Date | null;
  decisionNote: string;
  /** The version its approval made. */
  version: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const correctionSchema = new Schema<IMentorKpiCorrection>(
  {
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, default: "" },
    metric: { type: String, required: true },
    metricName: { type: String, default: "" },
    action: { type: String, enum: ["set_value", "leave_out"], required: true },
    value: { type: Number, default: null },
    was: { type: Schema.Types.Mixed, required: true },
    reason: { type: String, required: true, maxlength: 500 },
    evidence: { type: String, default: "", maxlength: 2000 },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    raisedBy: {
      source: { type: String, enum: ["root", "cs_portal", "lms"], required: true },
      email: { type: String, default: "" },
      name: { type: String, default: "" },
    },
    decidedBy: { type: String, default: "" },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: "", maxlength: 500 },
    version: { type: Number, default: null },
  },
  { timestamps: true, versionKey: false },
);

correctionSchema.index({ status: 1, createdAt: -1 });
correctionSchema.index({ month: 1, email: 1 });
// One open request per mentor, month and KPI.
correctionSchema.index({ month: 1, email: 1, metric: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });

export const MentorKpiCorrection = mongoose.model<IMentorKpiCorrection>("MentorKpiCorrection", correctionSchema);
