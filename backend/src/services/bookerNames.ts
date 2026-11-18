import { getSources } from "./crmConnections.js";
import { AdminUser } from "../models/AdminUser.js";
import { callTarget, resolveTarget } from "../lib/targetClient.js";

/*
 * Who booked a meeting, by name (the user, 2026-11-18: "filter the mentors' calendar by who scheduled the meeting —
 * CS or salesperson"). A meeting carries only the booker's address, as each portal sent it; this names it:
 *   1. a sales CRM's user (each CRM's database, read only, as the salesperson pages read it) → "Sales CRM", "Draw"…;
 *   2. else a CS Portal account (its /service/user?email=, with the role) → "CS Portal";
 *   3. else one of Root's own admins → "Root".
 * Kept 10 minutes an address (a minute when nobody was found), so a week's calendar costs a lookup now and then.
 * Never in the way: whatever cannot be asked in time is left as the bare address.
 */

export interface Booker { name: string; where: string; role: string | null }

const KEEP_MS = 10 * 60_000;
const KEEP_UNKNOWN_MS = 60_000;
const MAX_ASK = 60;
const cache = new Map<string, { at: number; who: Booker | null }>();

const fresh = (e: string) => {
  const had = cache.get(e);
  return had && Date.now() - had.at < (had.who ? KEEP_MS : KEEP_UNKNOWN_MS) ? had : null;
};

export async function bookerNames(emails: string[]): Promise<Map<string, Booker>> {
  const all = [...new Set(emails.map((e) => String(e ?? "").trim().toLowerCase()).filter((e) => e.includes("@")))];
  const missing = all.filter((e) => !fresh(e)).slice(0, MAX_ASK);
  if (missing.length) {
    const found = new Map<string, Booker>();
    // 1. The sales CRMs.
    try {
      const { sources } = await getSources();
      await Promise.all(sources.map(async (src) => {
        const users = await src.conn.collection("users")
          .find({ email: { $in: missing } }, { projection: { name: 1, email: 1 }, maxTimeMS: 5_000 }).toArray().catch(() => []);
        for (const u of users) {
          const e = String(u.email ?? "").toLowerCase();
          if (e && !found.has(e)) found.set(e, { name: String(u.name ?? "") || e, where: src.org.name || src.org.code, role: "Salesperson" });
        }
      }));
    } catch { /* a CRM that can't be read leaves its people as addresses */ }
    // 2. CS Portal.
    const left = missing.filter((e) => !found.has(e));
    if (left.length) {
      try {
        const target = await resolveTarget("commission");
        await Promise.all(left.map(async (e) => {
          const a = await callTarget<{ exists?: boolean; name?: string; roleName?: string | null }>(
            target, `/user?email=${encodeURIComponent(e)}`, { method: "GET", verb: "say who booked a meeting" },
          ).catch(() => null);
          if (a?.exists) found.set(e, { name: a.name || e, where: "CS Portal", role: a.roleName ?? null });
        }));
      } catch { /* CS Portal not set up here */ }
    }
    // 3. Root's own admins.
    const rest = missing.filter((e) => !found.has(e));
    if (rest.length) {
      const admins = await AdminUser.find({ email: { $in: rest } }).select("name email").lean().catch(() => []);
      for (const a of admins as Array<{ name?: string; email?: string }>) {
        const e = String(a.email ?? "").toLowerCase();
        if (e) found.set(e, { name: a.name || e, where: "Root", role: null });
      }
    }
    const at = Date.now();
    for (const e of missing) cache.set(e, { at, who: found.get(e) ?? null });
  }
  const out = new Map<string, Booker>();
  for (const e of all) { const who = cache.get(e)?.who; if (who) out.set(e, who); }
  return out;
}

/** For the check script: forget every name. */
export function resetBookerNamesForTests(): void { cache.clear(); }
