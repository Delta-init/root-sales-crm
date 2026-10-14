import { Types } from "mongoose";
import { Organization } from "../models/Organization.js";
import { getSources } from "./crmConnections.js";
import { callTarget, httpError, resolveTarget } from "../lib/targetClient.js";

/*
 * 3CX calls, every portal at once (the user, 2026-10-14): the "3CX calls" page
 * under Sales, and each person's calls on the Pending page.
 *
 *   - The Sales CRM (delta), Draw and Tetra Commission sync their calls from
 *     3CX and answer for themselves: GET /api/v1/service/calls with the portal
 *     secret Root already holds — their own Calls page's filters, totals and
 *     per-person table, each person with their email. Root does not copy their
 *     logic.
 *   - Banglore has no 3CX: its calls come from a phone call-recorder app (and a
 *     few click-to-calls) into its calllogs, read here straight from its
 *     database (read only). The recorder app does not say who made a call, so
 *     those are not anybody's.
 *   - The Remote CRM has no calls system.
 *
 * One person's calls are put together across portals by email. A recording
 * plays from the portal that has it: Root asks it for a link it signs for 10
 * minutes and hands that to the browser — no 3CX key ever reaches Root.
 */

export const CALL_PORTALS: Record<string, "3cx" | "recorder"> = {
  delta: "3cx",
  draw: "3cx",
  commission: "3cx",
  banglore: "recorder",
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UAE_MS = 4 * 3_600_000;
export const dubaiToday = (t = Date.now()) => new Date(t + UAE_MS).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dayStart = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - UAE_MS);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const KEYS = ["calls", "outgoing", "incoming", "connected", "missed", "notAnswered", "talkSeconds", "recorded"] as const;
export type CallTotals = Record<(typeof KEYS)[number], number> & { avgTalkSeconds: number };
const zero = (): CallTotals => ({ calls: 0, outgoing: 0, incoming: 0, connected: 0, missed: 0, notAnswered: 0, talkSeconds: 0, recorded: 0, avgTalkSeconds: 0 });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
function totalsOf(x: Record<string, unknown> | null | undefined): CallTotals {
  const t = zero();
  for (const k of KEYS) t[k] = num(x?.[k]);
  t.avgTalkSeconds = t.connected ? Math.round(t.talkSeconds / t.connected) : 0;
  return t;
}
function addInto(a: CallTotals, b: CallTotals) {
  for (const k of KEYS) a[k] += b[k];
  a.avgTalkSeconds = a.connected ? Math.round(a.talkSeconds / a.connected) : 0;
}

export interface CallPerson extends CallTotals { key: string; userId: string; name: string; email: string; extension: string }
export interface CallRow {
  portal: string;
  portalName: string;
  id: string;
  startedAt: string;
  direction: "in" | "out";
  status: "answered" | "missed" | "no_answer";
  talkSeconds: number;
  ringSeconds: number;
  number: string;
  extension: string;
  person: string;
  personName: string;
  personEmail: string;
  contact: string;
  contactKind: string;
  recordings: number;
}
interface PortalAnswer { stats: CallTotals; people: CallPerson[]; calls: CallRow[]; total: number }

export interface CallFilters {
  from?: string;
  to?: string;
  portal?: string;
  person?: string;
  direction?: string;
  result?: string;
  search?: string;
  sort?: string;
  order?: string;
  page?: string;
  limit?: string;
}

/** The period, Dubai days: from/to as given, else the last 7 days to today. */
export function periodOf(f: Pick<CallFilters, "from" | "to">): { from: string; to: string } {
  const from = String(f.from ?? "").trim(), to = String(f.to ?? "").trim();
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) throw httpError("from / to must be dates (YYYY-MM-DD)", 400);
  const today = dubaiToday();
  const p = { from: from || (to ? to : addDays(today, -6)), to: to || today };
  if (p.from > p.to) throw httpError("from is after to", 400);
  return p;
}

/* ── a portal that answers for itself ─────────────────────────────────────── */

