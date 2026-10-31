import { Types, type Connection } from "mongoose";
import { BUILT_IN, slabsInForce } from "./commissionPlanService.js";
import type { ICommissionPlan, IPlanSlabRow, PlanSlabRole } from "../types/index.js";

/*
 * The one commission logic, worked out in Root from Root's plan (the user, 2026-11-01: "one function used by every
 * portal"; "Root works out every figure"). What each sales CRM's commissionService.resolveSale and
 * salaryService.payRows do today, for any of them, with the portal's differences taken from its plan:
 *
 *   - who earns what on a sale: nobody when the closer is a login that earns nothing; the sale's team (its own, else
 *     the closer's one active team) must have exactly one leader and a Sales Manager must be set; the team-leader
 *     rule (paid; never; nothing on a team the Sales Manager leads) and whether a team leader closing in their own
 *     team is paid the TL line too; the amounts from the course's row;
 *   - My Pay for a month: the Sales Manager on the SM slab, a team leader on the TL slab where the portal has one
 *     (else on Sales Staff's, on their own closes), everyone else on Sales Staff's; the target is the money received
 *     in the month on finance-approved sales they count (the payments in AED where the CRM records them, else the fee
 *     times the share received); the level the highest reached; pay = salary + commission earned in the month (paid
 *     in full first) × the level's percent.
 *
 * The CRM's data — its sales records, teams, users, students and finance handovers — is read from its database;
 * nothing is written there. The CRMs keep counting with their own code until they are switched to ask Root.
 */

const QUERY_MS = 15_000;
/** Commission counts sales closed from 1 October 2026 (UAE), as in the CRMs; My Pay starts that month. */
export const PAY_FROM_MONTH = "2026-10";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 1e9) / 1e9;
export const idOf = (v: unknown): string => {
  if (!v) return "";
  if (v instanceof Types.ObjectId) return v.toHexString();
  if (typeof v === "object" && "_id" in (v as object)) return String((v as { _id: unknown })._id);
  return String(v);
};
const oid = (id: string) => (Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null);
const positive = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** A UAE month as two instants, inclusive. */
export function monthRange(month: string): { from: Date; to: Date } {
  const from = new Date(`${month}-01T00:00:00+04:00`);
  const [y, m] = month.split("-").map(Number);
  const next = new Date(`${m === 12 ? y! + 1 : y}-${String(m === 12 ? 1 : m! + 1).padStart(2, "0")}-01T00:00:00+04:00`);
  return { from, to: new Date(next.getTime() - 1) };
}

/** The portal's fixed rules, from its plan (a plan copied before they were kept falls back to the portal's own). */
function rulesOf(plan: ICommissionPlan) {
  const built = BUILT_IN[plan.portal];
  return {
    tlRule: plan.tlRule,
    tlSlab: plan.tlSlab,
    tlPaidOnOwnClose: typeof plan.tlPaidOnOwnClose === "boolean" ? plan.tlPaidOnOwnClose : built.tlPaidOnOwnClose,
  };
}

/* ── Who earns what on a sale ─────────────────────────────────────────────────────────────────────────────────── */

export type SaleState = "counted" | "waiting" | "excluded";
export interface EngineLine { role: PlanSlabRole; user: string; userName: string; amount: number; note?: string }
export interface Resolved {
  state: SaleState;
  reason: string;
  team: string | null;
  teamName: string;
  lines: EngineLine[];
  /** The course's row the amounts were taken from. */
  plan: { sales: number; tl: number; sm: number; creditUsd: number };
}

type TeamDoc = { _id: Types.ObjectId; name?: string; status?: string; leaders?: unknown[]; members?: unknown[] };

/** A course's row in the plan; zeros for one nobody has set. */
export function courseRow(plan: ICommissionPlan, courseId: string) {
  const r = plan.courses.find((c) => c.courseId === courseId);
  return { sales: positive(r?.sales), tl: positive(r?.tl), sm: positive(r?.sm), creditUsd: positive(r?.creditUsd) };
}

/** Names of the CRM's people, read once each. */
class Names {
  private cache = new Map<string, string>();
  constructor(private db: Connection) {}
  async of(id: string): Promise<string> {
    if (!this.cache.has(id)) {
      const _id = oid(id);
      const u = _id ? await this.db.collection("users").findOne({ _id }, { projection: { name: 1 }, maxTimeMS: QUERY_MS }) : null;
      this.cache.set(id, (u?.name as string | undefined) ?? "Unknown user");
    }
    return this.cache.get(id)!;
  }
}

