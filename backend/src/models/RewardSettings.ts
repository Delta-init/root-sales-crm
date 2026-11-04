import mongoose, { Schema } from "mongoose";

/**
 * The gift rewards' targets (the user, 2026-11-04), one row for every sales CRM. Money is counted as each CRM's
 * leaderboard counts it: payments in the month on the leads a person holds. The Bangalore CRM counts in rupees, so its
 * targets are these at `inrPerAed`.
 */
export interface IRewardSettings {
  key: "rewards";
  enabled: boolean;
  /** A salesperson's own closings in a month, and the gift value it earns. */
  salesTargetAed: number;
  salesGiftAed: number;
  /** A team leader's whole team (the leader included) in a month, and the gift value it earns the leader. */
  tlTargetAed: number;
  tlGiftAed: number;
  /** 1 AED = this many rupees: the Bangalore CRM's targets in rupees. */
  inrPerAed: number;
  /** When the built-in gifts went in: once, so a list emptied on purpose stays empty. */
  seededAt: Date | null;
  updatedBy: string;
}

const rewardSettingsSchema = new Schema<IRewardSettings>(
  {
    key: { type: String, enum: ["rewards"], default: "rewards", unique: true },
    enabled: { type: Boolean, default: true },
    salesTargetAed: { type: Number, default: 50_000, min: 1 },
    salesGiftAed: { type: Number, default: 2_000, min: 1 },
    tlTargetAed: { type: Number, default: 100_000, min: 1 },
    tlGiftAed: { type: Number, default: 3_000, min: 1 },
    inrPerAed: { type: Number, default: 22.75, min: 1, max: 1000 },
    seededAt: { type: Date, default: null },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true },
);

export const RewardSettings = mongoose.model<IRewardSettings>("RewardSettings", rewardSettingsSchema);
