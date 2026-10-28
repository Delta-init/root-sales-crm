"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Clock, Phone, RefreshCw, Search } from "lucide-react";
import { AxiosError } from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveRange } from "@/components/reports/RangePicker";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { CallsByPerson, EnrolmentFlow, PendingOverview, PendingPortal, SalespeopleList } from "@/lib/types";
import { BreakdownDialog, Bars, type BarRow } from "@/components/common/Breakdown";
import { CALL_PERIODS, periodDays, talkTime, type CallPeriod } from "@/lib/calls";

/**
 * Pending (the user, 2026-10-06): what is waiting in every portal, and for
 * whom — each portal's own sidebar counts on one page, per person, and one
 * person's across all of them: the sales CRMs, then CS Portal, Finance,
 * HRMS, LMS and Media ERP (2026-10-11), each answering for itself. A count that
 * waits on anyone holding a permission is "shared": every holder is listed with
 * all of it. Root admins only.
 *
 * Each sales CRM's card also shows this month's closings and revenue per
 * person (Gulf time, the CRM's own currency — the Salespeople page's figures),
 * and lists those who closed this month with nothing pending (2026-10-11).
 *
 * And everybody's 3CX calls beside it (2026-10-14): calls, connected and talk
 * time per person — today by default, or 7 days / 30 days / this month — on
 * each portal's card and in By person, with those who called and have nothing
 * pending listed after the rest. Calls come from the Sales CRM, Draw and CS
 * Portal (3CX) and Banglore's call recorder; one person's are put together
 * by email. The 3CX calls page (Sales) has every call and its recording.
 *
 * And the enrolment workflow (2026-10-14): every sales CRM's unfinished closes
 * as a chart of their My Enrolments steps — where each stands, the biggest
 * pile, who holds the most (finance, broker admins, each CS, each salesperson)
 * — and in By person what each of them holds: a salesperson's closes sent
 * back, a CS's welcomes to send and MT5s to log (a CS matched by name).
 *
 * Every figure on a portal's card opens its breakdown by person (2026-10-14).
 *
 * Its own tabs since 2026-10-17 (the user: "add separate tab view for each
 * portal"): each portal's tab shows only its cards (`only`); the All portals
 * tab keeps By portal and By person; the enrolment workflow and the CS portal
 * have pages of their own.
 */

const VIEWS = [
  { key: "portal", label: "By portal" },
  { key: "person", label: "By person" },
] as const;
type View = (typeof VIEWS)[number]["key"];

/** A portal's card lists this many people before "Show all". */
const FIRST = 8;

