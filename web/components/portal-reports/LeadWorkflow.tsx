"use client";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ReferenceArea, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, ArrowRight, Workflow } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";

/*
 * Reports → Sales → a CRM → Lead workflow (the user, 2026-10-17): the CRM's own
 * Inactive Leads → Workflow tab — the period's leads and where each went, by
 * team and by employee — asked of the CRM (GET /portal-reports/sales/:code/workflow).
 * The same map and charts as the CRM's page.
 */

interface WorkflowCounts {
  came: number; assigned: number; unassigned: number; worked: number; fresh: number; inactive: number;
  movedAuto: number; movedHand: number; onBreak: number; nobodyLeft: number; waiting: number;
}
interface PersonRef { id: string; name: string }
interface LeadWorkflow {
  generatedAt: string;
  period: { from: string; to: string; days: number };
  rule: { limitMinutes: number; hours: { start: string; end: string }; timezone: string };
  totals: WorkflowCounts & { moves: number };
  statuses: Array<{ status: string; count: number }>;
  timeline: { unit: "hour" | "day"; rows: Array<{ key: string; came: number }> };
  teams: Array<WorkflowCounts & { id: string | null; name: string; statuses: Record<string, number> }>;
  people: Array<{
    id: string; name: string; active: boolean; team: string | null; held: number; now: number; worked: number; fresh: number;
    inactiveNow: number; lost: number; got: number; statuses: Record<string, number>; breakMinutes: number;
  }>;
  movesMap: Array<{ from: PersonRef; to: PersonRef; count: number; automatic: number }>;
}

const STAGE = { worked: "#10b981", fresh: "#94a3b8", inactive: "#f43f5e", unassigned: "#64748b", lost: "#f59e0b" };
// The CRMs' own status colours (their statusConfig).
const STATUS: Record<string, [string, string]> = {
  new: ["New", "#3b82f6"], assigned: ["Assigned", "#eab308"], pending_response: ["Pending Response", "#8b5cf6"], followup: ["Follow Up", "#f97316"], closed: ["Closed", "#22c55e"], lost: ["Lost", "#ef4444"], not_connected: ["Not Connected", "#64748b"], mia: ["MIA", "#f43f5e"], repeated: ["Repeated", "#06b6d4"], callback: ["Call Back", "#0ea5e9"], cnc: ["CNC", "#f59e0b"],
};
const statusLabel = (s: string) => STATUS[s]?.[0] ?? s.replace(/_/g, " ");
const statusColor = (s: string) => STATUS[s]?.[1] ?? "#64748b";
const pctOf = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");
const breakWords = (m: number) => (!m ? "—" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim());
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The workflow for one sales CRM, over the report's period and filters. */
export function LeadWorkflowSection({ code, period, team, person }: { code: string; period: { from?: string; to?: string }; team: string; person: string }) {
  const q = useQuery({
    queryKey: ["portal-reports", "sales", code, "workflow", period, team, person],
    queryFn: async () => (await api.get(`/portal-reports/sales/${code}/workflow`, { params: { ...period, team: team || undefined, person: person || undefined } })).data.data as
      { available: true; data: LeadWorkflow } | { available: false; message: string },
    retry: 1,
  });
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-base font-semibold"><Workflow className="h-4 w-4 text-primary" /> Lead workflow</h3>
      {q.isLoading ? <Skeleton className="h-96 w-full" /> : q.isError || !q.data ? (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            {(q.error instanceof AxiosError && (q.error.response?.data as { message?: string } | undefined)?.message)
              || (q.error instanceof AxiosError && q.error.response?.status === 404 ? "Root's server is still on the previous version — this shows once it is updated." : "Could not load the lead workflow. Refresh in a moment.")}
          </CardContent>
        </Card>
      ) : !q.data.available ? (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">{q.data.message}</CardContent></Card>
      ) : (
        <LeadWorkflowBody data={q.data.data} />
      )}
    </section>
  );
}

