import mongoose, { Schema, type Types } from "mongoose";

/**
 * The office TVs' photos and videos (2026-11-02): every public TV — Root's Sales TV and Manager TV, the four CRMs'
 * leaderboards, the CS Portal TV and the HRMS pod board — shows the ones meant for it, then its own board for a minute,
 * and again. Root admins upload and arrange them on the TV media page.
 */
export interface ITvMedia {
  _id: Types.ObjectId;
  kind: "image" | "video";
  /** Where the file is in the TV media bucket. */
  key: string;
  name: string;
  mime: string;
  size: number;
  /** A video's length as the browser read it before uploading; it plays to the end on the TVs. 0 for a photo. */
  durationSec: number;
  /** How long a photo stays up. */
  seconds: number;
  /** Every TV, or only `screens`. */
  allScreens: boolean;
  screens: string[];
  order: number;
  active: boolean;
  /** Shown from / until these Dubai days (YYYY-MM-DD) when given. */
  fromDay: string;
  toDay: string;
  addedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const tvMediaSchema = new Schema<ITvMedia>(
  {
    kind: { type: String, enum: ["image", "video"], required: true },
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    durationSec: { type: Number, default: 0 },
    seconds: { type: Number, default: 10, min: 3, max: 300 },
    allScreens: { type: Boolean, default: true },
    screens: { type: [String], default: [] },
    order: { type: Number, default: 0, index: true },
    active: { type: Boolean, default: true },
    fromDay: { type: String, default: "" },
    toDay: { type: String, default: "" },
    addedBy: { type: String, default: "" },
  },
  { timestamps: true },
);

export const TvMedia = mongoose.model<ITvMedia>("TvMedia", tvMediaSchema);

/** One TV's own timing: its board stays up `boardSeconds` between the photos; `enabled` false shows the board only. */
export interface ITvScreen {
  key: string;
  boardSeconds: number;
  enabled: boolean;
  updatedBy: string;
}

const tvScreenSchema = new Schema<ITvScreen>(
  {
    key: { type: String, required: true, unique: true },
    boardSeconds: { type: Number, default: 60, min: 10, max: 3600 },
    enabled: { type: Boolean, default: true },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true },
);

export const TvScreen = mongoose.model<ITvScreen>("TvScreen", tvScreenSchema);
