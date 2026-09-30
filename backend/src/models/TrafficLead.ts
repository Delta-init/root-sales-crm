import mongoose, { Schema } from "mongoose";
import type { ITrafficLead } from "../types/index.js";

/**
 * One lead from the sheet, where it was sent, and how that went.
 *
 * This is the only copy of a lead the portal keeps — the lead itself lives in
 * whichever CRM it went to. It is kept because the split has to be counted
 * from something, a lead a CRM could not take has to wait somewhere, and "why
 * did this person land in Draw" deserves an answer later.
 */
const assigneeSchema = new Schema(
  { id: { type: String, required: true }, name: { type: String, default: "" } },
  { _id: false }
);

const trafficLeadSchema = new Schema<ITrafficLead>(
  {
    sourceKey: { type: String, required: true, unique: true },
    metaId: { type: String, default: "" },
    tab: { type: String, default: "" },
    segment: { type: String, enum: ["uk", "gcc", "hindi"], required: true },
    source: { type: String, default: "" },
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    phone9: { type: String, default: "" },
    email: { type: String, default: "" },
    platform: { type: String, default: "" },
    campaign: { type: String, default: "" },
    adName: { type: String, default: "" },
    isOrganic: { type: Boolean, default: false },
    createdTime: { type: Date, default: null },
    destination: { type: String, enum: ["delta", "draw", null], default: null },
    reason: { type: String, enum: ["split", "known", "invalid"], required: true },
    counted: { type: Boolean, default: false },
    ruleVersion: { type: Number, default: 0 },
    assignTo: { type: assigneeSchema, default: null },
    status: {
      type: String,
      enum: ["queued", "held", "sending", "sent", "duplicate", "invalid", "retrying", "failed"],
      required: true,
    },
    crmLeadId: { type: String, default: "" },
    note: { type: String, default: "" },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: null },
    claimedAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    sentAt: { type: Date, default: null },
    receivedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, versionKey: false }
);

// The same person, whatever the tab or however the number was typed.
trafficLeadSchema.index({ phone9: 1, receivedAt: -1 });
// What the worker looks for.
trafficLeadSchema.index({ status: 1, nextAttemptAt: 1 });
// Counting the split.
trafficLeadSchema.index({ segment: 1, ruleVersion: 1, counted: 1, destination: 1 });
trafficLeadSchema.index({ receivedAt: -1 });

export const TrafficLead = mongoose.model<ITrafficLead>("TrafficLead", trafficLeadSchema);
