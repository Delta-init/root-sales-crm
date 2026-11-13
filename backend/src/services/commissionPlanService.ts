import { Types } from "mongoose";
import { getSources, type CrmSource } from "./crmConnections.js";
import { CommissionPlan } from "../models/CommissionPlan.js";
import { AuditLog } from "../models/AuditLog.js";
import { compareSales, payRows, slabsOfMonth, PAY_FROM_MONTH, type EnginePayRow, type SaleCompare } from "./commissionEngine.js";
import { payOf } from "./crmCommissionService.js";
import type {
  ICommissionPlan, IPlanCourse, IPlanPerson, IPlanSlabRow, IPlanSlabVersion, IPlanTeam, PlanPortal, PlanSlabRole, PlanTlRule,
} from "../types/index.js";

/*
 * Commission plans. Each sales CRM's own plan, read straight from its database (the user, 2026-10-09: read only),
 * and — since 2026-11-01 ("read from one db, one logic, edited from Root") — the plan kept in Root: copied once from
 * the CRM (scripts/commission-plan-copy.ts), then edited here by root admins, by portal, position and course. Both
 * are shown, so where they differ can be seen before the CRMs are switched to count with Root's.
 */

/** The CRMs that pay commission, and how each pays a sale's team leader (their TL_RULE). */
const TL_RULES: Record<string, { rule: PlanTlRule; label: string }> = {
  delta: { rule: "zero_if_sm", label: "TL paid, except on a team the Sales Manager leads" },
  draw: { rule: "never", label: "No TL commission — Sales Staff and the Sales Manager only" },
  remote: { rule: "always", label: "TL always paid, the Sales Manager too when they lead" },
};

const QUERY_MS = 15_000;

export interface PlanRow {
  id: string;
  name: string;
  fee: number;
  status: string;
  sales: number;
  tl: number;
  sm: number;
  creditUsd: number;
}
export interface SlabRow {
  name: string;
  target: number;
  salary: number;
  percent: number;
}
/**
 * A team of the CRM and its own plan, if any (2026-11-03): the courses it has its own row for, and its own Sales
 * Staff / Team Leader rows in force this month (empty: the portal's).
 */
export interface TeamPlanView {
  id: string;
  name: string;
  status: string;
  inCrm: boolean;
  courses: Array<{ id: string; name: string; sales: number; tl: number; sm: number; salesInr: number; tlInr: number; smInr: number; updatedAt: string | null; updatedByEmail: string }>;
  slabs: { from: string | null; sales: SlabRow[]; tl: SlabRow[]; updatedAt: string | null; updatedByEmail: string };
}
/** Root's plan for a portal, as the page shows it: this month's slabs, every CRM course with its row (or none yet). */
export interface RootPlanView {
  tlSlab: boolean;
  /** `…Inr`: what the part of a sale paid in rupees pays each position (2026-11-13); 0 = none set, paid at the AED amount. */
  courses: Array<PlanRow & { salesInr: number; tlInr: number; smInr: number; set: boolean; inCrm: boolean; updatedAt: string | null; updatedByEmail: string }>;
  salesManager: IPlanPerson | null;
  excluded: IPlanPerson[];
  slabs: { from: string; sales: SlabRow[]; tl: SlabRow[]; sm: SlabRow[]; updatedAt: string | null; updatedByEmail: string };
  copiedAt: string | null;
  updatedAt: string | null;
  updatedByEmail: string;
  /** The CRM's people, for choosing the Sales Manager and who earns nothing. */
  people: IPlanPerson[];
  /** The latest changes made here. */
  changes: Array<{ at: string; by: string; detail: string }>;
  /** The CRM's teams with their own plans, where a portal's teams can have them (2026-11-03); null elsewhere. */
  teams: TeamPlanView[] | null;
}
export interface CrmPlan {
  code: string;
  name: string;
  available: boolean;
  error?: string;
  tlRule: string;
  tlRuleLabel: string;
  courses: PlanRow[];
  salesManager: string | null;
  excluded: string[];
  /** The slabs in force this month; null while the CRM still uses its built-in ones. */
  slabs: { from: string; sales: SlabRow[]; tl: SlabRow[]; sm: SlabRow[] } | null;
  /** The plan kept in Root (2026-11-01); null until it has been copied there. */
  root: RootPlanView | null;
}

/*
 * What each CRM pays from when it has no slabs saved — its DEFAULT_SLABS, as in its code (2026-11-01). Copied into
 * Root as the first version, so every month reads the same from Root as from the CRM.
 */
