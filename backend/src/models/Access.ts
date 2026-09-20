import mongoose, { Schema } from "mongoose";
import type { IAccess } from "../types/index.js";

/**
 * One person's right to open one system.
 *
 * The portal began as a control tower: a handful of super admins, each able to
 * open everything, and nothing to decide. Once ordinary staff sign in here the
 * question changes — a rep in the Banglore CRM must land in Banglore and
 * nowhere else — and the only dependable answer is a row somebody wrote.
 *
 * Listed rather than derived, deliberately. Access could be inferred from a
 * role, an email domain or which CRM a person was created in, and each of those
 * is one rename away from silently opening a door. A row has to be made, and
 * can be looked at.
 *
 * `roleInTarget` is what they become on arrival, in that system's own words: a
 * BDE in a CRM is a salesperson in finance. Recorded per row rather than
 * translated on the way in, because a convention that maps "BDE" to
 * "salesperson" reads as obvious until somebody adds "BDE II".
 */
const accessSchema = new Schema<IAccess>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
    target: {
      type: String,
      enum: ["delta", "banglore", "draw", "finance-hq", "finance-banglore", "hrms", "lms", "media-erp"],
      required: true,
    },
    roleInTarget: { type: String, required: true, trim: true },
    /** Who granted it. Null for rows the seed made. */
    grantedBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
  },
  { timestamps: true, versionKey: false }
);

// One row per person per door: granting twice is the same grant, and a second
// row would make revoking it look like it had worked while one remained.
accessSchema.index({ user: 1, target: 1 }, { unique: true });

export const Access = mongoose.model<IAccess>("Access", accessSchema);
