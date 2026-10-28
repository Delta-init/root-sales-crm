import type { Document } from "mongodb";
import type { CrmSource } from "./crmConnections.js";

/*
 * A Bangalore enrolment's money in Root's revenue figures (the user, 2026-10-28: "Ria's INR payment is not in the
 * reports"), read from each CRM's database as the CRMs count it themselves (their utils/bangaloreRevenue.ts):
 *
 *   • A close for the Bangalore academy in an AED CRM (Delta, Draw, Remote) is paid in rupees and kept on the
 *     enrolment, not the lead — its payments join the lead's, in AED: AED cash at its AED, rupees at the CRM's own
 *     Settings rate (appsettings.bangaloreRevenue.inrPerAed, 22.75 until changed). Not a payment that was on the lead
 *     before the close (`collectedBefore`), not a dropped enrolment; in Remote not the AED cash either, which its
 *     close puts on the lead.
 *   • A balance payment on such an enrolment is kept on the lead in rupees, marked `currency: "INR"`: left out of the
 *     AED sums (COUNTED_PAYMENT) and counted here in AED.
 *
 * The Banglore CRM is in rupees throughout: nothing to add there.
 */

export const DEFAULT_INR_PER_AED = 22.75;

/**
 * After `{ $unwind: "$payments" }`: the payments that count, as in the CRMs (utils/countedPayments.ts) — not one in
 * rupees, and a balance payment only once finance approved it.
 */
export const COUNTED_PAYMENT = {
  "payments.currency": { $ne: "INR" },
  $or: [{ "payments.finance.externalId": { $exists: false } }, { "payments.finance.state": "approved" }],
};

/** The CRM's rate: 1 AED = this many rupees. */
async function inrPerAed(src: CrmSource): Promise<number> {
  const doc = await src.conn.collection("appsettings").findOne({ key: "app" }, { projection: { bangaloreRevenue: 1 } }).catch(() => null);
  const rate = (doc as { bangaloreRevenue?: { inrPerAed?: unknown } } | null)?.bangaloreRevenue?.inrPerAed;
  return typeof rate === "number" && rate > 0 ? rate : DEFAULT_INR_PER_AED;
}

/** An enrolment's payments as lead payments in AED; `aedCashOnLead` — the CRM's close put its AED cash on the lead. */
function paymentsInAed(rate: number, aedCashOnLead: boolean) {
  const list = {
    $cond: [{ $gt: [{ $size: { $ifNull: ["$payments", []] } }, 0] }, "$payments", [{ amount: { $ifNull: ["$paidAmount", 0] }, paidAt: "$enrollmentDate" }]],
  };
  // Delta keeps AED cash as `original`; Draw and Remote as `currency` with `amountInCurrency`.
  const originalAed = { $eq: ["$$p.original.currency", "AED"] };
  const currencyAed = { $and: [{ $eq: ["$$p.currency", "AED"] }, { $gt: [{ $ifNull: ["$$p.amountInCurrency", 0] }, 0] }] };
  const keep = aedCashOnLead ? { $and: [{ $ne: ["$$p.collectedBefore", true] }, { $not: [currencyAed] }] } : { $ne: ["$$p.collectedBefore", true] };
  return {
    $filter: {
      input: {
        $map: {
          input: { $filter: { input: list, as: "p", cond: keep } },
          as: "p",
          in: {
            amount: {
              $round: [{
                $switch: {
                  branches: [{ case: originalAed, then: "$$p.original.amount" }, { case: currencyAed, then: "$$p.amountInCurrency" }],
                  default: { $divide: [{ $ifNull: ["$$p.amount", 0] }, rate] },
                },
              }, 2],
            },
            paidAt: { $ifNull: ["$$p.paidAt", "$enrollmentDate"] },
            note: { $concat: ["Bangalore enrolment · ₹", { $toString: { $ifNull: ["$$p.amount", 0] } }, " at 1 AED = ₹", { $toString: rate }] },
          },
        },
      },
      as: "p",
      cond: { $gt: ["$$p.amount", 0] },
    },
  };
}

/** A lead's rupee payments (`currency: "INR"`) in AED, finance's decision kept. */
function rupeesInAed(rate: number) {
  return {
    $map: {
      input: { $filter: { input: { $ifNull: ["$lead.payments", []] }, as: "p", cond: { $eq: ["$$p.currency", "INR"] } } },
      as: "p",
      in: {
        $mergeObjects: [
          { $arrayToObject: { $filter: { input: { $objectToArray: "$$p" }, as: "f", cond: { $ne: ["$$f.k", "currency"] } } } },
          {
            amount: { $round: [{ $divide: [{ $ifNull: ["$$p.amount", 0] }, rate] }, 2] },
            note: { $concat: ["Bangalore balance payment · ₹", { $toString: { $ifNull: ["$$p.amount", 0] } }, " at 1 AED = ₹", { $toString: rate }] },
          },
        ],
      },
    },
  };
}

/**
 * First stage(s) of a pipeline over the CRM's leads that unwinds their payments: beside the leads, one copy of each
 * Bangalore-enrolled lead carrying only its Bangalore money in AED. Follow the $unwind with COUNTED_PAYMENT, which
 * leaves the lead's own rupee payments out. None for a CRM in rupees.
 */
export async function bangaloreUnion(src: CrmSource): Promise<Document[]> {
  if (String(src.org.currency ?? "").toUpperCase() !== "AED") return [];
  const rate = await inrPerAed(src);
  return [{
    $unionWith: {
      coll: "students",
      pipeline: [
        { $match: { academy: "bangalore", status: { $ne: "dropped" } } },
        { $project: { leadId: 1, payments: paymentsInAed(rate, src.org.code === "remote") } },
        { $lookup: { from: "leads", localField: "leadId", foreignField: "_id", as: "lead", pipeline: [{ $project: { activityLogs: 0 } }] } },
        { $unwind: "$lead" },
        { $replaceWith: { $mergeObjects: ["$lead", { payments: { $concatArrays: ["$payments", rupeesInAed(rate)] } }] } },
        { $match: { "payments.0": { $exists: true } } },
      ],
    },
  }];
}
