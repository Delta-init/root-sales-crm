import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { z } from "zod";
import { TrafficRule } from "../models/TrafficRule.js";
import { TrafficLead } from "../models/TrafficLead.js";
import { Organization } from "../models/Organization.js";
import { getSources } from "./crmConnections.js";
import { postIntakeBatch, intakeConfig, type IntakeRow } from "../lib/crmIntakeClient.js";
import { env } from "../config/env.js";
import type {
  ITrafficLead,
  ITrafficRule,
  TrafficOrg,
  TrafficSegment,
  TrafficShare,
  TrafficStatus,
} from "../types/index.js";

/**
 * Lead traffic: the Meta lead sheet's leads, split between the Delta and Draw
 * CRMs.
 *
 * The sheet posts every new row here instead of into a CRM. Each lead is put
 * in its segment — UK (the UK tab), GCC (the Gulf tabs: UAE & Qatar, and the
 * GCC tab) or Hindi (the Hindi tab) — checked against everyone already sent or
 * already in either CRM, and given
 * to whichever CRM is furthest behind its share of that segment. It is then
 * posted into that CRM's own sheet intake, which shares it out across that
 * CRM's teams exactly as it did when the sheet posted there directly. A CRM
 * that cannot take it right now does not lose it: it waits here and is tried
 * again.
 */

const RULE_KEY = "sheet";
export const ORGS: TrafficOrg[] = ["delta", "draw"];
export const SEGMENTS: TrafficSegment[] = ["uk", "gcc", "hindi"];
export const SEGMENT_LABEL: Record<TrafficSegment, string> = { uk: "UK", gcc: "GCC", hindi: "Hindi" };
const SHORT: Record<TrafficOrg, string> = { delta: "Delta", draw: "Draw" };

/** Past this many tries a lead stops being retried on its own and waits for a person. */
const MAX_ATTEMPTS = 48;
/** A lead claimed for sending this long ago was lost with its process; it is tried again. */
const STALE_CLAIM_MS = 5 * 60_000;

/**
 * The source each CRM records, by tab — the labels the sheet's own script used,
 * so reports in the CRMs read the same before and after.
 */
export const SOURCE = {
  uk: "FOREX LEADS ALPHA UK",
  gcc: "FOREX LEADS ALPHA GCC",
  hindi: "FOREX LEADS ALPHA HINDI",
} as const;

export function classifyTab(tab: string): { segment: TrafficSegment; source: string } {
  const t = tab.toLowerCase();
  if (t.includes("hindi")) return { segment: "hindi", source: SOURCE.hindi };
  // "UK" as a word: "Abhin | UK | New" is, "Kuwait" is not.
  if (/(^|[^a-z])uk([^a-z]|$)/.test(t)) return { segment: "uk", source: SOURCE.uk };
  // Everything else is a Gulf tab: UAE & Qatar, and the GCC tab.
  return { segment: "gcc", source: SOURCE.gcc };
}

/**
 * Where things start, the first time.
 *
 * Half and half in each segment. The two people named are the ones the sheet's
 * own script used on 30 September 2026: Hindi leads going into Delta were
 * handed straight to Lubna, and every lead into Delta was recorded as added by
 * the same account. Both are ordinary settings from here on, changed on the
 * Lead traffic page.
 */
const DEFAULT_RULE = {
  paused: false,
  version: 1,
  segments: {
    uk: [
      { org: "delta", percent: 50, assignTo: null },
      { org: "draw", percent: 50, assignTo: null },
    ],
    gcc: [
      { org: "delta", percent: 50, assignTo: null },
      { org: "draw", percent: 50, assignTo: null },
    ],
    hindi: [
      { org: "delta", percent: 50, assignTo: { id: "6a7d78a7aa93812c05d38466", name: "Lubna" } },
      { org: "draw", percent: 50, assignTo: null },
    ],
  },
  reporters: { delta: "69ef14534e41f5008be375d2", draw: "" },
};

/**
 * UK and GCC used to be one segment, "UK & GCC".
 *
 * A split saved then is carried over rather than reset: UK and GCC each start
 * with what "UK & GCC" had — the same percentages and the same person, if one
 * was named — and the count starts again, since the two are now split
 * separately. Leads recorded under it are put in UK or GCC by the tab they came
 * from, which is what their source label already says.
 *
 * Looked for on every read, not once at start-up: it is one lookup on a unique
 * key, and a rule restored from a backup should not stay half-converted until
 * somebody restarts the server.
 */