const SALES_STAFF: IPlanSlabRow[] = [
  { name: "Base", target: 0, salary: 2000, percent: 0 },
  { name: "E", target: 10_000, salary: 2000, percent: 0 },
  { name: "D", target: 15_000, salary: 2500, percent: 50 },
  { name: "C", target: 22_000, salary: 3000, percent: 100 },
  { name: "B", target: 26_000, salary: 3500, percent: 100 },
  { name: "A", target: 32_000, salary: 4000, percent: 100 },
];
const DRAW_REMOTE_SM: IPlanSlabRow[] = [
  { name: "Base", target: 0, salary: 5000, percent: 50 },
  { name: "Level 1", target: 120_000, salary: 5000, percent: 50 },
  { name: "Level 2", target: 154_000, salary: 10_000, percent: 100 },
];
export const BUILT_IN: Record<PlanPortal, { tlSlab: boolean; tlPaidOnOwnClose: boolean; slabs: Record<PlanSlabRole, IPlanSlabRow[]> }> = {
  delta: {
    tlSlab: true,
    // A team leader's own close pays them Sales Staff and TL (the user, 2026-11-01; Sales Only before), as the Sales
    // CRM's TL_PAID_WHEN_THEY_CLOSE.
    tlPaidOnOwnClose: true,
    slabs: {
      sales: SALES_STAFF,
      tl: [
        { name: "Base", target: 0, salary: 4000, percent: 50 },
        { name: "Level 1", target: 80_000, salary: 4000, percent: 50 },
        { name: "Level 2", target: 100_000, salary: 4000, percent: 100 },
        { name: "Level 3", target: 132_000, salary: 8000, percent: 100 },
      ],
      sm: [
        { name: "Base", target: 0, salary: 5000, percent: 50 },
        { name: "Level 1", target: 200_000, salary: 5000, percent: 50 },
        { name: "Level 2", target: 250_000, salary: 5000, percent: 75 },
        { name: "Level 3", target: 330_000, salary: 10_000, percent: 100 },
      ],
    },
  },
  draw: { tlSlab: false, tlPaidOnOwnClose: false, slabs: { sales: SALES_STAFF, tl: [{ name: "Base", target: 0, salary: 2000, percent: 0 }], sm: DRAW_REMOTE_SM } },
  // Remote pays a team leader the TL line on their own close too.
  remote: { tlSlab: false, tlPaidOnOwnClose: true, slabs: { sales: SALES_STAFF, tl: [{ name: "Base", target: 0, salary: 2000, percent: 0 }], sm: DRAW_REMOTE_SM } },
};
/** The month the built-in slabs are dated from in Root: before any saved version. */
export const BUILT_IN_FROM = "2000-01";
/** The portals whose teams can be put on a plan of their own (the user, 2026-11-03: the Sales CRM's). */
export const TEAM_PLAN_PORTALS: PlanPortal[] = ["delta"];
/** A team's own slabs: Sales Staff, and Team Leader where the portal has a TL slab — never the Sales Manager's. */
export const teamSlabRolesOf = (portal: PlanPortal): PlanSlabRole[] => slabRolesOf(portal).filter((r) => r !== "sm");
const SLAB_KEYS: PlanSlabRole[] = ["sales", "tl", "sm"];
export const isPortal = (code: string): code is PlanPortal => code in BUILT_IN;
export const slabRolesOf = (portal: PlanPortal): PlanSlabRole[] => (BUILT_IN[portal].tlSlab ? SLAB_KEYS : ["sales", "sm"]);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const slabRows = (v: unknown): SlabRow[] =>
  (Array.isArray(v) ? v : []).map((r: Record<string, unknown>) => ({
    name: String(r.name ?? ""), target: num(r.target), salary: num(r.salary), percent: num(r.percent),
  }));
/** This month in UAE time, YYYY-MM, as the CRMs count it. */
export const uaeMonth = () => new Date(Date.now() + 4 * 60 * 60_000).toISOString().slice(0, 7);
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const rowsOf = (rows: IPlanSlabRow[] | undefined) => (rows ?? []).map((r) => ({ name: r.name, target: r.target, salary: r.salary, percent: r.percent }));

/** The version of a plan's slabs in force in a month: the latest that starts on or before it. */
export function slabsInForce(versions: IPlanSlabVersion[], month: string): IPlanSlabVersion | null {
  return [...versions].filter((v) => v.from <= month).sort((a, b) => (a.from < b.from ? 1 : -1))[0] ?? null;
}

/** What is wrong with a position's slab rows, or null — the CRMs' rule: a base at 0 first, then targets rising. */
export function slabProblem(rows: IPlanSlabRow[]): string | null {
  if (!rows.length) return "A slab needs at least its base row";
  if (rows[0]!.target !== 0) return "The first row is the base: its target must be 0";
  for (let i = 1; i < rows.length; i++) {
    if (!(rows[i]!.target > rows[i - 1]!.target)) return `Each level's target must be higher than the one before (row ${i + 1})`;
  }
  return null;
}

async function planOf(src: CrmSource): Promise<CrmPlan> {
  const db = src.conn;
  const [courses, settings] = await Promise.all([
    db.collection("courses").find({}, { projection: { name: 1, amount: 1, status: 1, commission: 1 }, maxTimeMS: QUERY_MS })
      .sort({ status: 1, name: 1 }).toArray(),
    db.collection("commissionsettings").findOne({ key: "default" }, { maxTimeMS: QUERY_MS }),
  ]);
  const ids = [settings?.salesManager, ...((settings?.excludedUsers as unknown[]) ?? [])]
    .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);
  const users = new Map(
    (await db.collection("users").find({ _id: { $in: ids } }, { projection: { name: 1 }, maxTimeMS: QUERY_MS }).toArray())
      .map((u) => [String(u._id), String(u.name ?? "")]),
  );
  const nameOf = (id: unknown) => (id ? users.get(String(id)) ?? "(removed user)" : null);
  const month = uaeMonth();
  const versions = ((settings?.salarySlabs as Record<string, unknown>[] | undefined) ?? [])
    .filter((v) => String(v.from ?? "") <= month)
    .sort((a, b) => String(a.from).localeCompare(String(b.from)));
  const now = versions.at(-1);
  const tl = TL_RULES[src.org.code];
  return {
    code: src.org.code,
    name: src.org.name,
    available: true,
    tlRule: tl.rule,
    tlRuleLabel: tl.label,
    courses: courses.map((c) => {
      const p = (c.commission ?? {}) as Record<string, unknown>;
      return {
        id: String(c._id), name: String(c.name ?? ""), fee: num(c.amount), status: String(c.status ?? ""),
        sales: num(p.sales), tl: num(p.tl), sm: num(p.sm), creditUsd: num(p.creditUsd),
      };
    }),
    salesManager: nameOf(settings?.salesManager),
    excluded: ((settings?.excludedUsers as unknown[]) ?? []).map((id) => nameOf(id) ?? ""),
    slabs: now ? { from: String(now.from), sales: slabRows(now.sales), tl: slabRows(now.tl), sm: slabRows(now.sm) } : null,
    root: null,
  };
}

