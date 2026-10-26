import { Organization } from "../models/Organization.js";
import { resolveTarget, callTarget } from "../lib/targetClient.js";
import { workModes, hrmsSigningConfigured } from "../lib/hrmsClient.js";
import { getSources } from "./crmConnections.js";

/*
 * Sales TV (the user, 2026-10-20): the Dubai Sales CRM, Draw and Remote on one
 * screen — closings and calls per salesperson, who is on a break (with their
 * HRMS photo), and every close celebrated with its amount and a sound. A
 * signed-in page for root admins, and an open link for the office TVs.
 *
 * Every screen asks Root, never the CRMs: one shared aggregate, refreshed only
 * while somebody is asking (nothing runs on a timer), so the CRMs' load is
 * bounded whatever the number of screens —
 *
 *   people   (each CRM's GET /service/sales-tv)            at most every 30 s
 *   live     (GET /service/sales-tv?parts=live — onBreak    at most every 5 s
 *            and closes, with ?after= the newest close seen)
 *   photos   (HRMS work-modes, per email)                   at most every 10 min
 *
 * Each CRM keeps its own error: one that is down or older than this feature
 * shows on its own table, and the other two carry on.
 *
 * Only the people working this month are shown (the user, 2026-10-22: "only
 * this month's leads, inactive users not shown"): someone given a lead this
 * month — a lead reaches them at its createdAt, a hand-over included — or
 * credited with a close this month. The leads are counted here, read-only from
 * the CRM's own database (as the Salespeople page reads it), with the people.
 * A CRM whose leads can't be read shows everybody rather than nobody.
 */

export const SALES_TV_CRMS = ["delta", "draw", "remote"] as const;
type CrmCode = (typeof SALES_TV_CRMS)[number];

const FULL_MS = 30_000;
const LIVE_MS = 5_000;
const CLOSES_KEEP_MS = 2 * 3_600_000;
const PHOTO_MS = 10 * 60_000;
const PHOTO_FAIL_MS = 2 * 60_000;
/** HRMS answers at most this many people per work-modes call. */
const PHOTO_BATCH = 300;
const NAMES_MS = 5 * 60_000;
/** How long a screen waits on a slow CRM before it gets what is already known. */
const WAIT_MS = 6_000;
const PHOTO_WAIT_MS = 2_500;
const LEADS_QUERY_MS = 10_000;
const DUBAI_OFFSET_MS = 4 * 3_600_000;
const MONTH = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;

const FALLBACK_NAMES: Record<CrmCode, string> = { delta: "Dubai Sales", draw: "Draw", remote: "Remote" };

// ── What a CRM answers (its services/salesTvService.ts) ─────────────────────

interface CrmBreak { id: string; name: string; email: string; team: string; since: string; kind: string | null }
interface CrmClose { id: string; closer: string; closerEmail?: string; courses: string[]; amount: number; academy: "dubai" | "bangalore"; currency: "AED" | "INR"; at: string }
interface CrmPerson {
  id: string; name: string; email: string; team: string;
  closingsMonth: number; closingsToday: number; revenueMonth: number;
  callsToday: number; connectedToday: number; talkSecondsToday: number;
}
interface CrmAnswer { crm?: string; generatedAt?: string; month?: string; onBreak?: CrmBreak[]; closes?: CrmClose[]; people?: CrmPerson[] }

// ── What Root keeps ─────────────────────────────────────────────────────────

export interface TvClose extends CrmClose { key: string; crm: CrmCode; crmName: string; seenAt: string }
export interface TvBreak extends CrmBreak { crm: CrmCode; crmName: string; photoUrl: string | null }

interface CrmState {
  code: CrmCode;
  people: CrmPerson[] | null;
  month: string | null;
  /** Leads each person was given this month, by CRM user id — null while unknown (then nobody is hidden). */
  leadsMonth: Map<string, number> | null;
  /** Its team leaders, Sales Manager and Super Admins, by CRM user id — hidden on the Sales TV, shown on the
      Manager TV (the user, 2026-10-23). Null while unknown: then nobody is hidden. */
  bosses: Set<string> | null;
  onBreak: CrmBreak[];
  /** When each part was last asked for (success or not) — what the windows are measured from. */
  fullAskedAt: number;
  liveAskedAt: number;
  /** When each part last arrived. */
  peopleAt: number;
  liveAt: number;
  error: string | null;
  /** Its server is from before Sales TV (answered not found). */
  outdated: boolean;
  /** The newest close seen from it — handed back as ?after= so live calls stay light. */
  newestClose: string | null;
  inflight: Promise<void> | null;
}

