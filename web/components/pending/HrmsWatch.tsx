"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { AlertTriangle, Briefcase, CalendarClock, CalendarOff, ClipboardList, RefreshCw, ShoppingCart, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CseStatCard } from "@/components/cses/CseStatCard";
import { BreakdownDialog, Bars, type BarRow, type BreakdownTab } from "@/components/common/Breakdown";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { HrmsWatch } from "@/lib/types";

/**
 * Pending → HRMS (the user, 2026-10-17): leave and regularization pending with
 * the department on the breakdown, hiring requests, office keeping and
 * procurement waiting, and today's leaves — total cards like the CS portal tab,
 * each department's figures, and the list behind every number. HRMS answers
 * for itself (GET /service/hrms-watch). Read-only.
 */

type Kind = "leave" | "regularization" | "hiring" | "officeKeeping" | "procurement" | "onLeaveToday";
type Pick = { kind: Kind; department?: string } | null;
const KIND: Record<Kind, { label: string; href: string }> = {
  leave: { label: "Leave requests pending", href: "/leave" },
  regularization: { label: "Regularization pending", href: "/regularization" },
  hiring: { label: "Hiring requests pending", href: "/hiring" },
  officeKeeping: { label: "Office keeping pending", href: "/office-keeping" },
  procurement: { label: "Procurement pending", href: "/assets" },
  onLeaveToday: { label: "On leave today", href: "/leave" },
};
const STAGE: Record<string, { label: string; cls: string }> = {
  with_hr: { label: "With HR", cls: "text-amber-500" },
  with_finance: { label: "With finance", cls: "text-sky-500" },
  to_order: { label: "Approved — to order", cls: "text-violet-500" },
  ordered: { label: "Ordered — not received", cls: "text-muted-foreground" },
  requested: { label: "Requested", cls: "text-amber-500" },
  arriving: { label: "On the way", cls: "text-sky-500" },
};
const NO_DEPT = "No department";
const deptOf = (x: { department: string }) => x.department || NO_DEPT;