/**
 * A CRM's plan as Root keeps it — what the copy script saves: every course's row, the Sales Manager and who earns
 * nothing (ids and names), and the slabs as versions, a version's position with no rows of its own taking the
 * built-in ones as the CRM does, the built-in slabs first. Read from the CRM's database; nothing is written there.
 */
export async function planFromCrm(src: CrmSource): Promise<Omit<ICommissionPlan, "copiedAt" | "updatedByEmail">> {
  const code = src.org.code;
  if (!isPortal(code)) throw new Error(`${code} has no commission plan`);
  const db = src.conn;
  const [courses, settings] = await Promise.all([
    db.collection("courses").find({}, { projection: { name: 1, commission: 1 }, maxTimeMS: QUERY_MS }).sort({ name: 1 }).toArray(),
    db.collection("commissionsettings").findOne({ key: "default" }, { maxTimeMS: QUERY_MS }),
  ]);
  const ids = [settings?.salesManager, ...((settings?.excludedUsers as unknown[]) ?? [])].filter((id) => id);
  const users = new Map(
    (await db.collection("users").find({ _id: { $in: ids as Types.ObjectId[] } }, { projection: { name: 1 }, maxTimeMS: QUERY_MS }).toArray())
      .map((u) => [String(u._id), String(u.name ?? "")]),
  );
  const person = (id: unknown): IPlanPerson => ({ id: String(id), name: users.get(String(id)) ?? "(removed user)" });
  const built = BUILT_IN[code].slabs;
  const saved = ((settings?.salarySlabs as Record<string, unknown>[] | undefined) ?? [])
    .map((v) => {
      const at = v.updatedAt instanceof Date ? v.updatedAt : null;
      const pick = (role: PlanSlabRole) => { const rows = slabRows(v[role]); return rows.length ? rows : rowsOf(built[role]); };
      return { from: String(v.from ?? ""), sales: pick("sales"), tl: pick("tl"), sm: pick("sm"), updatedAt: at, updatedByEmail: "copied from the CRM" };
    })
    .filter((v) => /^\d{4}-\d{2}$/.test(v.from))
    .sort((a, b) => a.from.localeCompare(b.from));
  return {
    portal: code,
    tlRule: TL_RULES[code]!.rule,
    tlSlab: BUILT_IN[code].tlSlab,
    tlPaidOnOwnClose: BUILT_IN[code].tlPaidOnOwnClose,
    salesManager: settings?.salesManager ? person(settings.salesManager) : null,
    excluded: ((settings?.excludedUsers as unknown[]) ?? []).map(person),
    courses: courses.map((c): IPlanCourse => {
      const p = (c.commission ?? {}) as Record<string, unknown>;
      return {
        courseId: String(c._id), name: String(c.name ?? ""), sales: num(p.sales), tl: num(p.tl), sm: num(p.sm), creditUsd: num(p.creditUsd),
        updatedAt: p.updatedAt instanceof Date ? p.updatedAt : null, updatedByEmail: "copied from the CRM",
      };
    }),
    slabs: [
      { from: BUILT_IN_FROM, sales: rowsOf(built.sales), tl: rowsOf(built.tl), sm: rowsOf(built.sm), updatedAt: null, updatedByEmail: "the CRM's built-in slabs" },
      ...saved.filter((v) => v.from > BUILT_IN_FROM),
    ],
  };
}