/** The map and the charts for one answer — also what Root shows for this CRM. */
export function LeadWorkflowBody({ data, personName, onPerson }: { data: LeadWorkflow; personName?: string; onPerson?: (id: string) => void }) {
  const t = data.totals;
  const days = data.period.from === data.period.to ? dayLabel(data.period.from) : `${dayLabel(data.period.from)} – ${dayLabel(data.period.to)}`;
  return (
    <div className="space-y-4">
      <WorkflowMap totals={t} statuses={data.statuses} title={`${personName ? `${personName}'s leads` : "Leads"} that came in · ${days}`}
        note={`Inactive = no action from the owner within ${data.rule.limitMinutes} min of the moving hours (${data.rule.hours.start}–${data.rule.hours.end}), breaks not counted. ${t.moves} moves in all.`} />
      <div className="grid gap-4 lg:grid-cols-3">
        <TimelineCard data={data} />
        <StatusCard data={data} />
      </div>
      <TeamsCard data={data} />
      <PeopleCard data={data} onPerson={onPerson} />
      <MovesCard data={data} />
    </div>
  );
}

function Box({ n, label, of, tone, className }: { n: number; label: string; of?: number; tone: "base" | "good" | "bad" | "muted"; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className={cn("rounded-xl border px-3 py-2.5 text-center", className,
        tone === "good" && "border-emerald-500/30 bg-emerald-500/10",
        tone === "bad" && "border-rose-500/30 bg-rose-500/10",
        tone === "muted" && "border-border/60 bg-muted/40",
        tone === "base" && "border-border/60 bg-card")}>
      <p className={cn("text-xl font-bold tabular-nums", tone === "good" && "text-emerald-600 dark:text-emerald-400", tone === "bad" && "text-rose-600 dark:text-rose-400")}>{n.toLocaleString("en-US")}</p>
      <p className="text-xs text-muted-foreground">{label}{of !== undefined ? ` · ${pctOf(n, of)}` : ""}</p>
    </motion.div>
  );
}
const Down = () => <div className="mx-auto h-4 w-px bg-border" aria-hidden />;

/** Came in → assigned → worked / within the limit / went inactive → how the inactive ones ended → their statuses now. */
export function WorkflowMap({ totals: t, statuses, title, note }: { totals: WorkflowCounts; statuses: LeadWorkflow["statuses"]; title: string; note: string }) {
  const total = statuses.reduce((n, s) => n + s.count, 0);
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-0">
        <Box n={t.came} label="came in" tone="base" className="mx-auto max-w-[14rem]" />
        <Down />
        <div className="grid grid-cols-2 gap-3 sm:mx-auto sm:max-w-xl">
          <Box n={t.assigned} label="assigned" of={t.came} tone="base" />
          <Box n={t.unassigned} label="not assigned yet" of={t.came} tone="muted" />
        </div>
        <Down />
        <div className="grid grid-cols-3 gap-3 sm:mx-auto sm:max-w-3xl">
          <Box n={t.worked} label="worked by the owner" of={t.assigned} tone="good" />
          <Box n={t.fresh} label="within the limit" of={t.assigned} tone="muted" />
          <Box n={t.inactive} label="went inactive" of={t.assigned} tone="bad" />
        </div>
        <Down />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Box n={t.movedAuto} label="moved automatically" tone="bad" />
          <Box n={t.movedHand} label="moved by hand" tone="bad" />
          <Box n={t.onBreak} label="owner on a break" tone="bad" />
          <Box n={t.nobodyLeft} label="nobody left to take" tone="bad" />
          <Box n={t.waiting} label="still waiting" tone="bad" />
        </div>
        <Down />
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Where they stand now</p>
          {total === 0 ? <p className="text-xs text-muted-foreground">No leads came in.</p> : (
            <>
              <div className="flex h-7 w-full overflow-hidden rounded-lg">
                {statuses.map((s) => (
                  <div key={s.status} title={`${statusLabel(s.status)}: ${s.count}`} style={{ width: `${(s.count / total) * 100}%`, background: statusColor(s.status) }} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {statuses.map((s) => (
                  <span key={s.status} className="flex items-center gap-1.5 text-xs">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: statusColor(s.status) }} />
                    {statusLabel(s.status)} <span className="font-semibold tabular-nums">{s.count}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
        <p className="pt-3 text-xs text-muted-foreground">{note}</p>
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
          {payload.map((p) => <p key={String(p.dataKey)} style={{ color: p.color }}>{p.name}: {p.value}</p>)}
        </div>
      );
    }}
  />
);

function TimelineCard({ data }: { data: LeadWorkflow }) {
  const hour = data.timeline.unit === "hour";
  const rows = data.timeline.rows.map((r) => ({ ...r, label: hour ? `${r.key}:00` : dayLabel(r.key) }));
  const startH = Number(data.rule.hours.start.slice(0, 2)), endH = Number(data.rule.hours.end.slice(0, 2));
  return (
    <Card className="border-border/50 lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">When they came in{hour ? " — by hour (GST)" : " — by day"}</CardTitle>
        {hour && <p className="text-xs text-muted-foreground">Shaded: the moving hours, {data.rule.hours.start}–{data.rule.hours.end}.</p>}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} margin={{ left: -20, right: 4, top: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.4} />
            {hour && <ReferenceArea x1={`${String(startH).padStart(2, "0")}:00`} x2={`${String(Math.max(startH, endH - (data.rule.hours.end.endsWith(":00") ? 1 : 0))).padStart(2, "0")}:00`} fill="#6366f1" fillOpacity={0.08} />}
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={hour ? 2 : "preserveStartEnd"} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            {tooltip}
            <Bar dataKey="came" name="Came in" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function StatusCard({ data }: { data: LeadWorkflow }) {
  const pie = data.statuses.map((s) => ({ name: statusLabel(s.status), value: s.count, color: statusColor(s.status) }));
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Status now</CardTitle></CardHeader>
      <CardContent>
        {pie.length === 0 ? <p className="py-16 text-center text-xs text-muted-foreground">No leads came in.</p> : (
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
                <span key={s.name} className="flex items-center gap-1.5 truncate text-xs">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="truncate">{s.name}</span><span className="ml-auto font-semibold tabular-nums">{s.value}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TeamsCard({ data }: { data: LeadWorkflow }) {
  const rows = data.teams.map((t) => ({ name: t.name, worked: t.worked, fresh: t.fresh, inactive: t.inactive, unassigned: t.unassigned }));
  if (!rows.length) return null;
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">By team</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 40 + 40)}>
          <BarChart data={rows} layout="vertical" margin={{ left: 10, right: 10 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" strokeOpacity={0.4} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
            {tooltip}
            <Bar dataKey="worked" name="Worked" stackId="a" fill={STAGE.worked} maxBarSize={22} />
            <Bar dataKey="fresh" name="Within the limit" stackId="a" fill={STAGE.fresh} maxBarSize={22} />
            <Bar dataKey="inactive" name="Went inactive" stackId="a" fill={STAGE.inactive} maxBarSize={22} />
            <Bar dataKey="unassigned" name="Not assigned" stackId="a" fill={STAGE.unassigned} radius={[0, 4, 4, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
        <Legend items={[["Worked", STAGE.worked], ["Within the limit", STAGE.fresh], ["Went inactive", STAGE.inactive], ["Not assigned", STAGE.unassigned]]} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
              {["Team", "Came in", "Worked", "Within limit", "Went inactive", "Moved auto", "By hand", "On a break", "Nobody left", "Not assigned"].map((h, i) => <th key={h} className={cn("pb-2 pr-3 font-medium", i && "text-right")}>{h}</th>)}
            </tr></thead>
            <tbody>
              {data.teams.map((t) => (
                <tr key={t.id ?? "none"} className="border-b border-border/20 last:border-0">
                  <td className="py-2 pr-3 font-medium">{t.name}</td>
                  {[t.came, t.worked, t.fresh, t.inactive, t.movedAuto, t.movedHand, t.onBreak, t.nobodyLeft, t.unassigned].map((v, i) => (
                    <td key={i} className={cn("py-2 pr-3 text-right tabular-nums", !v && "text-muted-foreground/50", i === 3 && v > 0 && "text-rose-500")}>{v || "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function PeopleCard({ data, onPerson }: { data: LeadWorkflow; onPerson?: (id: string) => void }) {
  const rows = useMemo(() => data.people.map((p) => ({ name: p.name, worked: p.worked, fresh: p.fresh, inactive: p.inactiveNow, lost: p.lost })), [data.people]);
  if (!rows.length) return null;
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">By employee</CardTitle>
        <p className="text-xs text-muted-foreground">Everyone who held one of these leads — theirs now, or moved from or to them.{onPerson ? " Pick a name to see only their leads." : ""}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 32 + 40)}>
          <BarChart data={rows} layout="vertical" margin={{ left: 10, right: 10 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" strokeOpacity={0.4} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
            {tooltip}
            <Bar dataKey="worked" name="Worked" stackId="a" fill={STAGE.worked} maxBarSize={18} />
            <Bar dataKey="fresh" name="Within the limit" stackId="a" fill={STAGE.fresh} maxBarSize={18} />
            <Bar dataKey="inactive" name="Inactive with them now" stackId="a" fill={STAGE.inactive} maxBarSize={18} />
            <Bar dataKey="lost" name="Moved away from them" stackId="a" fill={STAGE.lost} radius={[0, 4, 4, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
        <Legend items={[["Worked", STAGE.worked], ["Within the limit", STAGE.fresh], ["Inactive with them now", STAGE.inactive], ["Moved away from them", STAGE.lost]]} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
              {["Employee", "Held", "Theirs now", "Worked", "Within limit", "Inactive now", "Moved away", "Got from moves", "On a break", "Status of theirs now"].map((h, i) => (
                <th key={h} className={cn("pb-2 pr-3 font-medium", i > 0 && i < 9 && "text-right")}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.id} className="border-b border-border/20 align-top last:border-0">
                  <td className="py-2 pr-3">
                    {onPerson ? <button type="button" onClick={() => onPerson(p.id)} className="text-left font-medium hover:text-primary hover:underline">{p.name}</button> : <span className="font-medium">{p.name}</span>}
                    <div className="text-xs text-muted-foreground">{p.team ?? "No team"}{p.active ? "" : " · deactivated"}</div>
                  </td>
                  {[p.held, p.now, p.worked, p.fresh, p.inactiveNow, p.lost, p.got].map((v, i) => (
                    <td key={i} className={cn("py-2 pr-3 text-right tabular-nums", !v && "text-muted-foreground/50", (i === 4 || i === 5) && v > 0 && "text-rose-500")}>{v || "—"}</td>
                  ))}
                  <td className="py-2 pr-3 text-right tabular-nums">{breakWords(p.breakMinutes)}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(p.statuses).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                        <span key={s} className="rounded-full border px-1.5 py-0.5 text-[11px]" style={{ borderColor: statusColor(s), color: statusColor(s) }}>{statusLabel(s)} {n}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function MovesCard({ data }: { data: LeadWorkflow }) {
  if (!data.movesMap.length) return null;
  const max = Math.max(...data.movesMap.map((m) => m.count));
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Who lost leads to whom</CardTitle></CardHeader>
      <CardContent className="space-y-1.5">
        {data.movesMap.map((m) => (
          <div key={`${m.from.id}-${m.to.id}`} className="flex items-center gap-3 text-sm">
            <span className="w-32 truncate text-right font-medium sm:w-40">{m.from.name}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="w-32 truncate font-medium sm:w-40">{m.to.name}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-rose-500/70" style={{ width: `${Math.max(4, (m.count / max) * 100)}%` }} />
            </span>
            <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{m.count} · {m.automatic} auto</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Legend({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}
        </span>
      ))}
    </div>
  );
}
