import mongoose, { Schema } from "mongoose";
import type { IRoleMap } from "../types/index.js";

/**
 * What somebody's role in one system makes them in another.
 *
 * A BDE in a sales CRM is a salesperson in finance. That is a fact about how
 * this business is organised, and it was being retyped on every grant — which
 * means it was being retyped differently, and a role typed "Salesperson" where
 * finance calls it "salesperson" is a grant that fails at the far end after
 * somebody has gone home.
 *
 * A table rather than a convention. "BDE" mapping to "salesperson" looks
 * obvious enough to hard-code right up until somebody adds "BDE II", and a
 * convention has no answer for that one — it simply maps to nothing, quietly.
 *
 * Matched case-insensitively on the role somebody was given, because whoever
 * types it is a person and the CRMs do not agree on capitalisation either.
 */
const roleMapSchema = new Schema<IRoleMap>(
  {
    fromTarget: {
      type: String,
      enum: ["delta", "banglore", "draw", "finance-hq", "finance-banglore", "hrms"],
      required: true,
    },
    /** Stored lowercase; what was typed is kept in `label` for the screen. */
    fromRole: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, default: "" },

    toTarget: {
      type: String,
      enum: ["delta", "banglore", "draw", "finance-hq", "finance-banglore", "hrms"],
      required: true,
    },
    /** Spelled the way the far system spells it — it is sent there verbatim. */
    toRole: { type: String, required: true, trim: true },

    createdBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
  },
  { timestamps: true, versionKey: false }
);

// One answer per question. Two rules saying a BDE is both a salesperson and an
// accountant is not a richer map, it is a coin toss.
roleMapSchema.index({ fromTarget: 1, fromRole: 1, toTarget: 1 }, { unique: true });

export const RoleMap = mongoose.model<IRoleMap>("RoleMap", roleMapSchema);
