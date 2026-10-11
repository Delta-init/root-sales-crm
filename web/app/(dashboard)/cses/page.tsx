"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, ChevronRight, Headset, Search } from "lucide-react";
import { AxiosError } from "axios";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { RangePicker, resolveRange, REPORT_TZ_LABEL, type Range, type RangeKey } from "@/components/reports/RangePicker";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { CseList, MoneyByCurrency } from "@/lib/types";

/**
 * CSEs (the user, 2026-10-11): Tetra Commission's customer success people —
 * their students, the period's deposits and commission (USD), and what waits
 * on each now: today's and overdue follow-ups, instalments due in the next
 * 7 days or past due, what their students owe, bonuses waiting, students not
 * onboarded. Each opens their own page. Gulf time. Root admins only.
 */

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
/** AED 3,000 · USD 500 — never adding one currency to another. */
const moneyList = (m: MoneyByCurrency) =>
  Object.entries(m).filter(([, v]) => v).map(([c, v]) => `${c} ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`).join(" · ");
const dash = <span className="text-muted-foreground/60">—</span>;

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
          <span className="text-xs text-muted-foreground">Deposits and commission in the period · the rest as of now · {REPORT_TZ_LABEL}</span>
        </div>
      </motion.div>

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
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">CSE</th>
                  <th className="pb-2 pr-3 text-right font-medium">Students</th>
                  <th className="pb-2 pr-3 text-right font-medium">Deposits</th>
                  <th className="pb-2 pr-3 text-right font-medium">Commission</th>
                  <th className="pb-2 pr-3 text-right font-medium">Follow-ups today</th>
                  <th className="pb-2 pr-3 text-right font-medium">Due in {list.data?.upcomingDays ?? 7} days</th>
                  <th className="pb-2 pr-3 text-right font-medium">Balance due</th>
                  <th className="pb-2 pr-3 text-right font-medium">Bonus due</th>
                  <th className="pb-2 pr-3 text-right font-medium">Not onboarded</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={10} className="py-10 text-center text-muted-foreground">{needle ? "Nobody by that name." : "No CSEs."}</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/20 align-top last:border-0 hover:bg-muted/30">
                    <td className="py-2.5 pr-3">
                      <Link href={`/cses/${r.id}`} className={cn("font-medium hover:underline", !r.active && "text-muted-foreground")}>{r.name}</Link>
                      {!r.active && <span className="ml-1.5 text-xs text-muted-foreground">(left)</span>}
                      <div className="text-xs text-muted-foreground">{r.team || r.email}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{r.students || dash}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {r.deposits.usd ? <>{usd(r.deposits.usd)}<div className="text-xs text-muted-foreground">{r.deposits.count} deposit{r.deposits.count === 1 ? "" : "s"}</div></> : dash}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-primary">{r.commissionUsd ? usd(r.commissionUsd) : dash}</td>
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
                      {r.bonus.clients ? <>{usd(r.bonus.usd)}<div className="text-xs text-muted-foreground">{r.bonus.clients} client{r.bonus.clients === 1 ? "" : "s"}</div></> : dash}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {r.notOnboarded || dash}
                      {r.notOnboardedLate ? <div className="text-xs text-rose-500">{r.notOnboardedLate} 6h+</div> : null}
                    </td>
                    <td className="py-2.5 text-right"><Link href={`/cses/${r.id}`} aria-label={`Open ${r.name}`}><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
