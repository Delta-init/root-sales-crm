"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Users2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/axios";
import { cn } from "@/lib/utils";

/**
 * When the academy's mentors are free, and what is already booked.
 *
 * Two things on one grid, because either alone answers half the question. The
 * muted band behind a day is the pattern somebody set — "Tuesdays, nine to
 * twelve" — and the solid blocks are what has actually been booked into it.
 * A mentor with a wide band and nothing in it is free; the same band full of
 * blocks is not, and the difference is the entire point of looking.
 *
 * A week at a time. A month of seven-day columns is unreadable at this width,
 * and the question being asked is nearly always about this week or next.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface MentorClass {
  id: string;
  title: string | null;
  startsAt: string;
  durationMins: number;
  status: string;
  booked: number;
  capacity: number;
  mine: boolean;
}

interface Mentor {
  id: string;
  name: string;
  email: string;
  shared: boolean;
  slots: { dayOfWeek: number; startTime: string; endTime: string }[];
  classes: MentorClass[];
}

interface Schedule {
  timezone: string;
  from: string;
  to: string;
  mentors: Mentor[];
}

/** Midnight on the Sunday of whatever week this date falls in. */
const weekStart = (d: Date) => {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
};

export default function MentorsPage() {
  const [offset, setOffset] = useState(0);

  const { from, to, days } = useMemo(() => {
    const start = weekStart(new Date());
    start.setDate(start.getDate() + offset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      days: Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        return d;
      }),
    };
  }, [offset]);

  const schedule = useQuery({
    queryKey: ["mentors", "schedule", from, to],
    retry: false,
    queryFn: async () =>
      (
        await api.get<{ data: Schedule }>(
          `/mentors/schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        )
      ).data.data,
  });

  const tz = schedule.data?.timezone || "Asia/Dubai";

  /*
   * Every time on this page is drawn in the academy's zone, never the
   * browser's.
   *
   * The recurring slots are stored as bare "HH:MM" with no zone at all, so
   * they only mean anything in the academy's own. Rendering the classes beside
   * them in whatever zone the viewer happens to sit in would put the two
   * halves of one row hours apart, both looking perfectly reasonable.
   */
  const at = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", timeZone: tz,
    });

  const sameDay = (iso: string, day: Date) => {
    const key = (d: Date) =>
      d.toLocaleDateString("en-CA", { timeZone: tz });
    return key(new Date(iso)) === key(day);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold text-foreground">Mentors</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            When they are free, and what is already booked.{" "}
            <span className="whitespace-nowrap">All times {tz.replace("_", " ")}.</span>
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setOffset((o) => o - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="min-w-28 gap-1.5"
            onClick={() => setOffset(0)}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            {offset === 0 ? "This week" : days[0]!.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </Button>
          <Button variant="outline" size="icon" onClick={() => setOffset((o) => o + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {schedule.isPending && (
        <Card><CardContent className="space-y-3 py-6">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </CardContent></Card>
      )}

      {/*
        The LMS being unreachable costs this screen and says why, rather than
        rendering an empty week that reads as "nobody works here".
      */}
      {schedule.isError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-6 text-sm text-destructive">
            {apiErrorMessage(schedule.error, "The LMS could not be reached, so there is no schedule to show.")}
          </CardContent>
        </Card>
      )}

      {schedule.data && schedule.data.mentors.length === 0 && (
        <Card><CardContent className="py-16 text-center">
          <Users2 className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">No mentors in this academy</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Anybody given the instructor role in the LMS appears here.
          </p>
        </CardContent></Card>
      )}

      {schedule.data && schedule.data.mentors.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border/60 text-xs text-muted-foreground">
                  <th className="w-48 px-3 py-2.5 font-medium">Mentor</th>
                  {days.map((d) => (
                    <th key={d.toISOString()} className="px-2 py-2.5 font-medium">
                      {d.toLocaleDateString(undefined, { weekday: "short" })}{" "}
                      <span className="text-muted-foreground/60">
                        {d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedule.data.mentors.map((m) => (
                  <tr key={m.id} className="border-b border-border/40 align-top last:border-0">
                    <td className="px-3 py-2.5">
                      <p className="truncate font-medium text-foreground">{m.name || m.email}</p>
                      <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                      {m.shared && (
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          Shared
                        </Badge>
                      )}
                    </td>

                    {days.map((day) => {
                      const slots = m.slots.filter((s) => s.dayOfWeek === day.getDay());
                      const booked = m.classes.filter((c) => sameDay(c.startsAt, day));

                      return (
                        <td key={day.toISOString()} className="px-2 py-2.5">
                          {slots.length === 0 && booked.length === 0 ? (
                            <span className="text-xs text-muted-foreground/40">—</span>
                          ) : (
                            <div className="space-y-1">
                              {/* The pattern, behind everything else. */}
                              {slots.map((s, i) => (
                                <div
                                  key={`${s.startTime}-${i}`}
                                  className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-500"
                                >
                                  {s.startTime}–{s.endTime}
                                </div>
                              ))}

                              {/* What is actually in the diary. */}
                              {booked.map((c) => (
                                <div
                                  key={c.id}
                                  title={
                                    c.mine
                                      ? `${c.title ?? "Class"} · ${c.booked}/${c.capacity} booked · ${c.status}`
                                      : "A class for the other academy — the time is taken, the subject is not shown"
                                  }
                                  className={cn(
                                    "rounded border px-1.5 py-0.5 text-[11px]",
                                    c.status === "cancelled"
                                      ? "border-border/60 bg-muted/40 text-muted-foreground line-through"
                                      : c.mine
                                        ? "border-blue-500/30 bg-blue-500/15 text-blue-400"
                                        : "border-border/60 bg-muted/60 text-muted-foreground",
                                  )}
                                >
                                  <span className="tabular-nums">{at(c.startsAt)}</span>{" "}
                                  {c.mine ? (c.title || "Class") : "Booked elsewhere"}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {schedule.isFetching && !schedule.isPending && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Refreshing…
        </p>
      )}
    </div>
  );
}
