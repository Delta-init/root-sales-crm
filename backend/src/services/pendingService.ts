import { Types } from "mongoose";
import { Organization } from "../models/Organization.js";
import { getSources, type CrmSource } from "./crmConnections.js";
import { resolveTarget, callTarget } from "../lib/targetClient.js";

/*
 * Pending, every portal at once (the user, 2026-10-06): the counts each
 * portal's own sidebar shows, and who they are waiting on — so a root admin
 * sees on one page what is waiting where, and for whom.
 *
 * The sales CRMs first, read straight from their databases as the group report
 * reads them (read-only). Their sidebar's two badges, per salesperson:
 *   - New leads — leads assigned to them that nobody has worked yet (status
 *     "assigned"): the Leads badge;
 *   - Reminders — reminders they set that are not done, overdue ones among
 *     them counted apart: the Reminders badge.
 * Every other portal — Tetra Commission, Finance, HRMS, LMS, Media ERP (the
 * user, 2026-10-11) — answers for itself: GET /api/v1/service/pending with the
 * portal secret Root already holds for it, its own sidebar's badges and whom
 * each waits on. Root does not copy their logic. A badge that waits on anyone
 * holding a permission ("shared") is listed in full against every holder (the
 * user's choice), so people's figures can add up to more than the card's.
 */

export interface PendingKind {
  key: string;
  label: string;
  total: number;
  /** Of those, how many are past their time (reminders). */
  overdue?: number;
  /** Waits on anyone holding a permission: every holder is shown with all of it. */
  shared?: boolean;
}

export interface PendingPerson {
  id: string;
  name: string;
  email: string;
  /** Still active in that portal; a person who has left can still have work sitting with them. */
  active: boolean;
  counts: Record<string, number>;
  total: number;
}

export interface PendingPortal {
  code: string;
  name: string;
  accent: string;
  /** Answered; false with `error` when it could not be read. */
  available: boolean;
  error?: string;
  kinds: PendingKind[];
  people: PendingPerson[];
  total: number;
  /** A sales CRM: its people have a salesperson page in Root. */
  crm?: boolean;
}

/** What a CRM's sidebar badges are called, in the order it shows them. */
const CRM_KINDS = [
  { key: "new_leads", label: "New leads" },
  { key: "reminders", label: "Reminders" },
] as const;

/** A slow CRM must not hold the page: each count gives up after this. */
const QUERY_MS = 15_000;

const asObjectIds = (ids: unknown[]) =>
  ids.filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);

