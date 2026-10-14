"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, Bell, CircleDollarSign, Clock, GraduationCap, Inbox, PhoneCall, Target, Users } from "lucide-react";
import { AxiosError } from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RangePicker, resolveRange, REPORT_TZ_LABEL, type Range, type RangeKey } from "@/components/reports/RangePicker";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { SalespersonDetail, SalespersonLead } from "@/lib/types";
import { SalespersonBreakdown, type SalesCard } from "@/components/salespeople/SalespersonBreakdown";
import { BreakdownHint, cardButton } from "@/components/common/Breakdown";

/**
 * One salesperson (the user, 2026-10-11): the leads that reached them in the
 * period and where those stand now, their closings, their revenue and the
 * follow-ups they logged — the same rules as the CRM's own Leaderboard — and
 * what is waiting on them right now. Every time and day in Gulf time (GST).
 * Each card opens its breakdown (2026-10-14). Root admins only.
 */

const money = (n: number, currency: string) => `${currency} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const gst = (iso: string | null, withTime = false) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Dubai", day: "2-digit", month: "short", year: "numeric",
        ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: true } : {}),
      }).format(new Date(iso)) + (withTime ? " GST" : "")
    : "—";
const notYet = (e: unknown) => e instanceof AxiosError && e.response?.status === 404 && !(e.response?.data as { message?: string })?.message?.includes("Not a person");

export default function SalespersonPage() {
  const { code, userId } = useParams<{ code: string; userId: string }>();
  const [range, setRange] = useState<RangeKey>("month");
  const [custom, setCustom] = useState<Range>({});
  const [status, setStatus] = useState<string | null>(null);
  const [card, setCard] = useState<SalesCard | null>(null);
  const period = resolveRange(range, custom);

  const detail = useQuery({
    queryKey: ["salesperson", code, userId, period],
    queryFn: async () => (await api.get(`/salespeople/${code}/${userId}`, { params: period })).data.data as SalespersonDetail,
  });
  const leads = useQuery({
    queryKey: ["salesperson-leads", code, userId, status, period],
    queryFn: async () => (await api.get(`/salespeople/${code}/${userId}/leads`, { params: { ...period, status } })).data.data as SalespersonLead[],
    enabled: !!status,
  });
  const d = detail.data;
  const cur = d?.crm.currency ?? "AED";

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/salespeople"><ArrowLeft /> Salespeople</Link>
      </Button>

      {detail.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : detail.isError || !d ? (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            {notYet(detail.error)
              ? "The portal's server is still on the previous version — this page works once it is updated."
              : (detail.error as AxiosError<{ message?: string }>)?.response?.data?.message ?? "Could not load this person. Refresh in a moment."}
          </CardContent>
        </Card>
      ) : (
        <>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className={cn("text-2xl font-bold", !d.person.active && "text-muted-foreground")}>
                {d.person.name}{!d.person.active && <span className="ml-2 text-base font-normal">(left)</span>}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {d.person.email}{d.person.designation ? ` · ${d.person.designation}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="secondary">{d.crm.name}</Badge>
                {d.person.teams.map((t) => <Badge key={t} variant="outline" className="gap-1"><Users className="h-3 w-3" />{t}</Badge>)}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <RangePicker value={range} custom={custom} onChange={(k, c) => { setRange(k); if (c) setCustom(c); setStatus(null); }} />
              <span className="text-xs text-muted-foreground">
                {d.period.from || d.period.to ? `${gst(d.period.from)} – ${gst(d.period.to)}` : "All time"} · {REPORT_TZ_LABEL}
              </span>
            </div>
          </motion.div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat icon={Inbox} label="Total leads" value={d.summary.leads.toLocaleString("en-US")} hint="reached them in the period" onClick={() => setCard("leads")} />
            <Stat icon={GraduationCap} label="Closings" value={d.summary.closings.toLocaleString("en-US")} hint={`${d.summary.conversion}% of those leads`} tone="text-emerald-500" onClick={() => setCard("closings")} />
            <Stat icon={CircleDollarSign} label="Revenue" value={money(d.summary.revenue, cur)} hint="payments dated in the period" tone="text-primary" onClick={() => setCard("revenue")} />
            <Stat icon={PhoneCall} label="Follow-ups logged" value={d.summary.followUps.toLocaleString("en-US")} onClick={() => setCard("followups")} />
            <Stat icon={Bell} label="Pending now" value={(d.pendingNow.newLeads + d.pendingNow.reminders).toLocaleString("en-US")} onClick={() => setCard("pending")}
              hint={`${d.pendingNow.newLeads} new leads · ${d.pendingNow.reminders} reminders${d.pendingNow.overdue ? ` · ${d.pendingNow.overdue} overdue` : ""}`}
              tone={d.pendingNow.overdue ? "text-rose-500" : undefined} />
          </div>

          <SalespersonBreakdown card={card} d={d} code={code} userId={userId} period={period} money={(n) => money(n, cur)} onClose={() => setCard(null)} />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Target className="h-4 w-4 text-primary" /> Leads by status</CardTitle>
              <p className="text-xs text-muted-foreground">Where the leads that reached them in the period stand now. Pick one to see the leads.</p>
            </CardHeader>
            <CardContent>
              {d.statuses.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No leads reached them in this period.</p>
              ) : (
                <div className="space-y-1.5">
                  {d.statuses.map((s) => (
                    <button key={s.status} type="button" onClick={() => setStatus(status === s.status ? null : s.status)}
                      className={cn("flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/40", status === s.status && "bg-muted/60")}>
                      <span className="w-36 shrink-0 font-medium">{s.label}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, s.percent)}%` }} />
                      </span>
                      <span className="w-12 text-right tabular-nums">{s.count}</span>
                      <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{s.percent}%</span>
                    </button>
                  ))}
                </div>
              )}
              {status && (
                <div className="mt-4 overflow-x-auto rounded-md border border-border/50">
                  {leads.isLoading ? (
                    <p className="p-4 text-sm text-muted-foreground">Loading…</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                          <th className="p-2 font-medium">Lead</th><th className="p-2 font-medium">Phone</th><th className="p-2 font-medium">Source</th>
                          <th className="p-2 font-medium">Reached them</th><th className="p-2 font-medium">Last updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(leads.data ?? []).map((l) => (
                          <tr key={l.id} className="border-b border-border/20 last:border-0">
                            <td className="p-2 font-medium">{l.name || "—"}</td>
                            <td className="p-2 tabular-nums">{l.phone || "—"}</td>
                            <td className="p-2 text-muted-foreground">{l.source || "—"}</td>
                            <td className="p-2 text-xs">{gst(l.createdAt, true)}</td>
                            <td className="p-2 text-xs text-muted-foreground">{gst(l.updatedAt, true)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Closings · {d.summary.closings}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {d.closings.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No closings in this period.</p> : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                        <th className="pb-2 pr-2 font-medium">Student</th><th className="pb-2 pr-2 text-right font-medium">Fee</th>
                        <th className="pb-2 pr-2 text-right font-medium">Collected</th><th className="pb-2 pr-2 text-right font-medium">Balance</th><th className="pb-2 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.closings.map((c) => (
                        <tr key={c.id} className="border-b border-border/20 last:border-0 align-top">
                          <td className="py-2 pr-2"><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{c.course || "—"}</div></td>
                          <td className="py-2 pr-2 text-right tabular-nums">{money(c.fee, cur)}</td>
                          <td className="py-2 pr-2 text-right tabular-nums">{money(c.paid, cur)}</td>
                          <td className={cn("py-2 pr-2 text-right tabular-nums", c.balance > 0 && "text-amber-500")}>{c.balance ? money(c.balance, cur) : "—"}</td>
                          <td className="py-2 text-xs">{gst(c.date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {d.truncated.closings && <p className="mt-2 text-xs text-muted-foreground">Showing the latest 300.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Revenue · {money(d.summary.revenue, cur)}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {d.payments.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No payments in this period.</p> : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                        <th className="pb-2 pr-2 font-medium">Client</th><th className="pb-2 pr-2 text-right font-medium">Amount</th><th className="pb-2 font-medium">Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.payments.map((p, i) => (
                        <tr key={`${p.leadId}-${i}`} className="border-b border-border/20 last:border-0 align-top">
                          <td className="py-2 pr-2"><div className="font-medium">{p.name || "—"}</div>{p.note && <div className="text-xs text-muted-foreground">{p.note}</div>}</td>
                          <td className="py-2 pr-2 text-right tabular-nums">{money(p.amount, cur)}</td>
                          <td className="py-2 text-xs"><Clock className="mr-1 inline h-3 w-3 text-muted-foreground" />{gst(p.date, true)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {d.truncated.payments && <p className="mt-2 text-xs text-muted-foreground">Showing the latest 300.</p>}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, hint, tone, onClick }: { icon: typeof Inbox; label: string; value: string; hint?: string; tone?: string; onClick?: () => void }) {
  return (
    <Card className={cn("group relative", onClick && "cursor-pointer transition-colors hover:border-primary/40")} {...cardButton(onClick)}>
      {onClick && <BreakdownHint />}
      <CardContent className="space-y-1 pb-6 pt-4">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</p>
        <p className={cn("text-2xl font-bold tabular-nums", tone)}>{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