/** The team a sale counts under: its own, else the one active team its closer is in. */
async function teamFor(db: Connection, saleTeam: string, closer: string, closerName: string): Promise<{ team?: TeamDoc; reason?: string }> {
  const own = oid(saleTeam);
  if (own) {
    const t = await db.collection<TeamDoc>("teams").findOne({ _id: own }, { projection: { name: 1, leaders: 1 }, maxTimeMS: QUERY_MS });
    if (t) return { team: t };
  }
  const c = oid(closer);
  const theirs = c
    ? await db.collection<TeamDoc>("teams").find({ status: "active", $or: [{ members: c }, { leaders: c }] }, { projection: { name: 1, leaders: 1 }, maxTimeMS: QUERY_MS }).toArray()
    : [];
  if (theirs.length === 1) return { team: theirs[0] };
  return {
    reason: theirs.length
      ? `${closerName} is in ${theirs.length} teams — the sale has none, so it can't tell whose leader to pay`
      : `${closerName} isn't in a team`,
  };
}

/** Who earns what on a sale, under the portal's plan. Nothing is written. */
export async function resolveSale(
  db: Connection,
  plan: ICommissionPlan,
  input: {
    closer?: string | null; team?: string | null; course?: string | null;
    /** A bundle (Draw): every course of the sale — their rows added up, as the CRM adds them. */
    courses?: string[] | null;
    /** The amounts a held sale was held at (2026-11-01, stage 3): used instead of the course's row. */
    amounts?: { sales: number; tl: number; sm: number; creditUsd?: number } | null;
  },
  names: Names = new Names(db),
): Promise<Resolved> {
  const row = input.amounts
    ? { sales: positive(input.amounts.sales), tl: positive(input.amounts.tl), sm: positive(input.amounts.sm), creditUsd: positive(input.amounts.creditUsd) }
    : input.courses?.length
      ? input.courses.map((c) => courseRow(plan, idOf(c))).reduce((t, r) => ({ sales: t.sales + r.sales, tl: t.tl + r.tl, sm: t.sm + r.sm, creditUsd: t.creditUsd + r.creditUsd }), { sales: 0, tl: 0, sm: 0, creditUsd: 0 })
      : courseRow(plan, idOf(input.course));
  const rules = rulesOf(plan);
  const none = { team: null, teamName: "", lines: [] as EngineLine[], plan: row };
  const closer = idOf(input.closer);
  if (!closer || !Types.ObjectId.isValid(closer)) return { ...none, state: "waiting", reason: "Nobody is set as the closer" };
  const closerName = await names.of(closer);
  const excluded = new Set(plan.excluded.map((p) => p.id));
  if (excluded.has(closer)) return { ...none, state: "excluded", reason: `Closed under ${closerName}, a login that earns no commission` };

  const { team, reason } = await teamFor(db, idOf(input.team), closer, closerName);
  const line = async (role: PlanSlabRole, user: string, amount: number, note?: string): Promise<EngineLine> => ({
    role, user, userName: await names.of(user), amount, ...(note ? { note } : {}),
  });
  const sm = plan.salesManager?.id ?? "";

  if (rules.tlRule === "never") {
    const shown = { team: team ? String(team._id) : null, teamName: team?.name ?? "", lines: [] as EngineLine[], plan: row };
    if (!sm) return { ...shown, state: "waiting", reason: "No Sales Manager is set on the commission plan" };
    return { ...shown, state: "counted", reason: "", lines: [await line("sales", closer, row.sales), await line("sm", sm, row.sm)] };
  }

  if (!team) return { ...none, state: "waiting", reason: reason ?? "No team" };
  const onTeam = { team: String(team._id), teamName: team.name ?? "", lines: [] as EngineLine[], plan: row };
  const leaders = [...new Set((team.leaders ?? []).map(idOf).filter(Boolean))];
  if (leaders.length !== 1) {
    return {
      ...onTeam, state: "waiting",
      reason: leaders.length ? `${team.name} has ${leaders.length} leaders — a team needs exactly one` : `${team.name} has no leader`,
    };
  }
  if (!sm) return { ...onTeam, state: "waiting", reason: "No Sales Manager is set on the commission plan" };

  const tl = leaders[0]!;
  const tlIsSm = tl === sm && rules.tlRule === "zero_if_sm";
  const tlClosedIt = tl === closer && !rules.tlPaidOnOwnClose;
  const tlNote = tlIsSm ? "Leads this team as Sales Manager — paid as SM" : tlClosedIt ? "Closed it themselves — paid as Sales Staff" : undefined;
  return {
    ...onTeam,
    state: "counted",
    reason: "",
    lines: [
      await line("sales", closer, row.sales),
      await line("tl", tl, tlIsSm || tlClosedIt ? 0 : row.tl, tlNote),
      await line("sm", sm, row.sm),
    ],
  };
}