const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const day = (ymd: string) => {
  if (!ymd) return "—";
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

export function HrmsWatchView() {
  const [dept, setDept] = useState("all");
  const [pick, setPick] = useState<Pick>(null);
  const q = useQuery({
    queryKey: ["pending-hrms"],
    queryFn: async () => (await api.get("/pending/hrms")).data.data as HrmsWatch,
    refetchInterval: 60_000,
    retry: 1,
  });
  const data = q.data;
  /** Every list, narrowed to the department picked. */
  const items = useMemo(() => {
    const all = data?.items;
    if (!all) return null;
    const keep = <T extends { department: string }>(rows: T[]) => (dept === "all" ? rows : rows.filter((r) => deptOf(r) === dept));
    return {
      leave: keep(all.leave), regularization: keep(all.regularization), hiring: keep(all.hiring),
      officeKeeping: keep(all.officeKeeping), procurement: keep(all.procurement), onLeaveToday: keep(all.onLeaveToday),
    };
  }, [data, dept]);
  const departments = useMemo(() => {
    const all = data?.items;
    if (!all) return [];
    const names = new Set<string>();
    for (const list of Object.values(all)) for (const r of list as { department: string }[]) names.add(deptOf(r));
    return Array.from(names).sort((a, b) => (a === NO_DEPT ? 1 : b === NO_DEPT ? -1 : a.localeCompare(b)));
  }, [data]);

  if (q.error instanceof AxiosError && q.error.response?.status === 403) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">Pending is for root admins.</CardContent></Card>;
  }
  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}</div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (q.isError || !data || !items) {
    const message = q.error instanceof AxiosError ? (q.error.response?.data as { message?: string } | undefined)?.message : undefined;
    return (
      <Card className="border-rose-500/40 bg-rose-500/5">
        <CardContent className="flex gap-3 pt-6 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
          {q.error instanceof AxiosError && q.error.response?.status === 404 && !message
            ? "Root's server is still on the previous version — this tab shows once it is updated."
            : message || "Could not load HRMS. Refresh in a moment."}
        </CardContent>
      </Card>
    );
  }

  const n = (k: Kind) => items[k].length;
  const stageCount = (rows: { stage: string }[], ...stages: string[]) => rows.filter((r) => stages.includes(r.stage)).length;
  const deptRows = departments.map((d) => ({
    name: d,
    counts: Object.fromEntries((Object.keys(KIND) as Kind[]).map((k) => [k, (data.items[k] as { department: string }[]).filter((r) => deptOf(r) === d).length])) as Record<Kind, number>,
  })).filter((r) => dept === "all" || r.name === dept);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex max-w-full flex-wrap gap-1.5" role="group" aria-label="Department">
          <Button size="sm" variant={dept === "all" ? "default" : "outline"} onClick={() => setDept("all")}>Every department</Button>
          {departments.map((d) => (
            <Button key={d} size="sm" variant={dept === d ? "default" : "outline"} onClick={() => setDept(d)}>{d}</Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Updated {time(data.generatedAt)} · every minute</span>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={cn(q.isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <CseStatCard icon={CalendarClock} accent="amber" title="Leave requests pending" onClick={() => setPick({ kind: "leave" })} value={String(n("leave"))}
          hint={`${items.leave.reduce((s, r) => s + r.days, 0)} days asked for`} />
        <CseStatCard icon={ClipboardList} accent="violet" title="Regularization pending" onClick={() => setPick({ kind: "regularization" })} value={String(n("regularization"))}
          hint={`${items.regularization.filter((r) => r.escalated).length} past the allowance`} delay={0.05} />
        <CseStatCard icon={Briefcase} accent="blue" title="Hiring requests" onClick={() => setPick({ kind: "hiring" })} value={String(n("hiring"))}
          hint={`${stageCount(items.hiring, "with_hr")} with HR · ${stageCount(items.hiring, "with_finance")} with finance`} delay={0.1} />
        <CseStatCard icon={Wrench} accent="cyan" title="Office keeping" onClick={() => setPick({ kind: "officeKeeping" })} value={String(n("officeKeeping"))}
          hint={`${stageCount(items.officeKeeping, "requested")} new · ${stageCount(items.officeKeeping, "arriving")} on the way`} delay={0.15} />
        <CseStatCard icon={ShoppingCart} accent="rose" title="Procurement" onClick={() => setPick({ kind: "procurement" })} value={String(n("procurement"))}
          hint={`${stageCount(items.procurement, "with_hr", "with_finance")} awaiting a decision · ${stageCount(items.procurement, "to_order")} to order`} delay={0.2} />
        <CseStatCard icon={CalendarOff} accent="emerald" title="On leave today" onClick={() => setPick({ kind: "onLeaveToday" })} value={String(n("onLeaveToday"))}
          hint={day(data.today)} delay={0.25} />
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">By department · {deptRows.length}</CardTitle></CardHeader>
        <CardContent>
          {deptRows.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Nothing waiting.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Department</th>
                    <th className="pb-2 pr-3 text-right font-medium">Leave</th>
                    <th className="pb-2 pr-3 text-right font-medium">Regularization</th>
                    <th className="pb-2 pr-3 text-right font-medium">Hiring</th>
                    <th className="pb-2 pr-3 text-right font-medium">Office keeping</th>
                    <th className="pb-2 pr-3 text-right font-medium">Procurement</th>
                    <th className="border-l border-border/40 pb-2 pl-3 text-right font-medium">On leave today</th>
                  </tr>
                </thead>
                <tbody>
                  {deptRows.map((r) => (
                    <tr key={r.name} className="border-b border-border/20 last:border-0">
                      <td className="py-2.5 pr-3 font-medium">{r.name}</td>
                      {(["leave", "regularization", "hiring", "officeKeeping", "procurement", "onLeaveToday"] as Kind[]).map((k) => (
                        <td key={k} className={cn("py-2.5 pr-3 text-right tabular-nums", k === "onLeaveToday" && "border-l border-border/40 pl-3")}>
                          {r.counts[k] ? (
                            <button type="button" onClick={() => setPick({ kind: k, department: r.name })} className="rounded px-1 font-medium hover:bg-muted/60 hover:underline">{r.counts[k]}</button>
                          ) : <span className="text-muted-foreground/60">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            A person&apos;s department is their employee record&apos;s; hiring and procurement requests carry their own. Every number opens the requests behind it.
          </p>
        </CardContent>
      </Card>

      {pick && <ItemsDialog data={data} items={items} pick={pick} onClose={() => setPick(null)} />}
    </div>
  );
}

function ItemsDialog({ data, items, pick, onClose }: { data: HrmsWatch; items: HrmsWatch["items"]; pick: NonNullable<Pick>; onClose: () => void }) {
  const inDept = <T extends { department: string }>(rows: T[]) => (pick.department ? rows.filter((r) => deptOf(r) === pick.department) : rows);
  const link = (label: ReactNode) => (data.appUrl
    ? <a href={`${data.appUrl}${KIND[pick.kind].href}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">{label}</a>
    : <span className="font-medium">{label}</span>);
  const personCell = (x: { person: string; code?: string; department: string }) => (
    <div className="min-w-0"><div className="font-medium">{x.person}</div><div className="text-xs text-muted-foreground">{[x.code, deptOf(x)].filter(Boolean).join(" · ")}</div></div>
  );
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
  const stageCell = (s: string) => <span className={STAGE[s]?.cls}>{STAGE[s]?.label ?? s}</span>;
  const tabs: BreakdownTab[] = [];
  let about = "", count = 0;
  const extra = <T extends { department: string; person: string }>(rows: T[]) => {
    if (!pick.department) tabs.push({ key: "dept", label: "By department", content: <Bars rows={bars(rows, deptOf)} empty="Nobody." /> });
    tabs.push({ key: "person", label: "By person", content: <Bars rows={bars(rows, (r) => r.person)} empty="Nobody." /> });
  };
  const stageTabs = <T extends { stage: string }>(rows: T[], render: (xs: T[]) => ReactNode) => {
    for (const s of Array.from(new Set(rows.map((r) => r.stage)))) {
      const xs = rows.filter((r) => r.stage === s);
      tabs.push({ key: s, label: `${STAGE[s]?.label ?? s} · ${xs.length}`, content: render(xs) });
    }
  };

  if (pick.kind === "leave") {
    const rows = inDept(items.leave);
    count = rows.length;
    about = "Leave requests waiting for a decision, oldest first, with the requester's department.";
    tabs.push({ key: "list", label: `Requests · ${rows.length}`, content: table(["Who", "Leave", "Dates", "Asked"], rows.map((x) => ({
      key: x.id,
      cells: [personCell(x), <div key="l">{link(`${x.type} — ${x.days}${x.halfDay ? " (half)" : ""} day${x.days === 1 ? "" : "s"}`)}{x.reason ? <div className="text-xs text-muted-foreground">{x.reason}</div> : null}</div>,
        <span key="d" className="whitespace-nowrap">{day(x.from)}{x.to !== x.from ? ` → ${day(x.to)}` : ""}</span>, <span key="a" className="whitespace-nowrap">{ago(x.raisedAt)} ago</span>],
    }))) });
    extra(rows);
  } else if (pick.kind === "regularization") {
    const rows = inDept(items.regularization);
    count = rows.length;
    about = "Attendance corrections waiting for a decision, oldest first. Past the month's allowance they wait on the reporting manager.";
    tabs.push({ key: "list", label: `Requests · ${rows.length}`, content: table(["Who", "Correction", "Day", "Asked"], rows.map((x) => ({
      key: x.id,
      cells: [personCell(x), <div key="c">{link(`${x.type} → ${x.becomes}`)}{x.reason ? <div className="text-xs text-muted-foreground">{x.reason}</div> : null}
        {x.escalated ? <div className="text-xs text-amber-500">Past the allowance — reporting manager</div> : null}</div>,
        <span key="d" className="whitespace-nowrap">{day(x.date)}</span>, <span key="a" className="whitespace-nowrap">{ago(x.raisedAt)} ago</span>],
    }))) });
    extra(rows);
  } else if (pick.kind === "hiring") {
    const rows = inDept(items.hiring);
    count = rows.length;
    about = "Job requisitions waiting — with HR, or approved by HR and waiting on finance.";
    const list = (xs: typeof rows) => table(["Role", "Department", "Raised by", "Stage", "Waiting"], xs.map((x) => ({
      key: x.id,
      cells: [<div key="r">{link(x.title)}<div className="text-xs text-muted-foreground">{x.type} · {x.headcount} {x.headcount === 1 ? "person" : "people"}</div></div>,
        deptOf(x), x.person, stageCell(x.stage), <span key="a" className="whitespace-nowrap">{ago(x.raisedAt)}</span>],
    })));
    tabs.push({ key: "list", label: `All · ${rows.length}`, content: list(rows) });
    stageTabs(rows, list);
    extra(rows);
  } else if (pick.kind === "officeKeeping") {
    const rows = inDept(items.officeKeeping);
    count = rows.length;
    about = "Office keeping requests not sorted yet — new, or someone is on the way.";
    const list = (xs: typeof rows) => table(["What", "Where", "Raised by", "Stage", "Waiting"], xs.map((x) => ({
      key: x.id,
      cells: [link(x.issue), x.location, personCell(x), <div key="s">{stageCell(x.stage)}{x.handledBy ? <div className="text-xs text-muted-foreground">{x.handledBy}</div> : null}</div>,
        <span key="a" className="whitespace-nowrap">{ago(x.raisedAt)}</span>],
    })));
    tabs.push({ key: "list", label: `All · ${rows.length}`, content: list(rows) });
    stageTabs(rows, list);
    extra(rows);
  } else if (pick.kind === "procurement") {
    const rows = inDept(items.procurement);
    count = rows.length;
    about = "Purchase requests not finished — with HR, with finance, approved and to be ordered, or ordered and not received.";
    const list = (xs: typeof rows) => table(["Item", "Department", "Raised by", "Estimate", "Stage", "Waiting"], xs.map((x) => ({
      key: x.id,
      cells: [<div key="i">{link(`${x.item}${x.quantity > 1 ? ` × ${x.quantity}` : ""}`)}<div className="text-xs text-muted-foreground">{[x.category, x.vendor, x.neededBy ? `needed by ${day(x.neededBy)}` : ""].filter(Boolean).join(" · ")}</div></div>,
        deptOf(x), x.person, <span key="e" className="whitespace-nowrap tabular-nums">{x.currency} {x.estimatedCost.toLocaleString("en-US")}</span>,
        stageCell(x.stage), <span key="a" className="whitespace-nowrap">{ago(x.raisedAt)}</span>],
    })));
    tabs.push({ key: "list", label: `All · ${rows.length}`, content: list(rows) });
    stageTabs(rows, list);
    extra(rows);
  } else {
    const rows = inDept(items.onLeaveToday);
    count = rows.length;
    about = `Approved leave covering today, ${day(data.today)} (Gulf time), by department.`;
    tabs.push({ key: "list", label: `People · ${rows.length}`, content: table(["Who", "Leave", "Dates"], rows.map((x) => ({
      key: x.id,
      cells: [personCell(x), `${x.type}${x.halfDay ? " (half day)" : ""}`, <span key="d" className="whitespace-nowrap">{day(x.from)}{x.to !== x.from ? ` → ${day(x.to)}` : ""} · {x.days} day{x.days === 1 ? "" : "s"}</span>],
    }))) });
    if (!pick.department) tabs.push({ key: "dept", label: "By department", content: <Bars rows={bars(rows, deptOf)} empty="Nobody." /> });
  }

  return <BreakdownDialog open onClose={onClose} description={about} tabs={tabs}
    title={`${pick.department ? `${pick.department} · ` : ""}${KIND[pick.kind].label} · ${count}`} />;
}
