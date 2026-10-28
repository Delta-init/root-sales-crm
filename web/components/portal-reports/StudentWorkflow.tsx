"use client";
import { useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, GraduationCap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";

/*
 * Reports → CS portal → Student workflow (the user, 2026-10-20): the period's
 * students in CS Portal and where each went — came in (finance, LMS,
 * a sheet, by hand) → a CS or the open pool → onboarded, waiting (within the
 * wait) or late → enrolled in the LMS, contacted, first deposit, moved by hand
 * — and their follow-up stage now, per team and CS (GET /portal-reports/cs/workflow).
 * A box, a stage, a team or a CS opens the students behind it
 * (GET /portal-reports/cs/workflow/students). The same map as the sales CRMs'
 * Lead workflow. Read-only.
 */

interface Totals {
  came: number; assigned: number; pool: number; onboarded: number; waiting: number; late: number;
  enrolled: number; contacted: number; deposited: number; moved: number; moved_inactivity: number;
  bonus_pending?: number; bonus_sent_back?: number; bonus_after_payment?: number; bonus_needs_call?: number; bonus_with_finance?: number; bonus_waiting_broker?: number;
}
type BonusReason = "sent_back" | "after_payment" | "needs_call" | "with_finance" | "waiting_broker";
type BoxKey = keyof Totals;
interface StudentWorkflow {
  period: string; since: string | null; until: string | null; generated_at: string; wait_hours: number;
  totals: Totals;
  /** Pending bonuses of these students and why each waits (2026-10-20); missing from a TC not updated yet. */
  bonus?: { students: number; usd: number; reasons: Array<{ reason: BonusReason; students: number; usd: number }> };
  stages: Array<{ stage: string; count: number }>;
  sources: Array<{ source: string; count: number }>;
  teams: Array<Totals & { id: string | null; name: string; location: string }>;
  people: Array<Totals & { id: string; name: string; team: string | null; location: string }>;
  timeline: Array<{ day: string; came: number }>;
  studentLink?: string;
}
export interface StudentRow {
  id: string; name: string; code: string; came_at: string | null; source: string; location: string;
  cs: { id: string; name: string; team: string | null } | null;
  onboarded_at: string | null; stage: string; late: boolean; contacted: boolean; deposited: boolean; enrolled: boolean; moved: boolean;
  bonus?: { usd: number; reason: BonusReason; reasons: BonusReason[] } | null;
}
interface StudentList { total: number; students: StudentRow[]; studentLink?: string }

/** A box of the map, a stage of the legend, or a team's / CS's row. */
interface Pick { label: string; box?: BoxKey; stage?: string; teamId?: string; csId?: string }

// CS Portal's own stage colours (its followupUi STAGE_CLS), New made indigo so it is not the grey of "No follow-up".
const STAGES: Record<string, string> = {
  New: "#6366f1", Contacted: "#3b82f6", Qualified: "#06b6d4", "Session with CM": "#8b5cf6", "Objection Stage": "#f59e0b",
  Converted: "#10b981", Lost: "#f43f5e", "No follow-up": "#94a3b8",
};
const stageColor = (s: string) => STAGES[s] ?? "#64748b";
const SOURCE: Record<string, string> = { finance: "finance", lms: "LMS", sheet: "sheets", manual: "by hand" };
/* Why a bonus waits, as CS Portal says (its students/bonusPending.ts), in the order a CS can act on them. */
const BONUS_REASON: Record<BonusReason, string> = {
  sent_back: "sent back to the CS", after_payment: "waiting for full payment", needs_call: "needs a connected call",
  with_finance: "with finance", waiting_broker: "waiting for a broker admin",
};
const usd = (n: number | undefined) => `$${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
// 1 of 300 is "<1%", not "0%".
const pctOf = (n: number, of: number) => (!of ? "—" : n > 0 && Math.round((n / of) * 100) === 0 ? "<1%" : `${Math.round((n / of) * 100)}%`);
const n0 = (n: number | undefined) => (n ?? 0).toLocaleString("en-US");
/** A day, Dubai time: a YYYY-MM-DD as it is, or an instant (CS Portal sends the period's ends as instants). */
const dayLabel = (v: string) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00+04:00`) : new Date(v);
  return Number.isNaN(d.getTime()) ? "…" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Dubai" });
};
/** The period's last day: its end is the start of the day after, so a moment before it. */
const lastDayLabel = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? dayLabel(v) : dayLabel(new Date(new Date(v).getTime() - 1).toISOString()));
const gstWhen = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—");
const errorText = (e: unknown, what: string) => (e instanceof AxiosError && (e.response?.data as { message?: string } | undefined)?.message)
  || (e instanceof AxiosError && e.response?.status === 404 ? "Root's server is still on the previous version — this shows once it is updated." : `Could not load the ${what}. Refresh in a moment.`);

