import mongoose, { Schema, type Types } from "mongoose";

/**
 * Backups (2026-10-16): one run backs every portal up, one Backup row per portal.
 *
 * The run's `slot` is unique, and it is how two processes sharing this
 * database agree on who does the 13:30 backup: whoever creates the row first
 * runs it, the other gets a duplicate key and leaves it alone. A manual run
 * has a slot of its own ("manual-<time>").
 */

export type BackupStatus = "running" | "complete" | "failed" | "skipped";

export interface IBackupRun {
  _id: Types.ObjectId;
  slot: string;
  trigger: "scheduled" | "manual";
  triggeredBy: string;
  /** Only these portals, for a manual run of one; empty is all of them. */
  portals: string[];
  status: "running" | "complete" | "failed";
  startedAt: Date;
  finishedAt: Date | null;
}

export interface IBackupCollection {
  name: string;
  type: "collection" | "view";
  documents: number;
}

export interface IBackup {
  _id: Types.ObjectId;
  run: Types.ObjectId;
  portal: string;
  label: string;
  database: string;
  status: BackupStatus;
  /** Why it failed or was skipped, in words. */
  error: string;
  key: string;
  bytes: number;
  sha256: string;
  collections: IBackupCollection[];
  documents: number;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number;
  /** The archive was removed from R2 by the retention; the row stays as history. */
  expiredAt: Date | null;
}

const runSchema = new Schema<IBackupRun>(
  {
    slot: { type: String, required: true, unique: true },
    trigger: { type: String, enum: ["scheduled", "manual"], required: true },
    triggeredBy: { type: String, default: "" },
    portals: { type: [String], default: [] },
    status: { type: String, enum: ["running", "complete", "failed"], default: "running" },
    startedAt: { type: Date, default: () => new Date() },
    finishedAt: { type: Date, default: null },
  },
  { collection: "backup_runs" }
);
runSchema.index({ startedAt: -1 });

const backupSchema = new Schema<IBackup>(
  {
    run: { type: Schema.Types.ObjectId, ref: "BackupRun", required: true },
    portal: { type: String, required: true },
    label: { type: String, default: "" },
    database: { type: String, default: "" },
    status: { type: String, enum: ["running", "complete", "failed", "skipped"], default: "running" },
    error: { type: String, default: "" },
    key: { type: String, default: "" },
    bytes: { type: Number, default: 0 },
    sha256: { type: String, default: "" },
    collections: {
      type: [{ _id: false, name: String, type: { type: String }, documents: Number }],
      default: [],
    },
    documents: { type: Number, default: 0 },
    startedAt: { type: Date, default: () => new Date() },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: 0 },
    expiredAt: { type: Date, default: null },
  },
  { collection: "backups" }
);
backupSchema.index({ run: 1, portal: 1 }, { unique: true });
backupSchema.index({ portal: 1, startedAt: -1 });

export const BackupRun = mongoose.model<IBackupRun>("BackupRun", runSchema);
export const Backup = mongoose.model<IBackup>("Backup", backupSchema);
