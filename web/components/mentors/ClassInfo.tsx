"use client";

import { CalendarCheck, CalendarX, LogIn, MessageSquareText, Play, Square, Star, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/*
 * A class's Info (2026-10-09): who booked it and when, who cancelled, when it
 * started, when the mentor and each student joined, when it ended, and each
 * student's review from the after-class form — from the LMS's class card
 * (GET /mentors/classes/:id → LMS /service/classes/:id). Names only. An LMS
 * from before this sends neither list, and the section says so.
 */
interface InfoStudent {
  name: string; status: string; bookedAt: string; cancelledAt: string; joinedAt: string
  review: { rating: number; comment: string; at: string } | null
}
interface InfoEvent { at: string; kind: string; who: string; rating?: number; comment?: string }

const STATUS: Record<string, { label: string; cls: string }> = {
  booked: { label: "Booked", cls: "border-sky-500/30 bg-sky-500/10 text-sky-500" },
  attended: { label: "Attended", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" },
  missed: { label: "Missed", cls: "border-rose-500/30 bg-rose-500/10 text-rose-500" },
  cancelled: { label: "Cancelled", cls: "border-border bg-muted text-muted-foreground" },
};
const EVENT: Record<string, { icon: typeof Play; cls: string; text: (e: InfoEvent) => string }> = {
  booked: { icon: CalendarCheck, cls: "text-sky-500", text: (e) => `${e.who} booked` },
  cancelled: { icon: CalendarX, cls: "text-muted-foreground", text: (e) => `${e.who} cancelled` },
  started: { icon: Play, cls: "text-blue-500", text: () => "Class started" },
  mentor_joined: { icon: UserCheck, cls: "text-indigo-500", text: (e) => `${e.who || "The mentor"} (mentor) joined` },
  joined: { icon: LogIn, cls: "text-emerald-500", text: (e) => `${e.who} joined` },
  ended: { icon: Square, cls: "text-muted-foreground", text: () => "Class ended" },
  review: { icon: MessageSquareText, cls: "text-amber-500", text: (e) => `${e.who} sent a review` },
};

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn("h-3 w-3", i <= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
      ))}
    </span>
  );
}

export function ClassInfo({ c, tz }: { c: Record<string, unknown>; tz: string }) {
  const at = (iso: string) =>
    iso ? new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz || undefined }) : "";
  const students = Array.isArray(c.students) ? (c.students as InfoStudent[]) : null;
  const timeline = Array.isArray(c.timeline) ? (c.timeline as InfoEvent[]) : null;
  return (
    <div className="space-y-4 border-t border-border/60 pt-3 text-sm">
      <p className="font-semibold text-foreground">Info</p>
      {!students && !timeline ? (
        <p className="text-xs text-muted-foreground">The LMS doesn&apos;t share a class&apos;s bookings and reviews yet — it needs its update.</p>
      ) : (
        <>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Students ({students?.length ?? 0})</p>
            {!students?.length ? <p className="text-muted-foreground">Nobody has booked this class.</p> : (
              <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
                {students.map((s, i) => {
                  const st = STATUS[s.status] ?? STATUS.booked!;
                  return (
                    <li key={i} className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{s.name}</span>
                        <Badge variant="outline" className={st.cls}>{st.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[s.bookedAt && `Booked ${at(s.bookedAt)}`, s.cancelledAt && `cancelled ${at(s.cancelledAt)}`, s.joinedAt && `joined ${at(s.joinedAt)}`].filter(Boolean).join(" · ")}
                      </p>
                      {s.review && (
                        <div className="mt-1 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-foreground">
                          <Stars n={s.review.rating} />
                          {s.review.comment ? <span className="ml-1.5">“{s.review.comment}”</span> : null}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</p>
            {!timeline?.length ? <p className="text-muted-foreground">Nothing has happened yet.</p> : (
              <ol className="space-y-1.5">
                {timeline.map((e, i) => {
                  const ev = EVENT[e.kind] ?? { icon: CalendarCheck, cls: "text-muted-foreground", text: () => e.kind };
                  const Icon = ev.icon;
                  return (
                    <li key={i} className="flex items-start gap-2">
                      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", ev.cls)} />
                      <span className="w-28 shrink-0 text-xs leading-5 text-muted-foreground tabular-nums">{at(e.at)}</span>
                      <span className="min-w-0 text-foreground">
                        {ev.text(e)}
                        {e.kind === "review" && e.rating ? (
                          <span className="ml-1.5"><Stars n={e.rating} />{e.comment ? <span className="ml-1 text-muted-foreground">“{e.comment}”</span> : null}</span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </>
      )}
    </div>
  );
}
