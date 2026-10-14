"use client";

import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { Badge } from "@/components/ui/badge";
import { BreakdownDialog, Bars, ListTable, type BreakdownTab } from "@/components/common/Breakdown";
import { api } from "@/lib/axios";
import type { SalespersonDetail } from "@/lib/types";

/*
 * The salesperson page's cards, each opened into what it is made of (the user,
 * 2026-10-14). Leads, follow-ups and what is pending are asked of the server
 * (GET /salespeople/:code/:userId/breakdown/:kind); closings and revenue are
 * cut from what the page already has. Gulf time.
 */

export type SalesCard = "leads" | "closings" | "revenue" | "followups" | "pending";

type Group = { key: string; label: string; count: number };
type LeadsBreakdown = { bySource: Group[]; byStatus: Group[]; byDay: Group[]; truncated: boolean;
  rows: { id: string; name: string; phone: string; source: string; statusLabel: string; at: string | null; updatedAt: string | null }[] };
type FollowupsBreakdown = { byDay: Group[]; byStatus: Group[]; truncated: boolean;
  rows: { id: string; name: string; phone: string; statusLabel: string; at: string | null; note: string; next: string | null }[] };
type PendingBreakdown = {
  newLeads: { id: string; name: string; phone: string; source: string; at: string | null }[];
  reminders: { id: string; name: string; phone: string; statusLabel: string; title: string; note: string; at: string | null; overdue: boolean }[];
};

const gst = (iso: string | null, withTime = true) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : { year: "numeric" }) }).format(new Date(iso)) : "—";
const dayKey = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 4 * 3_600_000).toISOString().slice(0, 10) : "—");
const dayLabel = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(k) ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", weekday: "short", timeZone: "UTC" }).format(new Date(`${k}T00:00:00Z`)) : k);
const groupsToBars = (g: Group[]) => g.map((x) => ({ key: x.key, label: x.label, value: x.count }));
/** Sum `value` by `key`. */
function sumBy<T>(list: T[], key: (x: T) => string, value: (x: T) => number) {
  const m = new Map<string, number>();
  for (const x of list) m.set(key(x), (m.get(key(x)) ?? 0) + value(x));
  return Array.from(m);
}

