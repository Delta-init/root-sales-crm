"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowUpCircle, ChevronRight, CircleDollarSign, Coins, Gift, GraduationCap, HandCoins, Headset, PhoneCall, Search, UserX, Wallet } from "lucide-react";
import { AxiosError } from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CseStatCard } from "@/components/cses/CseStatCard";
import { FundingTable, UpgradesTable, UsdAed, aedOfUsd } from "@/components/cses/CseFunding";
import { RangePicker, resolveRange, REPORT_TZ_LABEL, type Range, type RangeKey } from "@/components/reports/RangePicker";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { CseFigures, CseList, MoneyByCurrency } from "@/lib/types";

/**
 * CSEs (the user, 2026-10-11): Tetra Commission's customer success people —
 * their students, the period's deposits and commission (USD), and what waits
 * on each now: today's and overdue follow-ups, instalments due in the next
 * 7 days or past due, what their students owe, bonuses waiting, students not
 * onboarded. Each opens their own page. Gulf time. Root admins only.
 *
 * Above them, the team's totals in the look of Tetra Commission's dashboard —
 * deposits, commission and course upgrades among them (2026-10-11). Tetra
 * Commission counts those, each student once: rows added up would count a
 * student shared with a Common CS twice.
 *
 * Dollars with their AED at Tetra Commission's fixed 3.67, as its Funding
 * Requests shows them; the funding requests waiting — with finance, with a
 * broker admin, sent back — and the period's, with the commission each
 * earned; and the period's course upgrades (2026-10-14).
 */

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
/** AED 3,000 · USD 500 — never adding one currency to another. */
const moneyList = (m: MoneyByCurrency) =>
  Object.entries(m).filter(([, v]) => v).map(([c, v]) => `${c} ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`).join(" · ");
