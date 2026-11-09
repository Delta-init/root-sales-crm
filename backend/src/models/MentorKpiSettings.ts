import mongoose, { Schema } from "mongoose";

/*
 * Mentor KPIs' one switch (2026-11-09): when root admins open the scores to the CS Portal (mentors their own; chiefs,
 * CS Managers and admins their reach). Opening starts the 60-day observation period — not used for salary,
 * commission, bonuses or penalties. Closed until a root admin opens it. One document (key "default").
 */
export interface IMentorKpiSettings {
  key: string;
  portalOpenSince: Date | null;
  changedBy: string;
  changedAt: Date | null;
}

const settingsSchema = new Schema<IMentorKpiSettings>(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    portalOpenSince: { type: Date, default: null },
    changedBy: { type: String, default: "" },
    changedAt: { type: Date, default: null },
  },
  { versionKey: false },
);

export const MentorKpiSettings = mongoose.model<IMentorKpiSettings>("MentorKpiSettings", settingsSchema);
