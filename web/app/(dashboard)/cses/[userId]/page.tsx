"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, ArrowUpCircle, CalendarClock, CircleDollarSign, Coins, Gift, GraduationCap, PhoneCall, UserX, Wallet } from "lucide-react";
import { AxiosError } from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CseStatCard } from "@/components/cses/CseStatCard";
import { RangePicker, resolveRange, REPORT_TZ_LABEL, type Range, type RangeKey } from "@/components/reports/RangePicker";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { CseDetail, MoneyByCurrency } from "@/lib/types";

/**
 * One CSE (the user, 2026-10-11): their figures and the lists behind them —
 * today's and overdue follow-ups, instalments due and overdue, bonuses waiting,
 * students not onboarded, and the period's deposits, commission and course
 * upgrades (2026-10-11). Gulf time.
 */

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const moneyList = (m: MoneyByCurrency) =>
  Object.entries(m).filter(([, v]) => v).map(([c, v]) => `${c} ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`).join(" · ") || "—";
const gst = (iso: string | null, withTime = false) => {
  if (!iso) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00+04:00`) : new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai", day: "2-digit", month: "short", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: true } : {}),
  }).format(d) + (withTime ? " GST" : "");
};
const aed = (n: number) => `AED ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const UPGRADE_STATUS: Record<string, string> = { open: "In progress", done: "Paid in full", cancelled: "Cancelled" };
const STAGE: Record<string, string> = { needs_call: "Needs call + MT5", with_finance: "With finance", waiting_broker: "Waiting for broker admin" };

export default function CsePage() {
  const { userId } = useParams<{ userId: string }>();
  const [range, setRange] = useState<RangeKey>("month");
  const [custom, setCustom] = useState<Range>({});
  const period = resolveRange(range, custom);
  const q = useQuery({
    queryKey: ["cse", userId, period],
    queryFn: async () => (await api.get(`/cses/${userId}`, { params: period })).data.data as CseDetail,
  });
  const d = q.data;
  const student = (r: { studentId: string; student: string; code?: string }) => {
    const label = <>{r.student || "—"}{r.code ? <span className="ml-1 text-xs text-muted-foreground">{r.code}</span> : null}</>;
    return d?.studentLink && r.studentId
      ? <a href={`${d.studentLink}${r.studentId}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">{label}</a>
      : <span className="font-medium">{label}</span>;
  };

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2"><Link href="/cses"><ArrowLeft /> CSEs</Link></Button>
      {q.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError || !d ? (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            {(q.error as AxiosError<{ message?: string }>)?.response?.data?.message ?? "Could not load this CSE. Refresh in a moment."}
          </CardContent>
        </Card>
      ) : (
        <>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className={cn("text-2xl font-bold", !d.person.active && "text-muted-foreground")}>
                {d.person.name}{!d.person.active && <span className="ml-2 text-base font-normal">(left)</span>}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{d.person.email}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="secondary">Tetra Commission</Badge>
                {d.person.team && <Badge variant="outline">{d.person.team}</Badge>}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <RangePicker value={range} custom={custom} onChange={(k, c) => { setRange(k); if (c) setCustom(c); }} />
              <span className="text-xs text-muted-foreground">Deposits, commission and upgrades in the period · the rest as of now · {REPORT_TZ_LABEL}</span>
            </div>
          </motion.div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <CseStatCard icon={CircleDollarSign} accent="emerald" title="Total deposits" value={usd(d.summary.deposits.usd)} hint={`${d.summary.deposits.count} in the period`} delay={0.05} />
            <CseStatCard icon={Coins} accent="cyan" title="Commission earned" value={usd(d.summary.commissionUsd)} hint="credited in the period" delay={0.1} />
            <CseStatCard icon={ArrowUpCircle} accent="violet" title="Course upgrades" value={d.summary.upgrades ? String(d.summary.upgrades.count) : "—"}
              hint={d.summary.upgrades ? `started · ${aed(d.summary.upgrades.paidAed)} paid in the period` : "after Tetra Commission's update"} delay={0.15} />
            <CseStatCard icon={GraduationCap} title="Students" value={String(d.summary.students)} hint="theirs now, Common CS too" delay={0.2} />
            <CseStatCard icon={PhoneCall} title="Follow-ups today" value={String(d.summary.followupsToday)}
              hint={d.summary.followupsOverdue ? `${d.summary.followupsOverdue} overdue` : "none overdue"} alert={!!d.summary.followupsOverdue} delay={0.25} />
            <CseStatCard icon={CalendarClock} accent="amber" title={`Due in ${d.upcomingDays} days`} value={String(d.summary.upcoming.count)}
              hint={`${moneyList(d.summary.upcoming.amount)}${d.summary.overdueDues.count ? ` · ${d.summary.overdueDues.count} overdue` : ""}`}
              alert={!!d.summary.overdueDues.count} delay={0.3} />
            <CseStatCard icon={Wallet} accent="amber" title="Balance due" value={moneyList(d.summary.balance.amount)} hint={`${d.summary.balance.students} students owing`} delay={0.35} />
            <CseStatCard icon={Gift} accent="rose" title="Bonus due" value={usd(d.summary.bonus.usd)}
              hint={`${d.summary.bonus.clients} clients · ${d.summary.bonus.needsCall} need a call · ${d.summary.bonus.withFinance} with finance · ${d.summary.bonus.waitingBroker} with a broker admin`} delay={0.4} />
            <CseStatCard icon={UserX} accent="amber" title="Not onboarded" value={String(d.summary.notOnboarded)}
              hint={d.summary.notOnboardedLate ? `${d.summary.notOnboardedLate} waiting 6h+` : "none waiting 6h+"} alert={!!d.summary.notOnboardedLate} delay={0.45} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title={`Follow-ups — today and overdue · ${d.followups.length}`} empty="No follow-ups due." rows={d.followups.length}>
              <thead><tr><Th>Student</Th><Th>Stage</Th><Th>Due</Th></tr></thead>
              <tbody>{d.followups.map((f, i) => (
                <tr key={i} className="border-b border-border/20 last:border-0">
                  <Td>{student(f)}<div className="text-xs text-muted-foreground">{f.title}</div></Td>
                  <Td>{f.stage}</Td>
                  <Td className={f.overdue ? "text-rose-500" : ""}>{f.overdue ? `Overdue · ${gst(f.due)}` : "Today"}</Td>
                </tr>
              ))}</tbody>
            </Section>

            <Section title={`Instalments and balances · ${d.dues.length}`} empty="Nobody owes anything." rows={d.dues.length}>
              <thead><tr><Th>Student</Th><Th right>Balance</Th><Th>Next due</Th></tr></thead>
              <tbody>{d.dues.map((x, i) => (
                <tr key={i} className="border-b border-border/20 last:border-0">
                  <Td>{student(x)}<div className="text-xs text-muted-foreground">{x.course}</div></Td>
                  <Td right>{x.currency} {x.balance.toLocaleString("en-US", { maximumFractionDigits: 2 })}</Td>
                  <Td className={x.state === "overdue" ? "text-rose-500" : x.daysLeft !== null && x.daysLeft <= d.upcomingDays ? "text-amber-500" : "text-muted-foreground"}>
                    {x.nextDueOn ? `${gst(x.nextDueOn)} · ${x.state === "overdue" ? `${-(x.daysLeft ?? 0)} days overdue` : x.daysLeft === 0 ? "today" : `in ${x.daysLeft} days`}` : "No date yet"}
                  </Td>
                </tr>
              ))}</tbody>
            </Section>

            <Section title={`Bonus due · ${d.bonus.length} clients`} empty="No bonuses waiting." rows={d.bonus.length}>
              <thead><tr><Th>Client</Th><Th right>Bonus</Th><Th>Where it waits</Th></tr></thead>
              <tbody>{d.bonus.map((x, i) => (
                <tr key={i} className="border-b border-border/20 last:border-0">
                  <Td>{student(x)}</Td>
                  <Td right>{usd(x.usd)}{x.count > 1 ? <span className="ml-1 text-xs text-muted-foreground">({x.count})</span> : null}</Td>
                  <Td>{STAGE[x.stage] ?? x.stage}</Td>
                </tr>
              ))}</tbody>
            </Section>

            <Section title={`Not onboarded · ${d.notOnboarded.length}`} empty="Everyone is onboarded." rows={d.notOnboarded.length}>
              <thead><tr><Th>Student</Th><Th>Waiting since</Th></tr></thead>
              <tbody>{d.notOnboarded.map((x, i) => (
                <tr key={i} className="border-b border-border/20 last:border-0">
                  <Td>{student(x)}</Td>
                  <Td className={x.late ? "text-rose-500" : ""}>{gst(x.since, true)}{x.late ? " · 6h+" : ""}</Td>
                </tr>
              ))}</tbody>
            </Section>

            <Section title={`Deposits in the period · ${usd(d.summary.deposits.usd)}`} empty="No deposits in this period." rows={d.deposits.length}>
              <thead><tr><Th>Student</Th><Th right>Amount</Th><Th>Approved</Th></tr></thead>
              <tbody>{d.deposits.map((x, i) => (
                <tr key={i} className="border-b border-border/20 last:border-0">
                  <Td>{student(x)}</Td><Td right>{usd(x.usd)}</Td><Td>{gst(x.at, true)}</Td>
                </tr>
              ))}</tbody>
            </Section>

            {d.upgrades && (
              <Section title={`Course upgrades · ${d.upgrades.length}`} empty="No course upgrades started or paid on in this period." rows={d.upgrades.length}>
                <thead><tr><Th>Student</Th><Th right>Paid in period</Th><Th>Started</Th></tr></thead>
                <tbody>{d.upgrades.map((x, i) => (
                  <tr key={i} className="border-b border-border/20 last:border-0">
                    <Td>{student(x)}<div className="text-xs text-muted-foreground">
                      {[x.course, x.plan === "full" ? "full payment" : "instalments", UPGRADE_STATUS[x.status] ?? x.status].filter(Boolean).join(" · ")}
                    </div></Td>
                    <Td right>{aed(x.paidAed)}<div className="text-xs text-muted-foreground">of {aed(x.dueAed)}</div></Td>
                    <Td>{gst(x.at)}{x.startedBy && <div className="text-xs text-muted-foreground">by {x.startedBy}</div>}</Td>
                  </tr>
                ))}</tbody>
              </Section>
            )}

            <Section title={`Commission in the period · ${usd(d.summary.commissionUsd)}`} empty="No commission credited in this period." rows={d.commission.length}>
              <thead><tr><Th>Student</Th><Th right>Commission</Th><Th>Credited</Th></tr></thead>
              <tbody>{d.commission.map((x, i) => (
                <tr key={i} className="border-b border-border/20 last:border-0">
                  <Td>{student(x)}<div className="text-xs text-muted-foreground">{[x.type, x.level ? `level ${x.level}` : "", x.status].filter(Boolean).join(" · ")}</div></Td>
                  <Td right>{usd(x.usd)}</Td><Td>{gst(x.at, true)}</Td>
                </tr>
              ))}</tbody>
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

function Section({ title, empty, rows, children }: { title: string; empty: string; rows: number; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="max-h-[420px] overflow-auto">
        {rows === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p> : <table className="w-full text-sm">{children}</table>}
      </CardContent>
    </Card>
  );
}
const Th = ({ children, right }: { children: ReactNode; right?: boolean }) => (
  <th className={cn("border-b border-border/40 pb-2 pr-2 text-xs font-medium text-muted-foreground", right ? "text-right" : "text-left")}>{children}</th>
);
const Td = ({ children, right, className }: { children: ReactNode; right?: boolean; className?: string }) => (
  <td className={cn("py-2 pr-2 align-top", right && "text-right tabular-nums", className)}>{children}</td>
);
