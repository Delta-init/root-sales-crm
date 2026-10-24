"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AxiosError } from "axios";
import { AlarmClock, AlertTriangle, CalendarClock, ClipboardCheck, ListTodo, RefreshCw, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CseStatCard } from "@/components/cses/CseStatCard";
import { BreakdownDialog, Bars, type BarRow, type BreakdownTab } from "@/components/common/Breakdown";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { MediaWatch } from "@/lib/types";

/**
 * Pending → Media ERP (the user, 2026-10-17): "media pending, task pending,
 * leader desk pending" — total cards like the CS portal tab, each person's
 * figures, and the list behind every number:
 *
 *   Media        Media Schedule tasks active now (overdue past their due date),
 *                and those scheduled to start later
 *   Tasks        project tasks somebody is on and hasn't handed in yet
 *   Leader Desk  tasks in review, new work nobody has picked up, work sent
 *                back — against the team leaders it waits on
 *
 * Media ERP answers for itself (GET /service/media-watch). IST days. Read-only.
 */

type Kind = "media" | "tasks" | "leaderDesk" | "overdue";
type Pick = { kind: Kind; person?: string; personName?: string } | null;
const KIND_LABEL: Record<Kind, string> = { media: "Media pending", tasks: "Tasks pending", leaderDesk: "Leader Desk", overdue: "Overdue" };
const DESK_STAGE: Record<string, { label: string; cls: string }> = {
  review: { label: "In review", cls: "text-amber-500" },
  incoming: { label: "New — nobody on it", cls: "text-sky-500" },
  reedit: { label: "Sent back to redo", cls: "text-rose-500" },
};
const TASK_STATUS: Record<string, string> = { pending: "Not started", started: "Started", break: "On a break", reedit: "Redo" };

const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const day = (ymd: string) => {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(d);
};
const ago = (iso: string) => {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
};
const bars = <T,>(rows: T[], key: (x: T) => string): BarRow[] => {
  const m = new Map<string, BarRow>();
  for (const x of rows) {
    const k = key(x) || "—";
    const r = m.get(k) ?? { key: k, label: k, value: 0 };
    r.value++;
    m.set(k, r);
  }
  return Array.from(m.values());
};

