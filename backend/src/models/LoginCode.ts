import mongoose, { Schema } from "mongoose";

/**
 * A one-time code that signs somebody in without a password.
 *
 * Stored as a hash, never as the digits. The collection is a list of live
 * credentials, and a dump of it should not be a list of ways into the portal —
 * the same reason the password column next door is bcrypt rather than text.
 *
 * Bound to one account. The hash covers the user id as well as the code, so
 * six digits stay unique across everybody signing in at once and a code minted
 * for one person cannot be replayed against another.
 *
 * Spent by an atomic findOneAndUpdate on `usedAt: null`, so two browsers
 * racing the same code cannot both be let in. The TTL index removes the row
 * once it expires, which keeps this from becoming a growing table of dead
 * secrets nobody looks at.
 */
export interface ILoginCode {
  user: mongoose.Types.ObjectId;
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  /** How many wrong guesses this code has survived. */
  attempts: number;
  requestedFromIp: string;
}

const loginCodeSchema = new Schema<ILoginCode>(
  {
    user: { type: Schema.Types.ObjectId, ref: "AdminUser", required: true, index: true },
    codeHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    requestedFromIp: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

// Mongo drops the row once it expires, so spent and stale codes do not pile up.
loginCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginCode = mongoose.model<ILoginCode>("LoginCode", loginCodeSchema);
