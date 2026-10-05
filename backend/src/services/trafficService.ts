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
  TrafficSegmentRule,
  TrafficShare,
  TrafficSheet,
  TrafficStatus,
} from "../types/index.js";

/**
 * Lead traffic: the lead sheets' leads, split between the Delta and Draw CRMs.
 *
 * Each sheet posts its new rows here instead of into a CRM, and says which
 * sheet it is. Every lead is put in its segment of that sheet — Abhin's Meta
 * sheet is split by tab into UK, GCC and Hindi; Shoaib's Forex sheet is split
 * as one — checked against everyone already sent or already in either CRM,
 * and given to whichever team is furthest behind its share of that segment.
 * It is then posted into that team's CRM through the CRM's own sheet intake,
 * which shares it out across its teams exactly as it did when the sheet
 * posted there directly, unless the team hands all its leads to one person.
 * A CRM that cannot take it right now does not lose it: it waits here and is
 * tried again.
 */

export const ORGS: TrafficOrg[] = ["delta", "draw", "remote"];
export const SHEETS: TrafficSheet[] = ["abhin", "shoaib"];
const SHORT: Record<TrafficOrg, string> = { delta: "Delta", draw: "Draw", remote: "Remote" };

export const isSheet = (v: unknown): v is TrafficSheet => SHEETS.includes(v as TrafficSheet);

/** Past this many tries a lead stops being retried on its own and waits for a person. */
const MAX_ATTEMPTS = 48;
/** A lead claimed for sending this long ago was lost with its process; it is tried again. */
const STALE_CLAIM_MS = 5 * 60_000;

// ── The sheets ───────────────────────────────────────────────────────────────

/** The account both sheets' own scripts recorded as adding every lead they put into Delta. Draw records its own. */
const SHEETS_REPORTER = "69ef14534e41f5008be375d2";

interface SheetConfig {
  name: string;
  about: string;
  /** In the order the page shows them. `source` is what each CRM records as the lead's source. */
  segments: { key: string; label: string; source: string }[];
  /** The segment a row from this sheet belongs to, from the tab it is on. */
  segmentOf: (tab: string) => string;
  /** What the CRM is told about where the lead came from, in its ad_creative field. */
  creative: (lead: Pick<ITrafficLead, "adName" | "adset" | "knowledge">) => string;
  /** The split the first time, before anybody has changed it. */
  teams: Record<string, TrafficShare[]>;
}

const team = (
  key: string,
  name: string,
  org: TrafficOrg,
  percent: number,
  assignTo: TrafficShare["assignTo"] = null,
): TrafficShare => ({ key, name, org, percent, assignTo });

/** What a CRM's own team is called, wherever one is made from a CRM alone. */
const TEAM_NAME: Record<TrafficOrg, string> = { delta: "Delta sales team", draw: "Draw department", remote: "Dilshad team" };