const state = new Map<CrmCode, CrmState>(
  SALES_TV_CRMS.map((code) => [code, {
    code, people: null, month: null, leadsMonth: null, bosses: null, onBreak: [], fullAskedAt: 0, liveAskedAt: 0, peopleAt: 0, liveAt: 0,
    error: null, outdated: false, newestClose: null, inflight: null,
  }]),
);
const closes = new Map<string, TvClose>();
const photos = new Map<string, { url: string | null; until: number }>();
let photoInflight: Promise<void> | null = null;
let names: { at: number; byCode: Map<string, string> } = { at: 0, byCode: new Map() };

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const validIso = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));

async function crmNames(): Promise<Map<string, string>> {
  if (Date.now() - names.at < NAMES_MS) return names.byCode;
  try {
    const orgs = await Organization.find({ code: { $in: [...SALES_TV_CRMS] } }).select("code name").lean<Array<{ code: string; name: string }>>();
    names = { at: Date.now(), byCode: new Map(orgs.map((o) => [o.code, o.name])) };
  } catch {
    /* the last names, or the fallbacks */
  }
  return names.byCode;
}
const nameOf = (code: CrmCode) => names.byCode.get(code) || FALLBACK_NAMES[code];

function keepCloses(code: CrmCode, list: CrmClose[] | undefined, now: number): void {
  const s = state.get(code)!;
  for (const raw of list ?? []) {
    const id = str(raw?.id);
    if (!id || !validIso(raw.at)) continue;
    const key = `${code}:${id}`;
    if (!s.newestClose || Date.parse(raw.at) > Date.parse(s.newestClose)) s.newestClose = new Date(raw.at).toISOString();
    if (closes.has(key)) continue;
    closes.set(key, {
      key, crm: code, crmName: nameOf(code), seenAt: new Date(now).toISOString(),
      id, closer: str(raw.closer), closerEmail: str(raw.closerEmail),
      courses: Array.isArray(raw.courses) ? raw.courses.map(str).filter(Boolean) : [],
      amount: Math.max(0, num(raw.amount)),
      academy: raw.academy === "bangalore" ? "bangalore" : "dubai",
      currency: raw.currency === "INR" || raw.academy === "bangalore" ? "INR" : "AED",
      at: new Date(raw.at).toISOString(),
    });
  }
}

function dropOldCloses(now: number): void {
  for (const [key, c] of closes) if (now - Date.parse(c.at) > CLOSES_KEEP_MS) closes.delete(key);
}

function cleanPeople(list: CrmPerson[]): CrmPerson[] {
  return list.map((p) => ({
    id: str(p.id), name: str(p.name), email: str(p.email).toLowerCase(), team: str(p.team),
    closingsMonth: num(p.closingsMonth), closingsToday: num(p.closingsToday), revenueMonth: num(p.revenueMonth),
    callsToday: num(p.callsToday), connectedToday: num(p.connectedToday), talkSecondsToday: num(p.talkSecondsToday),
  }));
}

function cleanBreaks(list: CrmBreak[] | undefined): CrmBreak[] {
  return (list ?? []).filter((b) => b && validIso(b.since)).map((b) => ({
    id: str(b.id), name: str(b.name), email: str(b.email).toLowerCase(), team: str(b.team),
    since: new Date(b.since).toISOString(), kind: str(b.kind) || null,
  }));
}

/** "2026-10" (else the current Dubai month) → that Dubai month's instants. */
function dubaiMonth(month: string | null): { from: Date; to: Date } {
  const now = new Date(Date.now() + DUBAI_OFFSET_MS);
  const [y, m] = month && MONTH.test(month) ? month.split("-").map(Number) as [number, number] : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  return { from: new Date(Date.UTC(y, m - 1, 1) - DUBAI_OFFSET_MS), to: new Date(Date.UTC(y, m, 1) - DUBAI_OFFSET_MS) };
}

/** Leads given to each person in the month, from the CRM's database; null when it can't be read. */
async function leadsThisMonth(code: CrmCode, month: string | null): Promise<Map<string, number> | null> {
  try {
    const { sources } = await getSources();
    const src = sources.find((x) => x.org.code === code);
    if (!src) return null;
    const { from, to } = dubaiMonth(month);
    const rows = await src.conn.collection("leads").aggregate<{ _id: unknown; n: number }>([
      { $match: { assignedTo: { $ne: null }, createdAt: { $gte: from, $lt: to } } },
      { $group: { _id: "$assignedTo", n: { $sum: 1 } } },
    ], { maxTimeMS: LEADS_QUERY_MS }).toArray();
    return new Map(rows.map((r) => [String(r._id), r.n]));
  } catch {
    return null;
  }
}