/** Root's plan for a portal as the page shows it, with the CRM's courses and people beside it. */
async function rootView(src: CrmSource | null, doc: ICommissionPlan): Promise<RootPlanView> {
  const crmCourses = src
    ? await src.conn.collection("courses").find({}, { projection: { name: 1, amount: 1, status: 1 }, maxTimeMS: QUERY_MS }).sort({ status: 1, name: 1 }).toArray()
    : [];
  const people = src
    ? (await src.conn.collection("users").find({ status: { $ne: "inactive" } }, { projection: { name: 1 }, maxTimeMS: QUERY_MS }).sort({ name: 1 }).toArray())
      .map((u) => ({ id: String(u._id), name: String(u.name ?? "") }))
    : [];
  const rows = new Map(doc.courses.map((c) => [c.courseId, c]));
  const seen = new Set<string>();
  const courses: RootPlanView["courses"] = crmCourses.map((c) => {
    const id = String(c._id);
    seen.add(id);
    const r = rows.get(id);
    return {
      id, name: String(c.name ?? r?.name ?? ""), fee: num(c.amount), status: String(c.status ?? ""),
      sales: r?.sales ?? 0, tl: r?.tl ?? 0, sm: r?.sm ?? 0, creditUsd: r?.creditUsd ?? 0, ...inrOf({}, r),
      set: !!r, inCrm: true, updatedAt: iso(r?.updatedAt), updatedByEmail: r?.updatedByEmail ?? "",
    };
  });
  for (const r of doc.courses) {
    if (seen.has(r.courseId)) continue;
    courses.push({
      id: r.courseId, name: r.name, fee: 0, status: "", sales: r.sales, tl: r.tl, sm: r.sm, creditUsd: r.creditUsd, ...inrOf({}, r),
      set: true, inCrm: !src, updatedAt: iso(r.updatedAt), updatedByEmail: r.updatedByEmail,
    });
  }
  const month = uaeMonth();
  const now = slabsInForce(doc.slabs, month);
  const changes = await AuditLog.find({ action: "commission_plan_changed", org: doc.portal }).sort({ createdAt: -1 }).limit(15).lean();
  let teams: TeamPlanView[] | null = null;
  if (TEAM_PLAN_PORTALS.includes(doc.portal)) {
    const crmTeams = src
      ? await src.conn.collection("teams").find({}, { projection: { name: 1, status: 1 }, maxTimeMS: QUERY_MS }).sort({ status: 1, name: 1 }).toArray()
      : [];
    const own = new Map((doc.teams ?? []).map((t) => [t.teamId, t]));
    const view = (id: string, name: string, status: string, inCrm: boolean): TeamPlanView => {
      const t = own.get(id);
      const v = slabsInForce(t?.slabs ?? [], month);
      return {
        id, name, status, inCrm,
        courses: (t?.courses ?? []).map((c) => ({
          id: c.courseId, name: c.name, sales: c.sales, tl: c.tl, sm: c.sm, ...inrOf({}, c), updatedAt: iso(c.updatedAt), updatedByEmail: c.updatedByEmail,
        })),
        slabs: { from: v?.from ?? null, sales: rowsOf(v?.sales), tl: rowsOf(v?.tl), updatedAt: iso(v?.updatedAt), updatedByEmail: v?.updatedByEmail ?? "" },
      };
    };
    teams = crmTeams.map((t) => view(String(t._id), String(t.name ?? ""), String(t.status ?? ""), true));
    // A team on its own plan that the CRM no longer has stays listed, so what it had can be seen.
    for (const t of doc.teams ?? []) if (!crmTeams.some((c) => String(c._id) === t.teamId)) teams.push(view(t.teamId, t.name, "", !src));
  }
  return {
    tlSlab: doc.tlSlab,
    courses,
    salesManager: doc.salesManager,
    excluded: doc.excluded,
    slabs: {
      from: now?.from ?? BUILT_IN_FROM, sales: rowsOf(now?.sales), tl: rowsOf(now?.tl), sm: rowsOf(now?.sm),
      updatedAt: iso(now?.updatedAt), updatedByEmail: now?.updatedByEmail ?? "",
    },
    copiedAt: iso(doc.copiedAt),
    updatedAt: iso(doc.updatedAt),
    updatedByEmail: doc.updatedByEmail,
    people,
    changes: changes.map((c) => ({ at: iso((c as { createdAt?: Date }).createdAt) ?? "", by: c.adminEmail, detail: c.detail })),
    teams,
  };
}

/** Every commission-paying CRM's plan; one that cannot be read says why. */
export async function commissionPlans(): Promise<CrmPlan[]> {
  const { sources, failures } = await getSources();
  const empty = (code: string, name: string, error: string): CrmPlan => ({
    code, name, available: false, error, tlRule: TL_RULES[code].rule, tlRuleLabel: TL_RULES[code].label,
    courses: [], salesManager: null, excluded: [], slabs: null, root: null,
  });
  const kept = new Map((await CommissionPlan.find({}).lean<ICommissionPlan[]>()).map((d) => [d.portal, d]));
  const withRoot = async (plan: CrmPlan, src: CrmSource | null) => {
    const doc = kept.get(plan.code as PlanPortal);
    if (doc) plan.root = await rootView(src, doc).catch(() => rootView(null, doc));
    return plan;
  };
  const plans = await Promise.all(
    sources.filter((s) => TL_RULES[s.org.code]).map((s) =>
      planOf(s)
        .catch((e) => empty(s.org.code, s.org.name, e instanceof Error ? e.message : "Could not be read"))
        .then((p) => withRoot(p, p.available ? s : null)),
    ),
  );
  for (const f of failures) if (TL_RULES[f.code]) plans.push(await withRoot(empty(f.code, f.name, f.error), null));
  const order = Object.keys(TL_RULES);
  return plans.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
}

/* ── Editing Root's plan (root admins, 2026-11-01) ─────────────────────────────────────────────────────────────── */

type Fail = Error & { statusCode: number };
const fail = (statusCode: number, message: string): Fail => Object.assign(new Error(message), { statusCode });
const aedOf = (n: number) => `AED ${n.toLocaleString("en-US")}`;

/* The rupee amounts of a course's row (2026-11-13): what the part of a sale paid in rupees pays each position. */
type InrAmounts = { salesInr?: number; tlInr?: number; smInr?: number };
const inrNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
/** The rupee amounts to keep: what was sent, else what the row already has (a page from before them sends none). */
function inrOf(input: InrAmounts, row?: InrAmounts | null): { salesInr: number; tlInr: number; smInr: number } {
  return {
    salesInr: input.salesInr ?? inrNum(row?.salesInr), tlInr: input.tlInr ?? inrNum(row?.tlInr), smInr: input.smInr ?? inrNum(row?.smInr),
  };
}
const hasInr = (r?: InrAmounts | null) => inrNum(r?.salesInr) + inrNum(r?.tlInr) + inrNum(r?.smInr) > 0;
const inrFig = (r?: InrAmounts | null) =>
  hasInr(r) ? [r!.salesInr, r!.tlInr, r!.smInr].map((n) => `INR ${inrNum(n).toLocaleString("en-US")}`).join(" / ") : "none";
/** How a change of the rupee amounts reads in the log; nothing when they are as they were. */
const inrChange = (before: InrAmounts | null | undefined, after: InrAmounts) =>
  inrFig(before) === inrFig(after) ? "" : ` · paid in rupees: ${inrFig(before)} → ${inrFig(after)}`;

async function sourceOf(code: PlanPortal): Promise<CrmSource | null> {
  const { sources } = await getSources();
  return sources.find((s) => s.org.code === code) ?? null;
}
async function planDoc(code: string) {
  if (!isPortal(code)) throw fail(404, `No commission plan for "${code}"`);
  const doc = await CommissionPlan.findOne({ portal: code });
  if (!doc) throw fail(409, "This CRM's plan has not been copied to Root yet");
  return doc;
}
const nameOf = (code: PlanPortal) => ({ delta: "Sales CRM", draw: "Draw", remote: "Remote" })[code];

