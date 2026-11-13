import { Types, type Connection } from "mongoose";
import { BUILT_IN, slabsInForce } from "./commissionPlanService.js";
import type { ICommissionPlan, IPlanSlabRow, IPlanTeam, PlanSlabRole } from "../types/index.js";

/*
 * The one commission logic, worked out in Root from Root's plan (the user, 2026-11-01: "one function used by every
 * portal"; "Root works out every figure"). What each sales CRM's commissionService.resolveSale and
 * salaryService.payRows do today, for any of them, with the portal's differences taken from its plan:
 *
 *   - who earns what on a sale: nobody when the closer is a login that earns nothing; the sale's team (its own, else
 *     the closer's one active team) must have exactly one leader and a Sales Manager must be set; the team-leader
 *     rule (paid; never; nothing on a team the Sales Manager leads) and whether a team leader closing in their own
 *     team is paid the TL line too; the amounts from the course's row — the sale's team's own row where that team is
 *     on a plan of its own (2026-11-03), else the portal's;
 *   - My Pay for a month: the Sales Manager on the SM slab, a team leader on the TL slab where the portal has one
 *     (else on Sales Staff's, on their own closes), everyone else on Sales Staff's — a team's own slab for its leader
 *     and its people where the team has one in force (2026-11-03); the target is the money received
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

/**
 * The portal's fixed rules. Whether a team leader's own close pays the TL line is the portal's own, from code
 * (BUILT_IN) — not what was stored when the plan was copied — so changing it (the Sales CRM, 2026-11-01) needs no
 * change to a plan already in Root.
 */
function rulesOf(plan: ICommissionPlan) {
  return { tlRule: plan.tlRule, tlSlab: plan.tlSlab, tlPaidOnOwnClose: BUILT_IN[plan.portal].tlPaidOnOwnClose };
}

/* ── Who earns what on a sale ─────────────────────────────────────────────────────────────────────────────────── */

export type SaleState = "counted" | "waiting" | "excluded";
/**
 * `amountInr` (the user, 2026-11-13: "separate INR commission for each course… the INR pay will be different"): what
 * the line pays, in rupees, for the part of the fee the client paid in rupees — the course's own rupee amount, never
 * `amount` converted. 0: none set, and that part is paid at `amount` like the rest.
 */
export interface EngineLine { role: PlanSlabRole; user: string; userName: string; amount: number; amountInr: number; note?: string }
type Row = { sales: number; tl: number; sm: number; creditUsd: number; salesInr: number; tlInr: number; smInr: number };
export interface Resolved {
  state: SaleState;
  reason: string;
  team: string | null;
  teamName: string;
  lines: EngineLine[];
  /** The course's row the amounts were taken from. */
  plan: Row;
}

type TeamDoc = { _id: Types.ObjectId; name?: string; status?: string; leaders?: unknown[]; members?: unknown[] };

/** A team's own plan in the portal, if it has one (2026-11-03). */
export function teamPlanOf(plan: ICommissionPlan, teamId: string): IPlanTeam | null {
  return teamId ? (plan.teams ?? []).find((t) => t.teamId === teamId) ?? null : null;
}

/**
 * A course's row in the plan; zeros for one nobody has set. On a team with its own row for the course, that row's
 * amounts (2026-11-03) — the MT5 credit stays the portal's, as it is the student's, not commission.
 */
export function courseRow(plan: ICommissionPlan, courseId: string, teamId = ""): Row {
  const r = plan.courses.find((c) => c.courseId === courseId);
  const inrOf = (x?: { salesInr?: number; tlInr?: number; smInr?: number }) => ({ salesInr: positive(x?.salesInr), tlInr: positive(x?.tlInr), smInr: positive(x?.smInr) });
  const base = { sales: positive(r?.sales), tl: positive(r?.tl), sm: positive(r?.sm), creditUsd: positive(r?.creditUsd), ...inrOf(r) };
  const own = teamPlanOf(plan, teamId)?.courses.find((c) => c.courseId === courseId);
  if (!own) return base;
  // The rupee amounts (2026-11-13): the team's own where its row has any, else the portal's.
  const mine = inrOf(own);
  const inr = mine.salesInr + mine.tlInr + mine.smInr > 0 ? mine : inrOf(r);
  return { sales: positive(own.sales), tl: positive(own.tl), sm: positive(own.sm), creditUsd: base.creditUsd, ...inr };
}

/**
 * The share of what a sale has received that came in rupees, 0–1 (2026-11-13) — from the payments the CRM marks
 * `inr`. A sale not followed payment by payment, or with nothing received: none.
 */
export function rupeeShareOf(s: { collections?: Array<{ share?: number; inr?: boolean }> | null }): number {
  const list = Array.isArray(s.collections) ? s.collections.filter((c) => Number(c.share) > 0) : [];
  const all = list.reduce((t, c) => t + Number(c.share), 0);
  if (!(all > 0)) return 0;
  return Math.min(1, round4(list.filter((c) => c.inr === true).reduce((t, c) => t + Number(c.share), 0) / all));
}