async function splitLegacySegments(): Promise<void> {
  const legacy = await TrafficRule.collection.findOne(
    { key: RULE_KEY, "segments.uk_gcc": { $exists: true } },
    { projection: { "segments.uk_gcc": 1 } },
  );
  if (!legacy) return;
  const shares = (legacy.segments as { uk_gcc: unknown[] }).uk_gcc;
  await TrafficRule.collection.updateOne(
    { key: RULE_KEY, "segments.uk_gcc": { $exists: true } },
    { $set: { "segments.uk": shares, "segments.gcc": shares }, $unset: { "segments.uk_gcc": "" }, $inc: { version: 1 } },
  );
  await TrafficLead.collection.updateMany({ segment: "uk_gcc", source: SOURCE.uk }, { $set: { segment: "uk" } });
  await TrafficLead.collection.updateMany({ segment: "uk_gcc" }, { $set: { segment: "gcc" } });
}

export async function getRule(): Promise<ITrafficRule> {
  await splitLegacySegments();
  const found = await TrafficRule.findOne({ key: RULE_KEY });
  if (found) return found;
  // Upsert rather than create, so two first requests cannot make two rules.
  await TrafficRule.updateOne({ key: RULE_KEY }, { $setOnInsert: { key: RULE_KEY, ...DEFAULT_RULE } }, { upsert: true });
  return (await TrafficRule.findOne({ key: RULE_KEY }))!;
}

// ── One decision at a time ───────────────────────────────────────────────────

/**
 * Deciding is done one lead after another.
 *
 * The split is "whoever is furthest behind gets the next one", which is only
 * true if nothing else decides in between. The sheet's script already runs one
 * batch at a time; this makes the portal not depend on that.
 */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export const cleanPhone = (raw: unknown) =>
  String(raw ?? "").trim().replace(/^p:/i, "").replace(/\s+/g, "");
/** The last nine digits: +971 50…, 971 50… and 050… are one person. */
export const phoneTail = (phone: string) => phone.replace(/\D/g, "").slice(-9);

const mapPlatform = (raw: string) => {
  const p = raw.trim().toLowerCase();
  if (p === "fb" || p === "facebook") return "facebook";
  if (p === "ig" || p === "instagram") return "instagram";
  return "meta";
};

const text = (max: number) =>
  z.union([z.string(), z.number(), z.boolean()]).optional().nullable()
    .transform((v) => (v === undefined || v === null ? "" : String(v).trim().slice(0, max)));

/** A row as the sheet sends it. Everything is text; the sheet decides nothing. */
export const intakeRowSchema = z.object({
  id: text(100),
  tab: text(200),
  created_time: text(60),
  full_name: text(200),
  phone_number: text(60),
  email: text(200),
  platform: text(50),
  campaign_name: text(200),
  ad_name: text(300),
  is_organic: text(10),
});

interface ParsedRow {
  sourceKey: string;
  metaId: string;
  tab: string;
  segment: TrafficSegment;
  source: string;
  name: string;
  phone: string;
  phone9: string;
  email: string;
  platform: string;
  campaign: string;
  adName: string;
  isOrganic: boolean;
  createdTime: Date | null;
  /** Why the lead cannot be sent, if it cannot. */
  problem: string;
}

function parseRow(raw: z.output<typeof intakeRowSchema>): ParsedRow {
  const phone = cleanPhone(raw.phone_number);
  const { segment, source } = classifyTab(raw.tab);
  const created = raw.created_time ? new Date(raw.created_time) : null;
  const createdTime = created && !Number.isNaN(created.getTime()) ? created : null;
  const email = /^\S+@\S+\.\S+$/.test(raw.email) ? raw.email.toLowerCase() : "";
  // Meta's lead id is the lead; without one, the row itself is.
  const sourceKey = raw.id
    ? `meta:${raw.id}`
    : `row:${createHash("sha1").update(`${raw.tab}|${phone}|${raw.created_time}`).digest("hex")}`;

  const joined = `${raw.full_name} ${raw.phone_number}`.toLowerCase();
  let problem = "";
  if (!raw.tab) problem = "No tab name";
  else if (joined.includes("test lead") || joined.includes("dummy data")) problem = "Meta test lead";
  else if (!raw.full_name || raw.full_name.toLowerCase() === "nan") problem = "No name";
  else if (phone.replace(/\D/g, "").length < 7) problem = "No usable phone number";
  else if (!createdTime) problem = "No created time";

  return {
    sourceKey,
    metaId: raw.id,
    tab: raw.tab,
    segment,
    source,
    name: raw.full_name,
    phone,
    phone9: phoneTail(phone),
    email,
    platform: mapPlatform(raw.platform),
    campaign: raw.campaign_name,
    adName: raw.ad_name,
    isOrganic: raw.is_organic.toLowerCase() === "true",
    createdTime,
    problem,
  };
}

