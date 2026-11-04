import mongoose, { Schema, type Types } from "mongoose";

export const CLAIM_STATUSES = ["requested", "ordered", "handed_over", "cancelled"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * A gift somebody chose for reaching their target (the user, 2026-11-04): one per person a month. The office buys it
 * and hands it over, moving it along on the Rewards page; the person sees where it is in their CRM. What they reached,
 * the gift and its value are copied in as they were when it was chosen.
 */
export interface IRewardClaim {
  _id: Types.ObjectId;
  /** Which CRM: delta, draw, remote, banglore. */
  portal: string;
  /** YYYY-MM, Dubai. */
  month: string;
  /** Their id in that CRM. */
  userId: string;
  userName: string;
  role: "sales" | "tl";
  teamName: string;
  /** What they (or their team) had closed when they chose, in AED, and in the CRM's own money. */
  achievedAed: number;
  achieved: number;
  currency: string;
  targetAed: number;
  giftId: Types.ObjectId;
  giftName: string;
  giftCategory: string;
  giftValueAed: number;
  status: ClaimStatus;
  /** Not cancelled: holds the person's one gift for the month. */
  live: boolean;
  note: string;
  history: Array<{ status: ClaimStatus; at: Date; by: string }>;
  createdAt: Date;
  updatedAt: Date;
}

const rewardClaimSchema = new Schema<IRewardClaim>(
  {
    portal: { type: String, required: true },
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    userId: { type: String, required: true },
    userName: { type: String, default: "" },
    role: { type: String, enum: ["sales", "tl"], required: true },
    teamName: { type: String, default: "" },
    achievedAed: { type: Number, default: 0 },
    achieved: { type: Number, default: 0 },
    currency: { type: String, default: "AED" },
    targetAed: { type: Number, default: 0 },
    giftId: { type: Schema.Types.ObjectId, ref: "RewardGift", required: true },
    giftName: { type: String, required: true },
    giftCategory: { type: String, default: "" },
    giftValueAed: { type: Number, default: 0 },
    status: { type: String, enum: CLAIM_STATUSES, default: "requested" },
    live: { type: Boolean, default: true },
    note: { type: String, default: "", maxlength: 300 },
    history: {
      type: [new Schema({ status: { type: String, enum: CLAIM_STATUSES }, at: Date, by: String }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true },
);

// One gift a person a month: a second choice, from a second tab or a double click, is refused here.
rewardClaimSchema.index({ portal: 1, month: 1, userId: 1 }, { unique: true, partialFilterExpression: { live: true } });
rewardClaimSchema.index({ month: 1, createdAt: -1 });

export const RewardClaim = mongoose.model<IRewardClaim>("RewardClaim", rewardClaimSchema);
