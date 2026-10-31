import mongoose, { Schema } from "mongoose";
import type { ICommissionPlan } from "../types/index.js";

/**
 * A sales CRM's commission plan, kept in Root (the user, 2026-11-01: "read from one db, one logic, edited from
 * Root — by portal, by the employee's position, by course"). One document per portal (Sales, Draw, Remote; no
 * Bangalore): what each course pays each position on a sale, the salary slabs per position as versions by the month
 * they start, the Sales Manager and the logins that earn nothing, and the portal's team-leader rule.
 *
 * Copied once from each CRM's own plan (scripts/commission-plan-copy.ts), then edited here by root admins. The CRMs
 * keep counting with their own plan until they are switched to ask Root (a later stage).
 */
const slabRowSchema = new Schema(
  {
    name: { type: String, required: true },
    target: { type: Number, required: true, min: 0 },
    salary: { type: Number, required: true, min: 0 },
    percent: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false }
);

/** The slabs in force from `from` (YYYY-MM, UAE) until the next version — a change leaves past months as they were. */
const slabVersionSchema = new Schema(
  {
    from: { type: String, required: true },
    sales: { type: [slabRowSchema], default: [] },
    tl: { type: [slabRowSchema], default: [] },
    sm: { type: [slabRowSchema], default: [] },
    updatedAt: { type: Date, default: null },
    updatedByEmail: { type: String, default: "" },
  },
  { _id: false }
);

/** One course of the portal (its id in that CRM): what a sale of it pays each position, AED; the MT5 credit in USD. */
const courseRowSchema = new Schema(
  {
    courseId: { type: String, required: true },
    name: { type: String, default: "" },
    sales: { type: Number, default: 0, min: 0 },
    tl: { type: Number, default: 0, min: 0 },
    sm: { type: Number, default: 0, min: 0 },
    creditUsd: { type: Number, default: 0, min: 0 },
    updatedAt: { type: Date, default: null },
    updatedByEmail: { type: String, default: "" },
  },
  { _id: false }
);

/** A person of the portal, by their id in that CRM, with their name as it was when chosen. */
const personSchema = new Schema(
  { id: { type: String, required: true }, name: { type: String, default: "" } },
  { _id: false }
);

const commissionPlanSchema = new Schema<ICommissionPlan>(
  {
    portal: { type: String, enum: ["delta", "draw", "remote"], required: true, unique: true },
    tlRule: { type: String, enum: ["zero_if_sm", "never", "always"], required: true },
    /** Whether team leaders have a slab of their own (the Sales CRM); elsewhere they are on the Sales Staff slab. */
    tlSlab: { type: Boolean, default: false },
    /** Whether a team leader closing a sale in their own team is paid its TL line too (Remote) or not (the Sales CRM). */
    tlPaidOnOwnClose: { type: Boolean, default: null },
    salesManager: { type: personSchema, default: null },
    excluded: { type: [personSchema], default: [] },
    courses: { type: [courseRowSchema], default: [] },
    slabs: { type: [slabVersionSchema], default: [] },
    copiedAt: { type: Date, default: null },
    updatedByEmail: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false }
);

export const CommissionPlan = mongoose.model<ICommissionPlan>("CommissionPlan", commissionPlanSchema);