/** One course's row: what a sale of it pays each position, and the MT5 credit. Only for sales counted from now on. */
export async function saveCourse(
  code: string, courseId: string, input: { sales: number; tl: number; sm: number; creditUsd: number } & InrAmounts, by: string,
): Promise<string> {
  const doc = await planDoc(code);
  const portal = doc.portal;
  if (doc.tlRule === "never" && (input.tl > 0 || (input.tlInr ?? 0) > 0)) throw fail(400, `${nameOf(portal)} pays team leaders nothing on a sale`);
  const row = doc.courses.find((c) => c.courseId === courseId);
  let name = row?.name ?? "";
  if (!row) {
    // A course not in the plan yet must be one of the CRM's.
    const src = await sourceOf(portal);
    if (!src || !Types.ObjectId.isValid(courseId)) throw fail(404, "Course not found in the CRM");
    const course = await src.conn.collection("courses").findOne({ _id: new Types.ObjectId(courseId) }, { projection: { name: 1 }, maxTimeMS: QUERY_MS });
    if (!course) throw fail(404, "Course not found in the CRM");
    name = String(course.name ?? "");
  }
  const before = row ? `${aedOf(row.sales)} / ${aedOf(row.tl)} / ${aedOf(row.sm)} / $${row.creditUsd}` : "not set";
  const inrBefore = row ? inrOf({}, row) : null;
  const inr = inrOf(input, row);
  const next = { courseId, name, ...input, ...inr, updatedAt: new Date(), updatedByEmail: by };
  if (row) Object.assign(row, next);
  else doc.courses.push(next);
  doc.updatedByEmail = by;
  await doc.save();
  return `${nameOf(portal)} · ${name}: ${before} → ${aedOf(input.sales)} / ${aedOf(input.tl)} / ${aedOf(input.sm)} / $${input.creditUsd} (sales / TL / SM / credit)${inrChange(inrBefore, inr)}`;
}

/** A position's slab rows, in force from this month (UAE) on; the other positions carried as they stand. */
export async function saveSlabs(code: string, role: string, rows: IPlanSlabRow[], by: string): Promise<string> {
  const doc = await planDoc(code);
  const portal = doc.portal;
  if (!(slabRolesOf(portal) as string[]).includes(role)) throw fail(400, `${nameOf(portal)} has no ${role} slab`);
  const problem = slabProblem(rows);
  if (problem) throw fail(400, problem);
  const month = uaeMonth();
  const now = slabsInForce(doc.slabs, month);
  const next: IPlanSlabVersion = {
    from: month,
    sales: rowsOf(now?.sales), tl: rowsOf(now?.tl), sm: rowsOf(now?.sm),
    updatedAt: new Date(), updatedByEmail: by,
  };
  next[role as PlanSlabRole] = rowsOf(rows);
  doc.slabs = [...doc.slabs.filter((v) => v.from !== month), next].sort((a, b) => (a.from < b.from ? -1 : 1)) as typeof doc.slabs;
  doc.updatedByEmail = by;
  await doc.save();
  const label = { sales: "Sales Staff", tl: "Team Leader", sm: "Sales Manager" }[role as PlanSlabRole];
  return `${nameOf(portal)} · ${label} slab from ${month}: ${rows.map((r) => `${r.name} ${r.target.toLocaleString("en-US")} → ${r.salary.toLocaleString("en-US")} + ${r.percent}%`).join(", ")}`;
}