/**
 * A line's amount by how the client paid: the rupee share at the line's rupee amount, the rest in dirhams. With no
 * rupee amount set, or nothing paid in rupees, all of it in dirhams as before.
 */
export function splitByCurrency(amount: number, amountInr: number, rupeeShare: number): { aed: number; inr: number } {
  if (!(amountInr > 0) || !(rupeeShare > 0)) return { aed: amount, inr: 0 };
  return { aed: round2(amount * (1 - rupeeShare)), inr: round2(amountInr * rupeeShare) };
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
    amounts?: { sales: number; tl: number; sm: number; creditUsd?: number; salesInr?: number; tlInr?: number; smInr?: number } | null;
  },
  names: Names = new Names(db),
): Promise<Resolved> {
  // The amounts on the sale's team: its own row where it has one (2026-11-03), so worked out once the team is known.
  const rowOn = (teamId: string): Row => input.amounts
    ? {
      sales: positive(input.amounts.sales), tl: positive(input.amounts.tl), sm: positive(input.amounts.sm), creditUsd: positive(input.amounts.creditUsd),
      salesInr: positive(input.amounts.salesInr), tlInr: positive(input.amounts.tlInr), smInr: positive(input.amounts.smInr),
    }
    : input.courses?.length
      ? input.courses.map((c) => courseRow(plan, idOf(c), teamId)).reduce<Row>((t, r) => ({
        sales: t.sales + r.sales, tl: t.tl + r.tl, sm: t.sm + r.sm, creditUsd: t.creditUsd + r.creditUsd,
        salesInr: t.salesInr + r.salesInr, tlInr: t.tlInr + r.tlInr, smInr: t.smInr + r.smInr,
      }), { sales: 0, tl: 0, sm: 0, creditUsd: 0, salesInr: 0, tlInr: 0, smInr: 0 })
      : courseRow(plan, idOf(input.course), teamId);
  const rules = rulesOf(plan);
  const none = { team: null, teamName: "", lines: [] as EngineLine[], plan: rowOn("") };
  const closer = idOf(input.closer);
  if (!closer || !Types.ObjectId.isValid(closer)) return { ...none, state: "waiting", reason: "Nobody is set as the closer" };
  const closerName = await names.of(closer);
  const excluded = new Set(plan.excluded.map((p) => p.id));
  if (excluded.has(closer)) return { ...none, state: "excluded", reason: `Closed under ${closerName}, a login that earns no commission` };

  const { team, reason } = await teamFor(db, idOf(input.team), closer, closerName);
  const row = rowOn(team ? String(team._id) : "");
  // A line the rules pay nothing pays nothing in rupees either.
  const line = async (role: PlanSlabRole, user: string, amount: number, amountInr: number, note?: string): Promise<EngineLine> => ({
    role, user, userName: await names.of(user), amount, amountInr, ...(note ? { note } : {}),
  });
  const sm = plan.salesManager?.id ?? "";

  if (rules.tlRule === "never") {
    const shown = { team: team ? String(team._id) : null, teamName: team?.name ?? "", lines: [] as EngineLine[], plan: row };
    if (!sm) return { ...shown, state: "waiting", reason: "No Sales Manager is set on the commission plan" };
    return { ...shown, state: "counted", reason: "", lines: [await line("sales", closer, row.sales, row.salesInr), await line("sm", sm, row.sm, row.smInr)] };
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
      await line("sales", closer, row.sales, row.salesInr),
      await line("tl", tl, tlIsSm || tlClosedIt ? 0 : row.tl, tlIsSm || tlClosedIt ? 0 : row.tlInr, tlNote),
      await line("sm", sm, row.sm, row.smInr),
    ],
  };
}

/* ── My Pay ───────────────────────────────────────────────────────────────────────────────────────────────────── */