export const SHEET_CONFIG: Record<TrafficSheet, SheetConfig> = {
  /*
   * Abhin's automated Meta lead sheet, a tab per form. The source labels are
   * the ones its own script used, so reports in the CRMs read the same before
   * and after. Since 30 September 2026 every Hindi lead goes to Vandana in
   * Delta; before that, half went to Lubna.
   */
  abhin: {
    name: "Abhin — Meta leads",
    about: "Split by tab: UK, GCC (UAE & Qatar, and the GCC tab) and Hindi.",
    segments: [
      { key: "uk", label: "UK", source: "FOREX LEADS ALPHA UK" },
      { key: "gcc", label: "GCC", source: "FOREX LEADS ALPHA GCC" },
      { key: "hindi", label: "Hindi", source: "FOREX LEADS ALPHA HINDI" },
    ],
    segmentOf: (tab) => {
      const t = tab.toLowerCase();
      if (t.includes("hindi")) return "hindi";
      // "UK" as a word: "Abhin | UK | New" is, "Kuwait" is not.
      if (/(^|[^a-z])uk([^a-z]|$)/.test(t)) return "uk";
      // Everything else is a Gulf tab: UAE & Qatar, and the GCC tab.
      return "gcc";
    },
    creative: (lead) => lead.adName,
    teams: {
      uk: [team("delta", TEAM_NAME.delta, "delta", 50), team("draw", TEAM_NAME.draw, "draw", 50)],
      gcc: [team("delta", TEAM_NAME.delta, "delta", 50), team("draw", TEAM_NAME.draw, "draw", 50)],
      hindi: [
        team("delta", TEAM_NAME.delta, "delta", 100, { id: "6a5b1786c1b944ae77c10f87", name: "vandanavikraman" }),
        team("draw", TEAM_NAME.draw, "draw", 0),
      ],
    },
  },
  /*
   * Shoaib's Forex lead sheet: one tab, split as a whole — 200, 800 and 300 in
   * every 1,300 to start with. The Dilshad team's share starts in Delta,
   * straight to Nusra; its own CRM, remote, is chosen for it on the Lead
   * traffic page once that is set up. The sheet's own script told the CRM the
   * lead's trading-knowledge answer and the ad set in place of the ad name,
   * and so does this.
   */
  shoaib: {
    name: "Shoaib — Forex leads",
    about: "One split for the whole sheet.",
    segments: [{ key: "all", label: "All leads", source: "FOREX LEADS SEIRRA" }],
    segmentOf: () => "all",
    creative: (lead) =>
      [lead.knowledge && `Trading knowledge: ${lead.knowledge}`, lead.adset && `Ad set: ${lead.adset}`]
        .filter(Boolean)
        .join("\n") || lead.adName,
    teams: {
      all: [
        team("delta", TEAM_NAME.delta, "delta", 15.38),
        team("draw", TEAM_NAME.draw, "draw", 61.54),
        team("dilshad", "Dilshad team", "delta", 23.08, { id: "69ecc78e9e1a9d99d1607c95", name: "Nusra" }),
      ],
    },
  },
};

const configOf = (sheet: string | undefined) => SHEET_CONFIG[isSheet(sheet) ? sheet : "abhin"];
const segmentLabel = (sheet: string | undefined, segment: string) =>
  configOf(sheet).segments.find((s) => s.key === segment)?.label ?? segment;

// ── The rules ────────────────────────────────────────────────────────────────

const defaultRule = (sheet: TrafficSheet) => ({
  key: sheet,
  paused: false,
  segments: SHEET_CONFIG[sheet].segments.map((s) => ({
    key: s.key,
    label: s.label,
    version: 1,
    shares: SHEET_CONFIG[sheet].teams[s.key],
  })),
  reporters: { delta: SHEETS_REPORTER, draw: "", remote: "" },
});

/**
 * The split as it was kept before there was more than one sheet.
 *
 * One document, "sheet", with a CRM's share of each segment and one version
 * for all of them. It becomes Abhin's rule: each CRM's share a team, with the
 * same percentages and the same person, and every segment at the version it
 * was, so its count carries on exactly where it is. Every lead recorded until
 * now is Abhin's, and those the split chose are counted by the team of their
 * CRM.
 *
 * The leads go first, so stopping half way leaves the old rule unconverted to
 * do it all again. Where Abhin's rule already exists it stands — the old one
 * can only have been written since by the previous version running alongside,
 * and that would be its own default, not a choice anybody made. The old rule
 * is kept, marked converted, so the previous version still finds its split if
 * it is ever put back.
 *
 * Looked for on every read, not once at start-up: it is one lookup on a
 * unique key, and a rule restored from a backup should not stay unconverted
 * until somebody restarts the server.
 */
const LEGACY_KEY = "sheet";
type LegacyShare = { org: TrafficOrg; percent: number; assignTo?: { id: string; name: string } | null };

