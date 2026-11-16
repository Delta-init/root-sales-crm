import mongoose, { Schema } from "mongoose";

/**
 * Which CRM lead a lead-sheet row is (2026-11-16, services/leadStatusService.ts): found once — from Root's own record
 * of where it sent the row, else by the phone's last nine digits in the CRMs — and kept, so every 30-minute status
 * refresh after that reads the lead by its id instead of searching every CRM again. `missUntil`: not found in any CRM;
 * looked for again after then.
 */
const trafficStatusLinkSchema = new Schema(
  {
    sourceKey: { type: String, required: true, unique: true },
    phone9: { type: String, default: "" },
    org: { type: String, enum: ["delta", "draw", "remote", null], default: null },
    leadId: { type: String, default: "" },
    missUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

export const TrafficStatusLink = mongoose.model("TrafficStatusLink", trafficStatusLinkSchema);
