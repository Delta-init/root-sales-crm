import { Organization } from "../models/Organization.js";
import { getSources } from "./crmConnections.js";
import { CALL_PORTALS, callsOverview } from "./callsService.js";
import { markedOf } from "./salesPendingService.js";
import { resolveTarget, callTarget } from "../lib/targetClient.js";
import { targetConfig } from "../config/targets.js";

/*
 * Reports → Sales, a tab per sales CRM (the user, 2026-10-17): what each
 * salesperson did in a period, read from the CRM's database as the Salespeople
 * page reads it (same rules as each CRM's Leaderboard), per person, team and
 * month (Gulf days), with the rows behind every figure:
 *
 *   leads       leads that reached them in the period (createdAt, which a
 *               hand-over resets), and how many are still untouched
 *   followups   follow-ups they logged; leads they worked (a status change)
 *   closings    enrolments credited to them in the period (dropped ones not),
 *               and the conversion against leads received
 *   revenue     payments dated in the period on the leads they hold, in the
 *               CRM's own currency
 *   lost        leads marked lost — with the reason — or not connected in the
 *               period, against the lead's owner
 *   calls       their calls: connected, talk time, recordings (3CX)
 *   commission  commission counted on sales made in the period
 *
 * Read-only.
 */

const QUERY_MS = 20_000;
const ROWS = 2000;
const UAE_MS = 4 * 3_600_000;
const httpError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const monthOf = (d: Date | string) => new Date(new Date(d).getTime() + UAE_MS).toISOString().slice(0, 7);
const cents = (n: number) => Math.round(n * 100) / 100;

type Num = Record<string, number>;
interface Who { id: string; name: string; team: string; active: boolean }

/** Sums by person, team and month, as Tetra Commission's report grouper does. */
function grouper(blank: () => Num) {
  const people = new Map<string, Who & Num>(), teams = new Map<string, { team: string } & Num>(), months = new Map<string, { month: string } & Num>();
  const total = blank();
  const sum = (into: Num, add: Num) => { for (const [k, v] of Object.entries(add)) into[k] = cents((into[k] ?? 0) + v); };
  return {
    add(p: Who, at: Date | string | null, add: Num) {
      const row = people.get(p.id) ?? ({ ...p, ...blank() } as Who & Num); sum(row, add); people.set(p.id, row);
      const t = teams.get(p.team) ?? ({ team: p.team, ...blank() } as { team: string } & Num); sum(t, add); teams.set(p.team, t);
      if (at) { const m = monthOf(at); const r = months.get(m) ?? ({ month: m, ...blank() } as { month: string } & Num); sum(r, add); months.set(m, r); }
      sum(total, add);
    },
    out(sortKey: string) {
      const by = (a: Num, b: Num) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0);
      return { total, people: [...people.values()].sort(by), teams: [...teams.values()].sort(by), months: [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1)) };
    },
  };
}
const latest = <T extends { at: string }>(rows: T[]) => rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, ROWS);