async function migrateLegacyRule(): Promise<void> {
  const legacy = await TrafficRule.collection.findOne({ key: LEGACY_KEY, convertedAt: { $exists: false } });
  if (!legacy) return;
  const abhin = SHEET_CONFIG.abhin;
  const old = (legacy.segments ?? {}) as Record<string, LegacyShare[] | undefined>;
  const version = Number(legacy.version) || 1;

  for (const org of ORGS) {
    await TrafficLead.collection.updateMany(
      { sheet: { $exists: false }, reason: "split", destination: org },
      { $set: { sheet: "abhin", share: org } },
    );
  }
  await TrafficLead.collection.updateMany({ sheet: { $exists: false } }, { $set: { sheet: "abhin", share: "" } });

  const segments = abhin.segments.map((seg) => {
    const saved = old[seg.key];
    return {
      key: seg.key,
      label: seg.label,
      version,
      shares: Array.isArray(saved)
        ? saved.map((s) => team(s.org, TEAM_NAME[s.org], s.org, s.percent, s.assignTo ?? null))
        : abhin.teams[seg.key],
    };
  });
  await TrafficRule.collection.updateOne(
    { key: "abhin" },
    {
      $setOnInsert: {
        key: "abhin",
        paused: Boolean(legacy.paused),
        segments,
        reporters: legacy.reporters ?? { delta: SHEETS_REPORTER, draw: "" },
        updatedBy: legacy.updatedBy ?? null,
        updatedByEmail: legacy.updatedByEmail ?? "",
        createdAt: legacy.createdAt ?? new Date(),
        updatedAt: legacy.updatedAt ?? new Date(),
      },
    },
    { upsert: true },
  );
  await TrafficRule.collection.updateOne({ _id: legacy._id }, { $set: { convertedAt: new Date() } });
}

/** Every sheet's rule; a sheet's is made with its first split the first time it is asked for. */
export async function getRules(): Promise<Map<TrafficSheet, ITrafficRule>> {
  await migrateLegacyRule();
  let found = await TrafficRule.find({ key: { $in: SHEETS } });
  if (found.length < SHEETS.length) {
    for (const sheet of SHEETS.filter((s) => !found.some((r) => r.key === s))) {
      // Upsert rather than create, so two first requests cannot make two rules.
      await TrafficRule.updateOne({ key: sheet }, { $setOnInsert: defaultRule(sheet) }, { upsert: true });
    }
    found = await TrafficRule.find({ key: { $in: SHEETS } });
  }
  return new Map(found.map((r) => [r.key, r]));
}

export const getRule = async (sheet: TrafficSheet): Promise<ITrafficRule> => (await getRules()).get(sheet)!;

const plainShare = (s: TrafficShare): TrafficShare => ({
  key: s.key,
  name: s.name,
  org: s.org,
  percent: s.percent,
  assignTo: s.assignTo ? { id: s.assignTo.id, name: s.assignTo.name } : null,
});

// ── One decision at a time ───────────────────────────────────────────────────

/**
 * Deciding is done one lead after another.
 *
 * The split is "whoever is furthest behind gets the next one", which is only
 * true if nothing else decides in between. The sheets' scripts already run one
 * batch at a time; this makes the portal not depend on that — and two sheets
 * posting at once cannot both claim the same person as new.
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

/** A row as a sheet sends it. Everything is text; the sheet decides nothing. */
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
  adset_name: text(300),
  /** The form's "current level of trading knowledge" answer, where it asks. */
  knowledge: text(300),
  is_organic: text(10),
});

interface ParsedRow {
  sourceKey: string;
  metaId: string;
  tab: string;
  segment: string;
  source: string;
  name: string;
  phone: string;
  phone9: string;
  email: string;
  platform: string;
  campaign: string;
  adName: string;
  adset: string;
  knowledge: string;
  isOrganic: boolean;
  createdTime: Date | null;
  /** Why the lead cannot be sent, if it cannot. */
  problem: string;
}

/** Meta's test leads: "<test lead: dummy data for full_name>". */
const isTest = (s: string) => {
  const t = s.toLowerCase();
  return t.includes("<test") || t.includes("test lead") || t.includes("dummy data");
};

