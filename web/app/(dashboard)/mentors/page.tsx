"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Plus, Search, Users2, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
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

interface MentorMeeting {
  id: string;
  title: string;
  kind: string;
  startsAt: string;
  durationMins: number;
  attendeeNames: string[];
}

interface Mentor {
  id: string;
  name: string;
  email: string;
  shared: boolean;
  slots: { dayOfWeek: number; startTime: string; endTime: string }[];
  classes: MentorClass[];
  meetings: MentorMeeting[];
}

const KIND_LABEL: Record<string, string> = {
  staff: "Staff",
  student: "Student",
  client: "Client",
};

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
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0);

  const { from, to, days } = useMemo(() => {
    const start = weekStart(new Date());
    start.setDate(start.getDate() + offset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    /*
     * Asked for a day either side of the week on show.
     *
     * The window is built from browser-local midnights, so for a viewer east
     * of the academy it begins and ends a few hours early in the academy's own
     * day — and a meeting late on the final Saturday would simply not be
     * fetched, leaving its cell looking empty rather than full. A day of slack
     * costs nothing and removes the edge entirely; which cell each hour lands
     * in is decided afterwards, by the column it actually belongs to.
     */
    const pad = 864e5;
    return {
      from: new Date(start.getTime() - pad).toISOString(),
      to: new Date(end.getTime() + pad).toISOString(),
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
   * Finding one person in a long list.
   *
   * Filtered here rather than asked of the LMS again: the whole week is
   * already in hand, and a round trip per keystroke would make the grid flicker
   * to answer a question the browser can answer instantly.
   *
   * Name and address both, because the list shows both and people search by
   * whichever they happen to know.
   */
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const all = schedule.data?.mentors ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [schedule.data, query]);

  /*
   * Booking an hour.
   *
   * Opened from the day it is for, with that mentor already chosen: the
   * commonest mistake a form like this invites is booking the right hour with
   * the wrong person, and picking neither of them twice removes it.
   *
   * The time is typed in the academy's zone, like everything else here, and
   * converted on the way out — a form that quietly means the browser's zone
   * would book an hour nobody agreed to.
   */
  const [booking, setBooking] = useState<{ mentor: Mentor; day: Date } | null>(null);
  const [form, setForm] = useState({
    title: "", kind: "staff", time: "10:00", durationMins: "30",
    meetingUrl: "", notes: "",
  });
  /* Who is coming, as rows. A staff meeting is rarely two people, and everybody
     with an address gets the invitation and the joining link. Starts as one
     empty row so the commonest case needs no clicking. */
  const [guests, setGuests] = useState<{ name: string; email: string }[]>([
    { name: "", email: "" },
  ]);

  const openBooking = (mentor: Mentor, day: Date) => {
    setBooking({ mentor, day });
    setForm({
      title: "", kind: "staff", time: "10:00", durationMins: "30",
      meetingUrl: "", notes: "",
    });
    setGuests([{ name: "", email: "" }]);
  };

  const book = useMutation({
    mutationFn: async () => {
      if (!booking) throw new Error("Nothing to book");
      /* The chosen day at the chosen wall-clock time, in the academy's zone.
         Built by asking what that wall time is worth in UTC rather than by
         trusting the browser's own offset, which is somebody else's hour. */
      const [h, min] = form.time.split(":").map(Number);
      const local = new Date(booking.day);
      local.setHours(h ?? 0, min ?? 0, 0, 0);
      const asIfHere = new Date(
        local.toLocaleString("en-US", { timeZone: tz }),
      );
      const drift = local.getTime() - asIfHere.getTime();
      const startsAt = new Date(local.getTime() + drift);

      return (
        await api.post<{ data: { linkNote: string | null } }>("/mentors/meetings", {
          mentorEmail: booking.mentor.email,
          title: form.title.trim(),
          kind: form.kind,
          scheduledStart: startsAt.toISOString(),
          durationMins: Number(form.durationMins),
          attendees: guests
            .map((g) => ({ name: g.name.trim(), email: g.email.trim() }))
            .filter((g) => g.name.length > 0),
          meetingUrl: form.meetingUrl.trim() || undefined,
          notes: form.notes.trim() || undefined,
        })
      ).data.data;
    },
    onSuccess: (d) => {
      /* Counted rather than written down: it said "both of them" while any
         number of people could be on it. Only the ones with an address are
         emailed, so that is the number worth reporting. */
      const emailed = guests.filter((g) => g.name.trim() && g.email.trim()).length;
      toast.success(
        d?.linkNote ??
          `Booked — the mentor${emailed ? ` and ${emailed} guest${emailed > 1 ? "s" : ""}` : ""} emailed`,
      );
      setBooking(null);
      void qc.invalidateQueries({ queryKey: ["mentors", "schedule"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not book that")),
  });

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

  /*
   * Which column an hour belongs in.
   *
   * The two sides are asked different questions on purpose, and getting that
   * wrong put bookings one column to the right for anybody east of Dubai.
   *
   * A column is a calendar date — the "23" in its heading — and nothing more.
   * It has no time and no zone, so it is read straight off the date's own
   * year, month and day. Converting it into the academy's zone was the bug: a
   * browser in India builds midnight on the 23rd, which is half past ten on
   * the 22nd in Dubai, so the column labelled 23 started calling itself the
   * 22nd while a meeting genuinely on the 23rd called itself the 23rd — and
   * landed in the cell headed 24.
   *
   * A meeting, by contrast, is a real instant, so the only meaningful question
   * is which day it falls on *there*. That one does need the zone.
   */
  const columnKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const sameDay = (iso: string, day: Date) =>
    new Date(iso).toLocaleDateString("en-CA", { timeZone: tz }) === columnKey(day);

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
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email…"
            className="pl-9"
          />
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

      {schedule.data && shown.length === 0 && (
        <Card><CardContent className="py-16 text-center">
          <Users2 className="mx-auto h-8 w-8 text-muted-foreground/50" />
          {/*
            Two different nothings. An academy with no instructors is a fact
            about the LMS; a search matching none of them is a fact about the
            box above. Saying the first when the second is true sends somebody
            off to investigate their own typo.
          */}
          {query.trim() ? (
            <>
              <p className="mt-3 text-sm font-medium">Nobody matches that</p>
              <button
                onClick={() => setQuery("")}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Clear the search
              </button>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm font-medium">No mentors in this academy</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Anybody given the instructor role in the LMS appears here.
              </p>
            </>
          )}
        </CardContent></Card>
      )}

      {schedule.data && shown.length > 0 && (
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
                {shown.map((m) => (
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
                      const meetings = m.meetings.filter((v) => sameDay(v.startsAt, day));
                      const empty = slots.length === 0 && booked.length === 0 && meetings.length === 0;

                      return (
                        <td
                          key={day.toISOString()}
                          className="group/cell cursor-pointer px-2 py-2.5 transition-colors hover:bg-accent/40"
                          title={`Book time with ${m.name || m.email}`}
                          onClick={() => openBooking(m, day)}
                        >
                          {empty ? (
                            <span className="text-xs text-muted-foreground/40 group-hover/cell:hidden">—</span>
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

                              {/* Meetings, which are nobody's class. Named by
                                  kind and attendee rather than by title alone:
                                  "Intro call" tells you nothing, "Client ·
                                  Rahul Menon" tells you whether it can move. */}
                              {meetings.map((v) => (
                                <div
                                  key={v.id}
                                  title={`${v.title} · with ${v.attendeeNames.join(", ")} · ${v.durationMins} minutes`}
                                  className="rounded border border-violet-500/30 bg-violet-500/15 px-1.5 py-0.5 text-[11px] text-violet-300"
                                >
                                  <span className="tabular-nums">{at(v.startsAt)}</span>{" "}
                                  {KIND_LABEL[v.kind] ?? v.kind} · {v.attendeeNames.join(", ")}
                                </div>
                              ))}
                            </div>
                          )}
                          <span className="mt-1 hidden text-[11px] text-primary group-hover/cell:block">
                            + Book
                          </span>
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

      <Dialog open={Boolean(booking)} onOpenChange={(o) => !o && setBooking(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Book time with {booking?.mentor.name || booking?.mentor.email}
            </DialogTitle>
            <DialogDescription>
              {booking?.day.toLocaleDateString(undefined, {
                weekday: "long", day: "numeric", month: "long",
              })}
              {" · "}times are {tz.replace("_", " ")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="mtitle">What is it</Label>
              <Input
                id="mtitle"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Intro call, weekly catch-up…"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mkind">Kind</Label>
              <select
                id="mkind"
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="staff">Staff meeting</option>
                <option value="student">With a student</option>
                <option value="client">Outside client</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="mtime">Start</Label>
                <Input
                  id="mtime" type="time" value={form.time}
                  onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mdur">Minutes</Label>
                <Input
                  id="mdur" type="number" min={5} max={600} step={5}
                  value={form.durationMins}
                  onChange={(e) => setForm((f) => ({ ...f, durationMins: e.target.value }))}
                />
              </div>
            </div>

            {/*
              Who is coming, as many as there are. Everybody with an address
              gets the invitation and the joining link, sent to each of them
              separately — one message with all of them in `to` would publish
              their addresses to each other, and some of these people are
              outside the company.

              A row with no name is ignored rather than refused: leaving a
              half-typed line behind is not a mistake worth stopping somebody
              for.
            */}
            <div className="space-y-2 sm:col-span-2">
              <Label>Who they are meeting</Label>
              {guests.map((g, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={g.name}
                    onChange={(e) =>
                      setGuests((rows) => rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                    }
                    placeholder="Name"
                  />
                  <Input
                    type="email"
                    value={g.email}
                    onChange={(e) =>
                      setGuests((rows) => rows.map((r, j) => (j === i ? { ...r, email: e.target.value } : r)))
                    }
                    placeholder="Email, so they get the invite"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    title="Remove"
                    disabled={guests.length === 1}
                    onClick={() => setGuests((rows) => rows.filter((_, j) => j !== i))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => setGuests((rows) => [...rows, { name: "", email: "" }])}
              >
                <Plus className="h-3.5 w-3.5" /> Add another person
              </Button>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="murl">Joining link</Label>
              <Input
                id="murl" value={form.meetingUrl}
                onChange={(e) => setForm((f) => ({ ...f, meetingUrl: e.target.value }))}
                placeholder="Paste one, or leave blank for a Google Meet"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="mnotes">Anything else</Label>
              <Input
                id="mnotes" value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional — goes in both emails"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setBooking(null)}>Cancel</Button>
            <Button
              disabled={
                book.isPending ||
                form.title.trim().length < 3 ||
                !guests.some((g) => g.name.trim())
              }
              onClick={() => book.mutate()}
            >
              {book.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Book it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
