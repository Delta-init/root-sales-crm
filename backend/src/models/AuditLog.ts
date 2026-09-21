import mongoose, { Schema } from "mongoose";
import type { IAuditLog } from "../types/index.js";

// Every portal login and every SSO launch lands here. This app is a single key
// to three production systems, so "who opened what, when" has to be answerable.
const auditLogSchema = new Schema<IAuditLog>(
  {
    admin: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
    adminEmail: { type: String, default: "", trim: true, lowercase: true },
    action: {
      type: String,
      enum: [
        "login",
        "login_failed",
        "logout",
        "sso_launch",
        "sso_launch_failed",
        "report_view",
        "access_granted",
        "access_revoked",
        "portal_role_changed",
        "target_registered",
        "target_updated",
        "account_provisioned",
        "people_imported",
        "role_map_changed",
        "account_deactivated",
        "account_deleted",
        /*
         * Looking at the portal as somebody else, and going through a door
         * while doing it.
         *
         * Both are recorded against whoever is really holding the session,
         * never the account being worn — which is the entire reason these
         * exist. This list and the AuditAction type have to agree: writes
         * here are swallowed on purpose so auditing can never break the
         * request it is recording, so an action missing from this enum is
         * silently not recorded at all.
         */
        "impersonation_started",
        "impersonation_launch",
        // An hour taken in somebody else's week, arranged from here.
        "mentor_meeting_booked",
      ],
      required: true,
    },
    // Every target, since a launch into finance or HRMS is logged like any
    // other. Null for entries that are not about one place — a grant names the
    // target in its detail instead.
    org: {
      type: String,
      enum: ["delta", "banglore", "draw", "finance-hq", "finance-banglore", "hrms", "lms", "media-erp", null],
      default: null,
    },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    detail: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ admin: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export const AuditLog = mongoose.model<IAuditLog>("AuditLog", auditLogSchema);