/** The student workflow over the CS report's period and filters. */
export function StudentWorkflowSection({ period, location, team, cs }: { period: { from?: string; to?: string }; location: string; team: string; cs: string }) {
  const filters = { ...period, location: location || undefined, team: team || undefined, cs: cs || undefined };
  const q = useQuery({
    queryKey: ["portal-reports", "cs", "workflow", period, location, team, cs],
    queryFn: async () => (await api.get("/portal-reports/cs/workflow", { params: filters })).data.data as StudentWorkflow,
    retry: 1,
  });
  const [pick, setPick] = useState<Pick | null>(null);
  const list = useQuery({
    queryKey: ["portal-reports", "cs", "workflow-students", period, location, team, cs, pick?.box, pick?.stage, pick?.teamId, pick?.csId],
    enabled: !!pick,
    queryFn: async () => (await api.get("/portal-reports/cs/workflow/students", {
      params: { ...filters, box: pick?.box, stage: pick?.stage, teamId: pick?.teamId, csId: pick?.csId },
    })).data.data as StudentList,
  });
  const link = (q.data?.studentLink || list.data?.studentLink || "");
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-base font-semibold"><GraduationCap className="h-4 w-4 text-primary" /> Student workflow</h3>
      {q.isLoading ? <Skeleton className="h-96 w-full" /> : q.isError || !q.data ? (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            {errorText(q.error, "student workflow")}
          </CardContent>
        </Card>
      ) : (
        <StudentWorkflowBody data={q.data} onPick={setPick} />
      )}
      <StudentBreakdown pick={pick} data={list.data} loading={list.isLoading} error={list.isError ? errorText(list.error, "students") : ""} onRetry={() => list.refetch()}
        onClose={() => setPick(null)} studentHref={(id) => (link ? `${link}${id}` : null)} />
    </section>
  );
}

export function StudentWorkflowBody({ data, onPick }: { data: StudentWorkflow; onPick?: (p: Pick) => void }) {
  const first = data.since ? dayLabel(data.since) : "…", last = data.until ? lastDayLabel(data.until) : "today";
  const days = !data.since && !data.until ? "all time" : first === last ? first : `${first} – ${last}`;
  return (
    <div className="space-y-4">
      <WorkflowMap data={data} onPick={onPick} title={`Students who came in · ${days}`} />
      <div className="grid gap-4 lg:grid-cols-3">
        <TimelineCard data={data} />
        <StageCard data={data} onPick={onPick} />
      </div>
      <TeamsCard data={data} onPick={onPick} />
      <PeopleCard data={data} onPick={onPick} />
    </div>
  );
}

function Box({ n, label, sub, of, tone, className, onOpen, children }: {
  n: number; label: string; sub?: string; of?: number; tone: "base" | "good" | "bad" | "muted"; className?: string; onOpen?: () => void; children?: ReactNode;
}) {
  const Tag = onOpen ? motion.button : motion.div;
  return (
    <div className={cn("relative", className)}>
      <Tag initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} {...(onOpen ? { type: "button" as const, onClick: onOpen, "aria-label": `${n} ${label} — see the students` } : {})}
        className={cn("block h-full w-full rounded-xl border px-3 py-2.5 text-center", onOpen && "cursor-pointer transition hover:ring-2 hover:ring-primary/40",
          tone === "good" && "border-emerald-500/30 bg-emerald-500/10",
          tone === "bad" && "border-rose-500/30 bg-rose-500/10",
          tone === "muted" && "border-border/60 bg-muted/40",
          tone === "base" && "border-border/60 bg-card")}>
        <p className={cn("text-xl font-bold tabular-nums", tone === "good" && "text-emerald-600 dark:text-emerald-400", tone === "bad" && n > 0 && "text-rose-600 dark:text-rose-400")}>{n0(n)}</p>
        <p className="text-xs text-muted-foreground">{label}{of !== undefined ? ` · ${pctOf(n, of)}` : ""}</p>
        {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground/80">{sub}</p> : null}
      </Tag>
      {children}
    </div>
  );
}
const Down = () => <div className="mx-auto h-4 w-px bg-border" aria-hidden />;

