import mongoose, { Schema, type Types } from "mongoose";

/**
 * A lead moved from one sales CRM to another (the user, 2026-11-19: "option to transfer between crms"). The CRM it
 * left asks Root; Root hands it to the other CRM through that CRM's own door and keeps this row — who moved what where,
 * what the other CRM did with it, and whether it was taken back (Undo, within 24 hours).
 */
export interface ICrmLeadMove {
  _id: Types.ObjectId;
  /** Which CRM it left and which it went to: delta (Sales), draw, remote. */
  from: string;
  to: string;
  fromLeadId: string;
  /** The lead in the other CRM: a new one, or the one it already had for that number. */
  toLeadId: string;
  /** created: a new lead there. repeat: it had the number already — with that lead's team leader to verify. */
  outcome: "created" | "repeat";
  /** Who has it there, when the other CRM said. */
  holder: string;
  name: string;
  phone: string;
  /** person / team (split across one team) / split (the other CRM's own split). */
  mode: "person" | "team" | "split";
  teamName: string;
  personName: string;
  byName: string;
  /** Who it belonged to in the CRM it left, and its status there. */
  ownerName: string;
  status: string;
  undoneAt: Date | null;
  undoneBy: string;
  createdAt: Date;
}

const crmLeadMoveSchema = new Schema<ICrmLeadMove>(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    fromLeadId: { type: String, required: true },
    toLeadId: { type: String, default: "" },
    outcome: { type: String, enum: ["created", "repeat"], required: true },
    holder: { type: String, default: "" },
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    mode: { type: String, enum: ["person", "team", "split"], required: true },
    teamName: { type: String, default: "" },
    personName: { type: String, default: "" },
    byName: { type: String, default: "" },
    ownerName: { type: String, default: "" },
    status: { type: String, default: "" },
    undoneAt: { type: Date, default: null },
    undoneBy: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: "crm_lead_moves" },
);
crmLeadMoveSchema.index({ createdAt: -1 });
crmLeadMoveSchema.index({ from: 1, fromLeadId: 1 });

export const CrmLeadMove = mongoose.model<ICrmLeadMove>("CrmLeadMove", crmLeadMoveSchema);
