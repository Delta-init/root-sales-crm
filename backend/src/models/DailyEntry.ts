import mongoose, { Schema } from "mongoose";
import type { IDailyEntry } from "../types/index.js";

/**
 * The hand-entered half of a rep's day.
 *
 * Only holds metrics the CRM cannot source — content produced, community work,
 * learning, demos. Anything the CRM knows is never written here, so a typed
 * number can never quietly override a measured one.
 *
 * `date` is a plain YYYY-MM-DD string cut in the org's own timezone rather than
 * a Date. A rep in Bangalore filing "22 August" means their 22nd, and storing
 * an instant would make that ambiguous the moment it is read back in Dubai.
 */
const dailyEntrySchema = new Schema<IDailyEntry>(
  {
    org: {
      type: String,
      enum: ["delta", "banglore", "draw"],
      required: true,
    },
    userId: { type: String, required: true },
    userName: { type: String, default: "" },
    date: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"],
    },
    metrics: { type: Map, of: Number, default: () => ({}) },
    remarks: { type: String, default: "", trim: true, maxlength: 500 },
    actionRequired: { type: String, default: "", trim: true, maxlength: 500 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
  },
  { timestamps: true, versionKey: false }
);

// One row per rep per day per org — the upsert in the service relies on this
// to make repeated saves idempotent rather than piling up duplicates.
dailyEntrySchema.index({ org: 1, userId: 1, date: 1 }, { unique: true });
dailyEntrySchema.index({ org: 1, date: 1 });

export const DailyEntry = mongoose.model<IDailyEntry>("DailyEntry", dailyEntrySchema);