export function MediaWatchView() {
  const [search, setSearch] = useState("");
  const [pick, setPick] = useState<Pick>(null);
  const q = useQuery({
    queryKey: ["pending-media"],
    queryFn: async () => (await api.get("/pending/media")).data.data as MediaWatch,
    refetchInterval: 60_000,
    retry: 1,
  });
  const data = q.data;
  /** One row per person: their media and tasks, and the desk items waiting on them as a leader. */
  const people = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, { id: string; name: string; media: number; mediaLate: number; tasks: number; tasksLate: number; desk: number }>();
    const row = (id: string, name: string) => m.get(id) ?? m.set(id, { id, name: name || "Unknown", media: 0, mediaLate: 0, tasks: 0, tasksLate: 0, desk: 0 }).get(id)!;
    for (const x of data.items.media) if (x.personId && x.status === "active") { const r = row(x.personId, x.person); r.media++; if (x.overdue) r.mediaLate++; }
    for (const x of data.items.tasks) if (x.personId) { const r = row(x.personId, x.person); r.tasks++; if (x.overdue) r.tasksLate++; }
    for (const x of data.items.leaderDesk) for (const l of x.leaders) row(l.id, l.name).desk++;
    const needle = search.trim().toLowerCase();
    return Array.from(m.values()).filter((r) => !needle || r.name.toLowerCase().includes(needle))
      .sort((a, b) => b.media + b.tasks + b.desk - (a.media + a.tasks + a.desk) || a.name.localeCompare(b.name));
  }, [data, search]);

  if (q.error instanceof AxiosError && q.error.response?.status === 403) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">You haven&apos;t been given this Pending tab — a root admin gives it on Users.</CardContent></Card>;
  }
  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}</div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (q.isError || !data) {
    const message = q.error instanceof AxiosError ? (q.error.response?.data as { message?: string } | undefined)?.message : undefined;
    return (
      <Card className="border-rose-500/40 bg-rose-500/5">
        <CardContent className="flex gap-3 pt-6 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
          {q.error instanceof AxiosError && q.error.response?.status === 404 && !message
            ? "Root's server is still on the previous version — this tab shows once it is updated."
            : message || "Could not load Media ERP. Refresh in a moment."}
        </CardContent>
      </Card>
    );
  }
  const c = data.counts;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground">Updated {time(data.generatedAt)} · every minute</span>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={cn(q.isFetching && "animate-spin")} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CseStatCard icon={CalendarClock} accent="violet" title="Media pending" onClick={() => setPick({ kind: "media" })} value={String(c.media)}
          hint={`${c.media_overdue} overdue · ${c.media_upcoming} starting later`} alert={c.media_overdue > 0} />
        <CseStatCard icon={ListTodo} accent="blue" title="Tasks pending" onClick={() => setPick({ kind: "tasks" })} value={String(c.tasks)}
          hint={`${c.tasks_overdue} past their due date`} alert={c.tasks_overdue > 0} delay={0.05} />
        <CseStatCard icon={ClipboardCheck} accent="amber" title="Leader Desk" onClick={() => setPick({ kind: "leaderDesk" })} value={String(c.leader_desk)}
          hint={`${c.leader_desk_review} in review · ${c.leader_desk_incoming} new · ${c.leader_desk_reedit} sent back`} delay={0.1} />
        <CseStatCard icon={AlarmClock} accent="rose" title="Overdue" onClick={() => setPick({ kind: "overdue" })} value={String(c.media_overdue + c.tasks_overdue)}
          hint="media and tasks past their due date" alert={c.media_overdue + c.tasks_overdue > 0} delay={0.15} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Each person · {people.length}</CardTitle>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a person" className="pl-8" aria-label="Find a person" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {people.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Nothing waiting.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Person</th>
                    <th className="pb-2 pr-3 text-right font-medium">Media</th>
                    <th className="pb-2 pr-3 text-right font-medium">Tasks</th>
                    <th className="pb-2 pr-3 text-right font-medium">Leader Desk</th>
                    <th className="pb-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p, i) => {
                    const cell = (kind: Kind, value: number, late?: number) => value ? (
                      <button type="button" onClick={() => setPick({ kind, person: p.id, personName: p.name })} className="rounded px-1 hover:bg-muted/60 hover:underline">
                        <span className="font-medium">{value}</span>{late ? <span className="ml-1 text-xs text-rose-500">{late} late</span> : null}
                      </button>
                    ) : <span className="text-muted-foreground/60">—</span>;
                    return (
                      <motion.tr key={p.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 15) * 0.02 }} className="border-b border-border/20 last:border-0">
                        <td className="py-2.5 pr-3 font-medium">{p.name}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{cell("media", p.media, p.mediaLate)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{cell("tasks", p.tasks, p.tasksLate)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{cell("leaderDesk", p.desk)}</td>
                        <td className="py-2.5 text-right font-semibold tabular-nums">{p.media + p.tasks + p.desk}</td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Leader Desk counts against the team&apos;s leaders (no team, or no leader: the admins), so a leader&apos;s figure includes work done by others in their team.
          </p>
        </CardContent>
      </Card>

      {pick && <ItemsDialog data={data} pick={pick} onClose={() => setPick(null)} />}
    </div>
  );
}

