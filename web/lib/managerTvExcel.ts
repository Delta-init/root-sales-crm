import type { Cell, Sheet } from "./xlsx";

/*
 * The Manager TV's month as a workbook (2026-11-25, the signed-in page's "Export Excel"): an Overview — every team,
 * every person with the TV's own closings and revenue, team totals, the old-books line and the grand total — then a
 * sheet per person with the payments that make up their figure (backend services/managerTvExport.ts).
 */

export interface ExportPayment { date: string; client: string; invoice: string; number: string; course: string; method: string; amount: number; note: string }
export interface ExportPerson { id: string; name: string; team: string; closings: number; revenue: number; payments: ExportPayment[] | null; missing?: string }
export interface ExportTeam { code: string; name: string; people: ExportPerson[]; closings: number; revenue: number; error?: string | null }
export interface ManagerTvExport {
  month: string; generatedAt: string; teams: ExportTeam[]; total: number; numbersError?: string | null;
  oldBooks: { monthAed: number; rows: { salesperson: string; amount: number; paidOn: string; invoiceNumber?: string }[]; error: string | null };
}

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const r2 = (n: number) => Math.round(n * 100) / 100;

export function managerTvSheets(x: ManagerTvExport): Sheet[] {
  const when = new Date(x.generatedAt).toLocaleString("en-GB", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" });
  const rows: Cell[][] = [[`Manager TV — ${monthName(x.month)}`], [`As on the TV, ${when} (Dubai)`], []];
  const bold: number[] = [0];
  rows.push(["Team", "Person", "Sub-team", "Closings / payments", "Revenue (AED)"]); bold.push(rows.length - 1);
  for (const t of x.teams) {
    for (const p of t.people) rows.push([t.name, p.name, p.team, p.closings, p.revenue]);
    rows.push([`${t.name} total`, `${t.people.length} ${t.people.length === 1 ? "person" : "people"}`, t.error ? `Note: ${t.error}` : "", t.closings, t.revenue]); bold.push(rows.length - 1);
    rows.push([]);
  }
  if (x.oldBooks.monthAed || x.oldBooks.rows.length) {
    for (const o of x.oldBooks.rows) rows.push(["Old books — no CRM user", o.salesperson, o.invoiceNumber ?? "", "", o.amount]);
    rows.push(["Old books total", "", x.oldBooks.error ?? "", x.oldBooks.rows.length, x.oldBooks.monthAed]); bold.push(rows.length - 1);
    rows.push([]);
  }
  rows.push(["Grand total", "", "", x.teams.reduce((s, t) => s + t.closings, 0), x.total]); bold.push(rows.length - 1);
  rows.push([], ["Sales teams count closings; Team Mafia (CS) counts course payments. A person's sheet lists the payments behind their revenue, each with its number in finance: its tax invoice (TI-…), its receipt (RCT-…), or the invoice itself where that is the tax invoice."]);
  if (x.numbersError) rows.push([`TI numbers left out: ${x.numbersError}`]);
  const sheets: Sheet[] = [{ name: "Overview", rows, bold, money: [4] }];

  for (const t of x.teams) {
    for (const p of t.people) {
      if (!p.revenue && !(p.payments?.length)) continue;            // nobody with nothing to show gets a sheet
      const s: Cell[][] = [[p.name], [`${t.name} · ${p.team} · ${monthName(x.month)}`], []];
      const b = [0];
      s.push(["Date", "Client", "Invoice", "Number", "Course", "Method", "Amount (AED)", "Note"]); b.push(s.length - 1);
      if (p.payments === null) {
        s.push([`Payments can't be listed here: ${p.missing ?? "not available"}`]);
      } else {
        for (const pay of p.payments) s.push([pay.date, pay.client, pay.invoice, pay.number || "—", pay.course, pay.method, pay.amount, pay.note]);
      }
      const listed = r2((p.payments ?? []).reduce((n, q) => n + q.amount, 0));
      s.push([]);
      s.push(["Total", `${p.payments?.length ?? 0} payment${(p.payments?.length ?? 0) === 1 ? "" : "s"}`, "", "", "", "", listed, ""]); b.push(s.length - 1);
      s.push(["On the Manager TV", "", "", "", "", "", p.revenue, listed === p.revenue || p.payments === null ? "" : `Differs by ${r2(p.revenue - listed)} — the TV's figure is the CRM's own`]); b.push(s.length - 1);
      sheets.push({ name: p.name || "Person", rows: s, bold: b, money: [6] });
    }
  }
  return sheets;
}