/* ── The slabs of now, applied to an earlier month (the user, 2026-11-01: "a button to apply them to October") ── */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthName = (m: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
const rowsText = (rows: IPlanSlabRow[]) => rows.map((r) => `${r.name} ${r.target.toLocaleString("en-US")} → ${r.salary.toLocaleString("en-US")} + ${r.percent}%`).join(", ");

/**
 * The slabs in force this month, made the ones in force from `month` on: every version from `month` up to the one in
 * force now is replaced by one version at `month` with today's rows (a later one, if any, is kept). Refused for a
 * month before commission began (October 2026), this month or later, or when today's slabs already start then or
 * before.
 */
function slabsFromMonth(versions: IPlanSlabVersion[], month: string, by: string): { next: IPlanSlabVersion[]; now: IPlanSlabVersion; before: IPlanSlabVersion | null } {
  if (!MONTH_RE.test(month)) throw fail(400, "month is YYYY-MM");
  if (month < PAY_FROM_MONTH) throw fail(400, `Pay on the slabs starts in ${monthName(PAY_FROM_MONTH)}`);
  const today = uaeMonth();
  if (month >= today) throw fail(400, `${monthName(month)} is this month or later — a change made now is in force from this month already`);
  const now = slabsInForce(versions, today);
  if (!now) throw fail(409, "This plan has no slabs");
  if (now.from <= month) throw fail(400, `These slabs are in force from ${now.from === BUILT_IN_FROM ? "the start" : monthName(now.from)} already`);
  const before = slabsInForce(versions, month);
  const moved: IPlanSlabVersion = { from: month, sales: rowsOf(now.sales), tl: rowsOf(now.tl), sm: rowsOf(now.sm), updatedAt: new Date(), updatedByEmail: by };
  const next = [...versions.filter((v) => v.from < month || v.from > now.from), moved].sort((a, b) => (a.from < b.from ? -1 : 1));
  return { next, now, before };
}

export interface ApplyPreviewRow {
  user: string;
  name: string;
  before: { role: string; level: string; percent: number; salary: number; payable: number; total: number } | null;
  after: { role: string; level: string; percent: number; salary: number; payable: number; total: number } | null;
}

/** What `month`'s pay would be with today's slabs in force from it — each person whose pay moves, before and after. Nothing is saved. */
export async function previewSlabsFrom(code: string, month: string) {
  const { plan, src } = await engineInputs(code);
  const { next, now } = slabsFromMonth(plan.slabs, month, "");
  const [was, will] = await Promise.all([payRows(src.conn, plan, month), payRows(src.conn, { ...plan, slabs: next }, month)]);
  const fig = (r: EnginePayRow | undefined) =>
    r ? { role: r.role, level: r.level.name, percent: r.percent, salary: r.salary, payable: r.commission.payable, total: r.total } : null;
  const ids = [...new Set([...was.map((r) => r.user), ...will.map((r) => r.user)])];
  const people: ApplyPreviewRow[] = ids
    .map((id) => {
      const a = was.find((r) => r.user === id), b = will.find((r) => r.user === id);
      return { user: id, name: (b ?? a)!.name, before: fig(a), after: fig(b) };
    })
    .filter((p) => JSON.stringify(p.before) !== JSON.stringify(p.after));
  const total = (rows: EnginePayRow[]) => Math.round(rows.reduce((t, r) => t + r.total, 0) * 100) / 100;
  return { code, month, from: now.from, people, unchanged: ids.length - people.length, totals: { before: total(was), after: total(will) } };
}

/** Today's slabs made the ones in force from `month` on. The change list keeps what `month` had before. */
export async function applySlabsFrom(code: string, month: string, by: string): Promise<string> {
  const doc = await planDoc(code);
  const { next, now, before } = slabsFromMonth(doc.slabs as IPlanSlabVersion[], month, by);
  doc.slabs = next as typeof doc.slabs;
  doc.updatedByEmail = by;
  await doc.save();
  const roles = slabRolesOf(doc.portal);
  const label = { sales: "Sales Staff", tl: "Team Leader", sm: "Sales Manager" };
  const was = roles.map((r) => `${label[r]} ${rowsText(rowsOf(before?.[r]))}`).join("; ");
  return `${nameOf(doc.portal)} · the slabs in force from ${monthName(now.from)} now in force from ${monthName(month)} · ${monthName(month)} had: ${was}`;
}

/* ── A team on a plan of its own (the user, 2026-11-03: "Team Legacy new, Titan and Maverick as now") ──────────── */

const ROLE_LABEL: Record<PlanSlabRole, string> = { sales: "Sales Staff", tl: "Team Leader", sm: "Sales Manager" };

/** The team's own plan in the portal's plan, made if it has none yet — the team checked against the CRM first. */
async function teamPlanIn(doc: Awaited<ReturnType<typeof planDoc>>, teamId: string, make: boolean): Promise<IPlanTeam> {
  if (!TEAM_PLAN_PORTALS.includes(doc.portal)) throw fail(400, `${nameOf(doc.portal)}'s teams are all on its one plan`);
  const teams = (doc.teams ?? []) as IPlanTeam[];
  const kept = teams.find((t) => t.teamId === teamId);
  if (kept) return kept;
  if (!make) throw fail(404, "That team has no plan of its own");
  const src = await sourceOf(doc.portal);
  if (!src) throw fail(503, `${nameOf(doc.portal)} can't be reached to check the team — try again`);
  if (!Types.ObjectId.isValid(teamId)) throw fail(404, "Team not found in the CRM");
  const team = await src.conn.collection("teams").findOne({ _id: new Types.ObjectId(teamId) }, { projection: { name: 1 }, maxTimeMS: QUERY_MS });
  if (!team) throw fail(404, "Team not found in the CRM");
  doc.teams = [...teams, { teamId, name: String(team.name ?? ""), courses: [], slabs: [], updatedAt: null, updatedByEmail: "" }] as typeof doc.teams;
  return (doc.teams as IPlanTeam[]).find((t) => t.teamId === teamId)!;
}

/** A course's name: its row in the portal's plan, else the CRM's course (which must exist). */
async function courseName(doc: Awaited<ReturnType<typeof planDoc>>, courseId: string): Promise<string> {
  const row = doc.courses.find((c) => c.courseId === courseId);
  if (row) return row.name;
  const src = await sourceOf(doc.portal);
  if (!src || !Types.ObjectId.isValid(courseId)) throw fail(404, "Course not found in the CRM");
  const course = await src.conn.collection("courses").findOne({ _id: new Types.ObjectId(courseId) }, { projection: { name: 1 }, maxTimeMS: QUERY_MS });
  if (!course) throw fail(404, "Course not found in the CRM");
  return String(course.name ?? "");
}

/** What a sale of a course pays each position on one team, in place of the portal's. Only for sales counted from now on. */
export async function saveTeamCourse(
  code: string, teamId: string, courseId: string, input: { sales: number; tl: number; sm: number } & InrAmounts, by: string,
): Promise<string> {
  const doc = await planDoc(code);
  if (doc.tlRule === "never" && (input.tl > 0 || (input.tlInr ?? 0) > 0)) throw fail(400, `${nameOf(doc.portal)} pays team leaders nothing on a sale`);
  const team = await teamPlanIn(doc, teamId, true);
  const name = await courseName(doc, courseId);
  const row = team.courses.find((c) => c.courseId === courseId);
  const base = doc.courses.find((c) => c.courseId === courseId);
  const fig = (r: { sales: number; tl: number; sm: number }) => `${aedOf(r.sales)} / ${aedOf(r.tl)} / ${aedOf(r.sm)}`;
  const before = row ? fig(row) : base ? `the portal's ${fig(base)}` : "not set";
  // The team's own rupee amounts; where it has none, a sale of its takes the portal's (commissionEngine courseRow).
  const inrBefore = row ? inrOf({}, row) : null;
  const inr = inrOf(input, row);
  const next: IPlanCourse = { courseId, name, ...input, ...inr, creditUsd: 0, updatedAt: new Date(), updatedByEmail: by };
  team.courses = row ? team.courses.map((c) => (c.courseId === courseId ? next : c)) : [...team.courses, next];
  team.updatedAt = new Date();
  team.updatedByEmail = by;
  doc.markModified("teams");
  doc.updatedByEmail = by;
  await doc.save();
  return `${nameOf(doc.portal)} · ${team.name} · ${name}: ${before} → ${fig(input)} (sales / TL / SM, this team only)${inrChange(inrBefore, inr)}`;
}

/** A course back on the portal's amounts for one team. */
export async function clearTeamCourse(code: string, teamId: string, courseId: string, by: string): Promise<string> {
  const doc = await planDoc(code);
  const team = await teamPlanIn(doc, teamId, false);
  const row = team.courses.find((c) => c.courseId === courseId);
  if (!row) throw fail(404, "This team has no amounts of its own for that course");
  team.courses = team.courses.filter((c) => c.courseId !== courseId);
  team.updatedAt = new Date();
  team.updatedByEmail = by;
  doc.markModified("teams");
  doc.updatedByEmail = by;
  await doc.save();
  return `${nameOf(doc.portal)} · ${team.name} · ${row.name}: back on the portal's amounts (was ${aedOf(row.sales)} / ${aedOf(row.tl)} / ${aedOf(row.sm)})`;
}

/**
 * One position's slab for one team, from this month (UAE) on — or, with `rows` null, that position back on the
 * portal's slab from this month. The team's other position is carried as it stands; past months keep theirs.
 */
export async function saveTeamSlabs(code: string, teamId: string, role: string, rows: IPlanSlabRow[] | null, by: string): Promise<string> {
  const doc = await planDoc(code);
  if (!(teamSlabRolesOf(doc.portal) as string[]).includes(role)) throw fail(400, `A team has no ${role} slab of its own in ${nameOf(doc.portal)}`);
  if (rows) {
    const problem = slabProblem(rows);
    if (problem) throw fail(400, problem);
  }
  const team = await teamPlanIn(doc, teamId, !!rows);
  const month = uaeMonth();
  const now = slabsInForce(team.slabs, month);
  const r = role as PlanSlabRole;
  if (!rows && !rowsOf(now?.[r]).length) throw fail(404, `${team.name} is on the portal's ${ROLE_LABEL[r]} slab already`);
  const next: IPlanSlabVersion = { from: month, sales: rowsOf(now?.sales), tl: rowsOf(now?.tl), sm: [], updatedAt: new Date(), updatedByEmail: by };
  next[r] = rows ? rowsOf(rows) : [];
  team.slabs = [...team.slabs.filter((v) => v.from !== month), next].sort((a, b) => (a.from < b.from ? -1 : 1));
  team.updatedAt = new Date();
  team.updatedByEmail = by;
  doc.markModified("teams");
  doc.updatedByEmail = by;
  await doc.save();
  return rows
    ? `${nameOf(doc.portal)} · ${team.name} · ${ROLE_LABEL[r]} slab from ${month}: ${rowsText(rows)} (this team only)`
    : `${nameOf(doc.portal)} · ${team.name} · ${ROLE_LABEL[r]}: back on the portal's slab from ${month}`;
}

/** The Sales Manager and the logins that earn nothing — people of the CRM, by id. */
export async function saveSettings(code: string, input: { salesManager: string | null; excluded: string[] }, by: string): Promise<string> {
  const doc = await planDoc(code);
  const portal = doc.portal;
  const ids = [...new Set([...(input.salesManager ? [input.salesManager] : []), ...input.excluded])];
  if (ids.some((id) => !Types.ObjectId.isValid(id))) throw fail(400, "Unknown user");
  const src = await sourceOf(portal);
  if (!src) throw fail(503, `${nameOf(portal)} can't be reached to check its people — try again`);
  const found = new Map(
    (await src.conn.collection("users").find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }, { projection: { name: 1 }, maxTimeMS: QUERY_MS }).toArray())
      .map((u) => [String(u._id), String(u.name ?? "")]),
  );
  if (found.size !== ids.length) throw fail(400, "Unknown user");
  const person = (id: string): IPlanPerson => ({ id, name: found.get(id) ?? "" });
  const before = `SM ${doc.salesManager?.name ?? "none"}; earn nothing: ${doc.excluded.map((p) => p.name).join(", ") || "no one"}`;
  doc.salesManager = input.salesManager ? person(input.salesManager) : null;
  doc.excluded = [...new Set(input.excluded)].map(person);
  doc.updatedByEmail = by;
  await doc.save();
  return `${nameOf(portal)} · ${before} → SM ${doc.salesManager?.name ?? "none"}; earn nothing: ${doc.excluded.map((p) => p.name).join(", ") || "no one"}`;
}