// ── What the sheet is told ───────────────────────────────────────────────────

export interface RowResult {
  index: number;
  status: TrafficStatus;
  destination: TrafficOrg | null;
  /** Written into the sheet's CRM Sync column as it is. */
  label: string;
  crmLeadId?: string;
  reason?: string;
}

export function sheetLabel(doc: Pick<ITrafficLead, "status" | "destination" | "note" | "lastError">): string {
  const who = doc.destination ? SHORT[doc.destination] : "";
  switch (doc.status) {
    case "sent":
      return `✅ ${who}`;
    case "duplicate":
      return `⚠️ Duplicate · ${who}`;
    case "invalid":
      return `❌ Invalid: ${doc.note || doc.lastError || "rejected"}`.slice(0, 150);
    case "held":
      return `⏸ Paused · ${who}`;
    case "failed":
      return `❌ Failed · ${who} — see Root`;
    default:
      return `⏳ Waiting · ${who}`;
  }
}

const resultFor = (index: number, doc: ITrafficLead): RowResult => ({
  index,
  status: doc.status,
  destination: doc.destination,
  label: sheetLabel(doc),
  ...(doc.crmLeadId ? { crmLeadId: doc.crmLeadId } : {}),
  ...(doc.note || doc.lastError ? { reason: doc.note || doc.lastError } : {}),
});

// ── Who is already somewhere ─────────────────────────────────────────────────

interface KnownLead {
  org: TrafficOrg;
  leadId: string;
  at: number;
}

/**
 * Which of these people each CRM already has.
 *
 * Read straight from the CRMs' databases, over the read-only connections the
 * reports already use, and matched on the last nine digits — so somebody the
 * Dubai desk has had since last year is not quietly copied into Draw because
 * they filled in a form again. A CRM that cannot be read is named rather than
 * guessed about: its own duplicate check still runs when the lead is posted.
 */
async function knownInCrms(tails: string[]): Promise<{ known: Map<string, KnownLead>; unreadable: TrafficOrg[] }> {
  const known = new Map<string, KnownLead>();
  const unreadable: TrafficOrg[] = [];
  const wanted = [...new Set(tails.filter((t) => t.length === 9))];
  if (!wanted.length) return { known, unreadable };

  const { sources, failures } = await getSources();
  for (const f of failures) if ((ORGS as string[]).includes(f.code)) unreadable.push(f.code as TrafficOrg);

  await Promise.all(
    sources
      .filter((s) => (ORGS as string[]).includes(s.org.code))
      .map(async (s) => {
        const org = s.org.code as TrafficOrg;
        try {
          const found = await s.conn
            .collection("leads")
            .find(
              { phone: { $in: wanted.map((t) => new RegExp(`${t}$`)) } },
              { projection: { phone: 1, createdAt: 1 } },
            )
            .toArray();
          for (const lead of found) {
            const tail = phoneTail(String(lead.phone ?? ""));
            const at = lead.createdAt instanceof Date ? lead.createdAt.getTime() : 0;
            const prior = known.get(tail);
            // In both CRMs: the one that has heard from them most recently.
            if (!prior || at > prior.at) known.set(tail, { org, leadId: String(lead._id), at });
          }
        } catch {
          unreadable.push(org);
        }
      }),
  );
  return { known, unreadable };
}

// ── The split ────────────────────────────────────────────────────────────────

async function splitCounts(segment: TrafficSegment, version: number): Promise<Record<TrafficOrg, number>> {
  const rows = await TrafficLead.aggregate<{ _id: TrafficOrg; n: number }>([
    { $match: { segment, ruleVersion: version, counted: true } },
    { $group: { _id: "$destination", n: { $sum: 1 } } },
  ]);
  const out: Record<TrafficOrg, number> = { delta: 0, draw: 0 };
  for (const r of rows) if (r._id in out) out[r._id] = r.n;
  return out;
}

/**
 * Whoever is furthest behind their share gets the next lead.
 *
 * Measured as leads so far divided by percent, lowest first; a tie goes to the
 * larger share, then to the order the shares are listed in. At 50/50 that is
 * simply taking turns, and at 70/30 it never drifts more than a lead from the
 * target, however the day goes.
 */
