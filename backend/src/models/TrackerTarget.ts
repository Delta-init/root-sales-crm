import mongoose, { Schema } from "mongoose";
import type { ITrackerTarget } from "../types/index.js";

/**
 * Per-org daily targets.
 *
 * Deliberately per-org rather than one shared set: the source sheet's numbers
 * assume an 18-rep Dubai desk billing in AED. Delta has 26 users, Banglore 23
 * and bills in INR, Draw 7. One shared target would make ACHIEVED % mean
 * something different in each org, which is worse than no target at all.
 */
const trackerTargetSchema = new Schema<ITrackerTarget>(
  {
    org: {
      type: String,
      enum: ["delta", "banglore", "draw"],
      required: true,
      unique: true,
    },
    // Free-form map so a metric can be added to the catalogue without a
    // migration; unknown keys are ignored by the scorer.
    metrics: {
      type: Map,
      of: Number,
      default: () => ({}),
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
  },
  { timestamps: true, versionKey: false }
);

export const TrackerTarget = mongoose.model<ITrackerTarget>(
  "TrackerTarget",
  trackerTargetSchema
);