export async function salesReport(code: string, q: { from?: unknown; to?: unknown; team?: unknown; person?: unknown }) {
  const org = await Organization.findOne({ code, isActive: true, kind: "crm" }).select("code name accent currency").lean();
  if (!org) throw httpError("No such sales CRM", 404);
  const parse = (v: unknown) => (typeof v === "string" && v ? new Date(v) : undefined);
  const from = parse(q.from), to = parse(q.to);
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw httpError("from / to must be dates", 400);
  if (from && to && from > to) throw httpError("from is after to", 400);
  const within = (field: string) => (from || to ? { [field]: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {});
  const inPeriod = (d: Date | string | null | undefined) => {
    if (!d) return false;
    const t = new Date(d).getTime();
    return Number.isFinite(t) && (!from || t >= from.getTime()) && (!to || t <= to.getTime());
  };

  const { sources, failures } = await getSources();
  const src = sources.find((s) => s.org.code === code);
  if (!src) throw httpError(failures.find((f) => f.code === code)?.error ?? `${org.name} could not be read`, 409);
  const leads = src.conn.collection("leads");

  const [users, teams] = await Promise.all([
    src.conn.collection("users").find({}, { projection: { name: 1, email: 1, status: 1 }, maxTimeMS: QUERY_MS }).toArray(),
    src.conn.collection("teams").find({}, { projection: { name: 1, leaders: 1, members: 1 }, maxTimeMS: QUERY_MS }).toArray(),
  ]);
  const teamOf = new Map<string, { id: string; name: string }>();
  for (const t of teams) for (const id of [...(t.leaders ?? []), ...(t.members ?? [])].map(String)) if (!teamOf.has(id)) teamOf.set(id, { id: String(t._id), name: String(t.name ?? "") });
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const idByEmail = new Map(users.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), String(u._id)]));
  const who = (id: unknown): Who => {
    const key = String(id ?? "");
    const u = userById.get(key);
    return { id: key, name: String(u?.name ?? "") || (key ? "Unknown user" : "Nobody"), team: teamOf.get(key)?.name || "No team", active: u ? u.status !== "inactive" : false };
  };
  const team = typeof q.team === "string" ? q.team : "", person = typeof q.person === "string" ? q.person : "";
  const counts = (p: Who) => (!team || teamOf.get(p.id)?.id === team) && (!person || p.id === person);
  const tag = (p: Who) => ({ owner_id: p.id, owner: p.name, team: p.team });

  const [received, followUps, worked, closings, payments, lostish, commission, calls] = await Promise.all([
    leads.find({ assignedTo: { $ne: null }, ...within("createdAt") }, { projection: { name: 1, phone: 1, source: 1, status: 1, assignedTo: 1, createdAt: 1 }, maxTimeMS: QUERY_MS }).toArray(),
    leads.aggregate([
      { $match: within("followUps.followedUpAt") },
      { $unwind: "$followUps" },
      { $match: within("followUps.followedUpAt") },
      { $project: { name: 1, phone: 1, status: 1, by: "$followUps.followedUpBy", at: "$followUps.followedUpAt", note: "$followUps.note" } },
    ], { maxTimeMS: QUERY_MS }).toArray(),
    leads.aggregate([
      { $match: { activityLogs: { $elemMatch: { action: "status_changed", ...(from || to ? { createdAt: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}) } } } },
      { $unwind: "$activityLogs" },
      { $match: { "activityLogs.action": "status_changed", ...within("activityLogs.createdAt") } },
      { $project: { by: "$activityLogs.performedBy", at: "$activityLogs.createdAt", lead: "$_id" } },
    ], { maxTimeMS: QUERY_MS }).toArray(),
    src.conn.collection("students").find({ status: { $ne: "dropped" }, ...within("enrollmentDate") },
      { projection: { name: 1, course: 1, totalFee: 1, paidAmount: 1, enrollmentDate: 1, assignedTo: 1, status: 1 }, maxTimeMS: QUERY_MS }).toArray(),
    leads.aggregate([
      { $match: { assignedTo: { $ne: null }, ...within("payments.paidAt") } },
      { $unwind: "$payments" },
      { $match: within("payments.paidAt") },
      { $project: { name: 1, assignedTo: 1, amount: "$payments.amount", at: "$payments.paidAt", note: "$payments.note" } },
    ], { maxTimeMS: QUERY_MS }).toArray(),
    leads.find({ status: { $in: ["lost", "not_connected"] }, ...(from ? { updatedAt: { $gte: from } } : {}) },
      { projection: { name: 1, phone: 1, source: 1, status: 1, lostReason: 1, lostNotes: 1, assignedTo: 1, updatedAt: 1, activityLogs: 1 }, maxTimeMS: QUERY_MS }).limit(20_000).toArray(),
    src.conn.collection("commissionsales").find({ state: "counted", ...within("saleDate") },
      { projection: { studentName: 1, courseName: 1, saleDate: 1, lines: 1, fee: 1 }, maxTimeMS: QUERY_MS }).toArray().catch(() => []),
    CALL_PORTALS[code]
      ? callsOverview({ portal: code, ...(from ? { from: new Date(from.getTime() + UAE_MS).toISOString().slice(0, 10) } : {}),
          ...(to ? { to: new Date(to.getTime() + UAE_MS).toISOString().slice(0, 10) } : {}), page: "1", limit: "200" })
        .then((c) => { const mine = c.portals.find((x) => x.code === code); return mine && !mine.available ? { error: mine.error ?? "Could not be read" } : { data: c }; })
        .catch((e) => ({ error: e instanceof Error ? e.message : "Could not be read" }))
      : Promise.resolve(null),
  ]);

  /* Leads */
  const lg = grouper(() => ({ received: 0, untouched: 0 }));
  const leadRows: Record<string, unknown>[] = [];
  const receivedBy = new Map<string, number>();
  const bySource = new Map<string, number>();
  for (const l of received) {
    const p = who(l.assignedTo);
    if (!counts(p)) continue;
    const untouched = l.status === "new" || l.status === "assigned";
    lg.add(p, l.createdAt, { received: 1, untouched: untouched ? 1 : 0 });
    receivedBy.set(p.id, (receivedBy.get(p.id) ?? 0) + 1);
    const s = String(l.source ?? "") || "No source"; bySource.set(s, (bySource.get(s) ?? 0) + 1);
    leadRows.push({ at: new Date(l.createdAt ?? 0).toISOString(), lead: String(l.name ?? "") || "No name", phone: String(l.phone ?? ""), source: String(l.source ?? ""), status: String(l.status ?? ""), ...tag(p) });
  }

  /* Follow-ups and worked */
  const fg = grouper(() => ({ followups: 0, leads_contacted: 0, status_changes: 0 }));
  const fuRows: Record<string, unknown>[] = [];
  const contacted = new Map<string, Set<string>>();
  for (const f of followUps) {
    const p = who(f.by);
    if (!counts(p) || !f.by) continue;
    const seen = contacted.get(p.id) ?? new Set<string>();
    const fresh = !seen.has(String(f._id)) ? 1 : 0;
    seen.add(String(f._id)); contacted.set(p.id, seen);
    fg.add(p, f.at, { followups: 1, leads_contacted: fresh });
    fuRows.push({ at: new Date(f.at).toISOString(), lead: String(f.name ?? "") || "No name", phone: String(f.phone ?? ""), status: String(f.status ?? ""), note: String(f.note ?? "").slice(0, 300), ...tag(p) });
  }
  for (const w of worked) {
    const p = who(w.by);
    if (!counts(p) || !w.by) continue;
    fg.add(p, w.at, { status_changes: 1 });
  }

  /* Closings */
  const courseIds = [...new Set(closings.map((s) => s.course).filter(Boolean).map(String))];
  const courseName = new Map((courseIds.length ? await src.conn.collection("courses").find({ _id: { $in: closings.map((s) => s.course).filter(Boolean) } },
    { projection: { name: 1, title: 1 }, maxTimeMS: QUERY_MS }).toArray() : []).map((c) => [String(c._id), String(c.name ?? c.title ?? "")]));
  const cg = grouper(() => ({ closings: 0, fee: 0, collected: 0 }));
  const closingRows: Record<string, unknown>[] = [];
  for (const s of closings) {
    const p = who(s.assignedTo);
    if (!counts(p)) continue;
    cg.add(p, s.enrollmentDate, { closings: 1, fee: Number(s.totalFee) || 0, collected: Number(s.paidAmount) || 0 });
    closingRows.push({ at: new Date(s.enrollmentDate ?? 0).toISOString(), student: String(s.name ?? ""), course: courseName.get(String(s.course ?? "")) ?? "", fee: Number(s.totalFee) || 0,
      collected: Number(s.paidAmount) || 0, status: String(s.status ?? ""), ...tag(p) });
  }
  const closingsOut = cg.out("closings");
  // Conversion: closings against the leads that reached them in the period.
  for (const r of closingsOut.people as (Who & Num)[]) r.conversion = receivedBy.get(r.id) ? cents(((r.closings ?? 0) / receivedBy.get(r.id)!) * 100) : 0;
  (closingsOut.total as Num).conversion = received.length ? cents(((closingsOut.total.closings ?? 0) / [...receivedBy.values()].reduce((a, b) => a + b, 0)) * 100) : 0;

  /* Revenue */
  const rg = grouper(() => ({ payments: 0, revenue: 0 }));
  const revenueRows: Record<string, unknown>[] = [];
  for (const pay of payments) {
    const p = who(pay.assignedTo);
    if (!counts(p)) continue;
    rg.add(p, pay.at, { payments: 1, revenue: Number(pay.amount) || 0 });
    revenueRows.push({ at: new Date(pay.at).toISOString(), lead: String(pay.name ?? ""), amount: Number(pay.amount) || 0, note: String(pay.note ?? "").slice(0, 200), ...tag(p) });
  }

  /* Lost and not connected, marked in the period */
  const xg = grouper(() => ({ lost: 0, not_connected: 0 }));
  const lostRows: Record<string, unknown>[] = [];
  const reasons = new Map<string, number>();
  for (const l of lostish) {
    const m = markedOf(l, String(l.status));
    if (!inPeriod(m.at)) continue;
    const p = who(l.assignedTo);
    if (!counts(p)) continue;
    const lost = l.status === "lost";
    xg.add(p, m.at, lost ? { lost: 1 } : { not_connected: 1 });
    const reason = lost ? String(l.lostReason ?? "") || "not_given" : "";
    if (lost) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    lostRows.push({ at: m.at, lead: String(l.name ?? "") || "No name", phone: String(l.phone ?? ""), source: String(l.source ?? ""), status: String(l.status), reason,
      notes: String(l.lostNotes ?? ""), marked_by: m.by ? who(m.by).name : "", ...tag(p) });
  }

  /* Calls */
  const callG = grouper(() => ({ calls: 0, connected: 0, talk_seconds: 0 }));
  let callRows: Record<string, unknown>[] = [];
  let callsInfo: { supported: boolean; available: boolean; message?: string; kind: string | null; unlinked: number } = { supported: !!CALL_PORTALS[code], available: false, kind: CALL_PORTALS[code] ?? null, unlinked: 0 };
  if (calls && "data" in calls && calls.data) {
    callsInfo = { ...callsInfo, available: true };
    for (const x of calls.data.people) {
      const pc = x.portals.find((y) => y.code === code);
      if (!pc) continue;
      const id = (userById.has(pc.person) ? pc.person : "") || (x.email ? idByEmail.get(x.email) ?? "" : "");
      if (!id) { callsInfo.unlinked += pc.calls; continue; }
      const p = who(id);
      if (!counts(p)) continue;
      callG.add(p, null, { calls: pc.calls, connected: pc.connected, talk_seconds: pc.talkSeconds });
    }
    callRows = calls.data.calls.map((c) => {
      const id = (userById.has(c.person) ? c.person : "") || idByEmail.get(c.personEmail) || "";
      const p = who(id);
      return { at: c.startedAt, id: c.id, portal: c.portal, direction: c.direction, status: c.status, talk_seconds: c.talkSeconds, recordings: c.recordings,
        contact: c.contact || c.number, ...(id ? tag(p) : { owner_id: "", owner: c.personName || "—", team: "" }) };
    }).filter((r) => !person || r.owner_id === person);
  } else if (calls && "error" in calls) callsInfo = { ...callsInfo, message: calls.error };

  /* Commission */
  const kg = grouper(() => ({ sales: 0, commission: 0 }));
  const commissionRows: Record<string, unknown>[] = [];
  for (const sale of commission as Record<string, any>[]) {
    for (const line of sale.lines ?? []) {
      const p = who(line.user);
      if (!counts(p)) continue;
      kg.add(p, sale.saleDate, { sales: 1, commission: Number(line.amount) || 0 });
      commissionRows.push({ at: new Date(sale.saleDate).toISOString(), student: String(sale.studentName ?? ""), course: String(sale.courseName ?? ""), role: String(line.role ?? ""),
        amount: Number(line.amount) || 0, ...tag(p) });
    }
  }

  return {
    code: org.code, name: org.name, currency: (org as { currency?: string }).currency || "AED",
    period: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
    filters: {
      teams: teams.map((t) => ({ id: String(t._id), name: String(t.name ?? "") })).sort((a, b) => a.name.localeCompare(b.name)),
      people: users.filter((u) => u.status !== "inactive").map((u) => ({ id: String(u._id), name: String(u.name ?? ""), team_id: teamOf.get(String(u._id))?.id ?? "" })).sort((a, b) => a.name.localeCompare(b.name)),
    },
    leads: { ...lg.out("received"), sources: [...bySource].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count), rows: latest(leadRows as any) },
    followups: { ...fg.out("followups"), rows: latest(fuRows as any) },
    closings: { ...closingsOut, rows: latest(closingRows as any) },
    revenue: { ...rg.out("revenue"), rows: latest(revenueRows as any) },
    lost: { ...xg.out("lost"), reasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count), rows: latest(lostRows as any) },
    calls: { ...callG.out("calls"), ...callsInfo, rows: callRows },
    commission: { ...kg.out("commission"), rows: latest(commissionRows as any) },
  };
}


