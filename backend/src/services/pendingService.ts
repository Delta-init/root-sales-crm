import { Types } from "mongoose";
import { Organization } from "../models/Organization.js";
import { getSources, type CrmSource } from "./crmConnections.js";

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
 * Finance, Tetra Commission, HRMS, LMS and Media ERP come next, each through
 * an endpoint of its own — they keep their own logic, Root does not copy it.
 * Until then they are listed as coming.
 */

export interface PendingKind {
  key: string;
  label: string;
  total: number;
  /** Of those, how many are past their time (reminders). */
  overdue?: number;
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
    kinds,
    people: list,
    total: kinds.reduce((n, k) => n + k.total, 0),
  };
}

/** One person, everywhere: matched by email across portals, else per portal. */
export interface PendingEveryone {
  key: string;
  name: string;
  email: string;
  total: number;
  items: { portal: string; portalName: string; key: string; label: string; count: number; overdue?: number }[];
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
  portals.sort((a, b) => order(a.code) - order(b.code));

  const labelOf = new Map(CRM_KINDS.map((k) => [k.key as string, k.label as string]));
  const everyone = new Map<string, PendingEveryone>();
  for (const portal of portals) {
    for (const p of portal.people) {
      const key = p.email || `${portal.code}:${p.id}`;
      const row = everyone.get(key) ?? { key, name: p.name, email: p.email, total: 0, items: [] };
      for (const kind of CRM_KINDS) {
        const count = p.counts[kind.key] ?? 0;
        if (!count) continue;
        row.items.push({
          portal: portal.code,
          portalName: portal.name,
          key: kind.key,
          label: labelOf.get(kind.key) ?? kind.key,
          count,
          ...(kind.key === "reminders" && p.counts.reminders_overdue ? { overdue: p.counts.reminders_overdue } : {}),
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
    /** In the registry, not on this page yet: they need an endpoint of their own. */
    comingNext: orgs.filter((o) => o.kind !== "crm").map((o) => ({ code: o.code, name: o.name })),
  };
}
