import { Types } from "mongoose";
import { getSources, type CrmSource } from "./crmConnections.js";

/*
 * Commission plans, every sales CRM's, read only (the user, 2026-10-09): the
 * plans are no longer edited anywhere — not in the CRMs, not here — so Root
 * shows each one as it stands. Read straight from each CRM's database, as the
 * Pending page reads them.
 */

/** The CRMs that pay commission, and how each pays a sale's team leader (their TL_RULE). */
const TL_RULES: Record<string, { rule: string; label: string }> = {
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
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const slabRows = (v: unknown): SlabRow[] =>
  (Array.isArray(v) ? v : []).map((r: Record<string, unknown>) => ({
    name: String(r.name ?? ""), target: num(r.target), salary: num(r.salary), percent: num(r.percent),
  }));
/** This month in UAE time, YYYY-MM, as the CRMs count it. */
const uaeMonth = () => new Date(Date.now() + 4 * 60 * 60_000).toISOString().slice(0, 7);

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
  };
}

/** Every commission-paying CRM's plan; one that cannot be read says why. */
export async function commissionPlans(): Promise<CrmPlan[]> {
  const { sources, failures } = await getSources();
  const empty = (code: string, name: string, error: string): CrmPlan => ({
    code, name, available: false, error, tlRule: TL_RULES[code].rule, tlRuleLabel: TL_RULES[code].label,
    courses: [], salesManager: null, excluded: [], slabs: null,
  });
  const plans = await Promise.all(
    sources.filter((s) => TL_RULES[s.org.code]).map((s) =>
      planOf(s).catch((e) => empty(s.org.code, s.org.name, e instanceof Error ? e.message : "Could not be read")),
    ),
  );
  for (const f of failures) if (TL_RULES[f.code]) plans.push(empty(f.code, f.name, f.error));
  const order = Object.keys(TL_RULES);
  return plans.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
}
