import mongoose, { Schema } from "mongoose";
import type { IOrganization } from "../types/index.js";

const organizationSchema = new Schema<IOrganization>(
  {
    code: {
      type: String,
      enum: ["delta", "banglore", "draw", "finance-hq", "finance-banglore", "hrms"],
      required: true,
      unique: true,
    },
    name: { type: String, required: true, trim: true },
    /*
     * What kind of system this is.
     *
     * The registry began as a list of CRMs and everything in it was one. It now
     * holds everywhere a person can be sent, and those differ in ways the code
     * has to know about: a CRM is scoped to whoever works in it, HRMS is
     * somewhere every employee belongs, and finance has no Draw at all.
     *
     * Defaulted to "crm" so the three rows that predate this keep their
     * meaning without being rewritten.
     */
    kind: {
      type: String,
      enum: ["crm", "finance", "hrms"],
      default: "crm",
    },
    appUrl: { type: String, required: true, trim: true },
    apiUrl: { type: String, required: true, trim: true },

    // Read-only URI. Never exposed by any route — see orgService.toPublic().
    mongoUri: { type: String, default: "", select: false },

    timezone: { type: String, required: true },
    currency: { type: String, required: true },
    fxToBase: { type: Number, required: true, default: 1 },

    serviceEmail: { type: String, trim: true, lowercase: true, default: "" },
    /*
     * Which organization this target is *inside* the system it points at.
     *
     * Needed only where one deployment holds several. Finance is one server
     * with a Delta HQ and a Delta Banglore organization in it, so two registry
     * rows share an address and are told apart by this. A CRM is one
     * organization per deployment and leaves it blank.
     *
     * Only provisioning needs it: signing somebody in uses the memberships
     * they already have, which say where they belong without being asked.
     */
    remoteOrgId: { type: String, trim: true, default: "" },
    // Shared secret for this org's SSO endpoint. select:false so it can never
    // leak through a stray .find() that gets serialised to the browser.
    ssoSecret: { type: String, default: "", select: false },

    accent: { type: String, default: "#2563eb" },
    dataStartsAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
);

organizationSchema.index({ sortOrder: 1 });

export const Organization = mongoose.model<IOrganization>(
  "Organization",
  organizationSchema
);