/* ── Stage 2 (2026-11-01): Root's figures beside the CRM's, and the plan as a CRM will read it ─────────────────── */

/** A portal's plan kept in Root, and its CRM's database — what Root works its figures out from. */
export async function engineInputs(code: string): Promise<{ plan: ICommissionPlan; src: CrmSource }> {
  if (!isPortal(code)) throw fail(404, `No commission plan for "${code}"`);
  const plan = await CommissionPlan.findOne({ portal: code }).lean<ICommissionPlan>();
  if (!plan) throw fail(409, "This CRM's plan has not been copied to Root yet");
  const src = await sourceOf(code);
  if (!src) throw fail(503, `${nameOf(code)}'s database can't be reached — try again`);
  return { plan, src };
}

export interface PayCompare {
  user: string;
  name: string;
  crm: { role: string; level: string; percent: number; earned: number; balance: number; payable: number } | null;
  root: { role: string; level: string; percent: number; salary: number; target: number; earned: number; balance: number; payable: number } | null;
  same: boolean;
}

/**
 * A month of a portal side by side (root admins): each person's My Pay as the CRM gives it and as Root works it out
 * from its plan, and each decided sale's lines as the CRM recorded them and as Root's plan gives them now.
 */
export async function compareMonth(code: string, month: string) {
  const { plan, src } = await engineInputs(code);
  const [rootRows, crmPay, sales] = await Promise.all([
    payRows(src.conn, plan, month),
    month < PAY_FROM_MONTH ? Promise.resolve({ people: [] }) : payOf(code, month),
    compareSales(src.conn, plan, month),
  ]);
  const crmPeople = "people" in crmPay ? crmPay.people : null;
  const byUser = new Map<string, PayCompare>();
  const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
  for (const r of rootRows as EnginePayRow[]) {
    byUser.set(r.user, {
      user: r.user, name: r.name, crm: null,
      root: { role: r.role, level: r.level.name, percent: r.percent, salary: r.salary, target: r.sales.value, earned: r.commission.earned, balance: r.commission.balance, payable: r.commission.payable },
      same: false,
    });
  }
  for (const p of crmPeople ?? []) {
    const row = byUser.get(String(p.user)) ?? { user: String(p.user), name: p.name, crm: null, root: null, same: false };
    row.crm = { role: String(p.role ?? ""), level: String(p.level ?? ""), percent: r2(p.percent), earned: r2(p.earned), balance: r2(p.balance), payable: r2(p.payable) };
    byUser.set(row.user, row);
  }
  const people = [...byUser.values()].map((p) => ({
    ...p,
    same: !!p.crm && !!p.root && p.crm.role === p.root.role && p.crm.level === p.root.level && p.crm.percent === p.root.percent
      && p.crm.earned === p.root.earned && p.crm.balance === p.root.balance && p.crm.payable === p.root.payable,
  }));
  const { from } = slabsOfMonth(plan, month);
  return {
    code, month, slabsFrom: from,
    pay: { crmError: "error" in crmPay ? crmPay.error : null, people, differ: people.filter((p) => !p.same).length },
    sales: { list: sales as SaleCompare[], differ: sales.filter((s) => !s.same).length },
  };
}

