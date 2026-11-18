"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { CalendarCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { Range } from "@/components/reports/RangePicker";

/*
 * The meetings this person booked with the mentors (the user, 2026-11-18: "in the salesperson or CS page, a report of
 * the meetings they added and done"), in the page's period — by when the meeting was: booked, done, outcome not
 * filled (a CS Portal student meeting that is over, the mentor not yet saying how it went), upcoming, cancelled.
 * Every kind, from whichever portal they booked it in, matched by their email. Asked of the LMS through Root.
 */

type Status = "upcoming" | "done" | "waiting" | "cancelled";
interface BookedMeeting {
  id: string; title: string; kind: string; startsAt: string; durationMins: number; inPerson: boolean;
  attendees: { name: string; email: string }[];
  mentor: { name: string; email: string };
  status: Status; cancelledAt: string | null; cancelReason: string; cancelledBy: string | null;
  outcome: { stage: string; courseTitle?: string; remark?: string } | null;
}
interface BookedAnswer { from: string; to: string; clipped: boolean; total: number; counts: Record<Status, number>; meetings: BookedMeeting[] }

const STATUS: Record<Status, { label: string; tone: string }> = {
  done: { label: "Done", tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" },
  waiting: { label: "Outcome not filled", tone: "border-amber-500/30 bg-amber-500/10 text-amber-400" },
  upcoming: { label: "Upcoming", tone: "border-sky-500/30 bg-sky-500/10 text-sky-400" },
  cancelled: { label: "Cancelled", tone: "border-rose-500/30 bg-rose-500/10 text-rose-400" },
};
const ORDER: Status[] = ["done", "waiting", "upcoming", "cancelled"];
const STAGE: Record<string, string> = { interested: "Interested", follow_up: "Follow-up", meeting_with: "Meeting with another mentor", revision: "Revision", not_interested: "Not interested" };
const KIND: Record<string, string> = { student: "Student", client: "Client", staff: "Staff" };
const BY: Record<string, string> = { student: "the student", mentor: "the mentor", cs: "the CS", other: "someone else" };
const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(iso)) + " GST";
const day = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export function MeetingsBookedCard({ email, period }: { email: string; period: Range }) {
  const [only, setOnly] = useState<Status | null>(null);
  const q = useQuery({
    queryKey: ["meetings-booked", email, period],
    queryFn: async () => (await api.get("/meetings-booked", { params: { email, ...period } })).data.data as BookedAnswer,
    enabled: !!email,
  });
  const d = q.data;
  const rows = (d?.meetings ?? []).filter((m) => !only || m.status === only);
  const err = q.error instanceof AxiosError ? ((q.error.response?.data as { message?: string })?.message ?? q.error.message) : q.error ? String(q.error) : "";

  return (
    <Card id="section-meetings" className="scroll-mt-24">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <CalendarCheck className="h-4 w-4 text-primary" /> Meetings booked with mentors{d ? ` · ${d.total}` : ""}
        </CardTitle>
        {d && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button type="button" onClick={() => setOnly(null)}
              className={cn("rounded-full border px-2.5 py-0.5 text-xs", !only ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
              All {d.total}
            </button>
            {ORDER.map((s) => (
              <button key={s} type="button" onClick={() => setOnly(only === s ? null : s)} disabled={!d.counts[s]}
                className={cn("rounded-full border px-2.5 py-0.5 text-xs disabled:opacity-40", only === s ? STATUS[s].tone : "border-border text-muted-foreground hover:text-foreground")}>
                {STATUS[s].label} {d.counts[s] ?? 0}
              </button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="max-h-[460px] overflow-auto">
        {!email ? <p className="py-6 text-center text-sm text-muted-foreground">No email on this person, so their meetings can&apos;t be found.</p>
          : q.isPending ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          : err ? <p className="py-6 text-center text-sm text-amber-400">{err}</p>
          : !rows.length ? <p className="py-6 text-center text-sm text-muted-foreground">{only ? `None ${STATUS[only].label.toLowerCase()} in this period.` : "No meetings booked with a mentor in this period."}</p>
          : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-2 font-medium">When</th><th className="pb-2 pr-2 font-medium">Mentor</th>
                  <th className="pb-2 pr-2 font-medium">With</th><th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-b border-border/20 align-top last:border-0">
                    <td className="py-2 pr-2 text-xs">{when(m.startsAt)}<div className="text-muted-foreground">{m.durationMins} min{m.inPerson ? " · in person" : ""}</div></td>
                    <td className="py-2 pr-2">{m.mentor.name || m.mentor.email || "—"}</td>
                    <td className="py-2 pr-2">
                      <div className="font-medium">{m.attendees.map((a) => a.name).join(", ") || "—"}</div>
                      <div className="text-xs text-muted-foreground">{[KIND[m.kind] ?? m.kind, m.title].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="py-2">
                      <Badge variant="outline" className={cn("font-normal", STATUS[m.status]?.tone)}>{STATUS[m.status]?.label ?? m.status}</Badge>
                      {m.status === "done" && m.outcome && (
                        <div className="mt-1 text-xs text-muted-foreground">{STAGE[m.outcome.stage] ?? m.outcome.stage}{m.outcome.courseTitle ? ` · ${m.outcome.courseTitle}` : ""}</div>
                      )}
                      {m.status === "cancelled" && (m.cancelReason || m.cancelledBy) && (
                        <div className="mt-1 text-xs text-muted-foreground">{[m.cancelledBy ? `by ${BY[m.cancelledBy] ?? m.cancelledBy}` : "", m.cancelReason].filter(Boolean).join(" — ")}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        {d?.clipped && <p className="mt-2 text-xs text-muted-foreground">Showing {day(d.from)} – {day(d.to)}: the LMS answers 400 days at a time.</p>}
        {d && d.meetings.length >= 2000 && <p className="mt-2 text-xs text-muted-foreground">Showing the latest 2,000.</p>}
      </CardContent>
    </Card>
  );
}