/* ── My Pay ───────────────────────────────────────────────────────────────────────────────────────────────────── */

type Collection = { paidAt: Date; share: number; aed?: number };
type SaleDoc = {
  _id: Types.ObjectId;
  student?: unknown; closer?: unknown; team?: unknown; state?: string; month?: string; fee?: number; saleDate?: Date;
  owedShare?: number | null; collections?: Collection[] | null; lines?: Array<{ user?: unknown; amount?: number }>;
};

/** The share of the fee received between two instants; a sale not followed yet, all of it on its sale day. */
function shareBetween(s: SaleDoc, from: Date, to: Date): number {
  if (!Array.isArray(s.collections)) return s.saleDate && s.saleDate >= from && s.saleDate <= to ? 1 : 0;
  return round4(s.collections.filter((c) => c.paidAt >= from && c.paidAt <= to).reduce((t, c) => t + c.share, 0));
}
/** The dirhams received between two instants: the payments in AED where the CRM records them, else the fee × the share. */
function collectedBetween(s: SaleDoc, fee: number, from: Date, to: Date): number {
  const list = Array.isArray(s.collections) ? s.collections : null;
  if (list && list.length && list.every((c) => typeof c.aed === "number")) {
    return round2(list.filter((c) => c.paidAt >= from && c.paidAt <= to).reduce((t, c) => t + (c.aed ?? 0), 0));
  }
  return round2(fee * shareBetween(s, from, to));
}
const owedShareOf = (s: SaleDoc) => (typeof s.owedShare === "number" && s.owedShare > 0 ? Math.min(1, s.owedShare) : 0);
/** When the client finished paying; null while they owe. */
function paidInFullAt(s: SaleDoc): Date | null {
  if (owedShareOf(s) > 0) return null;
  const list = Array.isArray(s.collections) ? s.collections.filter((c) => c.share > 0) : [];
  if (!list.length) return s.saleDate ?? null;
  return new Date(Math.max(...list.map((c) => new Date(c.paidAt).getTime())));
}
const earnedShareBetween = (s: SaleDoc, from: Date, to: Date) => { const at = paidInFullAt(s); return at && at >= from && at <= to ? 1 : 0; };
const waitingShareOf = (s: SaleDoc) => (owedShareOf(s) > 0 ? 1 : 0);
const partOf = (amount: number, share: number) => round2(amount * share);

type Level = IPlanSlabRow & { index: number };
export interface EnginePayRow {
  user: string;
  name: string;
  role: PlanSlabRole;
  teams: string[];
  sales: { count: number; value: number; fee: number };
  awaitingFinance: { count: number; value: number };
  level: Level;
  next: (Level & { more: number }) | null;
  salary: number;
  percent: number;
  commission: { earned: number; balance: number; payable: number; notCountedYet: number };
  total: number;
}

/** The level a month's sales reach on a slab, and the next one that pays differently. */
export function levelOf(rows: IPlanSlabRow[], value: number): { level: Level; next: EnginePayRow["next"] } {
  let i = 0;
  for (let k = 0; k < rows.length; k++) if (rows[k]!.target <= value) i = k;
  const level = { ...rows[i]!, index: i };
  let j = i + 1;
  while (j < rows.length && rows[j]!.salary === level.salary && rows[j]!.percent === level.percent) j++;
  const n = rows[j];
  return { level, next: n ? { ...n, index: j, more: round2(n.target - value) } : null };
}

/** The slabs of a month from the plan: the version in force, each position's rows. */
export function slabsOfMonth(plan: ICommissionPlan, month: string): { from: string; slabs: Record<PlanSlabRole, IPlanSlabRow[]> } {
  const v = slabsInForce(plan.slabs, month);
  const built = BUILT_IN[plan.portal].slabs;
  const rows = (role: PlanSlabRole) => {
    const r = (v?.[role] ?? []).map((x) => ({ name: x.name, target: x.target, salary: x.salary, percent: x.percent }));
    return r.length ? r : built[role].map((x) => ({ ...x }));
  };
  return { from: v?.from ?? "", slabs: { sales: rows("sales"), tl: rows("tl"), sm: rows("sm") } };
}

type Fact = {
  closer: string; team: string; fee: number; collected: number; inMonth: boolean; approved: boolean; state: string;
  lines: { user: string; amount: number; balance: number }[];
};