/** One CRM's two badges, for everybody at once. */
async function crmPending(src: CrmSource, now: Date): Promise<PendingPortal> {
  const leads = src.conn.collection("leads");
  type Row = { _id: unknown; n: number; overdue?: number };
  const [assigned, reminders] = await Promise.all([
    leads
      .aggregate<Row>(
        [
          { $match: { status: "assigned", assignedTo: { $ne: null } } },
          { $group: { _id: "$assignedTo", n: { $sum: 1 } } },
        ],
        { maxTimeMS: QUERY_MS },
      )
      .toArray(),
    leads
      .aggregate<Row>(
        [
          { $match: { reminders: { $elemMatch: { isDone: { $ne: true } } } } },
          { $unwind: "$reminders" },
          { $match: { "reminders.isDone": { $ne: true }, "reminders.createdBy": { $ne: null } } },
          {
            $group: {
              _id: "$reminders.createdBy",
              n: { $sum: 1 },
              overdue: {
                $sum: {
                  $cond: [
                    { $and: [{ $ne: [{ $ifNull: ["$reminders.remindAt", null] }, null] }, { $lt: ["$reminders.remindAt", now] }] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
        { maxTimeMS: QUERY_MS },
      )
      .toArray(),
  ]);

  const ids = asObjectIds([...assigned, ...reminders].map((r) => r._id));
  const users = await src.conn
    .collection("users")
    .find({ _id: { $in: ids } }, { projection: { name: 1, email: 1, status: 1 }, maxTimeMS: QUERY_MS })
    .toArray();
  const userOf = new Map(users.map((u) => [String(u._id), u]));

  const people = new Map<string, PendingPerson>();
  const personOf = (id: unknown): PendingPerson => {
    const key = String(id);
    let p = people.get(key);
    if (!p) {
      const u = userOf.get(key);
      p = {
        id: key,
        name: (u?.name as string | undefined) || "Unknown user",
        email: String(u?.email ?? "").toLowerCase(),
        active: u ? u.status !== "inactive" : false,
        counts: { new_leads: 0, reminders: 0, reminders_overdue: 0 },
        total: 0,
      };
      people.set(key, p);
    }
    return p;
  };
  for (const r of assigned) personOf(r._id).counts.new_leads += r.n;
  for (const r of reminders) {
    const p = personOf(r._id);
    p.counts.reminders += r.n;
    p.counts.reminders_overdue += r.overdue ?? 0;
  }
  const list = [...people.values()].map((p) => ({ ...p, total: p.counts.new_leads + p.counts.reminders }));
  list.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const sum = (key: string) => list.reduce((n, p) => n + (p.counts[key] ?? 0), 0);
  const kinds: PendingKind[] = [
    { key: "new_leads", label: CRM_KINDS[0].label, total: sum("new_leads") },
    { key: "reminders", label: CRM_KINDS[1].label, total: sum("reminders"), overdue: sum("reminders_overdue") },
  ];
  return {
    code: src.org.code,
    name: src.org.name,
    accent: src.org.accent ?? "",
    available: true,
    crm: true,
    kinds,
    people: list,
    total: kinds.reduce((n, k) => n + k.total, 0),
  };
}

/** What a portal's /service/pending answers (see the comment at the top). */
interface ServicePending {
  kinds?: { key?: unknown; label?: unknown; total?: unknown; overdue?: unknown; shared?: unknown }[];
  people?: { id?: unknown; name?: unknown; email?: unknown; active?: unknown; counts?: Record<string, unknown>; total?: unknown }[];
}

const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** A portal that answers for itself, read into the same shape as a CRM's. */
async function servicePending(org: { code: string; name: string; accent?: string | null }): Promise<PendingPortal> {
  const target = await resolveTarget(org.code);
  let answer: ServicePending;
  try {
    answer = await callTarget<ServicePending>(target, "/pending", { method: "GET", verb: "share what is pending" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not be read";
    // Its server from before this page: the route is not there yet.
    throw new Error(/404|not found/i.test(message) ? `${org.name}'s server needs updating — it has no pending endpoint yet` : message);
  }
  const kinds: PendingKind[] = (Array.isArray(answer?.kinds) ? answer.kinds : [])
    .filter((k) => typeof k?.key === "string" && k.key)
    .map((k) => ({
      key: String(k.key),
      label: String(k.label ?? k.key),
      total: int(k.total),
      ...(int(k.overdue) ? { overdue: int(k.overdue) } : {}),
      ...(k.shared === true ? { shared: true } : {}),
    }));
  const keys = new Set(kinds.map((k) => k.key));
  const people: PendingPerson[] = (Array.isArray(answer?.people) ? answer.people : [])
    .map((x) => {
      const counts: Record<string, number> = {};
      for (const [key, v] of Object.entries(x?.counts ?? {})) {
        const base = key.endsWith("_overdue") ? key.slice(0, -"_overdue".length) : key;
        if (keys.has(base) && int(v)) counts[key] = int(v);
      }
      return {
        id: String(x?.id ?? ""),
        name: String(x?.name ?? "") || "Unknown user",
        email: String(x?.email ?? "").trim().toLowerCase(),
        active: x?.active !== false,
        counts,
        total: kinds.reduce((n, k) => n + (counts[k.key] ?? 0), 0),
      };
    })
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return {
    code: org.code,
    name: org.name,
    accent: org.accent ?? "",
    available: true,
    kinds,
    people,
    total: kinds.reduce((n, k) => n + k.total, 0),
  };
}

/** One person, everywhere: matched by email across portals, else per portal. */
export interface PendingEveryone {
  key: string;
  name: string;
  email: string;
  total: number;
  items: { portal: string; portalName: string; personId: string; crm?: boolean; key: string; label: string; count: number; overdue?: number; shared?: boolean }[];
}

/**
 * Every portal's pending counts, and everybody's across them. A portal that
 * cannot be read says why and leaves the rest standing.
 */
export async function pendingOverview() {
  const now = new Date();
  const [{ sources, failures }, orgs] = await Promise.all([
    getSources(),
    Organization.find({ isActive: true }).select("code name kind accent sortOrder").sort({ sortOrder: 1 }).lean(),
  ]);
  const orgOf = new Map<string, (typeof orgs)[number]>(orgs.map((o) => [o.code, o]));
  const order = (code: string) => orgOf.get(code)?.sortOrder ?? 999;

  const portals: PendingPortal[] = await Promise.all(
    sources.map(async (src) => {
      try {
        return await crmPending(src, now);
      } catch (error) {
        return {
          code: src.org.code, name: src.org.name, accent: src.org.accent ?? "", available: false,
          error: error instanceof Error ? error.message : "Could not be read", kinds: [], people: [], total: 0,
        };
      }
    }),
  );
  for (const f of failures) {
    portals.push({ code: f.code, name: f.name, accent: orgOf.get(f.code)?.accent ?? "", available: false, error: f.error, kinds: [], people: [], total: 0 });
  }
  // Every other portal answers for itself, all at once; one that cannot leaves the rest standing.
  const others = orgs.filter((o) => o.kind !== "crm");
  portals.push(...(await Promise.all(others.map(async (o) => {
    try {
      return await servicePending({ code: o.code, name: o.name, accent: o.accent });
    } catch (error) {
      return {
        code: o.code, name: o.name, accent: o.accent ?? "", available: false,
        error: error instanceof Error ? error.message : "Could not be read", kinds: [], people: [], total: 0,
      } satisfies PendingPortal;
    }
  }))));
  portals.sort((a, b) => order(a.code) - order(b.code));

  const everyone = new Map<string, PendingEveryone>();
  for (const portal of portals) {
    for (const p of portal.people) {
      const key = p.email || `${portal.code}:${p.id}`;
      const row = everyone.get(key) ?? { key, name: p.name, email: p.email, total: 0, items: [] };
      for (const kind of portal.kinds) {
        const count = p.counts[kind.key] ?? 0;
        if (!count) continue;
        const overdue = p.counts[`${kind.key}_overdue`] ?? 0;
        row.items.push({
          portal: portal.code,
          portalName: portal.name,
          personId: p.id,
          ...(portal.crm ? { crm: true } : {}),
          key: kind.key,
          label: kind.label,
          count,
          ...(overdue ? { overdue } : {}),
          ...(kind.shared ? { shared: true } : {}),
        });
        row.total += count;
      }
      everyone.set(key, row);
    }
  }

  return {
    generatedAt: now.toISOString(),
    portals,
    people: [...everyone.values()].filter((p) => p.total > 0).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    /** Every portal in the registry is on the page now; kept for the page from before. */
    comingNext: [] as { code: string; name: string }[],
  };
}
