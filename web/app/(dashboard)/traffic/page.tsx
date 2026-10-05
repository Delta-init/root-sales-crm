"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AlertTriangle, Loader2, PauseCircle, PlayCircle, RotateCcw, Settings2, Shuffle } from "lucide-react";
import { AxiosError } from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { gulfToday } from "@/components/tracker/DayPicker";
import { SplitDialog } from "@/components/traffic/SplitDialog";
import { api, apiErrorMessage } from "@/lib/axios";
import { useAuth } from "@/providers/AuthProvider";
import { cn } from "@/lib/utils";
import type { TrafficLeadPage, TrafficLeadRow, TrafficOrg, TrafficRules, TrafficSheetKey, TrafficSummary } from "@/lib/types";

/** The days the page looks at, in Gulf time: the last few, this month so far, or any two dates. */
const RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];
const LAST_DAYS: Partial<Record<RangeKey, number>> = { today: 0, "7d": 6, "30d": 29 };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "waiting", label: "Waiting" },
  { key: "failed", label: "Failed" },
  { key: "sent", label: "Sent" },
  { key: "duplicate", label: "Duplicates" },
  { key: "invalid", label: "Invalid" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const shiftDay = (date: string, days: number) =>
  new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));

const statusTone = (s: TrafficLeadRow["status"]): "success" | "warning" | "destructive" | "secondary" | "outline" => {
  if (s === "sent") return "success";
  if (s === "duplicate") return "secondary";
  if (s === "invalid" || s === "failed") return "destructive";
  if (s === "held") return "warning";
  return "outline";
};

const forbidden = (e: unknown) => e instanceof AxiosError && e.response?.status === 403;

/** A colour per team, in the order the split lists them. */
const TEAM_COLOURS = ["bg-primary", "bg-violet-500", "bg-amber-500", "bg-emerald-500", "bg-sky-500", "bg-rose-500"];

/** The sheet last looked at, so whoever looks after one sheet lands on it. */
const SHEET_STORE = "root.traffic.sheet";

/**
 * Lead traffic.
 *
 * Where each lead sheet's leads went, a sheet at a time: how each segment was
 * split between its teams against the target, and every lead with what became
 * of it. The split itself is changed from here, and a lead a CRM could not
 * take can be sent again by hand — the worker would get to it anyway, this
 * just does not make anybody wait for it.
 */