/** Everyone on the slabs in a month, with what the month pays them — the CRM's My Pay, from Root's plan. */
export async function payRows(db: Connection, plan: ICommissionPlan, month: string): Promise<EnginePayRow[]> {
  if (month < PAY_FROM_MONTH) return [];
  const rules = rulesOf(plan);
  const { slabs } = slabsOfMonth(plan, month);
  const sm = plan.salesManager?.id ?? "";
  const excluded = new Set(plan.excluded.map((p) => p.id));
  const { from, to } = monthRange(month);
  const teams = await db.collection<TeamDoc>("teams").find({}, { projection: { name: 1, status: 1, leaders: 1, members: 1 }, maxTimeMS: QUERY_MS }).toArray();
  const active = teams.filter((t) => t.status === "active");
  const sales = await db.collection<SaleDoc>("commissionsales").find(
    { state: { $ne: "reversed" }, $or: [{ month }, { collections: { $elemMatch: { paidAt: { $gte: from, $lte: to } } } }] },
    { projection: { student: 1, closer: 1, team: 1, state: 1, lines: 1, fee: 1, saleDate: 1, month: 1, owedShare: 1, collections: 1 }, maxTimeMS: QUERY_MS },
  ).toArray();

  const ids = sales.map((s) => s.student).filter(Boolean) as Types.ObjectId[];
  const [handovers, students] = ids.length
    ? await Promise.all([
      db.collection("financehandovers").find({ studentId: { $in: ids } }, { projection: { studentId: 1, approvalState: 1 }, maxTimeMS: QUERY_MS }).toArray(),
      db.collection("students").find({ _id: { $in: ids } }, { projection: { team: 1, assignedTo: 1, totalFee: 1 }, maxTimeMS: QUERY_MS }).toArray(),
    ])
    : [[], []];
  const approvedInFinance = new Set(handovers.filter((h) => h.approvalState === "approved" || h.approvalState === "not_required").map((h) => String(h.studentId)));
  const studentOf = new Map(students.map((s) => [String(s._id), s]));
  const inTeam = (t: TeamDoc, user: string) => [...(t.leaders ?? []), ...(t.members ?? [])].some((u) => idOf(u) === user);

  const facts: Fact[] = sales.map((s) => {
    const student = studentOf.get(String(s.student));
    const closer = idOf(s.closer) || idOf(student?.assignedTo);
    let team = idOf(s.team) || idOf(student?.team);
    if (!team && closer) {
      const theirs = active.filter((t) => inTeam(t, closer));
      if (theirs.length === 1) team = String(theirs[0]!._id);
    }
    const fee = typeof s.fee === "number" ? s.fee : positive(student?.totalFee);
    return {
      closer, team, fee,
      collected: collectedBetween(s, fee, from, to),
      inMonth: s.month === month,
      approved: s.state === "counted" || s.state === "waiting" || approvedInFinance.has(String(s.student)),
      state: String(s.state ?? ""),
      lines: s.state === "counted"
        ? (s.lines ?? []).map((l) => ({ user: idOf(l.user), amount: partOf(Number(l.amount) || 0, earnedShareBetween(s, from, to)), balance: partOf(Number(l.amount) || 0, waitingShareOf(s)) }))
        : [],
    };
  });

  const who = new Set<string>();
  if (sm) who.add(sm);
  for (const t of active) for (const u of [...(t.leaders ?? []), ...(t.members ?? [])]) who.add(idOf(u));
  for (const f of facts) {
    if (f.closer) who.add(f.closer);
    for (const l of f.lines) who.add(l.user);
  }
  for (const x of excluded) who.delete(x);
  who.delete("");
  const users = await db.collection("users").find(
    { _id: { $in: [...who].map(oid).filter(Boolean) as Types.ObjectId[] } },
    { projection: { name: 1, status: 1 }, maxTimeMS: QUERY_MS },
  ).toArray();

  const ledTeams = (user: string) => teams.filter((t) => (t.leaders ?? []).some((l) => idOf(l) === user));
  const rank: Record<PlanSlabRole, number> = { sm: 0, tl: 1, sales: 2 };
  const rows: EnginePayRow[] = [];
  for (const u of users) {
    const user = String(u._id);
    const led = ledTeams(user);
    const role: PlanSlabRole = user === sm ? "sm" : rules.tlSlab && led.some((t) => t.status === "active") ? "tl" : "sales";
    const ledIds = new Set(led.map((t) => String(t._id)));
    const counts = (f: Fact) => (role === "sm" ? true : role === "tl" ? ledIds.has(f.team) && !excluded.has(f.closer) : f.closer === user);
    const mine = facts.filter(counts);
    const approved = mine.filter((f) => f.approved && (f.inMonth || f.collected > 0));
    const awaiting = mine.filter((f) => !f.approved && f.inMonth);
    const earned = round2(facts.reduce((t, f) => t + f.lines.filter((l) => l.user === user).reduce((x, l) => x + l.amount, 0), 0));
    const balance = round2(facts.reduce((t, f) => t + f.lines.filter((l) => l.user === user).reduce((x, l) => x + l.balance, 0), 0));
    if (u.status !== "active" && !mine.length && !earned) continue;
    const value = round2(approved.reduce((t, f) => t + f.collected, 0));
    const { level, next } = levelOf(slabs[role], value);
    const payable = round2((earned * level.percent) / 100);
    rows.push({
      user, name: String(u.name ?? ""), role,
      teams: role === "tl" ? led.filter((t) => t.status === "active").map((t) => String(t.name ?? "")) : [],
      sales: { count: approved.length, value, fee: round2(approved.reduce((t, f) => t + f.fee, 0)) },
      awaitingFinance: { count: awaiting.length, value: round2(awaiting.reduce((t, f) => t + f.fee, 0)) },
      level, next, salary: level.salary, percent: level.percent,
      commission: { earned, balance, payable, notCountedYet: mine.filter((f) => f.inMonth && (f.state === "progress" || f.state === "waiting")).length },
      total: round2(level.salary + payable),
    });
  }
  return rows.sort((a, b) => rank[a.role] - rank[b.role] || b.total - a.total || a.name.localeCompare(b.name));
}

