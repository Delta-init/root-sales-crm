import mongoose, { Schema } from "mongoose";
import type { ITrafficRule } from "../types/index.js";

/**
 * How the lead sheet is split between the CRMs.
 *
 * One document. Each segment of the sheet — UK & GCC, and Hindi — has its own
 * shares, and each share can name one person in that CRM to hand its leads to
 * rather than letting the CRM share them out. `version` moves on whenever a
 * percentage changes, and the split counts only within a version: changing
 * 50/50 to 70/30 starts the new ratio from here, rather than first paying back
 * everything the old one decided.
 */
const shareSchema = new Schema(
  {
    org: { type: String, enum: ["delta", "draw"], required: true },
    percent: { type: Number, min: 0, max: 100, required: true },
    assignTo: {
      type: new Schema({ id: { type: String, required: true }, name: { type: String, default: "" } }, { _id: false }),
      default: null,
    },
  },
  { _id: false }
);

const trafficRuleSchema = new Schema<ITrafficRule>(
  {
    key: { type: String, required: true, unique: true },
    paused: { type: Boolean, default: false },
    version: { type: Number, default: 1 },
    segments: {
      uk_gcc: { type: [shareSchema], default: [] },
      hindi: { type: [shareSchema], default: [] },
    },
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