export function pickShare(shares: TrafficShare[], counts: Record<TrafficOrg, number>): TrafficShare | null {
  let best: TrafficShare | null = null;
  for (const s of shares) {
    if (s.percent <= 0) continue;
    if (!best) {
      best = s;
      continue;
    }
    const a = counts[s.org] / s.percent;
    const b = counts[best.org] / best.percent;
    if (a < b || (a === b && s.percent > best.percent)) best = s;
  }
  return best;
}

// ── Taking a batch from the sheet ────────────────────────────────────────────

export async function intake(rows: unknown[]): Promise<{ results: RowResult[]; summary: Record<string, number> }> {
  const results: RowResult[] = [];
  const toSend: { index: number; doc: ITrafficLead }[] = [];

  await serial(async () => {
    // The unique key on Meta's lead id is what makes a resend harmless, and
    // Mongoose builds it in the background after start-up. Wait for it (a
    // no-op once built), so the first batch after a deploy cannot slip in twice.
    await TrafficLead.init();
    const rule = await getRule();
    const parsed = rows.map((r) => intakeRowSchema.safeParse(r));
    const tails = parsed.flatMap((p) => (p.success ? [phoneTail(cleanPhone(p.data.phone_number))] : []));
    const { known, unreadable } = await knownInCrms(tails);
    const counts: Partial<Record<TrafficSegment, Record<TrafficOrg, number>>> = {};

    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      if (!p.success) {
        results.push({ index: i, status: "invalid", destination: null, label: "❌ Invalid: unreadable row", reason: "unreadable row" });
        continue;
      }
      const row = parseRow(p.data);

      // A lead seen before is answered from what was decided then. The one
      // exception is a row turned away here for missing something: it may
      // have been fixed in the sheet since, so it is looked at again.
      const existing = await TrafficLead.findOne({ sourceKey: row.sourceKey });
      if (existing && !(existing.status === "invalid" && existing.reason === "invalid")) {
        results.push(resultFor(i, existing));
        continue;
      }

      const base = {
        sourceKey: row.sourceKey, metaId: row.metaId, tab: row.tab, segment: row.segment, source: row.source,
        name: row.name, phone: row.phone, phone9: row.phone9, email: row.email, platform: row.platform,
        campaign: row.campaign, adName: row.adName, isOrganic: row.isOrganic, createdTime: row.createdTime,
      };

      let decision: Partial<ITrafficLead>;
      if (row.problem) {
        decision = { destination: null, reason: "invalid", counted: false, status: "invalid", note: row.problem };
      } else {
        const prior = await TrafficLead.findOne({
          phone9: row.phone9,
          destination: { $ne: null },
          status: { $ne: "invalid" },
          sourceKey: { $ne: row.sourceKey },
        }).sort({ receivedAt: -1 });
        const inCrm = known.get(row.phone9);

        if (prior?.destination) {
          decision = {
            destination: prior.destination, reason: "known", counted: false, status: "duplicate",
            crmLeadId: prior.crmLeadId,
            note: `Already sent to ${SHORT[prior.destination]} on ${prior.receivedAt.toISOString().slice(0, 10)}`,
          };
        } else if (inCrm) {
          decision = {
            destination: inCrm.org, reason: "known", counted: false, status: "duplicate",
            crmLeadId: inCrm.leadId, note: `Already in ${SHORT[inCrm.org]}`,
          };
        } else {
          const shares = rule.segments[row.segment] ?? [];
          counts[row.segment] ??= await splitCounts(row.segment, rule.version);
          const share = pickShare(shares, counts[row.segment]!);
          if (!share) {
            decision = {
              destination: null, reason: "invalid", counted: false, status: "invalid",
              note: `No CRM has a share of ${SEGMENT_LABEL[row.segment]}`,
            };
          } else {
            counts[row.segment]![share.org] += 1;
            decision = {
              destination: share.org, reason: "split", counted: true, ruleVersion: rule.version,
              assignTo: share.assignTo ? { id: share.assignTo.id, name: share.assignTo.name } : null,
              status: rule.paused ? "held" : "sending",
              claimedAt: rule.paused ? null : new Date(),
              note: unreadable.length
                ? `Could not check ${unreadable.map((o) => SHORT[o]).join(" and ")} for an existing lead`
                : "",
            };
          }
        }
      }

      const doc = await TrafficLead.findOneAndUpdate(
        { sourceKey: row.sourceKey },
        { $set: { ...base, ...decision, receivedAt: existing?.receivedAt ?? new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      if (doc.status === "sending") toSend.push({ index: i, doc });
      results.push(resultFor(i, doc));
    }
  });

  // Posting happens after deciding, and outside the queue: a slow CRM must not
  // hold up the next batch's decisions.
  if (toSend.length) {
    const sent = await sendLeads(toSend.map((t) => t.doc));
    const byId = new Map(sent.map((d) => [String(d._id), d]));
    for (const t of toSend) {
      const fresh = byId.get(String(t.doc._id));
      if (fresh) results[results.findIndex((r) => r.index === t.index)] = resultFor(t.index, fresh);
    }
  }

  const summary: Record<string, number> = {};
  for (const r of results) summary[r.status] = (summary[r.status] ?? 0) + 1;
  return { results, summary };
}

// ── Posting into the CRMs ────────────────────────────────────────────────────

const backoffMs = (attempts: number) => Math.min(2 ** Math.max(0, attempts - 1), 60) * 60_000;

function toIntakeRow(doc: ITrafficLead, reporter: string): IntakeRow {
  return {
    full_name: doc.name,
    phone_number: doc.phone,
    platform: doc.platform || "meta",
    source: doc.source,
    ...(doc.email ? { email: doc.email } : {}),
    ...(doc.adName ? { ad_creative: doc.adName } : {}),
    ...(doc.campaign ? { campaign_name: doc.campaign } : {}),
    ...(doc.createdTime ? { created_time: doc.createdTime.toISOString() } : {}),
    ...(doc.metaId ? { id: doc.metaId } : {}),
    ...(doc.isOrganic ? { is_organic: "true" } : {}),
    ...(reporter ? { reporter } : {}),
    ...(doc.assignTo?.id ? { assigned_to: doc.assignTo.id } : {}),
  };
}

/**
 * Post leads already claimed for sending, and record what each CRM said.
 *
 * Grouped by CRM, in batches the intakes accept. A CRM that answers for a lead
 * decides its fate; a CRM that cannot be reached, or refuses the whole batch,
 * leaves every lead in it waiting to be tried again, later each time.
 */
export async function sendLeads(docs: ITrafficLead[]): Promise<ITrafficLead[]> {
  const rule = await getRule();
  const out: ITrafficLead[] = [];

  for (const org of ORGS) {
    const mine = docs.filter((d) => d.destination === org);
    for (let at = 0; at < mine.length; at += 100) {
      const chunk = mine.slice(at, at + 100);
      const now = new Date();
      let results: Awaited<ReturnType<typeof postIntakeBatch>> | null = null;
      let error = "";
      try {
        results = await postIntakeBatch(org, chunk.map((d) => toIntakeRow(d, rule.reporters?.[org] ?? "")));
      } catch (e) {
        error = `${SHORT[org]} ${(e as Error).message}`;
      }

      for (let i = 0; i < chunk.length; i++) {
        const doc = chunk[i];
        const attempts = (doc.attempts ?? 0) + 1;
        const r = results?.find((x) => x.index === i);
        let set: Partial<ITrafficLead>;
        if (r?.status === "created") {
          set = { status: "sent", crmLeadId: r.leadId ?? "", sentAt: now, lastError: "", nextAttemptAt: null };
        } else if (r?.status === "duplicate") {
          set = attempts > 1
            ? // A retry the CRM already has is, almost always, this lead's own
              // earlier attempt whose answer never came back. It was sent.
              { status: "sent", crmLeadId: r.leadId ?? "", sentAt: now, lastError: "", nextAttemptAt: null,
                note: "Already in the CRM when retried — most likely an earlier attempt that did get through" }
            : // First time, and the CRM already had this number: it took no
              // place in the split, so it gives its place back.
              { status: "duplicate", crmLeadId: r.leadId ?? "", counted: false, lastError: "", nextAttemptAt: null,
                note: `Already in ${SHORT[org]}` };
        } else if (r?.status === "invalid") {
          set = { status: "invalid", counted: false, lastError: "", nextAttemptAt: null,
            note: `${SHORT[org]} turned it down: ${String(r.reason ?? "no reason given").slice(0, 300)}` };
        } else {
          const why = error || `${SHORT[org]} answered without a result for this lead`;
          set = attempts >= MAX_ATTEMPTS
            ? { status: "failed", lastError: why, nextAttemptAt: null }
            : { status: "retrying", lastError: why, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) };
        }
        const updated = await TrafficLead.findByIdAndUpdate(
          doc._id,
          { $set: { ...set, attempts, claimedAt: null } },
          { new: true },
        );
        if (updated) out.push(updated);
      }
    }
  }
  return out;
}

// ── The worker ───────────────────────────────────────────────────────────────

/** Claim one lead for sending, so nothing else sends it at the same time. */
const claim = (filter: Record<string, unknown>) =>
  TrafficLead.findOneAndUpdate(filter, { $set: { status: "sending", claimedAt: new Date() } }, { new: true, sort: { receivedAt: 1 } });

/**
 * One pass: send what is due.
 *
 * Leads whose retry time has come; leads held while routing was paused, once
 * it no longer is; and leads claimed by a process that died before it could
 * say how the send went.
 */
export async function workerTick(): Promise<number> {
  const now = new Date();
  await TrafficLead.updateMany(
    { status: "sending", claimedAt: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
    { $set: { status: "retrying", nextAttemptAt: now, claimedAt: null } },
  );

  const rule = await getRule();
  const claimed: ITrafficLead[] = [];
  const due: Record<string, unknown>[] = [{ status: "retrying", nextAttemptAt: { $lte: now } }];
  if (!rule.paused) due.push({ status: "held" });
  for (const filter of due) {
    while (claimed.length < 200) {
      const doc = await claim(filter);
      if (!doc) break;
      claimed.push(doc);
    }
  }
  if (claimed.length) await sendLeads(claimed);
  return claimed.length;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startTrafficWorker(intervalMs: number): void {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await workerTick();
    } catch (error) {
      console.error("Lead traffic worker:", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, intervalMs);
  console.log(`Lead traffic worker running every ${Math.round(intervalMs / 1000)}s`);
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface RuleInput {
  paused: boolean;
  segments: Record<TrafficSegment, { org: TrafficOrg; percent: number; assignToId: string | null }[]>;
}

/** An active person in that CRM, read from its database, or null. */
async function crmUser(org: TrafficOrg, id: string): Promise<{ id: string; name: string } | null> {
  const { sources } = await getSources();
  const src = sources.find((s) => s.org.code === org);
  if (!src) throw Object.assign(new Error(`${SHORT[org]} cannot be read just now, so the person cannot be checked`), { statusCode: 503 });
  const user = await src.conn.collection("users").findOne(
    { _id: new Types.ObjectId(id), status: { $ne: "inactive" } },
    { projection: { name: 1 } },
  );
  return user ? { id, name: String(user.name ?? "") } : null;
}

export async function saveRule(input: RuleInput, admin: { adminId: string; email: string }): Promise<{ rule: ITrafficRule; changed: string }> {
  const rule = await getRule();
  const segments = {} as Record<TrafficSegment, TrafficShare[]>;
  let percentsChanged = false;

  for (const seg of SEGMENTS) {
    const shares = input.segments[seg] ?? [];
    const orgs = shares.map((s) => s.org).sort().join(",");
    if (orgs !== [...ORGS].sort().join(",")) {
      throw Object.assign(new Error(`${SEGMENT_LABEL[seg]} needs one share for each of Delta and Draw`), { statusCode: 400 });
    }
    const total = shares.reduce((n, s) => n + s.percent, 0);
    if (total !== 100) {
      throw Object.assign(new Error(`${SEGMENT_LABEL[seg]} adds up to ${total}%, not 100%`), { statusCode: 400 });
    }
    const out: TrafficShare[] = [];
    for (const org of ORGS) {
      const s = shares.find((x) => x.org === org)!;
      let assignTo: TrafficShare["assignTo"] = null;
      if (s.assignToId) {
        const kept = (rule.segments[seg] ?? []).find((x) => x.org === org)?.assignTo;
        // Checked only when it changes: an unchanged choice needs no second look
        // at a CRM that might be down.
        assignTo = kept?.id === s.assignToId ? { id: kept.id, name: kept.name } : await crmUser(org, s.assignToId);
        if (!assignTo) {
          throw Object.assign(new Error(`That person is not an active user in ${SHORT[org]}`), { statusCode: 400 });
        }
      }
      const before = (rule.segments[seg] ?? []).find((x) => x.org === org)?.percent;
      if (before !== s.percent) percentsChanged = true;
      out.push({ org, percent: s.percent, assignTo });
    }
    segments[seg] = out;
  }

  const describe = (segs: Record<TrafficSegment, TrafficShare[]>, paused: boolean) =>
    SEGMENTS.map((seg) =>
      `${SEGMENT_LABEL[seg]}: ${segs[seg].map((s) => `${SHORT[s.org]} ${s.percent}%${s.assignTo ? ` (to ${s.assignTo.name || s.assignTo.id})` : ""}`).join(" / ")}`,
    ).join("; ") + (paused ? "; paused" : "");

  const updated = await TrafficRule.findOneAndUpdate(
    { key: RULE_KEY },
    {
      $set: {
        paused: input.paused,
        segments,
        updatedBy: new Types.ObjectId(admin.adminId),
        updatedByEmail: admin.email,
      },
      ...(percentsChanged ? { $inc: { version: 1 } } : {}),
    },
    { new: true },
  );
  return { rule: updated!, changed: describe(segments, input.paused) };
}

/** Who can be picked to take a share's leads: the CRM's active people. */
export async function listCrmUsers(org: TrafficOrg): Promise<{ id: string; name: string; email: string }[]> {
  const { sources } = await getSources();
  const src = sources.find((s) => s.org.code === org);
  if (!src) throw Object.assign(new Error(`${SHORT[org]} cannot be read just now`), { statusCode: 503 });
  const users = await src.conn
    .collection("users")
    .find({ status: { $ne: "inactive" } }, { projection: { name: 1, email: 1 } })
    .sort({ name: 1 })
    .limit(1000)
    .toArray();
  return users.map((u) => ({ id: String(u._id), name: String(u.name ?? ""), email: String(u.email ?? "") }));
}

/** What the page shows about the settings, including anything missing to run. */
export async function rulesView() {
  const rule = await getRule();
  const orgs = await Organization.find({ code: { $in: ORGS } }).select("code name isActive").lean();
  return {
    paused: rule.paused,
    version: rule.version,
    segments: SEGMENTS.map((seg) => ({
      key: seg,
      label: SEGMENT_LABEL[seg],
      shares: rule.segments[seg] ?? [],
    })),
    crms: ORGS.map((code) => {
      const org = orgs.find((o) => o.code === code);
      return {
        code,
        name: org?.name ?? SHORT[code],
        active: Boolean(org?.isActive),
        missing: intakeConfig(code).missing,
      };
    }),
    sheetKeySet: Boolean(env.LEAD_TRAFFIC_SHEET_KEY),
    sources: SOURCE,
    updatedByEmail: rule.updatedByEmail,
    updatedAt: (rule as unknown as { updatedAt?: Date }).updatedAt ?? null,
  };
}

// ── Reading back ─────────────────────────────────────────────────────────────

const GULF_MS = 4 * 60 * 60_000;
/** Midnight Gulf time on that day, as an instant. */
const gulfStart = (day: string) => new Date(new Date(`${day}T00:00:00Z`).getTime() - GULF_MS);
export const gulfToday = () => new Date(Date.now() + GULF_MS).toISOString().slice(0, 10);

const WAITING: TrafficStatus[] = ["queued", "held", "sending", "retrying"];

export async function summary(from: string, to: string) {
  const start = gulfStart(from);
  const end = new Date(gulfStart(to).getTime() + 24 * 60 * 60_000);
  const rule = await getRule();
  const rows = await TrafficLead.aggregate<{
    _id: { segment: TrafficSegment; destination: TrafficOrg | null; status: TrafficStatus; counted: boolean };
    n: number;
  }>([
    { $match: { receivedAt: { $gte: start, $lt: end } } },
    { $group: { _id: { segment: "$segment", destination: "$destination", status: "$status", counted: "$counted" }, n: { $sum: 1 } } },
  ]);

  const orgNames = new Map(
    (await Organization.find({ code: { $in: ORGS } }).select("code name").lean()).map((o) => [o.code, o.name]),
  );
  const segments = SEGMENTS.map((seg) => {
    const mine = rows.filter((r) => r._id.segment === seg);
    const split = mine.filter((r) => r._id.counted).reduce((n, r) => n + r.n, 0);
    const shares = ORGS.map((org) => {
      const of = mine.filter((r) => r._id.destination === org);
      const count = (pred: (s: TrafficStatus) => boolean) => of.filter((r) => pred(r._id.status)).reduce((n, r) => n + r.n, 0);
      const splitHere = of.filter((r) => r._id.counted).reduce((n, r) => n + r.n, 0);
      return {
        org,
        name: orgNames.get(org) ?? SHORT[org],
        target: (rule.segments[seg] ?? []).find((s) => s.org === org)?.percent ?? 0,
        split: splitHere,
        actual: split ? Math.round((splitHere / split) * 1000) / 10 : null,
        sent: count((s) => s === "sent"),
        duplicates: count((s) => s === "duplicate"),
        invalid: count((s) => s === "invalid"),
        waiting: count((s) => WAITING.includes(s)),
        failed: count((s) => s === "failed"),
      };
    });
    return {
      key: seg,
      label: SEGMENT_LABEL[seg],
      received: mine.reduce((n, r) => n + r.n, 0),
      split,
      invalid: mine.filter((r) => r._id.destination === null).reduce((n, r) => n + r.n, 0),
      shares,
    };
  });

  const total = (pred: (s: TrafficStatus) => boolean) =>
    rows.filter((r) => pred(r._id.status)).reduce((n, r) => n + r.n, 0);
  return {
    from,
    to,
    paused: rule.paused,
    segments,
    totals: {
      received: rows.reduce((n, r) => n + r.n, 0),
      sent: total((s) => s === "sent"),
      duplicates: total((s) => s === "duplicate"),
      invalid: total((s) => s === "invalid"),
      waiting: total((s) => WAITING.includes(s)),
      failed: total((s) => s === "failed"),
    },
  };
}

/** Enough of a number to recognise it, not enough to ring it. */
const maskPhone = (p: string) => (p.length > 7 ? `${p.slice(0, 4)}${"•".repeat(p.length - 7)}${p.slice(-3)}` : p);

export type LeadFilter = "all" | "waiting" | "failed" | "sent" | "duplicate" | "invalid";

export async function listLeads(opts: { filter: LeadFilter; org: TrafficOrg | "all"; page: number; limit: number }) {
  const q: Record<string, unknown> = {};
  if (opts.filter === "waiting") q.status = { $in: WAITING };
  else if (opts.filter !== "all") q.status = opts.filter;
  if (opts.org !== "all") q.destination = opts.org;

  const [items, total] = await Promise.all([
    TrafficLead.find(q).sort({ receivedAt: -1 }).skip((opts.page - 1) * opts.limit).limit(opts.limit).lean(),
    TrafficLead.countDocuments(q),
  ]);
  return {
    total,
    page: opts.page,
    limit: opts.limit,
    items: items.map((d) => ({
      id: String(d._id),
      receivedAt: d.receivedAt,
      name: d.name,
      phone: maskPhone(d.phone),
      tab: d.tab,
      segment: d.segment,
      segmentLabel: SEGMENT_LABEL[d.segment],
      destination: d.destination,
      reason: d.reason,
      status: d.status,
      label: sheetLabel(d),
      assignTo: d.assignTo?.name ?? "",
      crmLeadId: d.crmLeadId,
      note: d.note,
      lastError: d.lastError,
      attempts: d.attempts,
      nextAttemptAt: d.nextAttemptAt,
      // Waiting on its own, or turned down by the CRM: both can be pushed again.
      canRetry: ["retrying", "failed"].includes(d.status) || (d.status === "invalid" && d.reason !== "invalid" && !!d.destination),
    })),
  };
}

/** Send one lead now, by hand. */
export async function retryLead(id: string): Promise<ITrafficLead> {
  if (!Types.ObjectId.isValid(id)) throw Object.assign(new Error("Invalid ID format"), { statusCode: 400 });
  const doc = await TrafficLead.findById(id);
  if (!doc) throw Object.assign(new Error("No such lead"), { statusCode: 404 });
  if (doc.status === "invalid" && doc.reason === "invalid") {
    throw Object.assign(new Error(`This lead was not sent because: ${doc.note}. Fix the row in the sheet and it will come through.`), { statusCode: 409 });
  }
  if (!["retrying", "failed", "invalid"].includes(doc.status) || !doc.destination) {
    throw Object.assign(new Error(`This lead is ${doc.status}; there is nothing to retry`), { statusCode: 409 });
  }
  const claimed = await TrafficLead.findOneAndUpdate(
    { _id: doc._id, status: doc.status },
    { $set: { status: "sending", claimedAt: new Date() } },
    { new: true },
  );
  if (!claimed) throw Object.assign(new Error("Somebody else is sending it right now"), { statusCode: 409 });
  const [sent] = await sendLeads([claimed]);
  return sent ?? claimed;
}