/** The plan as a CRM reads it from Root (stage 3): its rules, every course's row, the people, the month's slabs. */
export async function planForCrm(code: string, month: string) {
  if (!isPortal(code)) throw fail(404, `No commission plan for "${code}"`);
  const plan = await CommissionPlan.findOne({ portal: code }).lean<ICommissionPlan>();
  if (!plan) throw fail(409, "This CRM's plan has not been copied to Root yet");
  const { from, slabs } = slabsOfMonth(plan, month);
  return {
    portal: plan.portal,
    tlRule: plan.tlRule,
    tlSlab: plan.tlSlab,
    tlPaidOnOwnClose: BUILT_IN[plan.portal].tlPaidOnOwnClose,
    salesManager: plan.salesManager,
    excluded: plan.excluded,
    courses: plan.courses.map((c) => ({ courseId: c.courseId, name: c.name, sales: c.sales, tl: c.tl, sm: c.sm, creditUsd: c.creditUsd, ...inrOf({}, c) })),
    month,
    slabsFrom: from,
    slabs,
  };
}

/* ── Salary on the slabs, for payroll (the user, 2026-11-01: "the salary from the slab in HRMS, LOP on it") ─────── */

export interface SlabPayPerson {
  crm: string;
  crmName: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  level: string;
  /** The month's salary on the slab — what finance's payroll pays as this person's salary, loss of pay priced off it. */
  salary: number;
  /** The CRM's currency, the salary's. */
  currency: string;
  percent: number;
  earned: number;
  payable: number;
}

/**
 * Everyone on a CRM's slabs in a month, with their email, from Root's plan and figures — every CRM whose plan is
 * kept here (no Bangalore). A CRM that can't be read says why; the others still answer.
 */
export async function payrollSlabs(month: string): Promise<{ month: string; people: SlabPayPerson[]; failures: Array<{ crm: string; error: string }> }> {
  const { sources, failures } = await getSources();
  const plans = await CommissionPlan.find({}).lean<ICommissionPlan[]>();
  const people: SlabPayPerson[] = [];
  const failed = failures.filter((f) => isPortal(f.code)).map((f) => ({ crm: f.code, error: f.error }));
  for (const plan of plans) {
    const src = sources.find((x) => x.org.code === plan.portal);
    if (!src) {
      if (!failed.some((f) => f.crm === plan.portal)) failed.push({ crm: plan.portal, error: "Its database isn't configured on this server" });
      continue;
    }
    try {
      const rows = await payRows(src.conn, plan, month);
      const emails = new Map(
        (await src.conn.collection("users").find({ _id: { $in: rows.map((r) => new Types.ObjectId(r.user)) } }, { projection: { email: 1 }, maxTimeMS: QUERY_MS }).toArray())
          .map((u) => [String(u._id), String(u.email ?? "").trim().toLowerCase()]),
      );
      for (const r of rows) {
        people.push({
          crm: plan.portal, crmName: src.org.name, userId: r.user, name: r.name, email: emails.get(r.user) ?? "", role: r.role,
          level: r.level.name, salary: r.salary, currency: (src.org as { currency?: string }).currency || "AED", percent: r.percent, earned: r.commission.earned, payable: r.commission.payable,
        });
      }
    } catch (e) {
      failed.push({ crm: plan.portal, error: e instanceof Error ? e.message : "Could not be read" });
    }
  }
  return { month, people, failures: failed };
}