async function servicePortal(org: { code: string; name: string }, q: Record<string, string>): Promise<PortalAnswer> {
  const target = await resolveTarget(org.code);
  let answer: Record<string, unknown>;
  try {
    answer = await callTarget<Record<string, unknown>>(target, `/calls?${new URLSearchParams(q)}`, { method: "GET", verb: "share its calls" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not be read";
    // Its server from before this page: the route is not there yet.
    throw new Error(/404|not found/i.test(message) ? `${org.name}'s server needs updating — it has no calls endpoint yet` : message);
  }
  const people = (Array.isArray(answer.people) ? answer.people : []) as Record<string, unknown>[];
  const calls = (Array.isArray(answer.calls) ? answer.calls : []) as Record<string, unknown>[];
  return {
    stats: totalsOf(answer.stats as Record<string, unknown>),
    people: people.map((p) => ({
      ...totalsOf(p),
      key: String(p.key ?? ""),
      userId: String(p.userId ?? ""),
      name: String(p.name ?? "") || "Unknown",
      email: String(p.email ?? "").trim().toLowerCase(),
      extension: String(p.extension ?? ""),
    })),
    calls: calls.map((c) => ({
      portal: org.code,
      portalName: org.name,
      id: String(c.id ?? ""),
      startedAt: String(c.startedAt ?? ""),
      direction: c.direction === "in" ? "in" : "out",
      status: c.status === "answered" || c.status === "missed" ? c.status : "no_answer",
      talkSeconds: num(c.talkSeconds),
      ringSeconds: num(c.ringSeconds),
      number: String(c.number ?? ""),
      extension: String(c.extension ?? ""),
      person: String(c.person ?? "-"),
      personName: String(c.userName || c.agentName || (c.extension ? `Ext ${c.extension}` : "")),
      personEmail: String(c.userEmail ?? "").toLowerCase(),
      contact: String(c.contact ?? ""),
      contactKind: String(c.contactKind ?? ""),
      recordings: num(c.recordings),
    })),
    total: num(answer.total),
  };
}

/* ── Banglore: the call-recorder app's calls, from its database ───────────── */

/** A call log's type → direction and result. A missed or unanswered call has no talk time. */
const RECORDER_KIND = {
  status: {
    $switch: {
      branches: [
        { case: { $eq: ["$callType", "Missed"] }, then: "missed" },
        { case: { $eq: ["$callType", "Notanswered"] }, then: "no_answer" },
        { case: { $gt: [{ $ifNull: ["$callDuration", 0] }, 0] }, then: "answered" },
      ],
      default: { $cond: [{ $eq: ["$callDirection", "outbound"] }, "no_answer", "missed"] },
    },
  },
  direction: { $cond: [{ $eq: ["$callDirection", "outbound"] }, "out", "in"] },
};
const RESULT_OF: Record<string, string> = { connected: "answered", answered: "answered", missed: "missed", not_answered: "no_answer", no_answer: "no_answer" };

async function recorderPortal(org: { code: string; name: string }, f: CallFilters, period: { from: string; to: string }, want: { list: boolean; need: number }): Promise<PortalAnswer> {
  const { sources, failures } = await getSources();
  const src = sources.find((s) => s.org.code === org.code);
  if (!src) throw new Error(failures.find((x) => x.code === org.code)?.error ?? `${org.name}'s database is not configured on this server`);
  const logs = src.conn.collection("calllogs");
  const users = src.conn.collection("users");

  const match: Record<string, unknown>[] = [{ callDate: { $gte: dayStart(period.from), $lt: dayStart(addDays(period.to, 1)) } }];
  const search = String(f.search ?? "").trim().slice(0, 100);
  if (search) {
    const or: Record<string, unknown>[] = [{ contactName: { $regex: escape(search), $options: "i" } }];
    const digits = search.replace(/\D/g, "").replace(/^0+/, "");
    if (digits.length >= 3) or.push({ phoneNumber: { $regex: digits } });
    match.push({ $or: or });
  }
  const after: Record<string, unknown>[] = [];
  if (f.direction === "in" || f.direction === "out") after.push({ direction: f.direction });
  if (RESULT_OF[String(f.result ?? "")]) after.push({ status: RESULT_OF[String(f.result)] });
  const person = String(f.person ?? "");
  const onePerson = person && person !== "all"
    ? person === "-" ? { userId: null } : person.startsWith("u:") && Types.ObjectId.isValid(person.slice(2)) ? { userId: new Types.ObjectId(person.slice(2)) } : { userId: "__nobody__" }
    : null;

  const shaped = [
    { $match: { $and: match } },
    { $addFields: { ...RECORDER_KIND, userId: { $ifNull: ["$initiatedBy", null] }, talk: { $ifNull: ["$callDuration", 0] } } },
    ...(after.length ? [{ $match: { $and: after } }] : []),
  ];
  const cnt = (field: string, v: string) => ({ $sum: { $cond: [{ $eq: [field, v] }, 1, 0] } });
  const grouped = (await logs.aggregate([
    ...shaped,
    {
      $group: {
        _id: "$userId",
        agentName: { $first: "$agentName" },
        calls: { $sum: 1 },
        outgoing: cnt("$direction", "out"),
        incoming: cnt("$direction", "in"),
        connected: cnt("$status", "answered"),
        missed: cnt("$status", "missed"),
        notAnswered: cnt("$status", "no_answer"),
        talkSeconds: { $sum: "$talk" },
        recorded: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$recordingUrl", ""] } }, 0] }, 1, 0] } },
      },
    },
  ]).toArray()) as Record<string, unknown>[];
  const ids = grouped.map((g) => g._id).filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);
  const named = ids.length ? await users.find({ _id: { $in: ids } }, { projection: { name: 1, email: 1 } }).toArray() : [];
  const userOf = new Map(named.map((u) => [String(u._id), { name: String(u.name ?? ""), email: String(u.email ?? "").toLowerCase() }]));
  const people: CallPerson[] = grouped.map((g) => {
    const id = g._id ? String(g._id) : "";
    const u = userOf.get(id);
    return {
      ...totalsOf(g),
      key: id ? `u:${id}` : "-",
      userId: id,
      name: u?.name || String(g.agentName ?? "") || (id ? "Unknown user" : "Not linked to an employee (call recorder)"),
      email: u?.email ?? "",
      extension: "",
    };
  }).sort((a, b) => b.calls - a.calls);
  const stats = zero();
  for (const p of onePerson ? people.filter((p) => p.key === person) : people) addInto(stats, p);

  let calls: CallRow[] = [];
  if (want.list) {
    const sortField = f.sort === "talk" ? "talk" : "callDate";
    const docs = (await logs.aggregate([
      ...shaped,
      ...(onePerson ? [{ $match: onePerson }] : []),
      { $sort: { [sortField]: f.order === "asc" ? 1 : -1, callDate: -1, _id: -1 } },
      { $limit: want.need },
    ]).toArray()) as Record<string, any>[];
    calls = docs.map((c) => {
      const id = c.userId ? String(c.userId) : "";
      const u = userOf.get(id);
      return {
        portal: org.code,
        portalName: org.name,
        id: String(c._id),
        startedAt: new Date(c.callDate).toISOString(),
        direction: c.direction,
        status: c.status,
        talkSeconds: num(c.talk),
        ringSeconds: 0,
        number: String(c.phoneNumber ?? ""),
        extension: String(c.agentExtension ?? ""),
        person: id ? `u:${id}` : "-",
        personName: u?.name || String(c.agentName ?? ""),
        personEmail: u?.email ?? "",
        contact: String(c.contactName ?? ""),
        contactKind: c.leadId ? "lead" : "",
        recordings: c.recordingUrl ? 1 : 0,
      } satisfies CallRow;
    });
  }
  return { stats, people, calls, total: stats.calls };
}

/* ── every portal ─────────────────────────────────────────────────────────── */

async function callOrgs(only?: string) {
  const orgs = await Organization.find({ isActive: true, code: { $in: Object.keys(CALL_PORTALS) } })
    .select("code name accent sortOrder").sort({ sortOrder: 1 }).lean();
  return orgs.filter((o) => !only || only === "all" || o.code === only);
}

async function askPortal(org: { code: string; name: string }, f: CallFilters, period: { from: string; to: string }, want: { list: boolean; need: number }): Promise<PortalAnswer> {
  if (CALL_PORTALS[org.code] === "recorder") return recorderPortal(org, f, period, want);
  const q: Record<string, string> = { from: period.from, to: period.to };
  for (const k of ["direction", "result", "search", "sort", "order"] as const) if (f[k]) q[k] = String(f[k]);
  if (f.person && f.person !== "all") q.person = f.person;
  if (want.list) { q.page = "1"; q.limit = String(want.need); } else q.list = "0";
  return servicePortal(org, q);
}

export interface PortalCallsSummary {
  code: string;
  name: string;
  accent: string;
  kind: "3cx" | "recorder";
  available: boolean;
  error?: string;
  stats: CallTotals;
}

/** One person across portals: by email, else per portal. */
export interface CallEveryone extends CallTotals {
  key: string;
  name: string;
  email: string;
  portals: { code: string; name: string; person: string; calls: number; connected: number; talkSeconds: number }[];
}

function mergePeople(answers: { org: { code: string; name: string }; answer: PortalAnswer }[]): CallEveryone[] {
  const everyone = new Map<string, CallEveryone>();
  for (const { org, answer } of answers) {
    for (const p of answer.people) {
      const key = p.email || `${org.code}:${p.key}`;
      const row = everyone.get(key) ?? { key, name: p.name, email: p.email, portals: [], ...zero() };
      addInto(row, p);
      row.portals.push({ code: org.code, name: org.name, person: p.key, calls: p.calls, connected: p.connected, talkSeconds: p.talkSeconds });
      everyone.set(key, row);
    }
  }
  return [...everyone.values()].sort((a, b) => b.calls - a.calls || b.talkSeconds - a.talkSeconds || a.name.localeCompare(b.name));
}

const MAX_WINDOW = 1000;

/**
 * The 3CX calls page: the totals per portal and overall, everyone's figures,
 * and a page of calls, newest first (or by talk time), every portal's merged.
 * A person picked ("<portal>|<key>") narrows to that portal.
 */
export async function callsOverview(f: CallFilters) {
  const period = periodOf(f);
  let portalCode = String(f.portal ?? "all");
  let person = String(f.person ?? "");
  if (person && person !== "all") {
    const [code, ...rest] = person.split("|");
    if (!code || !CALL_PORTALS[code] || !rest.length) throw httpError("Unknown person", 400);
    portalCode = code;
    person = rest.join("|");
  }
  if (portalCode !== "all" && !CALL_PORTALS[portalCode]) throw httpError("Unknown portal", 400);
  const page = Math.max(1, Math.floor(Number(f.page) || 1));
  const limit = Math.min(200, Math.max(1, Math.floor(Number(f.limit) || 50)));
  const need = Math.min(MAX_WINDOW, page * limit);

  const orgs = await callOrgs(portalCode);
  const results = await Promise.all(orgs.map(async (org) => {
    try {
      return { org, answer: await askPortal(org, { ...f, person }, period, { list: true, need }), error: "" };
    } catch (error) {
      return { org, answer: null, error: error instanceof Error ? error.message : "Could not be read" };
    }
  }));

  const portals: PortalCallsSummary[] = results.map(({ org, answer, error }) => ({
    code: org.code, name: org.name, accent: org.accent ?? "", kind: CALL_PORTALS[org.code]!,
    available: !!answer, ...(answer ? {} : { error }), stats: answer?.stats ?? zero(),
  }));
  const ok = results.filter((r): r is typeof r & { answer: PortalAnswer } => !!r.answer);
  const stats = zero();
  for (const r of ok) addInto(stats, r.answer.stats);

  const byTalk = f.sort === "talk";
  const asc = f.order === "asc";
  const merged = ok.flatMap((r) => r.answer.calls).sort((a, b) => {
    const d = byTalk ? a.talkSeconds - b.talkSeconds : a.startedAt.localeCompare(b.startedAt);
    return (asc ? d : -d) || b.startedAt.localeCompare(a.startedAt);
  });
  const total = ok.reduce((n, r) => n + r.answer.total, 0);
  return {
    period,
    portals,
    stats,
    people: mergePeople(ok),
    calls: merged.slice((page - 1) * limit, page * limit),
    total,
    page,
    limit,
    /** Pages past the first 1,000 calls are not reachable: narrow the dates or filters. */
    capped: page * limit > MAX_WINDOW,
  };
}

/** Each person's calls in a period, for the Pending page: by email across portals, without the calls themselves. */
export async function callsByPerson(f: Pick<CallFilters, "from" | "to">) {
  const period = periodOf({ from: f.from || dubaiToday(), to: f.to || dubaiToday() });
  const orgs = await callOrgs();
  const results = await Promise.all(orgs.map(async (org) => {
    try {
      return { org, answer: await askPortal(org, {}, period, { list: false, need: 0 }), error: "" };
    } catch (error) {
      return { org, answer: null, error: error instanceof Error ? error.message : "Could not be read" };
    }
  }));
  const ok = results.filter((r): r is typeof r & { answer: PortalAnswer } => !!r.answer);
  const stats = zero();
  for (const r of ok) addInto(stats, r.answer.stats);
  return {
    period,
    portals: results.map(({ org, answer, error }) => ({
      code: org.code, name: org.name, accent: org.accent ?? "", kind: CALL_PORTALS[org.code]!,
      available: !!answer, ...(answer ? {} : { error }), stats: answer?.stats ?? zero(),
    })) satisfies PortalCallsSummary[],
    stats,
    people: mergePeople(ok),
  };
}

/** A recording's link for the browser: signed by the portal that has it, 10 minutes. */
export async function recordingLink(portal: string, id: string, indexRaw: unknown): Promise<{ url: string; expiresIn: number }> {
  if (!CALL_PORTALS[portal]) throw httpError("Unknown portal", 400);
  if (!/^[a-f0-9]{24}$/i.test(id)) throw httpError("Invalid call id", 400);
  const index = /^\d{1,2}$/.test(String(indexRaw ?? "0")) ? Number(indexRaw ?? 0) : -1;
  if (index < 0) throw httpError("index must be a small number", 400);
  const org = await Organization.findOne({ code: portal, isActive: true }).select("code name").lean();
  if (!org) throw httpError("Unknown portal", 404);

  if (CALL_PORTALS[portal] === "recorder") {
    const { sources } = await getSources();
    const src = sources.find((s) => s.org.code === portal);
    if (!src) throw httpError(`${org.name}'s database is not configured on this server`, 503);
    const log = await src.conn.collection("calllogs").findOne({ _id: new Types.ObjectId(id) }, { projection: { recordingUrl: 1 } });
    const url = String(log?.recordingUrl ?? "");
    if (index !== 0 || !/^https?:\/\//i.test(url)) throw httpError("No recording for this call", 404);
    // Stored as http://; this page is https, where a browser would block it.
    return { url: url.replace(/^http:\/\//i, "https://"), expiresIn: 0 };
  }

  const target = await resolveTarget(portal);
  let link: { path?: string; expiresIn?: number };
  try {
    link = await callTarget<{ path?: string; expiresIn?: number }>(target, `/calls/${id}/recording-link?index=${index}`, { method: "GET", verb: "give that recording" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/No recording/i.test(message)) throw httpError("No recording for this call", 404);
    throw error;
  }
  if (!link?.path || !link.path.startsWith("/")) throw httpError(`${org.name} gave no recording link`, 502);
  return { url: `${target.base}${link.path}`, expiresIn: num(link.expiresIn) };
}
