import mongoose, { Schema, type Types } from "mongoose";

/**
 * A line the Class TV plays (the user, 2026-11-14: "text to speech never works, so record from here"): a mentor's own
 * — their name, said by whoever records it on the Mentor voices page — or one of the two common lines played after
 * it, "your class starts in five minutes" and "your class is starting". Kept here, small: the page turns every
 * recording into a short mono WAV before it comes up, which every TV browser plays.
 */
export interface IClassVoice {
  _id: Types.ObjectId;
  /** `mentor:<the LMS's id for them>`, `common:soon` or `common:now`. One recording each. */
  key: string;
  /** Whose it is, as the LMS named them when it was recorded — for this portal's own list only. */
  name: string;
  audio: Buffer;
  bytes: number;
  seconds: number;
  /** Moves on with each new recording, so a copy a TV kept of the old one is never played for it. */
  version: number;
  recordedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const classVoiceSchema = new Schema<IClassVoice>(
  {
    key: { type: String, required: true, unique: true, maxlength: 60 },
    name: { type: String, default: "", trim: true, maxlength: 120 },
    audio: { type: Buffer, required: true },
    bytes: { type: Number, required: true },
    seconds: { type: Number, default: 0 },
    version: { type: Number, default: 1 },
    recordedBy: { type: String, default: "" },
  },
  { timestamps: true },
);

export const ClassVoice = mongoose.model<IClassVoice>("ClassVoice", classVoiceSchema);