/*
 * Reports → Sales → a CRM → Lead workflow (the user, 2026-10-17: the Sales CRM's
 * Workflow tab, shown in Root too): the leads that came in over the period and
 * where each went — came in, assigned, worked, inactive, moved, statuses now,
 * by team and by employee — as that CRM's own Inactive Leads → Workflow counts
 * them (GET /service/lead-workflow). The period's instants go as Gulf days
 * (none: today); the CRM refuses more than 92 days. Banglore has no inactive
 * leads, so nothing to ask. Read only.
 */
const NO_INACTIVE_LEADS = new Set(["banglore"]);
const gulfDay = (iso: string) => new Date(Date.parse(iso) + 4 * 3_600_000).toISOString().slice(0, 10);

/** The workflow's period and filters as the CRM takes them: Gulf days, team and person ids. */
function workflowParams(q: { from?: unknown; to?: unknown; team?: unknown; person?: unknown }) {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const from = str(q.from), to = str(q.to);
  for (const v of [from, to]) if (v && !Number.isFinite(Date.parse(v))) throw httpError("from / to must be dates", 400);
  const params = new URLSearchParams();
  if (from || to) {
    params.set("from", gulfDay(from || to));
    params.set("to", gulfDay(to || new Date().toISOString()));
  }
  for (const [k, v] of [["teamId", str(q.team)], ["personId", str(q.person)]] as const) {
    if (!v) continue;
    if (!/^[0-9a-f]{24}$/i.test(v)) throw httpError(`${k === "teamId" ? "team" : "person"} is not an id`, 400);
    params.set(k, v);
  }
  return params;
}