export function SalespersonBreakdown({ card, d, code, userId, period, money, onClose }: {
  card: SalesCard | null;
  d: SalespersonDetail;
  code: string;
  userId: string;
  period: { from?: string; to?: string };
  money: (n: number) => string;
  onClose: () => void;
}) {
  const asked = card === "leads" || card === "followups" || card === "pending" ? card : null;
  const q = useQuery({
    queryKey: ["salesperson-breakdown", code, userId, asked, period],
    queryFn: async () => (await api.get(`/salespeople/${code}/${userId}/breakdown/${asked}`, { params: period })).data.data as LeadsBreakdown & FollowupsBreakdown & PendingBreakdown,
    enabled: !!asked,
  });
  const waiting = <p className="py-8 text-center text-sm text-muted-foreground">{q.isError ? ((q.error as AxiosError)?.response?.status === 404 ? "This shows after Root's server is updated." : "Could not load it — try again.") : "Loading…"}</p>;
  const ready = !!q.data && !q.isFetching;

  let title = "", description = "", tabs: BreakdownTab[] = [];
  if (card === "leads") {
    const b = q.data as LeadsBreakdown | undefined;
    title = `Total leads · ${d.summary.leads}`;
    description = "The leads that reached them in the period — by status now, by source, by the day they came.";
    tabs = [
      { key: "status", label: "By status", content: ready && b ? <Bars rows={groupsToBars(b.byStatus)} /> : waiting },
      { key: "source", label: "By source", content: ready && b ? <Bars rows={groupsToBars(b.bySource)} /> : waiting },
      { key: "day", label: "By day", content: ready && b ? <Bars sort={false} rows={b.byDay.map((x) => ({ key: x.key, label: dayLabel(x.key), value: x.count }))} /> : waiting },
      { key: "list", label: "The leads", content: ready && b ? (
        <ListTable head={["Lead", "Phone", "Source", "Status", "Reached them"]} note={b.truncated ? "The latest 1,000." : undefined}
          rows={b.rows.map((l) => [<span key="n" className="font-medium">{l.name || "—"}</span>, l.phone || "—", l.source || "—", l.statusLabel, gst(l.at)])} />
      ) : waiting },
    ];
  } else if (card === "closings") {
    title = `Closings · ${d.summary.closings}`;
    description = `${d.summary.conversion}% of the period's leads — by course, by day, and each one.`;
    tabs = [
      { key: "course", label: "By course", content: <Bars rows={sumBy(d.closings, (c) => c.course || "No course", () => 1).map(([k, v]) => {
        const fee = d.closings.filter((c) => (c.course || "No course") === k).reduce((n, c) => n + c.fee, 0);
        return { key: k, label: k, value: v, sub: `fee ${money(fee)}` };
      })} /> },
      { key: "day", label: "By day", content: <Bars sort={false} rows={sumBy([...d.closings].sort((a, b) => String(a.date).localeCompare(String(b.date))), (c) => dayKey(c.date), () => 1).map(([k, v]) => ({ key: k, label: dayLabel(k), value: v }))} /> },
      { key: "money", label: "Fee · collected · balance", content: <Bars sort={false} rows={[
        { key: "fee", label: "Course fees", value: d.closings.reduce((n, c) => n + c.fee, 0), display: money(d.closings.reduce((n, c) => n + c.fee, 0)) },
        { key: "paid", label: "Collected at the close", value: d.closings.reduce((n, c) => n + c.paid, 0), display: money(d.closings.reduce((n, c) => n + c.paid, 0)) },
        { key: "bal", label: "Balance left", value: d.closings.reduce((n, c) => n + c.balance, 0), display: money(d.closings.reduce((n, c) => n + c.balance, 0)) },
      ]} /> },
      { key: "list", label: "Each closing", content: <ListTable head={["Student", "Course", "Fee", "Collected", "Balance", "Date"]}
        note={d.truncated.closings ? "The latest 300." : undefined}
        rows={d.closings.map((c) => [<span key="n" className="font-medium">{c.name}</span>, c.course || "—", money(c.fee), money(c.paid), c.balance ? <span key="b" className="text-amber-500">{money(c.balance)}</span> : "—", gst(c.date, false)])} /> },
    ];
  } else if (card === "revenue") {
    title = `Revenue · ${money(d.summary.revenue)}`;
    description = "The payments dated in the period on their leads — by client, by day, and each one. (The CRM keeps no method on these payments.)";
    tabs = [
      { key: "client", label: "By client", content: <Bars rows={sumBy(d.payments, (p) => p.name || "—", (p) => p.amount).map(([k, v]) => ({ key: k, label: k, value: v, display: money(v) }))} /> },
      { key: "day", label: "By day", content: <Bars sort={false} rows={sumBy([...d.payments].sort((a, b) => String(a.date).localeCompare(String(b.date))), (p) => dayKey(p.date), (p) => p.amount).map(([k, v]) => ({ key: k, label: dayLabel(k), value: v, display: money(v) }))} /> },
      { key: "list", label: "Each payment", content: <ListTable head={["Client", "Amount", "Paid", "Note"]} note={d.truncated.payments ? "The latest 300." : undefined}
        rows={d.payments.map((p) => [<span key="n" className="font-medium">{p.name || "—"}</span>, money(p.amount), gst(p.date), <span key="t" className="text-xs text-muted-foreground">{p.note || "—"}</span>])} /> },
    ];
  } else if (card === "followups") {
    const b = q.data as FollowupsBreakdown | undefined;
    title = `Follow-ups logged · ${d.summary.followUps}`;
    description = "Every follow-up they logged in the period — by day, by where the lead stands now, and each one with its note.";
    tabs = [
      { key: "day", label: "By day", content: ready && b ? <Bars sort={false} rows={b.byDay.map((x) => ({ key: x.key, label: dayLabel(x.key), value: x.count }))} /> : waiting },
      { key: "status", label: "By lead status", content: ready && b ? <Bars rows={groupsToBars(b.byStatus)} /> : waiting },
      { key: "list", label: "Each follow-up", content: ready && b ? (
        <ListTable head={["Lead", "Phone", "Status", "Logged", "Note", "Next"]} note={b.truncated ? "The latest 1,000." : undefined}
          rows={b.rows.map((f) => [<span key="n" className="font-medium">{f.name || "—"}</span>, f.phone || "—", f.statusLabel, gst(f.at), <span key="t" className="text-xs text-muted-foreground">{f.note || "—"}</span>, gst(f.next)])} />
      ) : waiting },
    ];
  } else if (card === "pending") {
    const b = q.data as PendingBreakdown | undefined;
    title = `Pending now · ${d.pendingNow.newLeads + d.pendingNow.reminders}`;
    description = "What waits on them now — new leads nobody has worked yet, and the reminders they set that are not done (overdue first).";
    tabs = [
      { key: "reminders", label: `Reminders · ${d.pendingNow.reminders}`, content: ready && b ? (
        <ListTable head={["Lead", "Reminder", "Due", "Lead status"]}
          rows={b.reminders.map((r) => [<span key="n" className="font-medium">{r.name || "—"}<span className="block text-xs font-normal text-muted-foreground">{r.phone}</span></span>,
            <span key="t">{r.title || "—"}{r.note ? <span className="block text-xs text-muted-foreground">{r.note}</span> : null}</span>,
            r.overdue ? <Badge key="d" variant="outline" className="border-rose-500/40 text-rose-500">Overdue · {gst(r.at)}</Badge> : gst(r.at), r.statusLabel])} />
      ) : waiting },
      { key: "new", label: `New leads · ${d.pendingNow.newLeads}`, content: ready && b ? (
        <ListTable head={["Lead", "Phone", "Source", "Waiting since"]}
          rows={b.newLeads.map((l) => [<span key="n" className="font-medium">{l.name || "—"}</span>, l.phone || "—", l.source || "—", gst(l.at)])} />
      ) : waiting },
    ];
  }

  return <BreakdownDialog open={!!card} onClose={onClose} title={title} description={description} tabs={tabs} />;
}