/** `inr`: the payment came in rupees (2026-11-13) — the CRM marks it; absent on payments from before. */
type Collection = { paidAt: Date; share: number; aed?: number; inr?: boolean };
type SaleDoc = {
  _id: Types.ObjectId;
  student?: unknown; closer?: unknown; team?: unknown; state?: string; month?: string; fee?: number; saleDate?: Date;
  owedShare?: number | null; collections?: Collection[] | null; lines?: Array<{ user?: unknown; amount?: number; amountInr?: number }>;
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
  /** The team whose own slab they are on this month (2026-11-03); null on the portal's. */
  slabTeam: string | null;
  sales: { count: number; value: number; fee: number };
  awaitingFinance: { count: number; value: number };
  level: Level;
  next: (Level & { more: number }) | null;
  salary: number;
  percent: number;
  /**
   * `earnedInr` / `payableInr` (2026-11-13): the part earned in rupees — on what clients paid in rupees, at the
   * courses' rupee amounts — and what the level pays of it. Apart from `earned` / `payable`, which are dirhams only;
   * `balance` (still waiting for full payment) stays in dirhams until the client has paid, as how they pay the rest
   * decides the split.
   */
  commission: { earned: number; balance: number; payable: number; notCountedYet: number; earnedInr: number; payableInr: number };
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

/**
 * The slabs of a month from the plan: the version in force, each position's rows. For a team on a plan of its own
 * (2026-11-03), its own Sales Staff and Team Leader rows where it has them in force that month; `own` says which.
 */
export function slabsOfMonth(
  plan: ICommissionPlan, month: string, teamId = "",
): { from: string; slabs: Record<PlanSlabRole, IPlanSlabRow[]>; own: PlanSlabRole[] } {
  const v = slabsInForce(plan.slabs, month);
  const t = slabsInForce(teamPlanOf(plan, teamId)?.slabs ?? [], month);
  const built = BUILT_IN[plan.portal].slabs;
  const copy = (list: IPlanSlabRow[] | undefined) => (list ?? []).map((x) => ({ name: x.name, target: x.target, salary: x.salary, percent: x.percent }));
  const own: PlanSlabRole[] = [];
  const rows = (role: PlanSlabRole) => {
    const mine = role === "sm" ? [] : copy(t?.[role]);
    if (mine.length) { own.push(role); return mine; }
    const r = copy(v?.[role]);
    return r.length ? r : built[role].map((x) => ({ ...x }));
  };
  return { from: v?.from ?? "", slabs: { sales: rows("sales"), tl: rows("tl"), sm: rows("sm") }, own };
}

type Fact = {
  closer: string; team: string; fee: number; collected: number; inMonth: boolean; approved: boolean; state: string;
  lines: { user: string; amount: number; inr: number; balance: number }[];
};

/** Everyone on the slabs in a month, with what the month pays them — the CRM's My Pay, from Root's plan. */
export async function payRows(db: Connection, plan: ICommissionPlan, month: string): Promise<EnginePayRow[]> {
  if (month < PAY_FROM_MONTH) return [];
  const rules = rulesOf(plan);
  // Each team's slabs, the portal's under "" (2026-11-03: a team can be on slabs of its own).
  const slabsOn = new Map<string, ReturnType<typeof slabsOfMonth>>();
  const slabsOf = (teamId: string) => {
    if (!slabsOn.has(teamId)) slabsOn.set(teamId, slabsOfMonth(plan, month, teamId));
    return slabsOn.get(teamId)!;
  };
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
        ? (s.lines ?? []).map((l) => {
          // Earned whole in the month the client finished paying — split then by how they paid (2026-11-13).
          const earned = earnedShareBetween(s, from, to);
          const by = splitByCurrency(Number(l.amount) || 0, Number(l.amountInr) || 0, rupeeShareOf(s));
          return { user: idOf(l.user), amount: partOf(by.aed, earned), inr: partOf(by.inr, earned), balance: partOf(Number(l.amount) || 0, waitingShareOf(s)) };
        })
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
    const earnedInr = round2(facts.reduce((t, f) => t + f.lines.filter((l) => l.user === user).reduce((x, l) => x + l.inr, 0), 0));
    if (u.status !== "active" && !mine.length && !earned && !earnedInr) continue;
    const value = round2(approved.reduce((t, f) => t + f.collected, 0));
    // Their team's slab where it has its own: the team a leader leads, the one a salesperson is in — only when that
    // is one team; the Sales Manager, and anyone in two, on the portal's.
    const theirs = role === "sm" ? [] : role === "tl" ? led.filter((t) => t.status === "active") : active.filter((t) => inTeam(t, user));
    const slabTeam = theirs.length === 1 ? theirs[0]! : null;
    const onSlabs = slabsOf(slabTeam ? String(slabTeam._id) : "");
    const { level, next } = levelOf(onSlabs.slabs[role], value);
    const payable = round2((earned * level.percent) / 100);
    const payableInr = round2((earnedInr * level.percent) / 100);
    rows.push({
      user, name: String(u.name ?? ""), role,
      teams: role === "tl" ? led.filter((t) => t.status === "active").map((t) => String(t.name ?? "")) : [],
      slabTeam: slabTeam && onSlabs.own.includes(role) ? String(slabTeam.name ?? "") : null,
      sales: { count: approved.length, value, fee: round2(approved.reduce((t, f) => t + f.fee, 0)) },
      awaitingFinance: { count: awaiting.length, value: round2(awaiting.reduce((t, f) => t + f.fee, 0)) },
      level, next, salary: level.salary, percent: level.percent,
      commission: { earned, balance, payable, notCountedYet: mine.filter((f) => f.inMonth && (f.state === "progress" || f.state === "waiting")).length, earnedInr, payableInr },
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