export default function TrafficPage() {
  const qc = useQueryClient();
  const { admin } = useAuth();
  // Looking is enough to be here; changing the split and sending by hand is more.
  const canManage = admin?.role === "root_admin" || admin?.trafficAccess === "manage";
  const [sheet, setSheet] = useState<TrafficSheetKey>("abhin");
  const [range, setRange] = useState<RangeKey>("today");
  // The two dates of Custom, filled from whatever was on show when it is picked.
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [filter, setFilter] = useState<FilterKey>("all");
  const [org, setOrg] = useState<"all" | TrafficOrg>("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(false);

  // Read after the first render, so the server's and the browser's first render agree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SHEET_STORE);
      if (saved === "abhin" || saved === "shoaib") setSheet(saved);
    } catch {
      /* private window or blocked storage: start on the first sheet */
    }
  }, []);
  const chooseSheet = (key: TrafficSheetKey) => {
    setSheet(key);
    setPage(1);
    try {
      window.localStorage.setItem(SHEET_STORE, key);
    } catch {
      /* not remembered, and nothing else lost */
    }
  };

  const today = gulfToday();
  const { from, to } =
    range === "custom" && custom.from && custom.to
      ? custom
      : range === "month"
        ? { from: `${today.slice(0, 8)}01`, to: today }
        : { from: shiftDay(today, -(LAST_DAYS[range] ?? 0)), to: today };
  // The leads below keep to the same days, from their first page.
  const chooseRange = (key: RangeKey) => {
    if (key === "custom") setCustom({ from, to });
    setRange(key);
    setPage(1);
  };
  // A From after To moves To along with it, and the other way round.
  const setCustomDay = (side: "from" | "to", day: string) => {
    if (!day) return;
    setCustom((c) => (side === "from" ? { from: day, to: day > c.to ? day : c.to } : { from: day < c.from ? day : c.from, to: day }));
    setPage(1);
  };

  const rules = useQuery({
    queryKey: ["traffic-rules"],
    queryFn: async () => (await api.get("/traffic/rules")).data.data as TrafficRules,
  });
  const summary = useQuery({
    queryKey: ["traffic-summary", sheet, from, to],
    queryFn: async () =>
      (await api.get(`/traffic/summary?sheet=${sheet}&from=${from}&to=${to}`)).data.data as TrafficSummary,
    refetchInterval: 30_000,
  });
  const leads = useQuery({
    queryKey: ["traffic-leads", sheet, filter, org, from, to, page],
    queryFn: async () =>
      (await api.get(`/traffic/leads?sheet=${sheet}&filter=${filter}&org=${org}&from=${from}&to=${to}&page=${page}&limit=25`))
        .data.data as TrafficLeadPage,
    refetchInterval: 30_000,
  });

  const retry = useMutation({
    mutationFn: async (id: string) => (await api.post(`/traffic/leads/${id}/retry`)).data,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["traffic-leads"] });
      qc.invalidateQueries({ queryKey: ["traffic-summary"] });
      if (res?.data?.status === "sent") toast.success("Sent");
      else toast.warning(res?.message ?? "Tried again");
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not send it")),
  });

  if (forbidden(rules.error) || forbidden(summary.error)) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          You do not have access to lead traffic. A root admin can give it to you from your page under Users.
        </CardContent>
      </Card>
    );
  }

  // Straight after a release the page can be ahead of the portal's server for a
  // few minutes; its older answers have no sheets in them.
  if (rules.data && !Array.isArray(rules.data.sheets)) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          The portal&apos;s server is still on the previous version of lead traffic. Once it is updated, this page
          shows each lead sheet — refresh in a few minutes.
        </CardContent>
      </Card>
    );
  }

  const current = rules.data?.sheets.find((s) => s.key === sheet);
  const setup = [
    ...(rules.data && !rules.data.sheetKeySet ? ["The sheets have no key to post with — set LEAD_TRAFFIC_SHEET_KEY on the portal's server."] : []),
    // Only the CRMs this sheet sends to: another CRM not being set up yet is
    // not this sheet's problem.
    ...(rules.data?.crms ?? []).filter((c) => current?.uses.includes(c.code)).flatMap((c) => [
      ...(c.active ? [] : [`${c.name} is not active in the registry.`]),
      ...(c.missing.length ? [`${c.name} cannot be sent leads yet — set ${c.missing.join(" and ")}.`] : []),
    ]),
  ];

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-wrap items-start justify-between gap-4"
      >
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Shuffle className="h-6 w-6 text-primary" /> Lead traffic
          </h2>
          <p className="mt-1 text-muted-foreground">
            Leads from the lead sheets, split between teams in the Delta and Draw CRMs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {current && (
            <Badge variant={current.paused ? "warning" : "success"} className="gap-1 py-1">
              {current.paused ? <PauseCircle className="h-3.5 w-3.5" /> : <PlayCircle className="h-3.5 w-3.5" />}
              {current.paused ? "Paused" : "Routing"}
            </Badge>
          )}
          {canManage && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={!current}>
              <Settings2 /> Edit split
            </Button>
          )}
        </div>
      </motion.div>

      {/* Which sheet */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Lead sheet">
          {(rules.data?.sheets ?? []).map((s) => (
            <Button
              key={s.key}
              role="tab"
              aria-selected={sheet === s.key}
              size="sm"
              variant={sheet === s.key ? "default" : "outline"}
              onClick={() => chooseSheet(s.key)}
            >
              {s.name}
              {s.paused && <PauseCircle className="text-amber-500" aria-label="paused" />}
            </Button>
          ))}
          {rules.isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-9 w-40" />)}
        </div>
        {current && <p className="text-sm text-muted-foreground">{current.about}</p>}
      </div>

      {setup.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium">Not everything is set up</p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {setup.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <Button key={r.key} size="sm" variant={range === r.key ? "default" : "outline"} onClick={() => chooseRange(r.key)}>
            {r.label}
          </Button>
        ))}
        {range === "custom" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="date"
              value={from}
              max={today}
              onChange={(e) => setCustomDay("from", e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
              aria-label="From"
            />
            <span className="text-muted-foreground">to</span>
            <input
              type="date"
              value={to}
              max={today}
              onChange={(e) => setCustomDay("to", e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
              aria-label="To"
            />
          </div>
        )}
        <span className="text-xs text-muted-foreground">
          {from === to ? from : `${from} → ${to}`} · Gulf time
        </span>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["Received", summary.data?.totals.received, ""],
            ["Sent", summary.data?.totals.sent, "text-emerald-500"],
            ["Duplicates", summary.data?.totals.duplicates, ""],
            ["Waiting", summary.data?.totals.waiting, "text-amber-500"],
            ["Failed", summary.data?.totals.failed, "text-rose-500"],
            ["Invalid", summary.data?.totals.invalid, ""],
          ] as const
        ).map(([label, value, tone]) => (
          <Card key={label}>
            <CardContent className="pt-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
              {summary.isLoading ? (
                <Skeleton className="mt-2 h-7 w-12" />
              ) : (
                <p className={cn("mt-1 text-2xl font-bold", value ? tone : "")}>{value ?? 0}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* The split, per segment */}
      <div className={cn("grid gap-4", (current?.segments.length ?? 3) > 1 ? "md:grid-cols-2 xl:grid-cols-3" : "max-w-3xl")}>
        {(summary.data?.sheet === sheet ? summary.data.segments : []).map((seg) => (
          <Card key={seg.key}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-baseline justify-between gap-2 text-base">
                <span>{seg.label}</span>
                <span className="text-sm font-normal text-muted-foreground">
                  {seg.split} split · {seg.received} received
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {seg.shares.map((s, i) => {
                const off = !s.removed && s.actual !== null && Math.abs(s.actual - s.target) > 10;
                return (
                  <div key={s.key} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="min-w-0">
                        <span className="block font-medium">{s.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {s.crm}
                          {s.assignTo && <> → {s.assignTo.name || "one person"}</>}
                          {s.removed && " · no longer in the split"}
                        </span>
                      </span>
                      <span className="shrink-0">
                        <span className={cn("font-semibold", off && "text-amber-500")}>
                          {s.split} {s.actual === null ? "" : `(${s.actual}%)`}
                        </span>
                        {!s.removed && <span className="ml-1 text-xs text-muted-foreground">target {s.target}%</span>}
                      </span>
                    </div>
                    <div className="relative h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", TEAM_COLOURS[i % TEAM_COLOURS.length])}
                        style={{ width: `${s.actual ?? 0}%` }}
                      />
                      {/* Where the target is, so a drift is visible without reading numbers. */}
                      <div className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: `${s.target}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {s.sent} sent · {s.duplicates} duplicates
                      {s.waiting ? <span className="text-amber-500"> · {s.waiting} waiting</span> : null}
                      {s.failed ? <span className="text-rose-500"> · {s.failed} failed</span> : null}
                      {s.invalid ? ` · ${s.invalid} turned down` : null}
                    </p>
                  </div>
                );
              })}
              {seg.known.some((k) => k.count > 0) && (
                <p className="text-xs text-muted-foreground">
                  Already in a CRM, sent back there outside the split:{" "}
                  {seg.known.filter((k) => k.count > 0).map((k) => `${k.name} ${k.count}`).join(" · ")}
                </p>
              )}
              {seg.invalid > 0 && (
                <p className="text-xs text-muted-foreground">{seg.invalid} row(s) could not be sent anywhere — see Invalid below.</p>
              )}
            </CardContent>
          </Card>
        ))}
        {summary.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-44 w-full" />)}
      </div>

      {/* Every lead */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
          <CardTitle className="text-base">Leads</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <Button
                  key={f.key}
                  size="sm"
                  variant={filter === f.key ? "secondary" : "ghost"}
                  onClick={() => { setFilter(f.key); setPage(1); }}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <select
              value={org}
              onChange={(e) => { setOrg(e.target.value as typeof org); setPage(1); }}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
              aria-label="CRM"
            >
              <option value="all">All CRMs</option>
              {(rules.data?.crms ?? []).map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {leads.isLoading ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : !leads.data?.items.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No leads here for these dates.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 text-left text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Received</th>
                    <th className="pb-2 pr-3 font-medium">Lead</th>
                    <th className="pb-2 pr-3 font-medium">From</th>
                    <th className="pb-2 pr-3 font-medium">Went to</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {leads.data.items.map((l) => (
                    <tr key={l.id} className="border-b border-border/20 align-top">
                      <td className="whitespace-nowrap py-2.5 pr-3 text-muted-foreground">{when(l.receivedAt)}</td>
                      <td className="py-2.5 pr-3">
                        <div className="font-medium">{l.name || "—"}</div>
                        <div className="font-mono text-xs text-muted-foreground">{l.phone}</div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div>{l.segmentLabel}</div>
                        <div className="max-w-56 truncate text-xs text-muted-foreground" title={l.tab}>{l.tab}</div>
                      </td>
                      <td className="py-2.5 pr-3">
                        {l.destination ? (
                          <>
                            <div className="capitalize">{l.destination}{l.assignTo ? <span className="text-muted-foreground"> → {l.assignTo}</span> : null}</div>
                            <div className="text-xs text-muted-foreground">
                              {l.reason === "known" ? "already there" : l.team ? `${l.team}, by the split` : "by the split"}
                            </div>
                          </>
                        ) : "—"}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge variant={statusTone(l.status)}>{l.label}</Badge>
                        {(l.lastError || (l.note && l.status !== "invalid")) && (
                          <p className="mt-1 max-w-72 text-xs text-muted-foreground">
                            {l.lastError || l.note}
                            {l.nextAttemptAt && ["retrying"].includes(l.status) ? ` · next try ${when(l.nextAttemptAt)}` : ""}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        {canManage && l.canRetry && (
                          <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(l.id)}>
                            {retry.isPending && retry.variables === l.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                            Send now
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {leads.data && leads.data.total > leads.data.limit && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {(page - 1) * leads.data.limit + 1}–{Math.min(page * leads.data.limit, leads.data.total)} of {leads.data.total}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page * leads.data.limit >= leads.data.total} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {current && (
        <p className="text-xs text-muted-foreground">
          Source each CRM records: {current.segments.map((s) => `${s.label} — ${s.source}`).join("; ")}.
        </p>
      )}

      {canManage && rules.data && current && (
        <SplitDialog open={editing} onOpenChange={setEditing} sheet={current} crms={rules.data.crms} />
      )}
    </div>
  );
}
