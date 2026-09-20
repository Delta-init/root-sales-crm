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
    /*
     * Where this system lives and how to reach it is NOT here.
     *
     * The addresses, the database URI, the shared secret and the remote
     * organization id all come from the environment — see config/targets.ts.
     * They used to be set in the environment, copied into this collection by
     * the bootstrap seed and then edited from a Registry screen, which meant
     * two sources of truth and the one being edited was the copy.
     *
     * A consequence worth keeping: a dump of this database now contains no
     * service credential and no connection string.
     *
     * What remains here is what a system *is* to the business — none of it
     * opens anything.
     */
    timezone: { type: String, required: true },
    currency: { type: String, required: true },
    fxToBase: { type: Number, required: true, default: 1 },

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