function ItemsDialog({ data, pick, onClose }: { data: MediaWatch; pick: NonNullable<Pick>; onClose: () => void }) {
  const table = (head: string[], rows: { key: string; cells: ReactNode[] }[]) => rows.length === 0
    ? <p className="py-8 text-center text-sm text-muted-foreground">Nothing here.</p>
    : (
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">{head.map((h) => <th key={h} className="pb-2 pr-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => <tr key={r.key} className="border-b border-border/20 align-top last:border-0">{r.cells.map((c, i) => <td key={i} className="py-2 pr-3">{c}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    );
  const dueCell = (due: string, overdue: boolean) => <span className={cn("whitespace-nowrap", overdue && "font-medium text-rose-500")}>{due === data.today ? "Today" : day(due)}{overdue ? " · late" : ""}</span>;
  const mine = <T extends { personId: string }>(rows: T[]) => (pick.person ? rows.filter((r) => r.personId === pick.person) : rows);
  const mediaTable = (rows: MediaWatch["items"]["media"]) => table(["Task", "Who", "Team", "Starts", "Due"], rows.map((x) => ({
    key: x.id, cells: [<span key="t" className="font-medium">{x.title}</span>, x.person || "—", x.team || "—", day(x.start), dueCell(x.due, x.overdue)],
  })));
  const taskTable = (rows: MediaWatch["items"]["tasks"]) => table(["Task", "Who", "Team", "Status", "Due"], rows.map((x) => ({
    key: x.id, cells: [<span key="t" className="font-medium">{x.title}</span>, x.person, x.team || "—", TASK_STATUS[x.status] ?? x.status, dueCell(x.due, x.overdue)],
  })));
  const tabs: BreakdownTab[] = [];
  let about = "", count = 0;

  if (pick.kind === "media") {
    const rows = mine(data.items.media);
    const active = rows.filter((r) => r.status === "active");
    count = active.length;
    about = "Media Schedule tasks active now — late ones past their due date — and those scheduled to start later.";
    tabs.push({ key: "active", label: `Active · ${active.length}`, content: mediaTable(active) });
    tabs.push({ key: "late", label: `Overdue · ${active.filter((r) => r.overdue).length}`, content: mediaTable(active.filter((r) => r.overdue)) });
    tabs.push({ key: "later", label: `Starting later · ${rows.length - active.length}`, content: mediaTable(rows.filter((r) => r.status === "scheduled")) });
    if (!pick.person) tabs.push({ key: "person", label: "By person", content: <Bars rows={bars(active, (r) => r.person || "Nobody")} empty="Nobody." /> });
    tabs.push({ key: "team", label: "By team", content: <Bars rows={bars(active, (r) => r.team || "No team")} empty="Nothing." /> });
  } else if (pick.kind === "tasks") {
    const rows = mine(data.items.tasks);
    count = rows.length;
    about = "Project tasks somebody is on and hasn't handed in yet — not started, started, on a break, or sent back to redo — soonest due first.";
    tabs.push({ key: "list", label: `Tasks · ${rows.length}`, content: taskTable(rows) });
    tabs.push({ key: "late", label: `Overdue · ${rows.filter((r) => r.overdue).length}`, content: taskTable(rows.filter((r) => r.overdue)) });
    if (!pick.person) tabs.push({ key: "person", label: "By person", content: <Bars rows={bars(rows, (r) => r.person)} empty="Nobody." /> });
    tabs.push({ key: "status", label: "By status", content: <Bars rows={bars(rows, (r) => TASK_STATUS[r.status] ?? r.status)} empty="Nothing." /> });
  } else if (pick.kind === "leaderDesk") {
    const rows = pick.person ? data.items.leaderDesk.filter((x) => x.leaders.some((l) => l.id === pick.person)) : data.items.leaderDesk;
    count = rows.length;
    about = "What the Leader Desk holds — tasks in review, new work nobody has picked up, work sent back — oldest first, with the leaders it waits on.";
    const list = (xs: typeof rows) => table(["Task", "Team", "Stage", "On it", "Waits on", "Since"], xs.map((x) => ({
      key: x.id,
      cells: [<span key="t" className="font-medium">{x.title}</span>, x.team || "—", <span key="s" className={DESK_STAGE[x.stage]?.cls}>{DESK_STAGE[x.stage]?.label}</span>,
        x.assignee || "—", x.leaders.map((l) => l.name).join(", ") || "—", <span key="a" className="whitespace-nowrap">{x.since ? `${ago(x.since)} ago` : "—"}</span>],
    })));
    tabs.push({ key: "list", label: `All · ${rows.length}`, content: list(rows) });
    for (const s of ["review", "incoming", "reedit"] as const) {
      const xs = rows.filter((r) => r.stage === s);
      if (xs.length) tabs.push({ key: s, label: `${DESK_STAGE[s]!.label} · ${xs.length}`, content: list(xs) });
    }
    tabs.push({ key: "team", label: "By team", content: <Bars rows={bars(rows, (r) => r.team || "No team")} empty="Nothing." /> });
  } else {
    const media = data.items.media.filter((r) => r.overdue), tasks = data.items.tasks.filter((r) => r.overdue);
    count = media.length + tasks.length;
    about = "Media and tasks past their due date.";
    tabs.push({ key: "media", label: `Media · ${media.length}`, content: mediaTable(media) });
    tabs.push({ key: "tasks", label: `Tasks · ${tasks.length}`, content: taskTable(tasks) });
    tabs.push({ key: "person", label: "By person", content: <Bars rows={bars([...media, ...tasks], (r) => r.person || "Nobody")} empty="Nobody." /> });
  }

  return <BreakdownDialog open onClose={onClose} description={about} tabs={tabs}
    title={`${pick.personName ? `${pick.personName} · ` : ""}${KIND_LABEL[pick.kind]} · ${count}`} />;
}