const forbidden = (e: unknown) => e instanceof AxiosError && e.response?.status === 403;
/** The portal's server from before this page: it has no /pending yet. */
const notYet = (e: unknown) => e instanceof AxiosError && e.response?.status === 404;
/** "1 reminder", "3 reminders": the kind's label, singular for one. */
const howMany = (count: number, label: string) => `${count} ${(count === 1 ? label.replace(/s$/, "") : label).toLowerCase()}`;
/** One person's calls in a portal, by email. */
type PersonCalls = { calls: number; connected: number; talkSeconds: number; name: string };
/** A CRM's closings and revenue this month, by person id. */
type SalesMonth = { currency: string; byId: Map<string, { closings: number; revenue: number; name: string; email: string; active: boolean }> };
const money = (currency: string, n: number) => `${currency} ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const time = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function PortalsView({ only, empty = "Nothing to show here." }: {
  /** One tab's portals; none: every portal, with By person beside them. */
  only?: (p: PendingPortal) => boolean;
  /** What a tab with no portal of its kind says. */
  empty?: string;
}) {
  const [view, setView] = useState<View>("portal");
  const [search, setSearch] = useState("");
  const pending = useQuery({
    queryKey: ["pending"],
    queryFn: async () => (await api.get("/pending")).data.data as PendingOverview,
    refetchInterval: 60_000,
  });
  const data = pending.data;
  // This month's closings and revenue for the CRM cards — the Salespeople page's figures.
  const month = useMemo(() => resolveRange("month", {}), []);
  const sales = useQuery({
    queryKey: ["salespeople", month],
    queryFn: async () => (await api.get("/salespeople", { params: month })).data.data as SalespeopleList,
    refetchInterval: 5 * 60_000,
  });
  const salesByCrm = useMemo(() => new Map<string, SalesMonth>((sales.data?.crms ?? []).map((c) => [c.code, {
    currency: c.currency,
    byId: new Map(c.people.map((x) => [x.id, { closings: x.closings, revenue: x.revenue, name: x.name, email: x.email, active: x.active }])),
  }])), [sales.data]);

  // Everybody's calls in the period picked (today by default).
  const [callsPeriod, setCallsPeriod] = useState<CallPeriod>("today");
  const callDays = useMemo(() => periodDays(callsPeriod), [callsPeriod]);
  const calls = useQuery({
    queryKey: ["pending-calls", callDays],
    queryFn: async () => (await api.get("/pending/calls", { params: callDays })).data.data as CallsByPerson,
    refetchInterval: 2 * 60_000,
  });
  const callsByEmail = useMemo(() => new Map((calls.data?.people ?? []).filter((x) => x.email).map((x) => [x.email, x])), [calls.data]);
  /** Per portal: each person's calls there, by email. */
  const callsByPortal = useMemo(() => {
    const out = new Map<string, Map<string, PersonCalls>>();
    for (const x of calls.data?.people ?? []) {
      if (!x.email) continue;
      for (const at of x.portals) {
        if (!out.has(at.code)) out.set(at.code, new Map());
        out.get(at.code)!.set(x.email, { calls: at.calls, connected: at.connected, talkSeconds: at.talkSeconds, name: x.name });
      }
    }
    return out;
  }, [calls.data]);
  const callSummaryOf = useMemo(() => new Map((calls.data?.portals ?? []).map((x) => [x.code, x])), [calls.data]);

  // Every sales CRM's enrolment workflow.
  const flow = useQuery({
    queryKey: ["pending-enrolments"],
    queryFn: async () => (await api.get("/pending/enrolments")).data.data as EnrolmentFlow,
    refetchInterval: 3 * 60_000,
    // Only By person shows it (what each salesperson and CS holds): not on one portal's tab.
    enabled: !only,
  });
  /** What each person holds of the workflow: a salesperson by email, a CS by name. */
  const flowByPerson = useMemo(() => {
    const out = new Map<string, { name: string; email: string; sentBack: number; onboard: number; mt5: number }>();
    for (const c of flow.data?.open ?? []) {
      const r = c.waitingOn.role;
      if (r !== "salesperson" && r !== "cs") continue;
      const key = r === "salesperson" ? (c.closedBy.email || `name:${c.waitingOn.name.toLowerCase()}`) : `name:${c.waitingOn.name.toLowerCase()}`;
      if (key === "name:") continue;
      const x = out.get(key) ?? { name: c.waitingOn.name, email: r === "salesperson" ? c.closedBy.email : "", sentBack: 0, onboard: 0, mt5: 0 };
      if (r === "salesperson") x.sentBack++;
      else if (c.stage === "onboarded") x.onboard++;
      else x.mt5++;
      out.set(key, x);
    }
    return out;
  }, [flow.data]);
  const flowOf = (email: string, name: string) => (email && flowByPerson.get(email)) || flowByPerson.get(`name:${name.toLowerCase()}`);

  const needle = search.trim().toLowerCase();
  const matches = (name: string, email: string) => !needle || name.toLowerCase().includes(needle) || email.includes(needle);
  const people = useMemo(() => {
    const pendingPeople = data?.people ?? [];
    const seen = new Set(pendingPeople.map((p) => p.email).filter(Boolean));
    // Those who called in the period with nothing pending, after the rest.
    const callersOnly = (calls.data?.people ?? [])
      .filter((x) => x.email && x.calls > 0 && !seen.has(x.email))
      .map((x) => ({ key: x.email, name: x.name, email: x.email, total: 0, items: [] as PendingOverview["people"][number]["items"] }));
    // …and those an enrolment waits on with nothing else (a CS by name, a salesperson by email).
    const listed = new Set([...pendingPeople, ...callersOnly].flatMap((p) => [p.email, `name:${p.name.toLowerCase()}`]).filter(Boolean));
    const flowOnly = Array.from(flowByPerson).filter(([key, x]) => !listed.has(key) && !(x.email && listed.has(x.email)))
      .map(([key, x]) => ({ key: `flow:${key}`, name: x.name, email: x.email, total: 0, items: [] as PendingOverview["people"][number]["items"] }));
    return [...pendingPeople, ...callersOnly, ...flowOnly].filter((p) => matches(p.name, p.email));
  }, [data, calls.data, flowByPerson, needle]); // eslint-disable-line react-hooks/exhaustive-deps

  if (forbidden(pending.error)) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">Pending is for root admins.</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {only ? <span /> : (
          <div className="flex gap-2" role="tablist" aria-label="View">
            {VIEWS.map((v) => (
              <Button
                key={v.key}
                role="tab"
                aria-selected={view === v.key}
                size="sm"
                variant={view === v.key ? "default" : "outline"}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </Button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          {data && (
            <span className="text-xs text-muted-foreground">
              Updated {time(data.generatedAt)} · every minute
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => pending.refetch()} disabled={pending.isFetching}>
            <RefreshCw className={cn(pending.isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Calls period">
          <span className="mr-1 flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3.5 w-3.5" /> Calls</span>
          {CALL_PERIODS.map((c) => (
            <Button key={c.key} size="sm" variant={callsPeriod === c.key ? "secondary" : "ghost"} className="h-7 px-2.5 text-xs" onClick={() => setCallsPeriod(c.key)}>
              {c.label}
            </Button>
          ))}
          {calls.isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a person"
            className="pl-8"
            aria-label="Find a person"
          />
        </div>
      </div>

      {pending.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      ) : pending.isError || !data ? (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            {notYet(pending.error)
              ? "The portal's server is still on the previous version, so it cannot answer this page yet. It works once the server is updated."
              : "Could not load what is pending. Refresh in a moment."}
          </CardContent>
        </Card>
      ) : only || view === "portal" ? (
        <div className="space-y-4">
          {/* grid-cols-1: a column that may shrink below its table, which scrolls inside the card instead of pushing it off a phone's screen. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {(only ? data.portals.filter(only) : data.portals).length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground md:col-span-2">{empty}</p>
            )}
            {(only ? data.portals.filter(only) : data.portals).map((p, i) => (
              <PortalCard
                key={p.code}
                portal={p}
                index={i}
                matches={matches}
                sales={p.crm ? salesByCrm.get(p.code) : undefined}
                calls={callSummaryOf.has(p.code) ? { summary: callSummaryOf.get(p.code)!, byEmail: callsByPortal.get(p.code) ?? new Map() } : undefined}
              />
            ))}
          </div>
          {!only && data.comingNext.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Not on this page yet: {data.comingNext.map((c) => c.name).join(", ")} — each joins once it has its own pending endpoint.
            </p>
          )}
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Everybody, across the portals · {people.length}</CardTitle>
            {calls.data && (
              <p className="text-xs text-muted-foreground">
                Calls {calls.data.period.from === calls.data.period.to ? `on ${calls.data.period.from}` : `${calls.data.period.from} → ${calls.data.period.to}`} (Dubai):{" "}
                <span className="font-medium text-foreground">{calls.data.stats.calls}</span> calls,{" "}
                <span className="font-medium text-foreground">{calls.data.stats.connected}</span> connected,{" "}
                <span className="font-medium text-foreground">{talkTime(calls.data.stats.talkSeconds)}</span> talk time ·{" "}
                <Link href="/calls" className="text-primary hover:underline">every call and recording</Link>
              </p>
            )}
          </CardHeader>
          <CardContent>
            {people.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {needle ? "Nobody by that name has anything pending." : "Nothing is pending anywhere."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40 text-left text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Person</th>
                      <th className="pb-2 pr-3 font-medium">Waiting on them</th>
                      <th className="pb-2 pr-3 text-right font-medium">Total</th>
                      <th className="whitespace-nowrap border-l border-border/40 pb-2 pl-3 pr-3 text-right font-medium">Calls</th>
                      <th className="whitespace-nowrap pb-2 text-right font-medium">Talk time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p, i) => (
                      <motion.tr
                        key={p.key}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i, 15) * 0.02 }}
                        className="border-b border-border/20 align-top"
                      >
                        <td className="py-2.5 pr-3">
                          {(() => {
                            // A salesperson's name opens their page (in the first CRM they have work in).
                            const crmItem = p.items.find((it) => it.crm);
                            return crmItem ? (
                              <Link href={`/salespeople/${crmItem.portal}/${crmItem.personId}`} className="font-medium hover:underline">{p.name}</Link>
                            ) : (
                              <div className="font-medium">{p.name}</div>
                            );
                          })()}
                          {p.email && <div className="text-xs text-muted-foreground">{p.email}</div>}
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="flex flex-wrap gap-1.5">
                            {(() => {
                              const f = flowOf(p.email, p.name);
                              if (!f) return null;
                              const parts = [
                                f.sentBack && `${f.sentBack} sent back to correct`,
                                f.onboard && `${f.onboard} to onboard`,
                                f.mt5 && `${f.mt5} MT5 / bonus`,
                              ].filter(Boolean);
                              return (
                                <span className="inline-flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/5 px-2 py-0.5 text-xs">
                                  <span className="text-muted-foreground">Enrolments</span>
                                  <span className="font-medium">{parts.join(" · ")}</span>
                                </span>
                              );
                            })()}
                            {p.items.map((it) => (
                              <span
                                key={`${it.portal}-${it.key}`}
                                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-xs"
                              >
                                <span className="text-muted-foreground">{it.portalName}</span>
                                <span className="font-medium">{howMany(it.count, it.label)}</span>
                                {it.overdue ? <span className="text-rose-500">· {it.overdue} overdue</span> : null}
                                {it.shared ? <span className="text-muted-foreground" title="Waits on anyone who can do it — shown in full for each of them">· shared</span> : null}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{p.total || <span className="font-normal text-muted-foreground/60">—</span>}</td>
                        {(() => {
                          const c = p.email ? callsByEmail.get(p.email) : undefined;
                          return (
                            <>
                              <td className="border-l border-border/40 py-2.5 pl-3 pr-3 text-right tabular-nums" title={c ? c.portals.map((x) => `${x.name}: ${x.calls}`).join(" · ") : undefined}>
                                {c?.calls ? (
                                  <>
                                    <span className="font-medium">{c.calls}</span>
                                    <span className="ml-1 text-xs text-muted-foreground">({c.connected} connected)</span>
                                  </>
                                ) : <span className="text-muted-foreground/60">—</span>}
                              </td>
                              <td className="whitespace-nowrap py-2.5 text-right tabular-nums">{c?.talkSeconds ? talkTime(c.talkSeconds) : <span className="text-muted-foreground/60">—</span>}</td>
                            </>
                          );
                        })()}
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PortalCard({ portal: p, index, matches, sales, calls }: {
  portal: PendingPortal;
  index: number;
  matches: (name: string, email: string) => boolean;
  /** A sales CRM's closings and revenue this month; not yet loaded, or not a CRM: none. */
  sales?: SalesMonth;
  /** The portal's calls in the period picked, and each person's by email; a portal with no calls system: none. */
  calls?: { summary: CallsByPerson["portals"][number]; byEmail: Map<string, PersonCalls> };
}) {
  const [all, setAll] = useState(false);
  /** A figure on the card, opened by person (2026-10-14). */
  const [pick, setPick] = useState<{ title: string; about: string; rows: BarRow[] } | null>(null);
  const kindRows = (key: string): BarRow[] => p.people.filter((x) => x.counts[key]).map((x) => ({
    key: x.id, label: x.name, value: x.counts[key]!, sub: x.counts[`${key}_overdue`] ? `${x.counts[`${key}_overdue`]} overdue` : x.active ? undefined : "left",
  }));
  // Those who closed this month with nothing pending join the list, after those with something.
  const closersOnly = sales
    ? Array.from(sales.byId).filter(([id, x]) => x.closings > 0 && !p.people.some((y) => y.id === id))
        .sort(([, a], [, b]) => b.closings - a.closings || b.revenue - a.revenue)
        .map(([id, x]) => ({ id, name: x.name, email: x.email, active: x.active, counts: {} as Record<string, number>, total: 0 }))
    : [];
  // …and those who called in the period with nothing pending and no closing.
  const listed = new Set([...p.people, ...closersOnly].map((x) => x.email).filter(Boolean));
  const callersOnly = calls
    ? Array.from(calls.byEmail).filter(([email, c]) => c.calls > 0 && !listed.has(email))
        .sort(([, a], [, b]) => b.calls - a.calls)
        .map(([email, c]) => ({ id: `calls:${email}`, name: c.name, email, active: true, counts: {} as Record<string, number>, total: 0 }))
    : [];
  const people = [...p.people, ...closersOnly, ...callersOnly].filter((x) => matches(x.name, x.email));
  const monthTotals = sales
    ? Array.from(sales.byId.values()).reduce((t, x) => ({ closings: t.closings + x.closings, revenue: t.revenue + x.revenue }), { closings: 0, revenue: 0 })
    : null;
  const shown = all ? people : people.slice(0, FIRST);
  const anyOverdue = p.kinds.some((k) => k.overdue);
  const anyShared = p.kinds.some((k) => k.shared);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="min-w-0">
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.accent || "hsl(var(--primary))" }} />
              <span className="truncate">{p.name}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {p.available && <span className="text-2xl font-bold tabular-nums">{p.total}</span>}
              <Button asChild size="sm" variant="ghost">
                <Link href={`/org/${p.code}`}>
                  Open <ArrowRight />
                </Link>
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!p.available ? (
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span className="text-muted-foreground">Could not be read — {p.error}</span>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {p.kinds.map((k) => (
                  <Badge key={k.key} variant="outline" className="cursor-pointer gap-1 py-1 hover:border-primary/50" role="button" tabIndex={0}
                    onClick={() => setPick({ title: `${p.name} · ${k.label} · ${k.total}`, about: k.shared ? "Waits on anyone who can do it — each holder is listed with all of it." : "By who it waits on.", rows: kindRows(k.key) })}>
                    {k.label} <span className="font-semibold">{k.total}</span>
                    {k.overdue ? <span className="text-rose-500">· {k.overdue} overdue</span> : null}
                    {k.shared ? <span className="text-muted-foreground">· shared</span> : null}
                  </Badge>
                ))}
                {calls && (
                  calls.summary.available ? (
                    <Badge variant="outline" className="cursor-pointer gap-1 border-sky-500/40 py-1 hover:border-sky-500" role="button" tabIndex={0}
                      onClick={() => setPick({
                        title: `${p.name} · Calls · ${calls.summary.stats.calls}`, about: "Calls in the period picked above, by who took them — talk time beside each.",
                        rows: Array.from(calls.byEmail).filter(([, c]) => c.calls).map(([email, c]) => ({ key: email, label: c.name, value: c.calls, sub: `${c.connected} connected · ${talkTime(c.talkSeconds)}` })),
                      })}>
                      <Phone className="h-3 w-3" /> Calls <span className="font-semibold text-sky-500">{calls.summary.stats.calls}</span>
                      <span className="text-muted-foreground">· {calls.summary.stats.connected} connected · {talkTime(calls.summary.stats.talkSeconds)}</span>
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 border-amber-500/40 py-1 text-muted-foreground" title={calls.summary.error}>
                      <Phone className="h-3 w-3" /> Calls could not be read
                    </Badge>
                  )
                )}
                {monthTotals && sales && (
                  <>
                    <Badge variant="outline" className="cursor-pointer gap-1 border-emerald-500/40 py-1 hover:border-emerald-500" role="button" tabIndex={0}
                      onClick={() => setPick({ title: `${p.name} · Closings this month · ${monthTotals.closings}`, about: "This month's closings by who closed them (Gulf time).",
                        rows: Array.from(sales.byId).filter(([, x]) => x.closings).map(([id, x]) => ({ key: id, label: x.name, value: x.closings, sub: money(sales.currency, x.revenue) })) })}>
                      Closings this month <span className="font-semibold text-emerald-500">{monthTotals.closings}</span>
                    </Badge>
                    <Badge variant="outline" className="cursor-pointer gap-1 border-emerald-500/40 py-1 hover:border-emerald-500" role="button" tabIndex={0}
                      onClick={() => setPick({ title: `${p.name} · Revenue this month · ${money(sales.currency, monthTotals.revenue)}`, about: "This month's revenue by salesperson (Gulf time).",
                        rows: Array.from(sales.byId).filter(([, x]) => x.revenue).map(([id, x]) => ({ key: id, label: x.name, value: x.revenue, display: money(sales.currency, x.revenue) })) })}>
                      Revenue <span className="font-semibold text-emerald-500">{money(sales.currency, monthTotals.revenue)}</span>
                    </Badge>
                  </>
                )}
              </div>
              {pick && (
                <BreakdownDialog open onClose={() => setPick(null)} title={pick.title} description={pick.about}
                  tabs={[{ key: "person", label: "By person", content: <Bars rows={pick.rows} empty="Nobody." /> }]} />
              )}
              {people.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {p.people.length ? "Nobody by that name here." : "Nothing pending."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-2 font-medium">Person</th>
                      {p.kinds.map((k) => (
                        <th key={k.key} className="pb-2 pr-2 text-right font-medium">{k.label}</th>
                      ))}
                      <th className="pb-2 pr-2 text-right font-medium">Total</th>
                      {sales && (
                        <>
                          <th className="whitespace-nowrap border-l border-border/40 pb-2 pl-3 pr-2 text-right font-medium">Closings</th>
                          <th className="whitespace-nowrap pb-2 pr-2 text-right font-medium">Revenue</th>
                        </>
                      )}
                      {calls && (
                        <>
                          <th className="whitespace-nowrap border-l border-border/40 pb-2 pl-3 pr-2 text-right font-medium">Calls</th>
                          <th className="whitespace-nowrap pb-2 text-right font-medium">Talk</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((x) => (
                      <tr key={x.id} className="border-b border-border/20 last:border-0">
                        <td className="py-2 pr-2">
                          {p.crm && !x.id.startsWith("calls:") ? (
                            <Link href={`/salespeople/${p.code}/${x.id}`} className={cn("font-medium hover:underline", !x.active && "text-muted-foreground")}>{x.name}</Link>
                          ) : (
                            <span className={cn("font-medium", !x.active && "text-muted-foreground")}>{x.name}</span>
                          )}
                          {!x.active && <span className="ml-1.5 text-xs text-muted-foreground">(left)</span>}
                        </td>
                        {p.kinds.map((k) => (
                          <td key={k.key} className="py-2 pr-2 text-right tabular-nums">
                            {x.counts[k.key] || <span className="text-muted-foreground/60">—</span>}
                            {x.counts[`${k.key}_overdue`] ? (
                              <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-rose-500">
                                <Clock className="h-3 w-3" />
                                {x.counts[`${k.key}_overdue`]}
                              </span>
                            ) : null}
                          </td>
                        ))}
                        <td className="py-2 pr-2 text-right font-semibold tabular-nums">{x.total || <span className="font-normal text-muted-foreground/60">—</span>}</td>
                        {sales && (() => {
                          const m = sales.byId.get(x.id);
                          return (
                            <>
                              <td className="border-l border-border/40 py-2 pl-3 pr-2 text-right tabular-nums">
                                {m?.closings ? <span className="font-medium text-emerald-500">{m.closings}</span> : <span className="text-muted-foreground/60">—</span>}
                              </td>
                              <td className="whitespace-nowrap py-2 pr-2 text-right tabular-nums">
                                {m?.revenue ? money(sales.currency, m.revenue) : <span className="text-muted-foreground/60">—</span>}
                              </td>
                            </>
                          );
                        })()}
                        {calls && (() => {
                          const c = x.email ? calls.byEmail.get(x.email) : undefined;
                          return (
                            <>
                              <td className="border-l border-border/40 py-2 pl-3 pr-2 text-right tabular-nums" title={c ? `${c.connected} connected` : undefined}>
                                {c?.calls ? <span className="font-medium text-sky-500">{c.calls}</span> : <span className="text-muted-foreground/60">—</span>}
                              </td>
                              <td className="whitespace-nowrap py-2 text-right tabular-nums">{c?.talkSeconds ? talkTime(c.talkSeconds) : <span className="text-muted-foreground/60">—</span>}</td>
                            </>
                          );
                        })()}
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
              {people.length > FIRST && (
                <Button size="sm" variant="ghost" className="w-full" onClick={() => setAll((v) => !v)}>
                  {all ? "Show fewer" : `Show all ${people.length}`}
                </Button>
              )}
              {sales ? (
                <p className="text-xs text-muted-foreground">
                  Closings and revenue are this month&apos;s, in Gulf time — the Salespeople page&apos;s figures.
                </p>
              ) : null}
              {calls?.summary.available ? (
                <p className="text-xs text-muted-foreground">
                  <Phone className="mr-1 inline h-3 w-3 text-sky-500" />
                  {calls.summary.kind === "recorder"
                    ? "Calls from the phone call-recorder app, which does not say who made them — only the card's total."
                    : "Calls from 3CX in the period picked above, by who took them."}{" "}
                  <Link href={`/calls?portal=${p.code}`} className="text-primary hover:underline">Every call and recording</Link>
                </p>
              ) : null}
              {anyOverdue ? (
                <p className="text-xs text-muted-foreground">
                  <Clock className="mr-1 inline h-3 w-3 text-rose-500" />
                  Overdue ones are counted inside their column, as the portal&apos;s badge counts them.
                </p>
              ) : null}
              {anyShared ? (
                <p className="text-xs text-muted-foreground">
                  &ldquo;Shared&rdquo; waits on anyone who can do it, so each of them is shown with all of it — people&apos;s figures add up to more than the card&apos;s.
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