/* ── Old and new, side by side ────────────────────────────────────────────────────────────────────────────────── */

export interface SaleCompare {
  saleId: string;
  student: string;
  course: string;
  saleDate: string | null;
  crm: { state: string; lines: Array<{ role: string; userName: string; amount: number }> };
  root: { state: SaleState; reason: string; lines: Array<{ role: string; userName: string; amount: number }> };
  same: boolean;
}

/**
 * Each of a month's decided sales (counted, held or excluded): who earns what as the CRM recorded it, and as Root's
 * plan gives it now. A sale counted before a plan change keeps its amounts in the CRM, so a difference there is the
 * change, not a fault.
 */
export async function compareSales(db: Connection, plan: ICommissionPlan, month: string): Promise<SaleCompare[]> {
  const sales = await db.collection("commissionsales").find(
    { month, state: { $in: ["counted", "waiting", "excluded"] } },
    { projection: { student: 1, studentName: 1, courseName: 1, course: 1, closer: 1, team: 1, state: 1, lines: 1, saleDate: 1 }, maxTimeMS: QUERY_MS },
  ).sort({ saleDate: 1 }).toArray();
  const ids = sales.map((s) => s.student).filter(Boolean) as Types.ObjectId[];
  const students = ids.length
    ? await db.collection("students").find({ _id: { $in: ids } }, { projection: { team: 1, assignedTo: 1 }, maxTimeMS: QUERY_MS }).toArray()
    : [];
  const studentOf = new Map(students.map((s) => [String(s._id), s]));
  const names = new Names(db);
  const out: SaleCompare[] = [];
  for (const s of sales) {
    const st = studentOf.get(String(s.student));
    // As the CRM decides it: the student's closer and team, else what the sale recorded.
    const r = await resolveSale(db, plan, { closer: idOf(st?.assignedTo) || idOf(s.closer), team: idOf(st?.team) || idOf(s.team), course: idOf(s.course) }, names);
    const crmLines = ((s.lines as Array<{ role?: string; userName?: string; amount?: number; user?: unknown }> | undefined) ?? [])
      .map((l) => ({ role: String(l.role ?? ""), userName: String(l.userName ?? ""), amount: Number(l.amount) || 0, user: idOf(l.user) }));
    const key = (ls: Array<{ role: string; amount: number; user: string }>) => JSON.stringify(ls.map((l) => [l.role, l.user, l.amount]).sort());
    out.push({
      saleId: String(s._id),
      student: String(s.studentName ?? ""),
      course: String(s.courseName ?? ""),
      saleDate: s.saleDate ? new Date(s.saleDate).toISOString() : null,
      crm: { state: String(s.state), lines: crmLines.map(({ role, userName, amount }) => ({ role, userName, amount })) },
      root: { state: r.state, reason: r.reason, lines: r.lines.map((l) => ({ role: l.role, userName: l.userName, amount: l.amount })) },
      same: String(s.state) === r.state && key(crmLines) === key(r.lines),
    });
  }
  return out;
}
