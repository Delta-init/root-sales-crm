import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { TrafficLead } from "../models/TrafficLead.js";
import { TrafficStatusLink } from "../models/TrafficStatusLink.js";
import { getSources } from "./crmConnections.js";
import { ORGS, cleanPhone, phoneTail } from "./trafficService.js";
import type { TrafficOrg } from "../types/index.js";

/*
 * Each lead-sheet row's status in its CRM, written back into the sheet's "CRM Status" column (the user, 2026-11-16:
 * "the linked sheets get back the lead status — status only, every 30 minutes, backfilled"). Read-only: the CRMs'
 * databases are read over the same connections the reports and the duplicate check use; nothing is written to them.
 *
 * Which lead a row is: where Root sent it (TrafficLead.destination + crmLeadId); else — a duplicate, or a row the old
 * scripts sent before Root (✅ SYNCED) — the lead with the same last nine phone digits, the CRM that heard from them
 * last. Found once, it is kept (TrafficStatusLink); not found anywhere, looked for again a day later.
 */

export interface StatusRow { id?: unknown; tab?: unknown; created_time?: unknown; phone_number?: unknown }
export interface RowStatus { status: string; crm: TrafficOrg | null }

const MISS_RETRY_MS = 24 * 3_600_000;

/** Each CRM's own words for its statuses (lib/statusConfig.ts in the CRMs' webs). */
const LABELS: Record<string, string> = {
  new: "New", assigned: "Assigned", pending_response: "Pending Response", followup: "Follow Up", closed: "Closed", lost: "Lost",
  not_connected: "Not Connected", mia: "MIA", repeated: "Repeated", callback: "Call Back", cnc: "CNC",
  meeting_scheduled: "Meeting Scheduled", meeting_done: "Meeting Done", wrong_number: "Wrong Number",
};
export const statusLabel = (s: unknown): string => {
  const k = String(s ?? "").trim();
  if (!k) return "";
  return LABELS[k] ?? k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** The row's key as the intake makes it (trafficService.parseRow): Meta's lead id, else the row itself. */
export function rowKey(raw: StatusRow): { sourceKey: string; phone9: string } {
  // The same limits as the intake's (trafficService.intakeRowSchema), so the key is the same one.
  const id = text(raw.id, 100), tab = text(raw.tab, 200), created = text(raw.created_time, 60);
  const phone = cleanPhone(text(raw.phone_number, 60));
  return {
    sourceKey: id ? `meta:${id}` : `row:${createHash("sha1").update(`${tab}|${phone}|${created}`).digest("hex")}`,
    phone9: phoneTail(phone),
  };
}

/** By the last nine phone digits, in every CRM: the one that heard from them last. */
async function byPhone(tails: string[], sources: Awaited<ReturnType<typeof getSources>>["sources"]): Promise<Map<string, { org: TrafficOrg; leadId: string }>> {
  const found = new Map<string, { org: TrafficOrg; leadId: string; at: number }>();
  const wanted = [...new Set(tails.filter((t) => t.length === 9))];
  if (!wanted.length) return new Map();
  await Promise.all(sources.filter((s) => (ORGS as string[]).includes(s.org.code)).map(async (s) => {
    const org = s.org.code as TrafficOrg;
    try {
      const leads = await s.conn.collection("leads")
        .find({ phone: { $in: wanted.map((t) => new RegExp(`${t}$`)) } }, { projection: { phone: 1, createdAt: 1, updatedAt: 1 }, maxTimeMS: 20_000 })
        .toArray();
      for (const l of leads) {
        const tail = phoneTail(String(l.phone ?? ""));
        const at = Math.max(l.updatedAt instanceof Date ? l.updatedAt.getTime() : 0, l.createdAt instanceof Date ? l.createdAt.getTime() : 0);
        const prior = found.get(tail);
        if (!prior || at > prior.at) found.set(tail, { org, leadId: String(l._id), at });
      }
    } catch { /* that CRM unreadable now: those rows keep their last status in the sheet */ }
  }));
  return new Map([...found].map(([k, v]) => [k, { org: v.org, leadId: v.leadId }]));
}

/** The statuses of up to 200 rows, in their order. A row whose lead cannot be found or read: status "". */
export async function leadStatuses(rows: StatusRow[], now = new Date()): Promise<RowStatus[]> {
  const keys = rows.map(rowKey);
  const sourceKeys = [...new Set(keys.map((k) => k.sourceKey))];
  const [sent, links] = await Promise.all([
    TrafficLead.find({ sourceKey: { $in: sourceKeys } }).select("sourceKey destination crmLeadId status").lean(),
    TrafficStatusLink.find({ sourceKey: { $in: sourceKeys } }).lean(),
  ]);
  const where = new Map<string, { org: TrafficOrg; leadId: string }>();
  const linkOf = new Map(links.map((l) => [l.sourceKey, l]));
  for (const t of sent) {
    if (t.destination && t.crmLeadId && Types.ObjectId.isValid(t.crmLeadId)) where.set(t.sourceKey, { org: t.destination as TrafficOrg, leadId: t.crmLeadId });
  }
  for (const l of links) {
    if (!where.has(l.sourceKey) && l.org && l.leadId) where.set(l.sourceKey, { org: l.org as TrafficOrg, leadId: l.leadId });
  }

  const { sources } = await getSources();
  // Not known yet (and not given up on for today): looked for by phone.
  const unknown = keys.filter((k) => !where.has(k.sourceKey) && !(linkOf.get(k.sourceKey)?.missUntil && linkOf.get(k.sourceKey)!.missUntil! > now));
  if (unknown.length) {
    const hits = await byPhone(unknown.map((k) => k.phone9), sources);
    const ops = [];
    for (const k of unknown) {
      const hit = hits.get(k.phone9);
      if (hit) where.set(k.sourceKey, hit);
      ops.push({
        updateOne: {
          filter: { sourceKey: k.sourceKey },
          update: { $set: hit ? { phone9: k.phone9, org: hit.org, leadId: hit.leadId, missUntil: null } : { phone9: k.phone9, org: null, leadId: "", missUntil: new Date(now.getTime() + MISS_RETRY_MS) } },
          upsert: true,
        },
      });
    }
    if (ops.length) await TrafficStatusLink.bulkWrite(ops, { ordered: false });
  }

  // The statuses, one read per CRM.
  const status = new Map<string, string>(); // org:leadId → status
  const gone: string[] = [];
  await Promise.all(sources.filter((s) => (ORGS as string[]).includes(s.org.code)).map(async (s) => {
    const org = s.org.code as TrafficOrg;
    const ids = [...new Set([...where.values()].filter((w) => w.org === org).map((w) => w.leadId))].filter((id) => Types.ObjectId.isValid(id));
    if (!ids.length) return;
    try {
      const leads = await s.conn.collection("leads")
        .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }, { projection: { status: 1 }, maxTimeMS: 20_000 })
        .toArray();
      const seen = new Set(leads.map((l) => String(l._id)));
      for (const l of leads) status.set(`${org}:${String(l._id)}`, statusLabel(l.status));
      for (const id of ids) if (!seen.has(id)) gone.push(`${org}:${id}`);
    } catch { /* unreadable now */ }
  }));
  // A remembered lead that is gone (deleted or merged): forgotten, looked for by phone next time.
  if (gone.length) {
    const goneSet = new Set(gone);
    const stale = [...where].filter(([, w]) => goneSet.has(`${w.org}:${w.leadId}`)).map(([k]) => k);
    if (stale.length) await TrafficStatusLink.deleteMany({ sourceKey: { $in: stale } });
  }

  return keys.map((k) => {
    const w = where.get(k.sourceKey);
    return w ? { status: status.get(`${w.org}:${w.leadId}`) ?? "", crm: w.org } : { status: "", crm: null };
  });
}
