"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AxiosError } from "axios";
import { AlertTriangle, Gift, GraduationCap, Inbox, LifeBuoy, PhoneCall, RefreshCw, Search, UserX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CseStatCard } from "@/components/cses/CseStatCard";
import { BreakdownDialog, Bars, type BarRow, type BreakdownTab } from "@/components/common/Breakdown";
import { api } from "@/lib/axios";
import { PersonLink } from "@/components/pending/access";
import { cn } from "@/lib/utils";
import type { BonusStage, CsLocation, CsPending, CsPendingCounts, CsPendingWho } from "@/lib/types";

/**
 * Pending → CS portal (the user, 2026-10-17): what waits on each Tetra
 * Commission CS, with a total card for each, and exactly which students —
 *
 *   Onboarding    not onboarded yet; late = from finance, waiting 6 hours or more
 *   Bonus         MT5 bonuses not decided, and where each is stuck: sent back to
 *                 the CS, needs a call, with finance, waiting for a broker admin
 *   Tickets       the student's LMS Help & Support tickets still open
 *   Follow-ups    due today, and overdue
 *   Class calls   classes attended that still wait for the CS's call
 *
 * Tetra Commission counts them by its own sidebar's rules: a student is their
 * CS's and any Common CS's, so a CS's figures can add up to more than the
 * team's, which counts each student once. Students with no CS yet have a row
 * of their own. Every figure opens the students behind it; a student opens in
 * Tetra Commission. Root admins only; nothing is changed.
 */

type Kind = "onboarding" | "bonus" | "tickets" | "followups" | "completions";
type Loc = "all" | CsLocation;
/** Whose: one CS's id, "" for students with no CS yet; undefined for everyone. */
type Pick = { kind: Kind; cs?: string; csName?: string; tab?: string } | null;

const LOCS: { key: Loc; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "dubai", label: "Dubai" },
  { key: "bangalore", label: "Bangalore" },
];
const KIND_LABEL: Record<Kind, string> = {
  onboarding: "Onboarding pending",
  bonus: "Bonus pending",
  tickets: "Tickets pending",
  followups: "Follow-ups due",
  completions: "Class completions to call",
};
export const STAGES: { key: BonusStage; label: string; about: string; bar: string; text: string }[] = [
  { key: "sent_back", label: "Sent back to the CS", about: "Returned to correct — the CS has to fix and resend it", bar: "bg-rose-500", text: "text-rose-500" },
  { key: "needs_call", label: "Needs a call", about: "Given at the sales close — goes once a connected call with their MT5 is logged", bar: "bg-amber-500", text: "text-amber-500" },
  { key: "with_finance", label: "With finance", about: "Delta finance has it to approve", bar: "bg-sky-500", text: "text-sky-500" },
  { key: "waiting_broker", label: "Waiting for a broker admin", about: "Finance approved (or it never goes there) — a broker admin or super admin decides it", bar: "bg-violet-500", text: "text-violet-500" },
];
const STAGE_COUNT: Record<BonusStage, keyof CsPendingCounts> = {
  sent_back: "bonus_sent_back", needs_call: "bonus_needs_call", with_finance: "bonus_with_finance", waiting_broker: "bonus_waiting_broker",
};

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
};
const day = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(d);
};
/** How long since: "40 min", "6 h", "3 d". */
const ago = (iso: string) => {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
};
const countOf = (c: CsPendingCounts, kind: Kind) =>
  kind === "tickets" ? c.tickets_open + c.tickets_waiting
    : kind === "followups" ? c.followups_today + c.followups_overdue
      : c[kind];

