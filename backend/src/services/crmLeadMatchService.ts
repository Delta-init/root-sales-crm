import type { Types } from "mongoose";
import { getSources, type CrmSource } from "./crmConnections.js";
import { statusLabel } from "./salespersonService.js";

/*
 * Which sales CRMs a person is a lead in (the user, 2026-10-13): the LMS's
 * Students Requests page asks, for up to 100 students at a time, and shows
 * each one's lead — which CRM, its status, who holds it.
 *
 * Read straight from every sales CRM's `leads`, read-only, as Salespeople and
 * Pending read them. A person matches a lead by:
 *   - email — exact, ignoring case. The CRMs store a lead's email trimmed and
 *     lower-cased (the Lead schema's own setters), so an `$in` on the
 *     lower-cased address uses their `email` index;
 *   - phone — the last 9 digits of any number in the lead's phone field, which
 *     can hold several ("050 123 4567 / 055 765 4321"), and only for a person
 *     whose phone has 9 digits or more. Nine, as the CRMs' own 3CX lookup
 *     matches, so +971 50…, 0050… and 050… are all the same number.
 *
 * One query per CRM for everyone asked: the emails and every phone ending in
 * one `$or`. The phone side cannot use an index (the digits sit anywhere in
 * free text), so the regex only narrows; each candidate is then checked
 * exactly here, number by number.
 */

const QUERY_MS = 15_000;
/** Newest first, this many per person. */
const PER_PERSON = 5;
/** A bound on one CRM's answer, so a pathological match cannot run away. */
const ROWS_PER_CRM = 5_000;
const TAIL = 9;

export interface PersonQuery { id: string; email?: string; phone?: string }

export interface LeadMatch {
  crm: string;
  crmName: string;
  leadId: string;
  leadName: string;
  status: string;
  statusLabel: string;
  assignedTo: string;
  matchedBy: "email" | "phone";
  createdAt: string | null;
}

const normEmail = (e?: string) => {
  const v = String(e ?? "").trim().toLowerCase();
  return v.includes("@") ? v : "";
};

/** The last 9 digits of a person's phone, or "" when it has fewer. */
const phoneTail = (p?: string) => {
  const digits = String(p ?? "").replace(/\D/g, "");
  return digits.length >= TAIL ? digits.slice(-TAIL) : "";
};

/** Every number in a lead's phone field, as its last 9 digits. */
const leadTails = (field: unknown): Set<string> =>
  new Set(
    String(field ?? "")
      .split(/[/,;|\n]+/)
      .map(phoneTail)
      .filter(Boolean),
  );

/*
 * The regex that narrows: each tail's digits with the separators people type
 * between them allowed (spaces, dashes, dots, brackets), not followed by
 * another digit of the same number.
 */
const SEP = "[\\s\\-.()]*";
const tailPattern = (tails: string[]) =>
  `(?:${tails.map((t) => t.split("").join(SEP)).join("|")})(?!${SEP}\\d)`;

interface LeadRow {
  _id: unknown;
  name?: string;
  email?: string;
  phone?: string;
  status?: string;
  assignedTo?: Types.ObjectId | null;
  createdAt?: Date;
}

interface Hit { match: LeadMatch; at: number }

async function matchOne(src: CrmSource, people: { id: string; email: string; tail: string }[]): Promise<Map<string, Hit[]>> {
  const emails = [...new Set(people.map((p) => p.email).filter(Boolean))];
  const tails = [...new Set(people.map((p) => p.tail).filter(Boolean))];
  const out = new Map<string, Hit[]>();
  if (!emails.length && !tails.length) return out;

  const or: Record<string, unknown>[] = [];
  if (emails.length) or.push({ email: { $in: emails } });
  if (tails.length) or.push({ phone: { $regex: tailPattern(tails) } });

  const leads = await src.conn.collection<LeadRow>("leads")
    // Not sorted here: a sort would steer the planner onto the createdAt index
    // and past the email one. The few rows that match are ordered below.
    .find({ $or: or }, { projection: { name: 1, email: 1, phone: 1, status: 1, assignedTo: 1, createdAt: 1 }, maxTimeMS: QUERY_MS })
    .limit(ROWS_PER_CRM)
    .toArray();
  if (!leads.length) return out;

  const holderIds = [...new Map(leads.flatMap((l) => (l.assignedTo ? [[String(l.assignedTo), l.assignedTo] as const] : []))).values()];
  const holders = holderIds.length
    ? await src.conn.collection("users")
      .find({ _id: { $in: holderIds } }, { projection: { name: 1 }, maxTimeMS: QUERY_MS })
      .toArray()
    : [];
  const nameOf = new Map(holders.map((u) => [String(u._id), String(u.name ?? "")]));

  for (const lead of leads) {
    const email = String(lead.email ?? "").trim().toLowerCase();
    const numbers = leadTails(lead.phone);
    const at = lead.createdAt instanceof Date ? lead.createdAt.getTime() : 0;
    for (const p of people) {
      // Email first: a lead found both ways is one lead, found by email.
      const by = p.email && p.email === email ? "email" : p.tail && numbers.has(p.tail) ? "phone" : null;
      if (!by) continue;
      const status = String(lead.status ?? "");
      const hits = out.get(p.id) ?? [];
      hits.push({
        at,
        match: {
          crm: src.org.code,
          crmName: src.org.name,
          leadId: String(lead._id),
          leadName: String(lead.name ?? ""),
          status,
          statusLabel: statusLabel(status),
          assignedTo: lead.assignedTo ? nameOf.get(String(lead.assignedTo)) ?? "" : "",
          matchedBy: by,
          createdAt: at ? new Date(at).toISOString() : null,
        },
      });
      out.set(p.id, hits);
    }
  }
  return out;
}

/**
 * Each person's leads across every sales CRM, newest first, at most 5. Every
 * id asked gets a key, an empty list when nothing matched. A CRM that cannot
 * be read is named in `failures` and the rest still answer.
 */
export async function matchCrmLeads(people: PersonQuery[]) {
  const asked = people.map((p) => ({ id: p.id, email: normEmail(p.email), tail: phoneTail(p.phone) }));
  const { sources, failures } = await getSources();

  const perCrm = await Promise.all(sources.map(async (src) => {
    try {
      return await matchOne(src, asked);
    } catch (error) {
      failures.push({ code: src.org.code, name: src.org.name, error: error instanceof Error ? error.message : "Could not be read" });
      return new Map<string, Hit[]>();
    }
  }));

  const results: Record<string, LeadMatch[]> = {};
  for (const p of asked) {
    if (results[p.id]) continue; // the same id twice: its hits are already one list
    const seen = new Set<string>();
    results[p.id] = perCrm
      .flatMap((m) => m.get(p.id) ?? [])
      .sort((a, b) => b.at - a.at || (a.match.matchedBy === "email" ? -1 : 1))
      .filter((h) => {
        const key = `${h.match.crm}:${h.match.leadId}`;
        return seen.has(key) ? false : (seen.add(key), true);
      })
      .slice(0, PER_PERSON)
      .map((h) => h.match);
  }
  return { results, failures };
}