function parseRow(raw: z.output<typeof intakeRowSchema>, sheet: TrafficSheet): ParsedRow {
  const cfg = SHEET_CONFIG[sheet];
  const phone = cleanPhone(raw.phone_number);
  const segment = cfg.segmentOf(raw.tab);
  const created = raw.created_time ? new Date(raw.created_time) : null;
  const createdTime = created && !Number.isNaN(created.getTime()) ? created : null;
  // A test@meta address is Meta's, not the lead's.
  const email = /^\S+@\S+\.\S+$/.test(raw.email) && !/test@meta/i.test(raw.email) ? raw.email.toLowerCase() : "";
  // Meta's lead id is the lead; without one, the row itself is.
  const sourceKey = raw.id
    ? `meta:${raw.id}`
    : `row:${createHash("sha1").update(`${raw.tab}|${phone}|${raw.created_time}`).digest("hex")}`;

  let problem = "";
  if (!raw.tab) problem = "No tab name";
  else if (isTest(`${raw.full_name} ${raw.phone_number}`)) problem = "Meta test lead";
  else if (!raw.full_name || raw.full_name.toLowerCase() === "nan") problem = "No name";
  else if (phone.replace(/\D/g, "").length < 7) problem = "No usable phone number";
  else if (!createdTime) problem = "No created time";

  return {
    sourceKey,
    metaId: raw.id,
    tab: raw.tab,
    segment,
    source: cfg.segments.find((s) => s.key === segment)?.source ?? "",
    name: raw.full_name,
    phone,
    phone9: phoneTail(phone),
    email,
    platform: mapPlatform(raw.platform),
    campaign: raw.campaign_name,
    adName: raw.ad_name,
    adset: raw.adset_name,
    knowledge: isTest(raw.knowledge) ? "" : raw.knowledge,
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

export function sheetLabel(doc: Pick<ITrafficLead, "status" | "destination" | "assignTo" | "note" | "lastError">): string {
  const crm = doc.destination ? SHORT[doc.destination] : "";
  // Where the split handed it to one person, the sheet says who.
  const to = doc.assignTo?.name ? `${crm} → ${doc.assignTo.name}` : crm;
  switch (doc.status) {
    case "sent":
      return `✅ ${to}`;
    case "duplicate":
      return `⚠️ Duplicate · ${crm}`;
    case "invalid":
      return `❌ Invalid: ${doc.note || doc.lastError || "rejected"}`.slice(0, 150);
    case "held":
      return `⏸ Paused · ${to}`;
    case "failed":
      return `❌ Failed · ${to} — see Root`;
    default:
      return `⏳ Waiting · ${to}`;
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

/** How many leads each team of one segment has had from the split, within its current version. */
async function splitCounts(sheet: TrafficSheet, segment: string, version: number): Promise<Record<string, number>> {
  const rows = await TrafficLead.aggregate<{ _id: string; n: number }>([
    { $match: { sheet, segment, ruleVersion: version, counted: true } },
    { $group: { _id: "$share", n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}

/**
 * Whichever team is furthest behind its share gets the next lead.
 *
 * Measured as leads so far divided by percent, lowest first; a tie goes to the
 * larger share, then to the order the teams are listed in. At 50/50 that is
 * simply taking turns, and at 15.38 / 61.54 / 23.08 every 13 leads are 2, 8
 * and 3 — never more than a lead from the target, however the day goes.
 */
export function pickShare(shares: TrafficShare[], counts: Record<string, number>): TrafficShare | null {
  let best: TrafficShare | null = null;
  for (const s of shares) {
    if (s.percent <= 0) continue;
    if (!best) {
      best = s;
      continue;
    }
    const a = (counts[s.key] ?? 0) / s.percent;
    const b = (counts[best.key] ?? 0) / best.percent;
    if (a < b || (a === b && s.percent > best.percent)) best = s;
  }
  return best;
}

// ── Taking a batch from a sheet ──────────────────────────────────────────────

export async function intake(
  sheet: TrafficSheet,
  rows: unknown[],
): Promise<{ results: RowResult[]; summary: Record<string, number> }> {
  const results: RowResult[] = [];
  const toSend: { index: number; doc: ITrafficLead }[] = [];

  await serial(async () => {
    // The unique key on Meta's lead id is what makes a resend harmless, and
    // Mongoose builds it in the background after start-up. Wait for it (a
    // no-op once built), so the first batch after a deploy cannot slip in twice.
    await TrafficLead.init();
    const rule = await getRule(sheet);
    const parsed = rows.map((r) => intakeRowSchema.safeParse(r));
    const tails = parsed.flatMap((p) => (p.success ? [phoneTail(cleanPhone(p.data.phone_number))] : []));
    const { known, unreadable } = await knownInCrms(tails);
    const counts: Record<string, Record<string, number>> = {};

    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      if (!p.success) {
        results.push({ index: i, status: "invalid", destination: null, label: "❌ Invalid: unreadable row", reason: "unreadable row" });
        continue;
      }
      const row = parseRow(p.data, sheet);

      // A lead seen before is answered from what was decided then. The one
      // exception is a row turned away here for missing something: it may
      // have been fixed in the sheet since, so it is looked at again.
      const existing = await TrafficLead.findOne({ sourceKey: row.sourceKey });
      if (existing && !(existing.status === "invalid" && existing.reason === "invalid")) {
        results.push(resultFor(i, existing));
        continue;
      }

      const base = {
        sheet, sourceKey: row.sourceKey, metaId: row.metaId, tab: row.tab, segment: row.segment, source: row.source,
        name: row.name, phone: row.phone, phone9: row.phone9, email: row.email, platform: row.platform,
        campaign: row.campaign, adName: row.adName, adset: row.adset, knowledge: row.knowledge,
        isOrganic: row.isOrganic, createdTime: row.createdTime,
      };
      // Every field a decision sets, so a row decided again keeps nothing from last time.
      const none = { share: "", destination: null, assignTo: null, ruleVersion: 0, crmLeadId: "", claimedAt: null };

      let decision: Partial<ITrafficLead>;
      if (row.problem) {
        decision = { ...none, reason: "invalid", counted: false, status: "invalid", note: row.problem };
      } else {
        // Whichever sheet they came in on before: one person, one CRM.
        const prior = await TrafficLead.findOne({
          phone9: row.phone9,
          destination: { $ne: null },
          status: { $ne: "invalid" },
          sourceKey: { $ne: row.sourceKey },
        }).sort({ receivedAt: -1 });
        const inCrm = known.get(row.phone9);

        if (prior?.destination) {
          decision = {
            ...none, destination: prior.destination, reason: "known", counted: false, status: "duplicate",
            crmLeadId: prior.crmLeadId,
            note: `Already sent to ${SHORT[prior.destination]} on ${prior.receivedAt.toISOString().slice(0, 10)}`,
          };
        } else if (inCrm) {
          decision = {
            ...none, destination: inCrm.org, reason: "known", counted: false, status: "duplicate",
            crmLeadId: inCrm.leadId, note: `Already in ${SHORT[inCrm.org]}`,
          };
        } else {
          const seg = rule.segments.find((s) => s.key === row.segment);
          if (seg && !counts[seg.key]) counts[seg.key] = await splitCounts(sheet, seg.key, seg.version);
          const share = seg ? pickShare(seg.shares, counts[seg.key]) : null;
          if (!seg || !share) {
            decision = {
              ...none, reason: "invalid", counted: false, status: "invalid",
              note: `No team has a share of ${segmentLabel(sheet, row.segment)}`,
            };
          } else {
            counts[seg.key][share.key] = (counts[seg.key][share.key] ?? 0) + 1;
            decision = {
              ...none,
              share: share.key, destination: share.org, reason: "split", counted: true, ruleVersion: seg.version,
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
  const creative = configOf(doc.sheet).creative(doc);
  return {
    full_name: doc.name,
    phone_number: doc.phone,
    platform: doc.platform || "meta",
    source: doc.source,
    ...(doc.email ? { email: doc.email } : {}),
    ...(creative ? { ad_creative: creative } : {}),
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
  const rules = await getRules();
  const reporter = (doc: ITrafficLead, org: TrafficOrg) =>
    rules.get(isSheet(doc.sheet) ? doc.sheet : "abhin")?.reporters?.[org] ?? "";
  const out: ITrafficLead[] = [];

  for (const org of ORGS) {
    const mine = docs.filter((d) => d.destination === org);
    for (let at = 0; at < mine.length; at += 100) {
      const chunk = mine.slice(at, at + 100);
      const now = new Date();
      let results: Awaited<ReturnType<typeof postIntakeBatch>> | null = null;
      let error = "";
      try {
        results = await postIntakeBatch(org, chunk.map((d) => toIntakeRow(d, reporter(d, org))));
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
 * Leads whose retry time has come; leads held while their sheet was paused,
 * once it no longer is; and leads claimed by a process that died before it
 * could say how the send went.
 */
export async function workerTick(): Promise<number> {
  const now = new Date();
  await TrafficLead.updateMany(
    { status: "sending", claimedAt: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
    { $set: { status: "retrying", nextAttemptAt: now, claimedAt: null } },
  );

  const rules = await getRules();
  const running = SHEETS.filter((s) => !rules.get(s)?.paused);
  const claimed: ITrafficLead[] = [];
  const due: Record<string, unknown>[] = [{ status: "retrying", nextAttemptAt: { $lte: now } }];
  if (running.length) due.push({ status: "held", sheet: { $in: running } });
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

export interface ShareInput {
  /** The team's key; left out for a team being added. */
  key?: string;
  name: string;
  org: TrafficOrg;
  percent: number;
  assignToId: string | null;
}

export interface RuleInput {
  paused: boolean;
  segments: Record<string, ShareInput[]>;
}

const invalid = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
/** Percentages are kept to two decimals and added up in hundredths, so 15.38 + 61.54 + 23.08 is exactly 100. */
const hundredths = (percent: number) => Math.round(percent * 100);
const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "team";

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

export async function saveRule(
  sheet: TrafficSheet,
  input: RuleInput,
  admin: { adminId: string; email: string },
): Promise<{ rule: ITrafficRule; changed: string }> {
  const cfg = SHEET_CONFIG[sheet];
  const rule = await getRule(sheet);
  const stray = Object.keys(input.segments).filter((k) => !cfg.segments.some((s) => s.key === k));
  if (stray.length) throw invalid(`${cfg.name} has no segment called ${stray.join(", ")}`);

  const segments: TrafficSegmentRule[] = [];
  for (const { key: segKey, label } of cfg.segments) {
    const given = input.segments[segKey] ?? [];
    if (!given.length) throw invalid(`${label} needs at least one team`);
    if (given.some((s) => Math.abs(s.percent * 100 - hundredths(s.percent)) > 1e-6)) {
      throw invalid(`${label}: percentages go to two decimal places at most`);
    }
    const total = given.reduce((n, s) => n + hundredths(s.percent), 0);
    if (total !== 10_000) throw invalid(`${label} adds up to ${total / 100}%, not 100%`);
    const names = given.map((s) => s.name.trim().toLowerCase());
    if (names.some((n) => !n)) throw invalid(`${label}: every team needs a name`);
    if (new Set(names).size !== names.length) throw invalid(`${label}: two teams have the same name`);

    // Teams already there keep their keys, and their counts with them; a new
    // one is keyed by its name, clear of every key already taken.
    const taken = new Set<string>();
    for (const s of given) {
      if (!s.key) continue;
      if (taken.has(s.key)) throw invalid(`${label}: two teams have the same key`);
      taken.add(s.key);
    }
    const before = rule.segments.find((s) => s.key === segKey);
    const shares: TrafficShare[] = [];
    for (const s of given) {
      let key = s.key;
      if (!key) {
        key = slug(s.name);
        for (let n = 2; taken.has(key); n++) key = `${slug(s.name)}-${n}`;
        taken.add(key);
      }
      let assignTo: TrafficShare["assignTo"] = null;
      if (s.assignToId) {
        const kept = before?.shares.find((x) => x.key === key);
        // Checked only when it changes: an unchanged choice needs no second
        // look at a CRM that might be down.
        assignTo = kept?.assignTo?.id === s.assignToId && kept.org === s.org
          ? { id: kept.assignTo.id, name: kept.assignTo.name }
          : await crmUser(s.org, s.assignToId);
        if (!assignTo) throw invalid(`${label}: that person is not an active user in ${SHORT[s.org]}`);
      }
      shares.push({ key, name: s.name.trim(), org: s.org, percent: hundredths(s.percent) / 100, assignTo });
    }

    // A new ratio, or a team in or out, starts this segment's count again;
    // a new name or person does not.
    const ratio = (list: TrafficShare[]) => list.map((x) => `${x.key}:${hundredths(x.percent)}`).sort().join(",");
    const moved = !before || ratio(before.shares.map(plainShare)) !== ratio(shares);
    segments.push({ key: segKey, label, version: (before?.version ?? 0) + (moved ? 1 : 0), shares });
  }

  const describe = segments
    .map((seg) => `${seg.label}: ${seg.shares
      .map((s) => `${s.name} (${SHORT[s.org]}${s.assignTo ? ` → ${s.assignTo.name || s.assignTo.id}` : ""}) ${s.percent}%`)
      .join(" / ")}`)
    .join("; ");

  const updated = await TrafficRule.findOneAndUpdate(
    { key: sheet },
    {
      $set: {
        paused: input.paused,
        segments,
        updatedBy: new Types.ObjectId(admin.adminId),
        updatedByEmail: admin.email,
      },
    },
    { new: true },
  );
  return { rule: updated!, changed: `${cfg.name} — ${describe}${input.paused ? "; paused" : ""}` };
}

/** Who can be picked to take a team's leads: the CRM's active people. */
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

/** What the page shows about the settings, sheet by sheet, and anything missing to run. */
export async function rulesView() {
  const rules = await getRules();
  const orgs = await Organization.find({ code: { $in: ORGS } }).select("code name isActive").lean();
  return {
    sheets: SHEETS.map((key) => {
      const cfg = SHEET_CONFIG[key];
      const rule = rules.get(key)!;
      return {
        key,
        name: cfg.name,
        about: cfg.about,
        paused: rule.paused,
        // The CRMs this sheet's split sends to, so its checks name only those.
        uses: ORGS.filter((org) => rule.segments.some((seg) => seg.shares.some((s) => s.org === org && s.percent > 0))),
        segments: cfg.segments.map((seg) => {
          const saved = rule.segments.find((s) => s.key === seg.key);
          return {
            key: seg.key,
            label: seg.label,
            source: seg.source,
            version: saved?.version ?? 1,
            shares: (saved?.shares ?? []).map(plainShare),
          };
        }),
        updatedByEmail: rule.updatedByEmail,
        updatedAt: (rule as unknown as { updatedAt?: Date }).updatedAt ?? null,
      };
    }),
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
  };
}

// ── Reading back ─────────────────────────────────────────────────────────────

const GULF_MS = 4 * 60 * 60_000;
/** Midnight Gulf time on that day, as an instant. */
const gulfStart = (day: string) => new Date(new Date(`${day}T00:00:00Z`).getTime() - GULF_MS);
export const gulfToday = () => new Date(Date.now() + GULF_MS).toISOString().slice(0, 10);

const WAITING: TrafficStatus[] = ["queued", "held", "sending", "retrying"];

export async function summary(sheet: TrafficSheet, from: string, to: string) {
  const cfg = SHEET_CONFIG[sheet];
  const start = gulfStart(from);
  const end = new Date(gulfStart(to).getTime() + 24 * 60 * 60_000);
  const rule = await getRule(sheet);
  type Row = {
    _id: { segment: string; share: string; destination: TrafficOrg | null; status: TrafficStatus; counted: boolean };
    n: number;
  };
  const rows = await TrafficLead.aggregate<Row>([
    { $match: { sheet, receivedAt: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: { segment: "$segment", share: "$share", destination: "$destination", status: "$status", counted: "$counted" },
        n: { $sum: 1 },
      },
    },
  ]);
  const count = (of: Row[], pred: (r: Row["_id"]) => boolean = () => true) =>
    of.filter((r) => pred(r._id)).reduce((n, r) => n + r.n, 0);

  const orgNames = new Map(
    (await Organization.find({ code: { $in: ORGS } }).select("code name").lean()).map((o) => [o.code, o.name]),
  );
  const segments = cfg.segments.map((seg) => {
    const mine = rows.filter((r) => r._id.segment === seg.key);
    const split = count(mine, (r) => r.counted);
    const teams = (rule.segments.find((s) => s.key === seg.key)?.shares ?? []).map(plainShare);
    // The teams in the split now, then any that had leads in this period and
    // have since been taken out of it.
    const gone = [...new Set(mine.map((r) => r._id.share).filter((k) => k && !teams.some((t) => t.key === k)))];
    const shares = [...teams.map((t) => t.key), ...gone].map((key) => {
      const t = teams.find((x) => x.key === key);
      const of = mine.filter((r) => r._id.share === key);
      const org: TrafficOrg = t?.org ?? of.find((r) => r._id.destination)?._id.destination ?? "delta";
      const splitHere = count(of, (r) => r.counted);
      return {
        key,
        name: t?.name ?? key,
        org,
        crm: orgNames.get(org) ?? SHORT[org],
        assignTo: t?.assignTo ?? null,
        target: t?.percent ?? 0,
        removed: !t,
        split: splitHere,
        actual: split ? Math.round((splitHere / split) * 1000) / 10 : null,
        sent: count(of, (r) => r.status === "sent"),
        duplicates: count(of, (r) => r.status === "duplicate"),
        invalid: count(of, (r) => r.status === "invalid"),
        waiting: count(of, (r) => WAITING.includes(r.status)),
        failed: count(of, (r) => r.status === "failed"),
      };
    });
    return {
      key: seg.key,
      label: seg.label,
      received: count(mine),
      split,
      // People already in a CRM went back there, outside the split.
      known: ORGS.map((org) => ({
        org,
        name: orgNames.get(org) ?? SHORT[org],
        count: count(mine, (r) => !r.share && r.destination === org),
      })),
      invalid: count(mine, (r) => r.destination === null),
      shares,
    };
  });

  return {
    sheet,
    from,
    to,
    paused: rule.paused,
    segments,
    totals: {
      received: count(rows),
      sent: count(rows, (r) => r.status === "sent"),
      duplicates: count(rows, (r) => r.status === "duplicate"),
      invalid: count(rows, (r) => r.status === "invalid"),
      waiting: count(rows, (r) => WAITING.includes(r.status)),
      failed: count(rows, (r) => r.status === "failed"),
    },
  };
}

/** Enough of a number to recognise it, not enough to ring it. */
const maskPhone = (p: string) => (p.length > 7 ? `${p.slice(0, 4)}${"•".repeat(p.length - 7)}${p.slice(-3)}` : p);

export type LeadFilter = "all" | "waiting" | "failed" | "sent" | "duplicate" | "invalid";

export async function listLeads(opts: {
  sheet: TrafficSheet;
  filter: LeadFilter;
  org: TrafficOrg | "all";
  page: number;
  limit: number;
  /** Received on these Gulf days, YYYY-MM-DD, both included; either left out, no bound that side. */
  from?: string;
  to?: string;
}) {
  const q: Record<string, unknown> = { sheet: opts.sheet };
  if (opts.filter === "waiting") q.status = { $in: WAITING };
  else if (opts.filter !== "all") q.status = opts.filter;
  if (opts.org !== "all") q.destination = opts.org;
  if (opts.from || opts.to) {
    q.receivedAt = {
      ...(opts.from ? { $gte: gulfStart(opts.from) } : {}),
      ...(opts.to ? { $lt: new Date(gulfStart(opts.to).getTime() + 24 * 60 * 60_000) } : {}),
    };
  }

  const [items, total, rule] = await Promise.all([
    TrafficLead.find(q).sort({ receivedAt: -1 }).skip((opts.page - 1) * opts.limit).limit(opts.limit).lean(),
    TrafficLead.countDocuments(q),
    getRule(opts.sheet),
  ]);
  const teamName = (segment: string, key: string) =>
    rule.segments.find((s) => s.key === segment)?.shares.find((s) => s.key === key)?.name ?? key;
  return {
    total,
    page: opts.page,
    limit: opts.limit,
    items: items.map((d) => ({
      id: String(d._id),
      sheet: d.sheet,
      receivedAt: d.receivedAt,
      name: d.name,
      phone: maskPhone(d.phone),
      tab: d.tab,
      segment: d.segment,
      segmentLabel: segmentLabel(d.sheet, d.segment),
      team: d.share ? teamName(d.segment, d.share) : "",
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
