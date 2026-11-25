import { getSources } from "./crmConnections.js";
import { bangaloreUnion, COUNTED_PAYMENT } from "./bangaloreRevenue.js";
import { managerTv } from "./managerTvService.js";
import { isPastTvMonth } from "./salesTvService.js";
import { callTarget, resolveTarget } from "../lib/targetClient.js";

/*
 * The Manager TV as an Excel file (the user, 2026-11-25: "an export button on the Manager TV page in Root — an
 * overview with the totals, and a sheet per employee with their collected payments, like finance's report by
 * salesperson; Manager TV values; only in the Root portal, not the public link").
 *
 * The overview is the TV's own answer for the month — every team, every person, their closings and revenue, the CS
 * team, the old-books line — so the file says what the screen said. Each person's payments are read the way the CRMs
 * count revenue (each CRM's database, its leads' counted payments by the day paid, its Bangalore enrolments and old
 * books in AED — bangaloreUnion), and each CS's from CS Portal (its /service/cs-tv-payments: the payments behind the
 * real board). Where a CRM's database can't be read here, or CS Portal is away, the person keeps their overview row
 * and the reason is given instead of payments. Signed-in root admins only (managerTvRoutes.ts).
 */

const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const dubaiMonthNow = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 7);
const nextMonth = (m: string) => { const [y, mm] = m.split("-").map(Number) as [number, number]; return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`; };
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ExportPayment { date: string; client: string; invoice: string; course: string; method: string; amount: number; note: string }
export interface ExportPerson { id: string; name: string; team: string; closings: number; revenue: number; payments: ExportPayment[] | null; missing?: string }
export interface ExportTeam { code: string; name: string; people: ExportPerson[]; closings: number; revenue: number; error?: string | null }
export interface ManagerTvExport {
  month: string;
  generatedAt: string;
  teams: ExportTeam[];
  oldBooks: { monthAed: number; rows: { salesperson: string; amount: number; paidOn: string; invoiceNumber?: string }[]; error: string | null };
  total: number;
}

type CrmCard = { code: string; name: string; error?: string | null; people: Array<{ id: string; name: string; team: string; closingsMonth: number; revenueMonth: number }>; hiddenPeople?: CrmCard["people"] };
type CsCard = { name: string; error?: string | null; people: Array<{ id: string; name: string; team: string; monthAed: number; payments: number }> };

/** One CRM's counted payments in the month, by the CRM user who holds the lead. */
async function crmPayments(code: string, from: Date, to: Date): Promise<Map<string, ExportPayment[]> | string> {
  const { sources, failures } = await getSources();
  const src = sources.find((s) => s.org.code === code);
  if (!src) return failures.find((f) => f.code === code)?.error ?? "This CRM's database isn't connected to Root";
  const range = { $gte: from, $lt: to };
  const rows = await src.conn.collection("leads").aggregate<{ who: unknown; name?: string; amount: number; paidAt: Date; method?: string; note?: string; inv?: string; course?: string }>([
    ...(await bangaloreUnion(src)),
    { $match: { assignedTo: { $ne: null }, "payments.paidAt": range } },
    { $unwind: "$payments" },
    { $match: COUNTED_PAYMENT },
    { $match: { "payments.paidAt": range } },
    {
      $lookup: {
        from: "students", localField: "_id", foreignField: "leadId", as: "st",
        pipeline: [
          { $project: { financeInvoiceNumber: 1, course: 1 } },
          { $lookup: { from: "courses", localField: "course", foreignField: "_id", as: "c", pipeline: [{ $project: { name: 1 } }] } },
          { $project: { financeInvoiceNumber: 1, courseName: { $first: "$c.name" } } },
        ],
      },
    },
    {
      $project: {
        _id: 0, who: "$assignedTo", name: 1, amount: "$payments.amount", paidAt: "$payments.paidAt", method: "$payments.method", note: "$payments.note",
        inv: { $first: "$st.financeInvoiceNumber" }, course: { $first: "$st.courseName" },
      },
    },
    { $sort: { paidAt: 1 } },
  ], { maxTimeMS: 20_000 }).toArray();
  const out = new Map<string, ExportPayment[]>();
  for (const r of rows) {
    const key = String(r.who);
    const note = String(r.note ?? "");
    const list = out.get(key) ?? [];
    list.push({
      date: new Date(new Date(r.paidAt).getTime() + 4 * 3_600_000).toISOString().slice(0, 10),
      client: String(r.name ?? ""), invoice: String(r.inv ?? (note.match(/DMDT\d+|IN-\d+/)?.[0] ?? "")), course: String(r.course ?? ""),
      method: String(r.method ?? "").replace(/_/g, " "), amount: round2(Number(r.amount) || 0), note,
    });
    out.set(key, list);
  }
  return out;
}

/** The CS team's payments in the month, by CS (CS Portal's list behind the real board). */
async function csPayments(month: string): Promise<Map<string, ExportPayment[]> | string> {
  try {
    const target = await resolveTarget("commission");
    const data = await callTarget<{ payments: Array<{ cs_id: string; aed: number; product: string; student: string; student_code: string; method: string; reference: string; invoice: string; kind: string; at: string }> }>(
      target, `/cs-tv-payments?location=dubai&month=${month}`, { method: "GET", verb: "share its CS payments" },
    );
    const out = new Map<string, ExportPayment[]>();
    for (const p of data.payments ?? []) {
      const list = out.get(p.cs_id) ?? [];
      list.push({
        date: new Date(Date.parse(p.at) + 4 * 3_600_000).toISOString().slice(0, 10),
        client: [p.student, p.student_code].filter(Boolean).join(" · "), invoice: p.invoice ?? "", course: p.product ?? "",
        method: String(p.method ?? "").toLowerCase().replace(/_/g, " "), amount: round2(Number(p.aed) || 0),
        note: [p.kind ? `${p.kind} payment` : "", p.reference ? `ref ${p.reference}` : ""].filter(Boolean).join(" · "),
      });
      out.set(p.cs_id, list);
    }
    return out;
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    return /404|Not found/i.test(msg) ? "CS Portal's server needs updating — it has no payment list yet" : msg || "CS Portal can't be reached";
  }
}

export async function managerTvExport(monthIn?: unknown): Promise<ManagerTvExport> {
  const now = dubaiMonthNow();
  const month = typeof monthIn === "string" && MONTH.test(monthIn) && monthIn <= now ? monthIn : now;
  const tv = (await managerTv(isPastTvMonth(month) ? { month } : {})) as unknown as { crms: CrmCard[]; cs: CsCard; oldBooks?: ManagerTvExport["oldBooks"] };
  const from = new Date(`${month}-01T00:00:00+04:00`), to = new Date(`${nextMonth(month)}-01T00:00:00+04:00`);

  const teams: ExportTeam[] = [];
  for (const crm of tv.crms ?? []) {
    const people = [...(crm.people ?? []), ...(crm.hiddenPeople ?? [])];
    const pays = await crmPayments(crm.code, from, to);
    const list = people.map((p): ExportPerson => ({
      id: p.id, name: p.name, team: p.team, closings: p.closingsMonth ?? 0, revenue: round2(p.revenueMonth ?? 0),
      ...(typeof pays === "string" ? { payments: null, missing: pays } : { payments: pays.get(p.id) ?? [] }),
    })).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
    teams.push({ code: crm.code, name: crm.name, people: list, closings: list.reduce((s, p) => s + p.closings, 0), revenue: round2(list.reduce((s, p) => s + p.revenue, 0)), error: crm.error ?? null });
  }
  if (tv.cs) {
    const pays = await csPayments(month);
    const list = (tv.cs.people ?? []).map((p): ExportPerson => ({
      id: p.id, name: p.name, team: p.team, closings: p.payments ?? 0, revenue: round2(p.monthAed ?? 0),
      ...(typeof pays === "string" ? { payments: null, missing: pays } : { payments: pays.get(p.id) ?? [] }),
    })).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
    teams.push({ code: "cs", name: tv.cs.name, people: list, closings: list.reduce((s, p) => s + p.closings, 0), revenue: round2(list.reduce((s, p) => s + p.revenue, 0)), error: tv.cs.error ?? null });
  }
  const oldBooks = tv.oldBooks ?? { monthAed: 0, rows: [], error: null };
  return {
    month, generatedAt: new Date().toISOString(), teams, oldBooks,
    total: round2(teams.reduce((s, t) => s + t.revenue, 0) + (oldBooks.monthAed ?? 0)),
  };
}
