import mongoose, { Schema } from "mongoose";
import type { ITrafficRule } from "../types/index.js";

/**
 * How one lead sheet is split between the CRMs.
 *
 * One document per sheet. Each segment of it — a group of its tabs, or the
 * whole sheet — has its own teams: a name, the CRM the team's leads go to, a
 * share in percent, and optionally one person in that CRM who takes them all
 * rather than the CRM sharing them out. A segment's `version` moves on when
 * its percentages or teams change, and its split is counted only within one
 * version: changing 50/50 to 70/30 starts the new ratio from there, rather
 * than first paying back everything the old one decided — and changing Hindi
 * leaves UK's count where it is.
 */
const assigneeSchema = new Schema(
  { id: { type: String, required: true }, name: { type: String, default: "" } },
  { _id: false }
);

const shareSchema = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    org: { type: String, enum: ["delta", "draw"], required: true },
    percent: { type: Number, min: 0, max: 100, required: true },
    assignTo: { type: assigneeSchema, default: null },
  },
  { _id: false }
);

const segmentSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, default: "" },
    version: { type: Number, default: 1 },
    shares: { type: [shareSchema], default: [] },
  },
  { _id: false }
);

const trafficRuleSchema = new Schema<ITrafficRule>(
  {
    key: { type: String, required: true, unique: true },
    paused: { type: Boolean, default: false },
    segments: { type: [segmentSchema], default: [] },
    reporters: {
      delta: { type: String, default: "" },
      draw: { type: String, default: "" },
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
    updatedByEmail: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false }
);

export const TrafficRule = mongoose.model<ITrafficRule>("TrafficRule", trafficRuleSchema);