export function CsPendingView() {
  const [loc, setLoc] = useState<Loc>("all");
  const [search, setSearch] = useState("");
  const [pick, setPick] = useState<Pick>(null);
  const q = useQuery({
    queryKey: ["pending-cs"],
    queryFn: async () => (await api.get("/pending/cs")).data.data as CsPending,
    refetchInterval: 60_000,
  });
  const data = q.data;
  const needle = search.trim().toLowerCase();
  const people = useMemo(() => (data?.people ?? [])
    .filter((p) => loc === "all" || p.location === loc)
    .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.email.includes(needle) || p.team.toLowerCase().includes(needle)),
  [data, loc, needle]);
  const t = data ? (loc === "all" ? data.totals : data.totalsByLocation[loc]) : null;
  // Nobody's students are counted with Dubai (their location is their CS's).
  const showNoCs = !!data?.noCs && data.noCs.total > 0 && loc !== "bangalore" && !needle;

  if (q.error instanceof AxiosError && q.error.response?.status === 403) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">You haven&apos;t been given this Pending tab — a root admin gives it on Users.</CardContent></Card>;
  }
  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}</div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (q.isError || !data || !t) {
    const message = q.error instanceof AxiosError ? (q.error.response?.data as { message?: string } | undefined)?.message : undefined;
    return (
      <Card className="border-rose-500/40 bg-rose-500/5">
        <CardContent className="flex gap-3 pt-6 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
          {q.error instanceof AxiosError && q.error.response?.status === 404
            ? "Root's server is still on the previous version — this tab shows once it is updated."
            : message || "Could not load the CS portal's pending work. Refresh in a moment."}
        </CardContent>
      </Card>
    );
  }

  const stageTotal = STAGES.reduce((n, s) => n + t[STAGE_COUNT[s.key]], 0);
  const open = (kind: Kind, tab?: string) => setPick({ kind, tab });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Location">
          {LOCS.map((l) => (
            <Button key={l.key} size="sm" variant={loc === l.key ? "default" : "outline"} onClick={() => setLoc(l.key)}>{l.label}</Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Updated {time(data.generatedAt)} · every minute</span>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={cn(q.isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <CseStatCard icon={Inbox} title="Total pending" value={String(t.total)} hint={`across ${plural(people.length, "CS", "CSs")}${showNoCs ? " and students with no CS" : ""}`} />
        <CseStatCard icon={UserX} accent="amber" title="Onboarding pending" onClick={() => open("onboarding")} value={String(t.onboarding)}
          hint={t.onboarding_late ? `${t.onboarding_late} late — from finance, 6 h+` : "none late"} alert={t.onboarding_late > 0} delay={0.05} />
        <CseStatCard icon={Gift} accent="rose" title="Bonus pending" onClick={() => open("bonus")} value={String(t.bonus)}
          hint={t.bonus ? `${usd(t.bonus_usd)} · ${t.bonus_sent_back} sent back · ${t.bonus_waiting_broker} broker admin` : "nothing waiting"} delay={0.1} />
        <CseStatCard icon={LifeBuoy} accent="cyan" title="Tickets pending" onClick={() => open("tickets")}
          value={data.tickets.available ? String(t.tickets_open + t.tickets_waiting) : "—"}
          hint={data.tickets.available ? `${t.tickets_open} need an answer · ${t.tickets_waiting} on the student` : "LMS could not be asked"} alert={!data.tickets.available} delay={0.15} />
        <CseStatCard icon={PhoneCall} accent="violet" title="Follow-ups due" onClick={() => open("followups")} value={String(t.followups_today + t.followups_overdue)}
          hint={`${t.followups_today} today · ${t.followups_overdue} overdue`} alert={t.followups_overdue > 0} delay={0.2} />
        <CseStatCard icon={GraduationCap} accent="emerald" title="Class completions" onClick={() => open("completions")} value={String(t.completions)}
          hint="attended a class, call not logged yet" delay={0.25} />
      </div>

      {!data.tickets.available && (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span className="text-muted-foreground">Tickets aren&apos;t counted right now — {data.tickets.message || "the LMS could not be asked"}. Everything else is.</span>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
            <span>Where the bonuses are stuck</span>
            <span className="text-sm font-normal text-muted-foreground">{plural(t.bonus, "bonus", "bonuses")} · {usd(t.bonus_usd)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {stageTotal === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No bonus is waiting.</p>
          ) : (
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
              {STAGES.map((s) => t[STAGE_COUNT[s.key]] > 0 && (
                <div key={s.key} className={cn("h-full", s.bar)} style={{ width: `${(t[STAGE_COUNT[s.key]] / stageTotal) * 100}%` }} title={`${s.label}: ${t[STAGE_COUNT[s.key]]}`} />
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {STAGES.map((s) => (
              <button key={s.key} type="button" onClick={() => open("bonus", s.key)} disabled={!t[STAGE_COUNT[s.key]]}
                className="flex items-start gap-2 rounded-lg border border-border/60 p-3 text-left transition-colors hover:border-primary/40 disabled:cursor-default disabled:opacity-60 disabled:hover:border-border/60">
                <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", s.bar)} />
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className={cn("text-xl font-bold tabular-nums", s.text)}>{t[STAGE_COUNT[s.key]]}</span>
                    <span className="text-sm font-medium">{s.label}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{s.about}</span>
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Each CS · {people.length}</CardTitle>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a CS or team" className="pl-8" aria-label="Find a CS or team" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {people.length === 0 && !showNoCs ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{needle ? "No CS by that name." : "No CS here."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">CS</th>
                    <th className="pb-2 pr-3 text-right font-medium">Onboarding</th>
                    <th className="pb-2 pr-3 text-right font-medium">Bonus</th>
                    <th className="pb-2 pr-3 text-right font-medium">Tickets</th>
                    <th className="pb-2 pr-3 text-right font-medium">Follow-ups</th>
                    <th className="pb-2 pr-3 text-right font-medium">Class calls</th>
                    <th className="pb-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p, i) => (
                    <motion.tr key={p.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 15) * 0.02 }}
                      className="border-b border-border/20 last:border-0">
                      <td className="py-2.5 pr-3">
                        <PersonLink href={`/cses/${p.id}`} className={cn("font-medium hover:underline", !p.active && "text-muted-foreground")}>{p.name}</PersonLink>
                        {!p.active && <span className="ml-1.5 text-xs text-muted-foreground">(switched off)</span>}
                        <div className="text-xs text-muted-foreground">
                          {[p.team, p.location === "bangalore" ? "Bangalore" : "Dubai", p.role === "cs" ? "" : p.role.replace(/_/g, " ")].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <Cells counts={p.counts} tickets={data.tickets.available} onPick={(kind) => setPick({ kind, cs: p.id, csName: p.name })} />
                      <td className="py-2.5 text-right font-semibold tabular-nums">{p.total || <span className="font-normal text-muted-foreground/60">—</span>}</td>
                    </motion.tr>
                  ))}
                  {showNoCs && data.noCs && (
                    <tr className="border-t border-border/60 bg-muted/20">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium">No CS yet</div>
                        <div className="text-xs text-muted-foreground">Students waiting in Delta Open Students</div>
                      </td>
                      <Cells counts={data.noCs.counts} tickets={data.tickets.available} onPick={(kind) => setPick({ kind, cs: "", csName: "No CS yet" })} />
                      <td className="py-2.5 text-right font-semibold tabular-nums">{data.noCs.total}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            A student shared with a Common CS counts for both, so the rows can add up to more than the cards, which count each student once.
            Red is late: onboarding from finance waiting 6 hours or more, overdue follow-ups.
          </p>
        </CardContent>
      </Card>

      {pick && <ItemsDialog data={data} pick={pick} loc={loc} onClose={() => setPick(null)} />}
    </div>
  );
}

/** One row's five figures, each opening its students. */
function Cells({ counts: c, tickets, onPick }: { counts: CsPendingCounts; tickets: boolean; onPick: (kind: Kind) => void }) {
  const cell = (kind: Kind, main: number, extra?: ReactNode) => (
    <td className="py-2.5 pr-3 text-right tabular-nums">
      {main ? (
        <button type="button" onClick={() => onPick(kind)} className="rounded px-1 hover:bg-muted/60 hover:underline">
          <span className="font-medium">{main}</span>{extra}
        </button>
      ) : <span className="text-muted-foreground/60">—</span>}
    </td>
  );
  return (
    <>
      {cell("onboarding", c.onboarding, c.onboarding_late ? <span className="ml-1 text-xs text-rose-500">{c.onboarding_late} late</span> : null)}
      {cell("bonus", c.bonus, c.bonus_usd ? <span className="ml-1 text-xs text-muted-foreground">{usd(c.bonus_usd)}</span> : null)}
      {tickets ? cell("tickets", c.tickets_open + c.tickets_waiting, c.tickets_waiting ? <span className="ml-1 text-xs text-muted-foreground">({c.tickets_waiting} on student)</span> : null)
        : <td className="py-2.5 pr-3 text-right text-muted-foreground/60">?</td>}
      {cell("followups", c.followups_today + c.followups_overdue, c.followups_overdue ? <span className="ml-1 text-xs text-rose-500">{c.followups_overdue} overdue</span> : null)}
      {cell("completions", c.completions)}
    </>
  );
}

/** The students behind a figure: everyone's, or one CS's — in tabs by how they split, and by CS. */
function ItemsDialog({ data, pick, loc, onClose }: { data: CsPending; pick: NonNullable<Pick>; loc: Loc; onClose: () => void }) {
  const mine = <T extends CsPendingWho>(rows: T[]) => rows.filter((x) =>
    (pick.cs === undefined ? loc === "all" || x.location === loc : x.csIds.includes(pick.cs)));
  const link = (who: CsPendingWho) => (
    <div className="min-w-0">
      {data.studentLink && who.studentId ? (
        <a href={`${data.studentLink}${who.studentId}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">{who.student || "A student"}</a>
      ) : <span className="font-medium">{who.student || "A student"}</span>}
      <div className="text-xs text-muted-foreground">{[who.code, pick.cs === undefined ? (who.cs.map((c) => c.name).join(", ") || "No CS yet") : ""].filter(Boolean).join(" · ")}</div>
    </div>
  );
  const byCs = (rows: CsPendingWho[], weight: (x: CsPendingWho) => number = () => 1): BarRow[] => {
    const m = new Map<string, BarRow>();
    for (const x of rows) for (const id of x.csIds) {
      const name = id ? (x.cs.find((c) => c.id === id)?.name || "Unknown") : "No CS yet";
      const r = m.get(id) ?? { key: id || "none", label: name, value: 0 };
      r.value += weight(x);
      m.set(id, r);
    }
    return Array.from(m.values());
  };
  const table = (head: string[], rows: { key: string; cells: ReactNode[] }[], empty = "Nothing here.") => rows.length === 0
    ? <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
    : (
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
              {head.map((h, i) => <th key={h} className={cn("pb-2 pr-3 font-medium", i > 0 && i === head.length - 1 && "text-right")}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-border/20 align-top last:border-0">
                {r.cells.map((c, i) => <td key={i} className={cn("py-2 pr-3", i > 0 && i === r.cells.length - 1 && "text-right")}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  const tabs: BreakdownTab[] = [];
  let count = 0;
  let about = "";
  const csTab = (rows: CsPendingWho[], weight?: (x: CsPendingWho) => number) => {
    if (pick.cs === undefined) tabs.push({ key: "cs", label: "By CS", content: <Bars rows={byCs(rows, weight)} empty="Nobody." /> });
  };

  if (pick.kind === "onboarding") {
    const rows = mine(data.items.onboarding);
    count = rows.length;
    about = "Students not onboarded yet, the longest waiting first. Late: from finance and waiting 6 hours or more.";
    const list = (xs: typeof rows) => table(["Student", "From", "Waiting", "Since"], xs.map((x) => ({
      key: x.studentId,
      cells: [link(x), x.fromFinance ? "Finance (sale closed)" : "Added in the portal",
        <span key="w" className={cn("tabular-nums", x.late && "font-medium text-rose-500")}>{ago(x.since)}{x.late ? " · late" : ""}</span>, when(x.since)],
    })));
    tabs.push({ key: "all", label: `All · ${rows.length}`, content: list(rows) });
    tabs.push({ key: "late", label: `Late · ${rows.filter((x) => x.late).length}`, content: list(rows.filter((x) => x.late)) });
    tabs.push({ key: "waiting", label: `Not late yet · ${rows.filter((x) => !x.late).length}`, content: list(rows.filter((x) => !x.late)) });
    csTab(rows);
  } else if (pick.kind === "bonus") {
    const rows = mine(data.items.bonus);
    count = rows.reduce((n, x) => n + x.count, 0);
    about = "MT5 bonuses not decided yet, and where each is stuck. A student with several shows each stage they have.";
    const list = (xs: typeof rows, only?: BonusStage) => table(["Student", "Where it is stuck", "Waiting", "Amount"], xs.map((x) => ({
      key: x.studentId,
      cells: [link(x),
        <div key="s" className="flex flex-wrap gap-1">
          {STAGES.filter((s) => x.stages[s.key] && (!only || s.key === only)).map((s) => (
            <span key={s.key} className={cn("inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5 text-xs", s.text)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", s.bar)} />{s.label}{x.stages[s.key]!.count > 1 ? ` × ${x.stages[s.key]!.count}` : ""}
            </span>
          ))}
        </div>,
        x.since ? ago(x.since) : "—",
        <span key="u" className="tabular-nums">{usd(only ? x.stages[only]?.total_usd ?? 0 : x.usd)}</span>],
    })));
    tabs.push({ key: "all", label: `All · ${count}`, content: list(rows) });
    for (const s of STAGES) {
      const xs = rows.filter((x) => x.stages[s.key]);
      tabs.push({ key: s.key, label: `${s.label} · ${xs.reduce((n, x) => n + x.stages[s.key]!.count, 0)}`, content: list(xs, s.key) });
    }
    csTab(rows, (x) => (x as (typeof rows)[number]).count);
  } else if (pick.kind === "tickets") {
    const rows = mine(data.items.tickets);
    count = rows.length;
    about = data.tickets.available
      ? "LMS Help & Support tickets still open, the longest quiet first. They are answered on the LMS or the student's page in Tetra Commission."
      : `The LMS could not be asked — ${data.tickets.message ?? ""}`;
    const list = (xs: typeof rows) => table(["Student", "Ticket", "Last message", "Status"], xs.map((x) => ({
      key: x.ticketId,
      cells: [link(x),
        <div key="t" className="min-w-0"><div className="font-medium">{x.subject || "(no subject)"}</div><div className="text-xs text-muted-foreground">{x.category} · opened {when(x.openedAt)}</div></div>,
        <span key="l" className="whitespace-nowrap">{ago(x.lastMessageAt)} ago · {x.lastFrom === "student" ? "student" : "support"}</span>,
        x.status === "waiting_for_answer" ? <span key="s" className="text-rose-500">Needs an answer</span> : <span key="s" className="text-muted-foreground">On the student</span>],
    })));
    const answer = rows.filter((x) => x.status === "waiting_for_answer");
    tabs.push({ key: "all", label: `All · ${rows.length}`, content: list(rows) });
    tabs.push({ key: "answer", label: `Need an answer · ${answer.length}`, content: list(answer) });
    tabs.push({ key: "student", label: `On the student · ${rows.length - answer.length}`, content: list(rows.filter((x) => x.status !== "waiting_for_answer")) });
    csTab(rows);
  } else if (pick.kind === "followups") {
    const rows = mine(data.items.followups);
    count = rows.length;
    about = "Open follow-ups due today or already overdue, the oldest first.";
    const list = (xs: typeof rows) => table(["Student", "Follow-up", "Stage", "Due"], xs.map((x, i) => ({
      key: `${x.studentId}-${x.due}-${i}`,
      cells: [link(x), <div key="f">{x.outcome || "—"}{x.title ? <div className="text-xs text-muted-foreground">{x.title}</div> : null}</div>, x.stage || "—",
        <span key="d" className={cn("whitespace-nowrap", x.overdue && "font-medium text-rose-500")}>{x.due === data.today ? "Today" : day(x.due)}</span>],
    })));
    const late = rows.filter((x) => x.overdue);
    tabs.push({ key: "all", label: `All · ${rows.length}`, content: list(rows) });
    tabs.push({ key: "overdue", label: `Overdue · ${late.length}`, content: list(late) });
    tabs.push({ key: "today", label: `Today · ${rows.length - late.length}`, content: list(rows.filter((x) => !x.overdue)) });
    csTab(rows);
  } else {
    const rows = mine(data.items.completions);
    count = rows.length;
    about = "Students who attended a class and haven't had their call yet — a follow-up log or a 3CX call after the class settles it.";
    tabs.push({ key: "all", label: `All · ${rows.length}`, content: table(["Student", "Class", "Mentor", "Ended"], rows.map((x, i) => ({
      key: `${x.studentId}-${i}`,
      cells: [link(x), <div key="c">{x.className || "A class"}{x.course ? <div className="text-xs text-muted-foreground">{x.course}</div> : null}</div>, x.mentor || "—",
        <span key="e" className="whitespace-nowrap">{when(x.endedAt)} · {ago(x.endedAt)} ago</span>],
    }))) });
    csTab(rows);
  }

  // Opened from a bonus stage: that stage's tab first.
  const first = pick.tab ? tabs.findIndex((x) => x.key === pick.tab) : -1;
  const ordered = first > 0 ? [tabs[first]!, ...tabs.filter((_, i) => i !== first)] : tabs;
  return (
    <BreakdownDialog open onClose={onClose} title={`${pick.csName ? `${pick.csName} · ` : ""}${KIND_LABEL[pick.kind]} · ${count}`} description={about} tabs={ordered} />
  );
}
