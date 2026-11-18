"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { Loader2, Phone, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import { Recording } from "@/components/calls/Recording";
import { addDays, callLength, dubaiToday, talkTime } from "@/lib/calls";
import type { Range } from "@/components/reports/RangePicker";
import type { CallRow, CallsOverview } from "@/lib/types";

/*
 * This person's 3CX calls (the user, 2026-11-18: "in the salesperson and CS details page, the 3CX calls of the
 * employee"), in the page's period: the totals and the calls, newest first, with their recordings. Asked of the
 * portal the person works in through Root's own calls route (GET /calls?person=<portal>|u:<id>) — the same figures as
 * the 3CX calls page. "All time" is the last 90 days: a person's whole history can be thousands of calls.
 */

const CALL_PORTALS: Record<string, string> = { delta: "Sales CRM", draw: "Draw", banglore: "Banglore", commission: "CS Portal" };
const PAGE = 50;
const MAX = 1000;
const UAE_MS = 4 * 3_600_000;
const dubaiDay = (iso: string) => new Date(Date.parse(iso) + UAE_MS).toISOString().slice(0, 10);
const RESULT: Record<CallRow["status"], { label: string; cls: string }> = {
  answered: { label: "Connected", cls: "border-emerald-500/40 text-emerald-500" },
  missed: { label: "Missed", cls: "border-rose-500/40 text-rose-500" },
  no_answer: { label: "Not answered", cls: "border-amber-500/40 text-amber-500" },
};
const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function PersonCallsCard({ portal, userId, period }: { portal: string; userId: string; period: Range }) {
  const today = dubaiToday();
  const allTime = !period.from && !period.to;
  const days = allTime
    ? { from: addDays(today, -89), to: today }
    : { from: period.from ? dubaiDay(period.from) : addDays(period.to ? dubaiDay(period.to) : today, -89), to: period.to ? dubaiDay(period.to) : today };
  const [shown, setShown] = useState(PAGE);
  const has = !!CALL_PORTALS[portal];
  const q = useQuery({
    queryKey: ["person-calls", portal, userId, days.from, days.to, shown],
    queryFn: async () => (await api.get("/calls", { params: { person: `${portal}|u:${userId}`, ...days, page: "1", limit: String(Math.min(shown, 200)) } })).data.data as CallsOverview,
    enabled: has && !!userId,
    placeholderData: keepPreviousData,
  });
  // The calls route gives at most 200 a page: past that, the further pages are asked for and put together.
  const more = useQuery({
    queryKey: ["person-calls-more", portal, userId, days.from, days.to, shown],
    queryFn: async () => {
      const pages = Math.ceil(shown / 200);
      const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) =>
        api.get("/calls", { params: { person: `${portal}|u:${userId}`, ...days, page: String(i + 2), limit: "200" } }).then((r) => (r.data.data as CallsOverview).calls)));
      return rest.flat();
    },
    enabled: has && !!userId && shown > 200,
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const calls = [...(d?.calls ?? []), ...(shown > 200 ? more.data ?? [] : [])].slice(0, shown);
  const s = d?.stats;
  const err = q.error instanceof AxiosError ? ((q.error.response?.data as { message?: string })?.message ?? q.error.message) : q.error ? String(q.error) : "";
  const portalError = d?.portals?.find((p) => !p.available)?.error;

  return (
    <Card id="section-calls" className="scroll-mt-24">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Phone className="h-4 w-4 text-primary" /> 3CX calls{s ? ` · ${s.calls.toLocaleString("en-US")}` : ""}
          {has && <span className="text-xs font-normal text-muted-foreground">{CALL_PORTALS[portal]} · {days.from === days.to ? days.from : `${days.from} – ${days.to}`}{allTime ? " (last 90 days)" : ""}</span>}
        </CardTitle>
        {s && (
          <div className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4 lg:grid-cols-7">
            {[
              ["Calls", s.calls.toLocaleString("en-US"), ""],
              ["Outgoing", s.outgoing.toLocaleString("en-US"), ""],
              ["Incoming", s.incoming.toLocaleString("en-US"), ""],
              ["Connected", s.connected.toLocaleString("en-US"), "text-emerald-500"],
              ["Missed / not answered", `${s.missed} / ${s.notAnswered}`, "text-rose-500"],
              ["Talk time", talkTime(s.talkSeconds), ""],
              ["Average call", s.avgTalkSeconds ? callLength(s.avgTalkSeconds) : "—", ""],
            ].map(([label, value, tone]) => (
              <div key={label} className="rounded-md border border-border/60 px-3 py-2">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</p>
              </div>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="max-h-[520px] overflow-auto">
        {!has ? <p className="py-6 text-center text-sm text-muted-foreground">This CRM has no 3CX calls.</p>
          : q.isPending ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          : err ? <p className="py-6 text-center text-sm text-amber-400">{err}</p>
          : portalError ? <p className="py-6 text-center text-sm text-amber-400">{portalError}</p>
          : !calls.length ? <p className="py-6 text-center text-sm text-muted-foreground">No calls in this period.</p>
          : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">When (Dubai)</th><th className="pb-2 pr-3 font-medium">With</th>
                    <th className="pb-2 pr-3 font-medium">Number</th><th className="pb-2 pr-3 font-medium">Call</th>
                    <th className="pb-2 pr-3 text-right font-medium">Talk</th><th className="pb-2 font-medium">Recording</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((c) => (
                    <tr key={`${c.portal}-${c.id}`} className="border-b border-border/20 align-top last:border-0">
                      <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{when(c.startedAt)}</td>
                      <td className="py-2 pr-3">{c.contact || <span className="text-muted-foreground/60">—</span>}{c.contactKind && <span className="ml-1 text-xs text-muted-foreground">({c.contactKind})</span>}</td>
                      <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-muted-foreground">{c.number || "—"}</td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        <span className="mr-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          {c.direction === "out" ? <PhoneOutgoing className="h-3.5 w-3.5" /> : <PhoneIncoming className="h-3.5 w-3.5" />}
                          {c.direction === "out" ? "Out" : "In"}
                        </span>
                        <Badge variant="outline" className={cn("py-0 text-[11px]", RESULT[c.status]?.cls)}>{RESULT[c.status]?.label ?? c.status}</Badge>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{c.talkSeconds ? callLength(c.talkSeconds) : "—"}</td>
                      <td className="py-2">{c.recordings > 0 ? <Recording call={c} /> : <span className="text-xs text-muted-foreground/60">None</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d && d.total > calls.length && (
                <div className="flex items-center justify-center gap-3 pt-3">
                  <span className="text-xs text-muted-foreground">Showing {calls.length.toLocaleString("en-US")} of {d.total.toLocaleString("en-US")}</span>
                  {shown < MAX ? (
                    <Button size="sm" variant="outline" disabled={q.isFetching || more.isFetching} onClick={() => setShown((n) => Math.min(MAX, n + PAGE))}>
                      {(q.isFetching || more.isFetching) && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Load more
                    </Button>
                  ) : <span className="text-xs text-muted-foreground">The first 1,000 — narrow the period for the rest.</span>}
                </div>
              )}
            </>
          )}
      </CardContent>
    </Card>
  );
}