const dash = <span className="text-muted-foreground/60">—</span>;
const aed = (n: number) => `AED ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The team's cards. Before Tetra Commission sends totals, only what rows add up to exactly. */
function TeamTotals({ list }: { list: CseList }) {
  const t: CseFigures | undefined = list.totals;
  const later = "after Tetra Commission's update";
  const deposits = t?.deposits ?? list.rows.reduce((m, r) => ({ count: m.count + r.deposits.count, usd: m.usd + r.deposits.usd }), { count: 0, usd: 0 });
  const commission = t?.commissionUsd ?? list.rows.reduce((n, r) => n + r.commissionUsd, 0);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <CseStatCard icon={CircleDollarSign} accent="emerald" title="Total deposits" value={usd(deposits.usd)} hint={`${aedOfUsd(deposits.usd)} · ${plural(deposits.count, "deposit")} in the period`} delay={0.05} />
      <CseStatCard icon={Coins} accent="cyan" title="Total commission" value={usd(commission)} hint={`${aedOfUsd(commission)} · credited in the period`} delay={0.1} />
      <CseStatCard icon={ArrowUpCircle} accent="violet" title="Course upgrades" value={t?.upgrades ? String(t.upgrades.count) : "—"}
        hint={t?.upgrades ? `started · ${aed(t.upgrades.paidAed)} paid in the period` : later} delay={0.15} />
      <CseStatCard icon={GraduationCap} title="Students" value={t ? String(t.students) : "—"} hint={t ? "with a CSE, now" : later} delay={0.2} />
      <CseStatCard icon={Wallet} accent="amber" title="Balance due" value={t ? moneyList(t.balance.amount) || "—" : "—"}
        hint={t ? `${plural(t.balance.students, "student")} owing · ${t.upcoming.count} due in ${list.upcomingDays} days` : later}
        alert={!!t?.overdueDues.count} delay={0.25} />
      <CseStatCard icon={Gift} accent="rose" title="Bonus due" value={t ? usd(t.bonus.usd) : "—"} hint={t ? `${aedOfUsd(t.bonus.usd)} · ${plural(t.bonus.clients, "client")} waiting` : later} delay={0.3} />
      <CseStatCard icon={PhoneCall} title="Follow-ups today" value={t ? String(t.followupsToday) : "—"}
        hint={t ? (t.followupsOverdue ? `${t.followupsOverdue} overdue` : "none overdue") : later} alert={!!t?.followupsOverdue} delay={0.35} />
      <CseStatCard icon={UserX} accent="amber" title="Not onboarded" value={t ? String(t.notOnboarded) : "—"}
        hint={t ? (t.notOnboardedLate ? `${t.notOnboardedLate} waiting 6h+` : "none waiting 6h+") : later} alert={!!t?.notOnboardedLate} delay={0.4} />
      <CseStatCard icon={HandCoins} accent="violet" title="Funding requests waiting" value={t?.funding ? String(t.funding.pending) : "—"}
        hint={t?.funding
          ? `${usd(t.funding.pendingUsd)} · ${aedOfUsd(t.funding.pendingUsd)} — ${t.funding.withFinance} with finance · ${t.funding.waitingBroker} broker admin · ${t.funding.sentBack} sent back`
          : later}
        alert={!!t?.funding?.sentBack} delay={0.45} />
    </div>
  );
}

export default function CsesPage() {
  const [range, setRange] = useState<RangeKey>("month");
  const [custom, setCustom] = useState<Range>({});
  const [search, setSearch] = useState("");
  const [showLeft, setShowLeft] = useState(false);
  const period = resolveRange(range, custom);

  const list = useQuery({
    queryKey: ["cses", period],
    queryFn: async () => (await api.get("/cses", { params: period })).data.data as CseList,
  });
  const needle = search.trim().toLowerCase();
  const rows = useMemo(() => (list.data?.rows ?? [])
    .filter((r) => (showLeft || r.active) && (!needle || r.name.toLowerCase().includes(needle) || r.email.includes(needle) || r.team.toLowerCase().includes(needle))),
  [list.data, needle, showLeft]);
  const message = (list.error as AxiosError<{ message?: string }>)?.response?.data?.message;

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground"><Headset className="h-6 w-6 text-primary" /> CSEs</h2>
          <p className="mt-1 text-muted-foreground">
            Tetra Commission&apos;s CSEs — students, deposits and commission for the period, and what waits on each now.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <RangePicker value={range} custom={custom} onChange={(k, c) => { setRange(k); if (c) setCustom(c); }} />
          <span className="text-xs text-muted-foreground">Deposits, commission and upgrades in the period · the rest as of now · {REPORT_TZ_LABEL}</span>
        </div>
      </motion.div>

      {list.data && <TeamTotals list={list.data} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button size="sm" variant={showLeft ? "default" : "outline"} onClick={() => setShowLeft((v) => !v)}>Show people who left</Button>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a CSE or team" className="pl-8" aria-label="Find a CSE" />
        </div>
      </div>

      {list.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : list.isError ? (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            {(list.error as AxiosError)?.response?.status === 404
              ? "The portal's server is still on the previous version — this page works once it is updated."
              : message ?? "Could not load the CSEs. Refresh in a moment."}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto pt-4">
            <table className="w-full min-w-[1180px] text-sm">
              <thead>
                <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">CSE</th>
                  <th className="pb-2 pr-3 text-right font-medium">Students</th>
                  <th className="pb-2 pr-3 text-right font-medium">Deposits</th>
                  <th className="pb-2 pr-3 text-right font-medium">Commission</th>
                  <th className="pb-2 pr-3 text-right font-medium">Course upgrades</th>
                  <th className="pb-2 pr-3 text-right font-medium">Follow-ups today</th>
                  <th className="pb-2 pr-3 text-right font-medium">Due in {list.data?.upcomingDays ?? 7} days</th>
                  <th className="pb-2 pr-3 text-right font-medium">Balance due</th>
                  <th className="pb-2 pr-3 text-right font-medium">Bonus due</th>
                  <th className="pb-2 pr-3 text-right font-medium">Not onboarded</th>
                  <th className="pb-2 pr-3 text-right font-medium">Funding waiting</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={12} className="py-10 text-center text-muted-foreground">{needle ? "Nobody by that name." : "No CSEs."}</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/20 align-top last:border-0 hover:bg-muted/30">
                    <td className="py-2.5 pr-3">
                      <Link href={`/cses/${r.id}`} className={cn("font-medium hover:underline", !r.active && "text-muted-foreground")}>{r.name}</Link>
                      {!r.active && <span className="ml-1.5 text-xs text-muted-foreground">(left)</span>}
                      <div className="text-xs text-muted-foreground">{r.team || r.email}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{r.students || dash}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {r.deposits.usd ? <><UsdAed usd={r.deposits.usd} /><div className="text-xs text-muted-foreground">{r.deposits.count} deposit{r.deposits.count === 1 ? "" : "s"}</div></> : dash}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-primary">{r.commissionUsd ? <UsdAed usd={r.commissionUsd} /> : dash}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {r.upgrades?.count || r.upgrades?.paidAed ? <>{r.upgrades.count}<div className="text-xs text-muted-foreground">{aed(r.upgrades.paidAed)} paid</div></> : dash}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {r.followupsToday || dash}
                      {r.followupsOverdue ? <div className="text-xs text-rose-500">{r.followupsOverdue} overdue</div> : null}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {r.upcoming.count ? <>{r.upcoming.count}<div className="text-xs text-muted-foreground">{moneyList(r.upcoming.amount)}</div></> : dash}
                      {r.overdueDues.count ? <div className="text-xs text-rose-500">{r.overdueDues.count} overdue · {moneyList(r.overdueDues.amount)}</div> : null}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {r.balance.students ? <>{moneyList(r.balance.amount)}<div className="text-xs text-muted-foreground">{r.balance.students} student{r.balance.students === 1 ? "" : "s"}</div></> : dash}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {r.bonus.clients ? <><UsdAed usd={r.bonus.usd} /><div className="text-xs text-muted-foreground">{r.bonus.clients} client{r.bonus.clients === 1 ? "" : "s"}</div></> : dash}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {r.notOnboarded || dash}
                      {r.notOnboardedLate ? <div className="text-xs text-rose-500">{r.notOnboardedLate} 6h+</div> : null}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {r.funding?.pending ? (
                        <>
                          {r.funding.pending}
                          <div className="text-xs text-muted-foreground">
                            {[r.funding.withFinance && `${r.funding.withFinance} finance`, r.funding.waitingBroker && `${r.funding.waitingBroker} broker`].filter(Boolean).join(" · ")}
                          </div>
                          {r.funding.sentBack ? <div className="text-xs text-rose-500">{r.funding.sentBack} sent back</div> : null}
                        </>
                      ) : dash}
                    </td>
                    <td className="py-2.5 text-right"><Link href={`/cses/${r.id}`} aria-label={`Open ${r.name}`}><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {list.data?.funding && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><HandCoins className="h-4 w-4" /> Funding requests</CardTitle>
            <p className="text-xs text-muted-foreground">
              Every one still waiting, from any date, and those raised in the period — where each is paused, the amount in USD and AED (3.67), and the commission it earned.
            </p>
          </CardHeader>
          <CardContent>
            <FundingTable rows={list.data.funding.rows} total={list.data.funding.total}
              studentHref={(id) => (list.data?.studentLink && id ? `${list.data.studentLink}${id}` : null)} />
          </CardContent>
        </Card>
      )}

      {list.data?.recentUpgrades && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><ArrowUpCircle className="h-4 w-4" /> Recent course upgrades · {list.data.recentUpgrades.length}</CardTitle>
            <p className="text-xs text-muted-foreground">Started in the period, or paid on in it — newest first, with who started each.</p>
          </CardHeader>
          <CardContent>
            <UpgradesTable rows={list.data.recentUpgrades} studentHref={(id) => (list.data?.studentLink && id ? `${list.data.studentLink}${id}` : null)} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
