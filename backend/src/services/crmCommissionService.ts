import { getSources } from "./crmConnections.js";
import { resolveTarget, callTarget } from "../lib/targetClient.js";
import { inrPerAed } from "./bangaloreRevenue.js";

/**
 * GET /service/crm-commission?month=YYYY-MM — finance's CRM commission tab (the user, 2026-10-21: "commission of each
 * CRM needs to show here, a manager approves, then accounts mark it paid with the receipt").
 *
 * For each sales CRM, the month's counted commission (CommissionSale, state "counted" — its five steps done, who earns
 * what decided once), per person: their lines as salesperson, team leader or sales manager added up, and the sales
 * behind them. Amounts in the CRM's own currency, major units, as the CRM keeps them. Sales still on their way (in
 * progress or waiting) are counted, not listed. A CRM that can't be reached says so and the others still answer.
 * A salesperson's sale that earns nothing (no commission on its course) is listed at 0, as My Pay counts it.
 *
 * And what finance pays (the user, 2026-10-21: "finance pays My Pay's commission payable"): each person's My Pay
 * figures from the CRM's own API (GET /service/pay) — the commission earned × their salary-slab level's percent,
 * "payable" — which can only be worked out there. A CRM whose API can't say gives `payError` and no payable.
 *
 * And for finance's Collected column (2026-10-31: a Bangalore sale's INR 57,375 was added up as AED 57,375): each
 * sale's student — its invoice's external id in finance, as invoice numbers repeat across finance's organizations —
 * and the CRM's rupees-per-dirham rate, the one its revenue (and the TV) counts rupees at.
 * Read-only.
 */

export interface CommissionLine {
  saleId: string; saleDate: string; student: string; course: string; invoiceNumber: string; role: string; amount: number;
  /** The CRM's student (finance's invoice external id); "" when the sale doesn't say. */
  studentId: string;
}
export interface CommissionPerson {
  userId: string; name: string; roles: string[]; amount: number; sales: number; lines: CommissionLine[];
  /** My Pay's commission payable, the level's percent and name; null when the CRM's API couldn't say. */
  payable: number | null; percent: number | null; level: string | null;
}
export interface CrmCommission {
  code: string; name: string; currency: string; error: string | null;
  people: CommissionPerson[]; total: number; pending: { progress: number; waiting: number };
  /** Payable this month, all people; null with payError when the CRM's My Pay figures couldn't be had. */
  payableTotal: number | null; payError: string | null;
  /** 1 AED = this many rupees, the CRM's Settings rate; null when it couldn't be read. */
  inrPerAed: number | null;
}

interface PayPerson { user: string; name: string; percent: number; level: string; earned: number; payable: number }

/** A CRM's My Pay figures for the month, through its API — or why not. */
async function payOf(code: string, month: string): Promise<{ people: PayPerson[] } | { error: string }> {
  try {
    const target = await resolveTarget(code);
    const data = await callTarget<{ people?: PayPerson[] }>(target, `/pay?month=${encodeURIComponent(month)}`, { method: "GET", verb: "share My Pay" });
    return { people: data?.people ?? [] };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Its My Pay figures could not be had" };
  }
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function validMonth(v: unknown): v is string {
  return typeof v === "string" && MONTH.test(v);
}

export async function crmCommission(month: string): Promise<{ month: string; crms: CrmCommission[] }> {
  const { sources, failures } = await getSources();
  const crms: CrmCommission[] = await Promise.all(sources.map(async (src) => {
    const { org, conn } = src;
    const base = { code: org.code, name: org.name, currency: (org as { currency?: string }).currency || "AED" };
    const pay = await payOf(org.code, month);
    const payByUser = "people" in pay ? new Map(pay.people.map((p) => [String(p.user), p])) : null;
    const payError = "error" in pay ? pay.error : null;
    const rate = await inrPerAed(src).catch(() => null);
    try {
      const sales = conn.collection("commissionsales");
      const [counted, progress, waiting] = await Promise.all([
        sales.find({ month, state: "counted" }, { projection: { student: 1, studentName: 1, courseName: 1, invoiceNumber: 1, saleDate: 1, lines: 1 } }).sort({ saleDate: 1 }).toArray(),
        sales.countDocuments({ month, state: "progress" }),
        sales.countDocuments({ month, state: "waiting" }),
      ]);
      const byPerson = new Map<string, CommissionPerson>();
      for (const s of counted as Record<string, any>[]) {
        const sold = new Set<string>();
        for (const l of s.lines ?? []) {
          const amount = Number(l.amount) || 0;
          // A salesperson's own sale stays even at 0 — a course with no commission on the plan still counts toward
          // their slab in My Pay (2026-10-31: finance listed 11 sales where My Pay and the TV had 12); a team leader's
          // or sales manager's 0 is left out.
          if (!l.user || !(amount > 0 || l.role === "sales")) continue;
          const id = String(l.user);
          const mine = payByUser?.get(id);
          const p = byPerson.get(id) ?? {
            userId: id, name: String(l.userName || "—"), roles: [], amount: 0, sales: 0, lines: [],
            payable: payByUser ? Math.round((Number(mine?.payable) || 0) * 100) / 100 : null,
            percent: mine ? Number(mine.percent) || 0 : payByUser ? 0 : null, level: mine?.level ?? null,
          };
          if (!p.roles.includes(String(l.role))) p.roles.push(String(l.role));
          p.amount += amount;
          if (!sold.has(id)) { p.sales++; sold.add(id); }
          p.lines.push({
            saleId: String(s._id), saleDate: new Date(s.saleDate).toISOString(), student: String(s.studentName ?? ""), course: String(s.courseName ?? ""),
            invoiceNumber: String(s.invoiceNumber ?? ""), role: String(l.role), amount, studentId: s.student ? String(s.student) : "",
          });
          byPerson.set(id, p);
        }
      }
      const people = [...byPerson.values()]
        .map((p) => ({ ...p, amount: Math.round(p.amount * 100) / 100 }))
        .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
      const payableTotal = payByUser ? Math.round(people.reduce((t, p) => t + (p.payable ?? 0), 0) * 100) / 100 : null;
      return { ...base, error: null, people, total: Math.round(people.reduce((t, p) => t + p.amount, 0) * 100) / 100, pending: { progress, waiting }, payableTotal, payError, inrPerAed: rate };
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message : "Could not read its commission", people: [], total: 0, pending: { progress: 0, waiting: 0 }, payableTotal: null, payError, inrPerAed: rate };
    }
  }));
  for (const f of failures) crms.push({ code: f.code, name: f.name, currency: "AED", error: f.error, people: [], total: 0, pending: { progress: 0, waiting: 0 }, payableTotal: null, payError: null, inrPerAed: null });
  return { month, crms };
}
