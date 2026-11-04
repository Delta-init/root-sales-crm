import mongoose, { Schema, type Types } from "mongoose";

/**
 * A gift the sales CRMs offer for reaching a month's target (the user, 2026-11-04): a salesperson who closes AED 50,000
 * in a month takes home a gift worth up to AED 2,000; a team leader whose team closes AED 100,000, gifts worth up to
 * AED 3,000. Kept here once for every CRM; each shows a person the gifts their tier covers. The photo is kept with it,
 * small: the Rewards page shrinks it before it comes up.
 */
export interface IRewardGift {
  _id: Types.ObjectId;
  name: string;
  category: string;
  /** What it costs, in AED. A tier sees the gifts its gift value covers. */
  valueAed: number;
  photo: Buffer | null;
  photoType: string;
  /** Moves on with each new photo, so a copy cached for the old one is never shown for it. */
  photoVersion: number;
  active: boolean;
  order: number;
  /** The built-in gift this began as; "" for one added on the Rewards page. */
  seedKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const rewardGiftSchema = new Schema<IRewardGift>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    category: { type: String, required: true, trim: true, maxlength: 40 },
    valueAed: { type: Number, required: true, min: 1, max: 1_000_000 },
    photo: { type: Buffer, default: null },
    photoType: { type: String, default: "" },
    photoVersion: { type: Number, default: 1 },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    seedKey: { type: String, default: "" },
  },
  { timestamps: true },
);

// One copy of each built-in gift, however many requests find the list empty at once.
rewardGiftSchema.index({ seedKey: 1 }, { unique: true, partialFilterExpression: { seedKey: { $gt: "" } } });

export const RewardGift = mongoose.model<IRewardGift>("RewardGift", rewardGiftSchema);