export async function salesLeadWorkflow(code: string, q: { from?: unknown; to?: unknown; team?: unknown; person?: unknown }) {
  const org = await Organization.findOne({ code, isActive: true, kind: "crm" }).select("code name").lean();
  if (!org) throw httpError("No such sales CRM", 404);
  if (NO_INACTIVE_LEADS.has(code)) return { available: false, message: `${org.name} has no inactive leads or mover, so there is no workflow to show.` };
  const params = workflowParams(q);
  const target = await resolveTarget(code);
  try {
    const data = await callTarget<Record<string, unknown>>(target, `/lead-workflow${params.size ? `?${params}` : ""}`, { method: "GET", verb: "share its lead workflow" });
    // Where the CRM's pages are, so a lead in a box's list opens there ("" when its address is not set).
    return { available: true, data, appUrl: targetConfig(code).appUrl.replace(/\/+$/, "") };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not be read";
    if (/not found/i.test(message)) return { available: false, message: `${org.name}'s server needs updating — it has no lead workflow yet.` };
    throw error;
  }
}

/** The leads behind one box of the workflow map (?box, and ?status for a status) — the CRM's own list (2026-10-19). */
export async function salesLeadWorkflowLeads(code: string, q: { from?: unknown; to?: unknown; team?: unknown; person?: unknown; box?: unknown; status?: unknown }) {
  const org = await Organization.findOne({ code, isActive: true, kind: "crm" }).select("code name").lean();
  if (!org) throw httpError("No such sales CRM", 404);
  if (NO_INACTIVE_LEADS.has(code)) throw httpError(`${org.name} has no inactive leads or mover`, 404);
  const box = typeof q.box === "string" ? q.box.trim() : "";
  if (!/^[a-z_]{2,20}$/.test(box)) throw httpError("Say which box", 400);
  const params = workflowParams(q);
  params.set("box", box);
  if (typeof q.status === "string" && q.status.trim()) params.set("status", q.status.trim().slice(0, 40));
  const target = await resolveTarget(code);
  try {
    return await callTarget<Record<string, unknown>>(target, `/lead-workflow/leads?${params}`, { method: "GET", verb: "share the leads behind that box" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not be read";
    if (/not found/i.test(message)) throw httpError(`${org.name}'s server needs updating — it can't list a box's leads yet`, 409);
    throw error;
  }
}