/** Came in → a CS or the pool → onboarded / waiting / late → enrolled, contacted, first deposit, moved → their stage now. */
function WorkflowMap({ data, title, onPick }: { data: StudentWorkflow; title: string; onPick?: (p: Pick) => void }) {
  const t = data.totals;
  const open = (box: BoxKey, label: string) => (onPick ? () => onPick({ box, label }) : undefined);
  const sources = data.sources.filter((s) => s.count > 0).map((s) => `${SOURCE[s.source] ?? s.source} ${n0(s.count)}`).join(" · ");
  const total = data.stages.reduce((n, s) => n + s.count, 0);
  const hours = data.wait_hours ?? 6;
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-0">
        <Box n={t.came} label="came in" sub={sources || undefined} onOpen={open("came", "Came in")} tone="base" className="mx-auto max-w-[18rem]" />
        <Down />
        <div className="grid grid-cols-2 gap-3 sm:mx-auto sm:max-w-xl">
          <Box n={t.assigned} label="assigned to a CS" of={t.came} onOpen={open("assigned", "Assigned to a CS")} tone="good" />
          <Box n={t.pool} label="no CS · open pool" of={t.came} onOpen={open("pool", "No CS · open pool")} tone="bad" />
        </div>
        <Down />
        <div className="grid grid-cols-3 gap-3 sm:mx-auto sm:max-w-3xl">
          <Box n={t.onboarded} label="onboarded" of={t.assigned} onOpen={open("onboarded", "Onboarded")} tone="good" />
          <Box n={t.waiting} label={`waiting · within ${hours} h`} onOpen={open("waiting", `Waiting · within ${hours} h`)} tone="muted" />
          <Box n={t.late} label="late · not onboarded" onOpen={open("late", "Late · not onboarded")} tone="bad" />
        </div>
        <Down />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Box n={t.enrolled} label="enrolled in LMS" of={t.came} onOpen={open("enrolled", "Enrolled in LMS")} tone="good" />
          <Box n={t.contacted} label="contacted" of={t.came} onOpen={open("contacted", "Contacted")} tone="good" />
          <Box n={t.deposited} label="first deposit" of={t.came} onOpen={open("deposited", "First deposit")} tone="good" />
          <Box n={t.moved} label="moved by hand" onOpen={open("moved", "Moved by hand")} tone="bad">
            {t.moved_inactivity > 0 ? (
              <button type="button" disabled={!onPick} onClick={() => onPick?.({ box: "moved_inactivity", label: "Moved for no deposit" })}
                className={cn("mt-1 block w-full text-center text-[11px] text-rose-600/80 dark:text-rose-400/80", onPick && "hover:underline")}>
                moved for no deposit {n0(t.moved_inactivity)}
              </button>
            ) : null}
          </Box>
        </div>
        {data.bonus ? (
          <>
            <Down />
            <div className={cn("rounded-xl border px-3 py-2.5", data.bonus.students ? "border-amber-500/30 bg-amber-500/10" : "border-border/60 bg-card")}>
              <button type="button" disabled={!onPick} onClick={() => onPick?.({ box: "bonus_pending", label: "Bonus pending" })}
                className={cn("flex w-full items-baseline justify-center gap-2", onPick && "cursor-pointer hover:underline")}>
                <span className={cn("text-xl font-bold tabular-nums", data.bonus.students > 0 && "text-amber-600 dark:text-amber-400")}>{n0(data.bonus.students)}</span>
                <span className="text-xs text-muted-foreground">bonus pending · {usd(data.bonus.usd)}</span>
              </button>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {data.bonus.reasons.map((r) => (
                  <button key={r.reason} type="button" disabled={!onPick || !r.students}
                    onClick={() => onPick?.({ box: `bonus_${r.reason}` as BoxKey, label: `Bonus pending — ${BONUS_REASON[r.reason] ?? r.reason}` })}
                    className={cn("rounded-full border px-2.5 py-0.5 text-xs", r.students ? "border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300" : "border-border/60 text-muted-foreground/60")}>
                    {BONUS_REASON[r.reason] ?? r.reason} · <span className="font-semibold tabular-nums">{n0(r.students)}</span>{r.students ? ` · ${usd(r.usd)}` : ""}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
        <Down />
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Where they stand now (follow-up stage)</p>
          {total === 0 ? <p className="text-xs text-muted-foreground">No students came in.</p> : (
            <>
              <div className="flex h-7 w-full overflow-hidden rounded-lg">
                {data.stages.filter((s) => s.count > 0).map((s) => (
                  <button key={s.stage} type="button" disabled={!onPick} onClick={() => onPick?.({ stage: s.stage, label: s.stage })}
                    title={`${s.stage}: ${s.count}`} aria-label={`${s.stage}: ${s.count} — see the students`}
                    className={cn("h-full", onPick && "cursor-pointer hover:opacity-80")} style={{ width: `${(s.count / total) * 100}%`, background: stageColor(s.stage) }} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {data.stages.map((s) => (
                  <button key={s.stage} type="button" disabled={!onPick || !s.count} onClick={() => onPick?.({ stage: s.stage, label: s.stage })}
                    className={cn("flex items-center gap-1.5 text-xs", onPick && s.count > 0 && "cursor-pointer hover:underline", !s.count && "opacity-50")}>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: stageColor(s.stage) }} />
                    {s.stage} <span className="font-semibold tabular-nums">{n0(s.count)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <p className="pt-3 text-xs text-muted-foreground">
          As CS Portal counts them: late = not onboarded within {hours} h of coming in. Assigned and pool are where each student is now.
        </p>
      </CardContent>
    </Card>
  );
}

const tooltip = (
  <RechartsTooltip
    cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
    content={({ active, payload, label }) => {
      if (!active || !payload?.length) return null;
      return (
        <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
          {label !== undefined && <p className="mb-1 font-semibold">{String(label)}</p>}
          {payload.map((p) => <p key={String(p.dataKey ?? p.name)} style={{ color: p.color }}>{p.name}: {p.value}</p>)}
        </div>
      );
    }}
  />
);

function TimelineCard({ data }: { data: StudentWorkflow }) {
  const rows = data.timeline.map((r) => ({ ...r, label: dayLabel(r.day) }));
  return (
    <Card className="border-border/50 lg:col-span-2">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">When they came in — by day</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? <p className="py-16 text-center text-xs text-muted-foreground">No students came in.</p> : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={rows} margin={{ left: -20, right: 4, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.4} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              {tooltip}
              <Bar dataKey="came" name="Came in" fill="#14b8a6" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function StageCard({ data, onPick }: { data: StudentWorkflow; onPick?: (p: Pick) => void }) {
  const pie = data.stages.filter((s) => s.count > 0).map((s) => ({ name: s.stage, value: s.count, color: stageColor(s.stage) }));
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Follow-up stage now</CardTitle></CardHeader>
      <CardContent>
        {pie.length === 0 ? <p className="py-16 text-center text-xs text-muted-foreground">No students came in.</p> : (
          <>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={pie} cx="50%" cy="50%" innerRadius={45} outerRadius={72} paddingAngle={2} dataKey="value">
                  {pie.map((e) => <Cell key={e.name} fill={e.color} strokeWidth={0} />)}
                </Pie>
                {tooltip}
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
              {pie.map((s) => (
                <button key={s.name} type="button" disabled={!onPick} onClick={() => onPick?.({ stage: s.name, label: s.name })}
                  className={cn("flex items-center gap-1.5 truncate text-left text-xs", onPick && "hover:underline")}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="truncate">{s.name}</span><span className="ml-auto font-semibold tabular-nums">{s.value}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const COLS: Array<{ key: BoxKey; label: string; bad?: boolean }> = [
  { key: "came", label: "Came in" }, { key: "onboarded", label: "Onboarded" }, { key: "late", label: "Late", bad: true },
  { key: "contacted", label: "Contacted" }, { key: "deposited", label: "First deposit" }, { key: "bonus_pending", label: "Bonus pending" },
  { key: "moved", label: "Moved", bad: true },
];

function Counts({ row }: { row: Totals }) {
  return (
    <>
      {COLS.map((c) => {
        const v = row[c.key] ?? 0;
        return <td key={c.key} className={cn("py-2 pr-3 text-right tabular-nums", !v && "text-muted-foreground/50", c.bad && v > 0 && "text-rose-500")}>{v ? n0(v) : "—"}</td>;
      })}
    </>
  );
}
const head = (first: string) => (
  <thead><tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
    {[first, ...COLS.map((c) => c.label)].map((h, i) => <th key={h} className={cn("pb-2 pr-3 font-medium", i && "text-right")}>{h}</th>)}
  </tr></thead>
);

function Name({ name, clickable, className }: { name: string; clickable: boolean; className?: string }) {
  return clickable
    ? <button type="button" aria-label={`${name} — see the students`} className={cn("text-left font-medium hover:text-primary hover:underline", className)}>{name}</button>
    : <span className={cn("font-medium", className)}>{name}</span>;
}

function TeamsCard({ data, onPick }: { data: StudentWorkflow; onPick?: (p: Pick) => void }) {
  // The open pool's row only when someone is in it.
  const teams = data.teams.filter((t) => t.id || t.came > 0 || t.pool > 0);
  if (!teams.length) return null;
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">By team</CardTitle>
        {onPick ? <p className="text-xs text-muted-foreground">Pick a team to see its students.</p> : null}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          {head("Team")}
          <tbody>
            {teams.map((t) => (
              <tr key={t.id ?? "pool"} onClick={onPick ? () => onPick({ box: "came", teamId: t.id ?? "", label: `${t.name} · came in` }) : undefined}
                className={cn("border-b border-border/20 last:border-0", onPick && "cursor-pointer hover:bg-muted/40")}>
                <td className="py-2 pr-3">
                  {/* The row opens the team's students; the name is the button a keyboard reaches (its click bubbles to the row). */}
                  <Name name={t.name} clickable={!!onPick} className={cn(!t.id && "text-rose-600 dark:text-rose-400")} />
                  {t.location ? <div className="text-xs capitalize text-muted-foreground">{t.location}</div> : null}
                </td>
                <Counts row={t} />
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function PeopleCard({ data, onPick }: { data: StudentWorkflow; onPick?: (p: Pick) => void }) {
  const people = useMemo(() => [...data.people].sort((a, b) => b.came - a.came || a.name.localeCompare(b.name)), [data.people]);
  if (!people.length) return null;
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">By CS</CardTitle>
        {onPick ? <p className="text-xs text-muted-foreground">Pick a CS to see their students.</p> : null}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          {head("CS")}
          <tbody>
            {people.map((p) => (
              <tr key={p.id} onClick={onPick ? () => onPick({ box: "came", csId: p.id, label: `${p.name} · came in` }) : undefined}
                className={cn("border-b border-border/20 last:border-0", onPick && "cursor-pointer hover:bg-muted/40")}>
                <td className="py-2 pr-3">
                  <Name name={p.name} clickable={!!onPick} />
                  <div className="text-xs text-muted-foreground">{p.team ?? "No team"}{p.location === "bangalore" ? " · Bangalore" : ""}</div>
                </td>
                <Counts row={p} />
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ─── The students behind a box, a stage, a team or a CS ─────────────────────────────

function Flag({ on, label, bad }: { on: boolean; label: string; bad?: boolean }) {
  if (!on) return null;
  return <span className={cn("rounded-full border px-1.5 py-0.5 text-[11px]", bad ? "border-rose-500/40 text-rose-600 dark:text-rose-400" : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400")}>{label}</span>;
}

function StudentBreakdown({ pick, data, loading, error, onRetry, onClose, studentHref }: {
  pick: Pick | null; data?: StudentList; loading: boolean; error: string; onRetry: () => void; onClose: () => void;
  studentHref: (id: string) => string | null;
}) {
  const [tab, setTab] = useState<"list" | "cs" | "team">("list");
  const groups = useMemo(() => {
    const by = (key: (s: StudentRow) => string) => {
      const m = new Map<string, number>();
      for (const s of data?.students ?? []) m.set(key(s), (m.get(key(s)) ?? 0) + 1);
      return Array.from(m.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    };
    return { cs: by((s) => s.cs?.name ?? "No CS · open pool"), team: by((s) => (s.cs ? s.cs.team ?? "No team" : "Open pool")) };
  }, [data]);
  const shown = data?.students.length ?? 0;
  return (
    <Dialog open={!!pick} onOpenChange={(open) => { if (!open) { onClose(); setTab("list"); } }}>
      <DialogContent className="flex max-h-[88vh] max-w-5xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{pick?.label}{data ? ` · ${n0(data.total)} student${data.total === 1 ? "" : "s"}` : ""}</DialogTitle>
          <DialogDescription>The students behind this, newest first — with the same dates, location, team and CS as the map.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1.5" role="tablist">
          {([["list", "List"], ["cs", "By CS"], ["team", "By team"]] as const).map(([k, l]) => (
            <Button key={k} size="sm" role="tab" aria-selected={tab === k} variant={tab === k ? "default" : "outline"} onClick={() => setTab(k)}>{l}</Button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? <Skeleton className="h-64 w-full" /> : error || !data ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {error || "Could not load these students."} <Button variant="link" size="sm" onClick={onRetry}>Try again</Button>
            </div>
          ) : data.total === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">No students here.</p> : tab === "list" ? (
            <>
              <table className="w-full min-w-[820px] text-sm">
                <thead className="sticky top-0 bg-background"><tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                  {["Student", "CS", "Came in", "Onboarded", "Stage", "Bonus pending", "Flags"].map((h) => <th key={h} className="pb-2 pr-3 font-medium">{h}</th>)}
                </tr></thead>
                <tbody>
                  {data.students.map((s) => {
                    const href = studentHref(s.id);
                    return (
                      <tr key={s.id} className="border-b border-border/20 align-top last:border-0">
                        <td className="py-2 pr-3">
                          {href ? <a href={href} target="_blank" rel="noreferrer" className="font-medium hover:text-primary hover:underline">{s.name || "A student"}</a>
                            : <span className="font-medium">{s.name || "A student"}</span>}
                          <div className="text-xs text-muted-foreground">{s.code || "—"}{s.location === "bangalore" ? " · Bangalore" : ""}</div>
                        </td>
                        <td className="py-2 pr-3">{s.cs?.name ?? <span className="text-rose-600 dark:text-rose-400">Open pool</span>}<div className="text-xs text-muted-foreground">{s.cs ? s.cs.team ?? "No team" : "No CS"}</div></td>
                        <td className="py-2 pr-3 text-xs">{gstWhen(s.came_at)}<div className="text-muted-foreground">{SOURCE[s.source] ?? (s.source || "—")}</div></td>
                        <td className="py-2 pr-3 text-xs">{s.onboarded_at ? gstWhen(s.onboarded_at) : <span className={s.late ? "text-rose-500" : "text-muted-foreground"}>{s.late ? "late" : "not yet"}</span>}</td>
                        <td className="py-2 pr-3"><span className="rounded-full border px-1.5 py-0.5 text-[11px]" style={{ borderColor: stageColor(s.stage), color: stageColor(s.stage) }}>{s.stage || "No follow-up"}</span></td>
                        <td className="py-2 pr-3 text-xs">{s.bonus ? (
                          <><span className="font-medium text-amber-600 dark:text-amber-400">{usd(s.bonus.usd)}</span>
                            <div className="text-muted-foreground">{(s.bonus.reasons?.length ? s.bonus.reasons : [s.bonus.reason]).map((x) => BONUS_REASON[x] ?? x).join(" · ")}</div></>
                        ) : <span className="text-muted-foreground/60">—</span>}</td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-1">
                            <Flag on={s.late} label="late" bad /><Flag on={s.enrolled} label="LMS" /><Flag on={s.contacted} label="contacted" />
                            <Flag on={s.deposited} label="deposit" /><Flag on={s.moved} label="moved" bad />
                            {!s.late && !s.enrolled && !s.contacted && !s.deposited && !s.moved ? <span className="text-xs text-muted-foreground/60">—</span> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {data.total > shown && <p className="pt-2 text-xs text-muted-foreground">Showing the newest {n0(shown)} of {n0(data.total)} — By CS and By team count these {n0(shown)}.</p>}
            </>
          ) : (
            <div className="space-y-1.5">
              {(tab === "cs" ? groups.cs : groups.team).map((x, _i, all) => {
                const max = Math.max(...all.map((y) => y.count));
                return (
                  <div key={x.name} className="flex items-center gap-3 text-sm">
                    <span className="w-44 shrink-0 truncate font-medium">{x.name}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (x.count / max) * 100)}%` }} /></span>
                    <span className="w-24 shrink-0 text-right tabular-nums">{x.count} <span className="text-xs text-muted-foreground">{pctOf(x.count, shown)}</span></span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
