"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AxiosError } from "axios";
import {
  AlertTriangle, ArrowDown, ArrowUp, Clock, Download, Loader2, Pause, Phone, PhoneIncoming, PhoneMissed,
  PhoneOff, PhoneOutgoing, Play, RefreshCw, Search, Timer, Users2, X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import { CALL_PERIODS, callLength, periodDays, talkTime, type CallPeriod } from "@/lib/calls";
import type { CallRow, CallsOverview, PortalCallsSummary } from "@/lib/types";

/**
 * 3CX calls (the user, 2026-10-14): every call in every portal that has one —
 * the Sales CRM, Draw and Tetra Commission sync theirs from 3CX; Banglore's
 * come from a phone call-recorder app — with the totals, everybody's figures
 * (one person's put together across portals by email), and each call with its
 * recording, played from the portal that has it on a link it signs for 10
 * minutes. Dubai days. Root admins only.
 */

const forbidden = (e: unknown) => e instanceof AxiosError && e.response?.status === 403;
const PAGE = 50;

const DIRECTIONS = [
  { key: "all", label: "In and out" },
  { key: "out", label: "Outgoing" },
  { key: "in", label: "Incoming" },
] as const;
const RESULTS = [
  { key: "all", label: "Every result" },
  { key: "connected", label: "Connected" },
  { key: "missed", label: "Missed" },
  { key: "not_answered", label: "Not answered" },
] as const;

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";

export default function CallsPage() {
  const [period, setPeriod] = useState<CallPeriod>("7d");
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [portal, setPortal] = useState("all");
  const [person, setPerson] = useState<{ value: string; name: string } | null>(null);
  const [direction, setDirection] = useState("all");
  const [result, setResult] = useState("all");
  const [search, setSearch] = useState("");
  const [typed, setTyped] = useState("");
  const [sort, setSort] = useState<"date" | "talk">("date");
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);

  // Opened from a portal's card on Pending: that portal.
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get("portal");
      if (p) setPortal(p);
    } catch { /* no URL to read */ }
  }, []);
  // Search as you type, a moment after the typing stops.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(typed.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [typed]);

  const days = useMemo(() => periodDays(period, custom), [period, custom]);
  const params = {
    ...days, portal, direction, result, sort, order, page: String(page), limit: String(PAGE),
    ...(person ? { person: person.value } : {}), ...(search ? { search } : {}),
  };
  const q = useQuery({
    queryKey: ["calls", params],
    queryFn: async () => (await api.get("/calls", { params })).data.data as CallsOverview,
    placeholderData: keepPreviousData,
    refetchInterval: 2 * 60_000,
  });
  const data = q.data;
  const reset = () => setPage(1);
  // Every portal with calls, remembered from when all of them were in view.
  const [known, setKnown] = useState<PortalCallsSummary[]>([]);
  useEffect(() => { if (data && portal === "all") setKnown(data.portals); }, [data, portal]);
  const tabs = known.length ? known : data?.portals ?? [];

  if (forbidden(q.error)) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">3CX calls is for root admins.</CardContent></Card>;
  }

  const stats = data?.stats;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Phone className="h-6 w-6 text-primary" /> 3CX calls
          </h2>
          <p className="mt-1 max-w-3xl text-muted-foreground">
            Every call in every portal — who took it, how long, and the recording. The Sales CRM, Draw and Tetra Commission from 3CX; Banglore from its call recorder.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton params={params} />
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={cn(q.isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>
      </motion.div>

      {/* Period */}
      <div className="flex flex-wrap items-center gap-2">
        {CALL_PERIODS.map((p) => (
          <Button key={p.key} size="sm" variant={period === p.key ? "default" : "outline"} onClick={() => { setPeriod(p.key); reset(); }}>{p.label}</Button>
        ))}
        <Button size="sm" variant={period === "custom" ? "default" : "outline"} onClick={() => { setPeriod("custom"); setCustom({ from: days.from, to: days.to }); reset(); }}>Custom</Button>
        {period === "custom" && (
          <span className="flex items-center gap-1.5">
            <Input type="date" className="h-9 w-40" value={custom.from ?? ""} max={custom.to} onChange={(e) => { setCustom((c) => ({ ...c, from: e.target.value })); reset(); }} aria-label="From" />
            <span className="text-muted-foreground">→</span>
            <Input type="date" className="h-9 w-40" value={custom.to ?? ""} min={custom.from} onChange={(e) => { setCustom((c) => ({ ...c, to: e.target.value })); reset(); }} aria-label="To" />
          </span>
        )}
        <span className="text-xs text-muted-foreground">{days.from === days.to ? days.from : `${days.from} → ${days.to}`} (Dubai)</span>
      </div>

      {/* Portals: every one stays a tab; its count shows while it is in view. */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Portal">
        <PortalTab active={portal === "all"} onClick={() => { setPortal("all"); setPerson(null); reset(); }} label="All portals"
          count={data && portal === "all" ? data.stats.calls : undefined} />
        {tabs.map((p) => {
          const now = data?.portals.find((x) => x.code === p.code);
          return (
            <PortalTab key={p.code} active={portal === p.code} accent={p.accent} onClick={() => { setPortal(p.code); setPerson(null); reset(); }}
              label={p.name} count={now?.available ? now.stats.calls : undefined} warn={now ? !now.available : false} />
          );
        })}
      </div>

      {data?.portals.filter((p) => !p.available).map((p) => (
        <div key={p.code} className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span className="text-muted-foreground"><span className="font-medium text-foreground">{p.name}</span> could not be read — {p.error}</span>
        </div>
      ))}

      {/* Totals */}
      {q.isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : q.isError || !stats ? (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            {q.error instanceof AxiosError && q.error.response?.status === 404
              ? "Root's server is still on the previous version, so it cannot answer this page yet. It works once the server is updated."
              : "Could not load the calls. Refresh in a moment."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
          <Stat icon={Phone} label="All calls" value={stats.calls} />
          <Stat icon={PhoneOutgoing} label="Outgoing" value={stats.outgoing} />
          <Stat icon={PhoneIncoming} label="Incoming" value={stats.incoming} />
          <Stat icon={Phone} label="Connected" value={stats.connected} tone="text-emerald-500" />
          <Stat icon={PhoneMissed} label="Missed" value={stats.missed} tone="text-rose-500" hint="They called, nobody answered" />
          <Stat icon={PhoneOff} label="Not answered" value={stats.notAnswered} tone="text-amber-500" hint="We called, they didn't pick up" />
          <Stat icon={Timer} label="Talk time" value={talkTime(stats.talkSeconds)} />
          <Stat icon={Clock} label="Average connected call" value={stats.avgTalkSeconds ? callLength(stats.avgTalkSeconds) : "—"} />
        </div>
      )}

      {/* People */}
      {data && data.people.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Users2 className="h-4 w-4" /> By person · {data.people.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Person</th>
                    <th className="pb-2 pr-3 font-medium">Portal (pick to see their calls)</th>
                    <th className="pb-2 pr-3 text-right font-medium">Calls</th>
                    <th className="pb-2 pr-3 text-right font-medium">Out / In</th>
                    <th className="pb-2 pr-3 text-right font-medium">Connected</th>
                    <th className="pb-2 pr-3 text-right font-medium">Missed</th>
                    <th className="pb-2 pr-3 text-right font-medium">Not answered</th>
                    <th className="pb-2 pr-3 text-right font-medium">Talk time</th>
                    <th className="pb-2 text-right font-medium">Average</th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((p) => (
                    <tr key={p.key} className="border-b border-border/20 last:border-0">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{p.name}</div>
                        {p.email && <div className="text-xs text-muted-foreground">{p.email}</div>}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {p.portals.map((at) => {
                            const value = `${at.code}|${at.person}`;
                            const on = person?.value === value;
                            return (
                              <button key={value} type="button" onClick={() => { setPerson(on ? null : { value, name: `${p.name} · ${at.name}` }); reset(); }}
                                className={cn("rounded-md border px-1.5 py-0.5 text-xs transition-colors", on ? "border-primary bg-primary/10 text-primary" : "border-border/60 hover:bg-muted/50")}>
                                {at.name} · {at.calls}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums">{p.calls}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{p.outgoing} / {p.incoming}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-emerald-500">{p.connected}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{p.missed || <span className="text-muted-foreground/60">—</span>}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{p.notAnswered || <span className="text-muted-foreground/60">—</span>}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{talkTime(p.talkSeconds)}</td>
                      <td className="py-2 text-right tabular-nums">{p.avgTalkSeconds ? callLength(p.avgTalkSeconds) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Calls */}
      <Card>
        <CardHeader className="space-y-3 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Lead, student or number" className="pl-8" aria-label="Search calls" />
            </div>
            <select className={selectClass} value={direction} onChange={(e) => { setDirection(e.target.value); reset(); }} aria-label="Direction">
              {DIRECTIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <select className={selectClass} value={result} onChange={(e) => { setResult(e.target.value); reset(); }} aria-label="Result">
              {RESULTS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            <select className={selectClass} value={sort} onChange={(e) => { setSort(e.target.value as "date" | "talk"); reset(); }} aria-label="Sort">
              <option value="date">Sort: time</option>
              <option value="talk">Sort: talk time</option>
            </select>
            <Button variant="outline" size="sm" onClick={() => { setOrder((o) => (o === "desc" ? "asc" : "desc")); reset(); }}>
              {order === "desc" ? <ArrowDown /> : <ArrowUp />} {order === "desc" ? (sort === "date" ? "Newest" : "Longest") : sort === "date" ? "Oldest" : "Shortest"}
            </Button>
            {person && (
              <Badge variant="outline" className="gap-1 py-1">
                {person.name}
                <button type="button" onClick={() => { setPerson(null); reset(); }} aria-label="Show everyone"><X className="h-3 w-3" /></button>
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!data ? (
            <Skeleton className="h-64 w-full" />
          ) : data.calls.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No calls in this period{search || direction !== "all" || result !== "all" || person ? " that match" : ""}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">When</th>
                    <th className="pb-2 pr-3 font-medium">Portal</th>
                    <th className="pb-2 pr-3 font-medium">Who took it</th>
                    <th className="pb-2 pr-3 font-medium">With</th>
                    <th className="pb-2 pr-3 font-medium">Number</th>
                    <th className="pb-2 pr-3 font-medium">Call</th>
                    <th className="pb-2 pr-3 text-right font-medium">Talk</th>
                    <th className="pb-2 font-medium">Recording</th>
                  </tr>
                </thead>
                <tbody>
                  {data.calls.map((c) => <CallLine key={`${c.portal}:${c.id}`} call={c} />)}
                </tbody>
              </table>
            </div>
          )}
          {data && data.total > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {data.total.toLocaleString()} call{data.total === 1 ? "" : "s"} · page {data.page} of {pages}
                {data.capped && " · only the first 1,000 can be paged through — narrow the dates or filters"}
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page >= pages || data.capped} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PortalTab({ active, onClick, label, count, accent, warn }: { active: boolean; onClick: () => void; label: string; count?: number; accent?: string; warn?: boolean }) {
  return (
    <Button role="tab" aria-selected={active} size="sm" variant={active ? "default" : "outline"} onClick={onClick} className="gap-2">
      {accent && <span className="h-2 w-2 rounded-full" style={{ background: accent }} />}
      {label}
      {warn ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> : count !== undefined ? <span className="rounded-full bg-background/30 px-1.5 text-xs tabular-nums">{count}</span> : null}
    </Button>
  );
}

function Stat({ icon: Icon, label, value, tone, hint }: { icon: React.ElementType; label: string; value: number | string; tone?: string; hint?: string }) {
  return (
    <Card className="min-w-0">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className={cn("h-4 w-4", tone)} /> {label}</div>
        <div className={cn("mt-1 text-2xl font-bold tabular-nums", tone)}>{typeof value === "number" ? value.toLocaleString() : value}</div>
        {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

const RESULT_LABEL: Record<CallRow["status"], { label: string; cls: string }> = {
  answered: { label: "Connected", cls: "border-emerald-500/40 text-emerald-500" },
  missed: { label: "Missed", cls: "border-rose-500/40 text-rose-500" },
  no_answer: { label: "Not answered", cls: "border-amber-500/40 text-amber-500" },
};

function CallLine({ call: c }: { call: CallRow }) {
  const r = RESULT_LABEL[c.status];
  return (
    <tr className="border-b border-border/20 align-top last:border-0">
      <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{when(c.startedAt)}</td>
      <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">{c.portalName}</td>
      <td className="py-2 pr-3">
        {c.personName || <span className="text-muted-foreground">{c.status === "missed" ? "Nobody — missed" : "—"}</span>}
        {c.extension && c.personName && !c.personName.startsWith("Ext ") && <span className="ml-1 text-xs text-muted-foreground">· {c.extension}</span>}
      </td>
      <td className="py-2 pr-3">{c.contact || <span className="text-muted-foreground/60">—</span>}{c.contactKind === "student" && <span className="ml-1 text-xs text-muted-foreground">(student)</span>}</td>
      <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-muted-foreground">{c.number || "—"}</td>
      <td className="whitespace-nowrap py-2 pr-3">
        <span className="mr-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
          {c.direction === "out" ? <PhoneOutgoing className="h-3.5 w-3.5" /> : <PhoneIncoming className="h-3.5 w-3.5" />}
          {c.direction === "out" ? "Out" : "In"}
        </span>
        <Badge variant="outline" className={cn("py-0 text-[11px]", r.cls)}>{r.label}</Badge>
      </td>
      <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{c.talkSeconds ? callLength(c.talkSeconds) : "—"}</td>
      <td className="py-2">{c.recordings > 0 ? <Recording call={c} /> : <span className="text-xs text-muted-foreground/60">None</span>}</td>
    </tr>
  );
}

/** Asks the portal for a fresh signed link only when played, so it is never stale. */
function Recording({ call }: { call: CallRow }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    setState("loading");
    try {
      const res = await api.get(`/calls/${call.portal}/${call.id}/recording-link`, { params: { index: 0 } });
      setUrl(res.data.data.url as string);
      setState("ready");
    } catch (e) {
      setError(e instanceof AxiosError ? (e.response?.data as { message?: string })?.message ?? "Could not open it" : "Could not open it");
      setState("error");
    }
  };
  if (state === "ready") {
    return (
      <span className="flex items-center gap-1">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio controls autoPlay preload="none" src={url} className="h-8 w-56" onError={() => { setError("The recording could not be played"); setState("error"); }} />
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setState("idle")} aria-label="Close the player"><Pause className="h-3.5 w-3.5" /></Button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <Button size="sm" variant="outline" className="h-7 gap-1 px-2" onClick={load} disabled={state === "loading"}>
        {state === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Play
      </Button>
      {state === "error" && <span className="text-xs text-rose-500">{error}</span>}
    </span>
  );
}

/** Every matching call (up to 1,000) as a CSV, fetched page by page. */
function ExportButton({ params }: { params: Record<string, string> }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const rows: CallRow[] = [];
      for (let page = 1; page <= 5; page++) {
        const d = (await api.get("/calls", { params: { ...params, page: String(page), limit: "200" } })).data.data as CallsOverview;
        rows.push(...d.calls);
        if (d.calls.length < 200 || rows.length >= d.total) break;
      }
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const head = ["When (Dubai)", "Portal", "Who took it", "Email", "Extension", "With", "Number", "Direction", "Result", "Talk seconds", "Ring seconds", "Recordings"];
      const lines = rows.map((c) => [when(c.startedAt), c.portalName, c.personName, c.personEmail, c.extension, c.contact, c.number,
        c.direction === "out" ? "Outgoing" : "Incoming", RESULT_LABEL[c.status].label, c.talkSeconds, c.ringSeconds, c.recordings].map(esc).join(","));
      const blob = new Blob([[head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `calls-${params.from}-to-${params.to}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" size="sm" onClick={run} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : <Download />} CSV
    </Button>
  );
}
