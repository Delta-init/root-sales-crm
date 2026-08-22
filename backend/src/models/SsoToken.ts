import mongoose, { Schema } from "mongoose";
import type { ISsoToken } from "../types/index.js";

/**
 * A single-use, short-lived handoff token.
 *
 * The browser carries this in a URL, so it must be worthless the moment it is
 * spent: `usedAt` is set by an atomic findOneAndUpdate on redemption, and the
 * TTL index expires the row regardless. Never put a JWT in a URL instead —
 * URLs leak through history, Referer headers and proxy logs.
 */
const ssoTokenSchema = new Schema<ISsoToken>(
  {
    token: { type: String, required: true, unique: true, index: true },
    admin: { type: Schema.Types.ObjectId, ref: "AdminUser", required: true },
    adminEmail: { type: String, required: true, lowercase: true, trim: true },
    org: { type: String, enum: ["delta", "banglore", "draw"], required: true },
    /** The CRM account this token authorises — the org's service account. */
    subjectEmail: { type: String, required: true, lowercase: true, trim: true },
    subjectName: { type: String, default: "Root Admin" },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    issuedToIp: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false }
);

// Mongo drops the row once expiresAt passes, so spent and stale tokens do not
// accumulate. This is a cleanup mechanism, not the security boundary — the
// expiry is also checked explicitly on redemption, because the TTL monitor
// only runs about once a minute.
ssoTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SsoToken = mongoose.model<ISsoToken>("SsoToken", ssoTokenSchema);
