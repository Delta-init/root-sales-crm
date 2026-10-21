import { getSources } from "./crmConnections.js";

/**
 * GET /service/crm-commission?month=YYYY-MM — finance's CRM commission tab (the user, 2026-10-21: "commission of each
 * CRM needs to show here, a manager approves, then accounts mark it paid with the receipt").
 *
 * For each sales CRM, the month's counted commission (CommissionSale, state "counted" — its five steps done, who earns
 * what decided once), per person: their lines as salesperson, team leader or sales manager added up, and the sales
 * behind them. Amounts in the CRM's own currency, major units, as the CRM keeps them. Sales still on their way (in
 * progress or waiting) are counted, not listed. A CRM that can't be reached says so and the others still answer.
 * Read-only.
 */

export interface CommissionLine {
  saleId: string; saleDate: string; student: string; course: string; invoiceNumber: string; role: string; amount: number;
}
export interface CommissionPerson {
  userId: string; name: string; roles: string[]; amount: number; sales: number; lines: CommissionLine[];
}
export interface CrmCommission {
  code: string; name: string; currency: string; error: string | null;
  people: CommissionPerson[]; total: number; pending: { progress: number; waiting: number };
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function validMonth(v: unknown): v is string {
  return typeof v === "string" && MONTH.test(v);
}

export async function crmCommission(month: string): Promise<{ month: string; crms: CrmCommission[] }> {
  const { sources, failures } = await getSources();
  const crms: CrmCommission[] = await Promise.all(sources.map(async ({ org, conn }) => {
    const base = { code: org.code, name: org.name, currency: (org as { currency?: string }).currency || "AED" };
    try {
      const sales = conn.collection("commissionsales");
      const [counted, progress, waiting] = await Promise.all([
        sales.find({ month, state: "counted" }, { projection: { studentName: 1, courseName: 1, invoiceNumber: 1, saleDate: 1, lines: 1 } }).sort({ saleDate: 1 }).toArray(),
        sales.countDocuments({ month, state: "progress" }),
        sales.countDocuments({ month, state: "waiting" }),
      ]);
      const byPerson = new Map<string, CommissionPerson>();
      for (const s of counted as Record<string, any>[]) {
        const sold = new Set<string>();
        for (const l of s.lines ?? []) {
          const amount = Number(l.amount) || 0;
          if (!l.user || !(amount > 0)) continue;
          const id = String(l.user);
          const p = byPerson.get(id) ?? { userId: id, name: String(l.userName || "—"), roles: [], amount: 0, sales: 0, lines: [] };
          if (!p.roles.includes(String(l.role))) p.roles.push(String(l.role));
          p.amount += amount;
          if (!sold.has(id)) { p.sales++; sold.add(id); }
          p.lines.push({
            saleId: String(s._id), saleDate: new Date(s.saleDate).toISOString(), student: String(s.studentName ?? ""), course: String(s.courseName ?? ""),
            invoiceNumber: String(s.invoiceNumber ?? ""), role: String(l.role), amount,
          });
          byPerson.set(id, p);
        }
      }
      const people = [...byPerson.values()]
        .map((p) => ({ ...p, amount: Math.round(p.amount * 100) / 100 }))
        .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
      return { ...base, error: null, people, total: Math.round(people.reduce((t, p) => t + p.amount, 0) * 100) / 100, pending: { progress, waiting } };
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message : "Could not read its commission", people: [], total: 0, pending: { progress: 0, waiting: 0 } };
    }
  }));
  for (const f of failures) crms.push({ code: f.code, name: f.name, currency: "AED", error: f.error, people: [], total: 0, pending: { progress: 0, waiting: 0 } });
  return { month, crms };
}