/**
 * The people who aren't salespeople on the TV (the user, 2026-10-23: "in the normal TV hide dilshad, the sales
 * manager and the team leaders"): the leaders of the CRM's active teams, its Sales Manager (commission settings)
 * and its Super Admins — from the CRM's database; null when it can't be read.
 */
async function bossesOf(code: CrmCode): Promise<Set<string> | null> {
  try {
    const { sources } = await getSources();
    const src = sources.find((x) => x.org.code === code);
    if (!src) return null;
    const db = src.conn;
    const opts = { maxTimeMS: LEADS_QUERY_MS };
    const [teams, settings, roles] = await Promise.all([
      db.collection("teams").find({ status: { $ne: "inactive" } }, { projection: { leaders: 1 }, ...opts }).toArray(),
      db.collection("commissionsettings").find({}, { projection: { salesManager: 1 }, ...opts }).toArray(),
      db.collection("roles").find({ isSystemRole: true, roleName: "Super Admin" }, { projection: { _id: 1 }, ...opts }).toArray(),
    ]);
    const admins = roles.length
      ? await db.collection("users").find({ role: { $in: roles.map((r) => r._id) } }, { projection: { _id: 1 }, ...opts }).toArray()
      : [];
    const ids = new Set<string>();
    for (const t of teams) for (const l of (t.leaders as unknown[] | undefined) ?? []) ids.add(String(l));
    for (const c of settings) if (c.salesManager) ids.add(String(c.salesManager));
    for (const a of admins) ids.add(String(a._id));
    return ids;
  } catch {
    return null;
  }
}

/**
 * Who the TV shows: given a lead this month or credited with a close (everybody while the leads are unknown) — and
 * on the Sales TV, not the team leaders, the Sales Manager or the Super Admins (`withBosses`: the Manager TV).
 */
function shownPeople(s: CrmState, withBosses = true): CrmPerson[] {
  const leads = s.leadsMonth;
  const bosses = withBosses ? null : s.bosses;
  return (s.people ?? []).filter((p) =>
    (!leads || (leads.get(p.id) ?? 0) > 0 || p.closingsMonth > 0) && !(bosses && bosses.has(p.id))).sort(byStanding);
}

/**
 * The order of the podium and the standings, the same for every CRM (2026-10-26: Draw had Anagha, AED 4,500, on the
 * podium above Jerin, AED 11,000, both on 2 closings — each CRM broke the tie its own way): the month's closings, then
 * the month's revenue, then today's closings, then the name.
 */
function byStanding(a: CrmPerson, b: CrmPerson): number {
  return b.closingsMonth - a.closingsMonth || b.revenueMonth - a.revenueMonth || b.closingsToday - a.closingsToday
    || a.name.localeCompare(b.name);
}

/** One CRM, brought up to date if its window has passed. Concurrent screens share one call. */
function refreshCrm(code: CrmCode, now: number): Promise<void> {
  const s = state.get(code)!;
  if (s.inflight) return s.inflight;
  // Until the people have come once, they are asked again at the live pace, not every 30 s.
  const full = now - s.fullAskedAt >= (s.people ? FULL_MS : LIVE_MS);
  const live = now - s.liveAskedAt >= LIVE_MS;
  if (!full && !live) return Promise.resolve();
  // A server from before Sales TV won't have it in five seconds either: every 30 s is enough.
  if (s.outdated && now - s.fullAskedAt < FULL_MS) return Promise.resolve();

  s.liveAskedAt = now;
  if (full) s.fullAskedAt = now;
  const params = new URLSearchParams();
  if (s.newestClose) params.set("after", s.newestClose);
  if (!full) params.set("parts", "live");

  s.inflight = (async () => {
    try {
      const target = await resolveTarget(code);
      const data = await callTarget<CrmAnswer>(target, `/sales-tv${params.size ? `?${params}` : ""}`, { method: "GET", verb: "share its Sales TV" });
      const at = Date.now();
      s.onBreak = cleanBreaks(data.onBreak);
      s.liveAt = at;
      keepCloses(code, data.closes, at);
      if (full && Array.isArray(data.people)) {
        s.people = cleanPeople(data.people);
        s.month = str(data.month) || null;
        s.peopleAt = at;
        // Unreadable this time: the last counts stand (none yet → nobody hidden).
        s.leadsMonth = (await leadsThisMonth(code, s.month)) ?? s.leadsMonth;
        s.bosses = (await bossesOf(code)) ?? s.bosses;
      }
      s.error = null;
      s.outdated = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not be read";
      s.outdated = /not found/i.test(message);
      s.error = s.outdated ? `${nameOf(code)}'s server needs updating — it has no Sales TV yet.` : message;
      // Who was on a break a minute ago is not shown as still on it.
      if (Date.now() - s.liveAt > 60_000) s.onBreak = [];
    } finally {
      s.inflight = null;
    }
  })();
  return s.inflight;
}

/**
 * HRMS photos for whoever is on a break and everybody in the tables (the
 * podium shows the top three's faces, 2026-10-20); asked only for emails not
 * already known, at most HRMS's 300 at a time — breaks first.
 */
function refreshPhotos(now: number): Promise<void> {
  if (photoInflight) return photoInflight;
  if (!hrmsSigningConfigured()) return Promise.resolve();
  const want = new Map<string, string>();
  const ask = (email: string, name: string) => {
    if (!email || want.size >= PHOTO_BATCH) return;
    const known = photos.get(email);
    if (!known || known.until <= now) want.set(email, name);
  };
  for (const s of state.values()) for (const b of s.onBreak) ask(b.email, b.name);
  for (const s of state.values()) for (const p of shownPeople(s)) ask(p.email, p.name);
  if (!want.size) return Promise.resolve();
  const asked = [...want].map(([email, name]) => ({ email, name: name || undefined }));
  photoInflight = (async () => {
    try {
      const rows = await workModes(asked);
      const at = Date.now();
      asked.forEach((p, i) => {
        const row = rows[i];
        const url = row && typeof row.photoUrl === "string" && /^https?:\/\//.test(row.photoUrl) ? row.photoUrl : null;
        photos.set(p.email, { url, until: at + PHOTO_MS });
      });
    } catch {
      // Initials for now, and HRMS is not asked again for a couple of minutes.
      const at = Date.now();
      for (const p of asked) photos.set(p.email, { url: null, until: at + PHOTO_FAIL_MS });
    } finally {
      photoInflight = null;
    }
  })();
  return photoInflight;
}

const within = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise((ok) => setTimeout(ok, ms))]);

export interface SalesTvOptions {
  since?: unknown;
  publicView?: boolean;
  /** The Manager TV: team leaders, the Sales Manager and Super Admins in the tables too (the Sales TV hides them). */
  withBosses?: boolean;
}

/**
 * The whole screen: the three CRMs' tables, who is on a break, and the closes
 * of the last two hours (newest first). `since` (an instant) keeps only closes
 * Root first saw after it — a screen passes the previous answer's serverTime.
 * The public view carries no email anywhere, and no CRM error beyond a plain
 * sentence.
 */
export async function salesTv(opts: SalesTvOptions = {}) {
  const now = Date.now();
  await crmNames();
  await within(Promise.all(SALES_TV_CRMS.map((c) => refreshCrm(c, now))), WAIT_MS);
  await within(refreshPhotos(Date.now()), PHOTO_WAIT_MS);
  dropOldCloses(Date.now());

  const pub = opts.publicView === true;
  const since = validIso(opts.since) ? Date.parse(opts.since as string) : null;

  const crms = SALES_TV_CRMS.map((code) => {
    const s = state.get(code)!;
    const status = s.error ? (s.outdated ? "outdated" : "error") : s.people ? "ok" : "loading";
    const error = !s.error ? null : s.outdated ? s.error : pub ? `${nameOf(code)} can't be reached right now.` : s.error;
    const people = shownPeople(s, opts.withBosses === true).map((p) => {
      const photoUrl = (p.email && photos.get(p.email)?.url) || null;
      return pub ? {
        id: p.id, name: p.name, team: p.team, closingsMonth: p.closingsMonth, closingsToday: p.closingsToday,
        callsToday: p.callsToday, connectedToday: p.connectedToday, talkSecondsToday: p.talkSecondsToday, photoUrl,
        revenueMonth: p.revenueMonth,
      } : { ...p, photoUrl };
    });
    return {
      code, name: nameOf(code), status, error, month: s.month,
      peopleUpdatedAt: s.peopleAt ? new Date(s.peopleAt).toISOString() : null,
      liveUpdatedAt: s.liveAt ? new Date(s.liveAt).toISOString() : null,
      people,
    };
  });

  const onBreak = SALES_TV_CRMS.flatMap((code) => state.get(code)!.onBreak.map((b) => {
    const photoUrl = (b.email && photos.get(b.email)?.url) || null;
    const row = { ...b, crm: code, crmName: nameOf(code), photoUrl };
    if (!pub) return row;
    const { email: _email, ...open } = row;
    return open;
  })).sort((a, b) => Date.parse(a.since) - Date.parse(b.since));

  const closeList = [...closes.values()]
    .filter((c) => since === null || Date.parse(c.seenAt) > since)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map((c) => {
      const row = { ...c, crmName: nameOf(c.crm) };
      if (!pub) return row;
      const { closerEmail: _email, ...open } = row;
      return open;
    });

  return { serverTime: new Date().toISOString(), crms, onBreak, closes: closeList };
}
