"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { AlertTriangle, Loader2, RefreshCw, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";

/**
 * Reports → Students (the user, 2026-10-29: "today's bookings, a date range past and future, which student and which
 * class has the most bookings, the non-active students with their CS counted, who they are, who attended fully"). As
 * the LMS counts them (GET /service/student-report through Root); Dubai days. A cancelled seat, and a seat on a class
 * the academy cancelled, are counted, not listed. Non-active = enrolled, not signed in for 14 days or never — whatever
 * the dates. Read-only.
 */

type State = "upcoming" | "live" | "attended" | "missed";
type Attendance = "full" | "some" | "none" | "not_due";
interface Cs { name: string; team: string; code: string; open: boolean }
interface Person { id: string; name: string; email: string; phone: string; academy: string; cs: Cs }
interface Lesson { id: string; title: string; course: string; mentor: string; start: string; durationMins: number; online: boolean }
interface Tally { booked: number; upcoming: number; live: number; attended: number; missed: number }
interface Report {
  from: string; to: string; academy: string; academies: { slug: string; name: string }[];
  totals: Tally & { seats: number; cancelledSeats: number; cancelledClassSeats: number; students: number; classes: number };
  bookings: { id: string; state: State; bookedAt: string; student: Person; class: Lesson }[]; bookingsListed: number;
  students: (Person & Tally & { attendance: Attendance })[];
  fullness: Record<Attendance, number>;
  classes: (Lesson & Tally & { academy: string })[];
  inactive: {
    days: number; total: number; never: number; listed: number;
    byCs: { cs: string; team: string; count: number; never: number }[];
    students: (Person & { lastLoginAt: string; daysAway: number | null; joinedAt: string })[];
  };
}

const dubaiToday = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const PRESETS: [string, string, () => [string, string]][] = [
  ["today", "Today", () => { const t = dubaiToday(); return [t, t]; }],
  ["upcoming", "Upcoming 30 days", () => { const t = dubaiToday(); return [shift(t, 1), shift(t, 30)]; }],
  ["past", "Past 30 days", () => { const t = dubaiToday(); return [shift(t, -30), shift(t, -1)]; }],
  ["month", "This month", () => { const t = dubaiToday(); return [`${t.slice(0, 8)}01`, t]; }],
];
const VIEWS = [["bookings", "Bookings"], ["students", "Most-booked students"], ["classes", "Most-booked classes"], ["attendance", "Full attendance"], ["inactive", "Non-active"]] as const;
type View = (typeof VIEWS)[number][0];
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }) : "");
const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }) : "");
const message = (e: unknown, fallback: string) => (e instanceof AxiosError && (e.response?.data as { message?: string } | undefined)?.message) || fallback;
const NO_CS = "No CS yet";

const STATE: Record<State, [string, string]> = {
  upcoming: ["Upcoming", "bg-sky-500/10 text-sky-500"],
  live: ["On now", "bg-violet-500/10 text-violet-500"],
  attended: ["Joined", "bg-emerald-500/10 text-emerald-500"],
  missed: ["Missed", "bg-amber-500/10 text-amber-500"],
};
const ATTENDANCE: Record<Attendance, [string, string]> = {
  full: ["Attended every class", "bg-emerald-500/10 text-emerald-500"],
  some: ["Missed some", "bg-amber-500/10 text-amber-500"],
  none: ["Missed all", "bg-rose-500/10 text-rose-500"],
  not_due: ["Nothing due yet", "bg-muted text-muted-foreground"],
};
const Tag = ({ tone, children }: { tone: string; children: React.ReactNode }) => (
  <span className={cn("inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium", tone)}>{children}</span>
);

function Who({ p }: { p: Person }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{p.name || p.email}</p>
      <p className="truncate text-xs text-muted-foreground">{p.email}{p.academy ? ` · ${p.academy}` : ""}</p>
    </div>
  );
}
function CsCell({ cs }: { cs: Cs }) {
  if (!cs.name) return <span className="text-xs text-muted-foreground">{cs.open ? "Open students" : NO_CS}</span>;
  return <div className="min-w-0"><p className="truncate">{cs.name}</p>{cs.team && <p className="truncate text-xs text-muted-foreground">{cs.team}</p>}</div>;
}
const Num = ({ v, tone }: { v: number; tone?: string }) => <td className={cn("px-3 py-2.5 text-right tabular-nums", v ? tone : "text-muted-foreground/50")}>{v || 0}</td>;

function Table({ head, empty, children, count }: { head: (string | [string, "right"])[]; empty: boolean; children: React.ReactNode; count: string }) {
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>{head.map((h) => {
              const [label, align] = Array.isArray(h) ? h : [h, "left"];
              return <th key={label} className={cn("px-3 py-3 font-semibold first:pl-4", align === "right" && "text-right")}>{label}</th>;
            })}</tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {empty ? <tr><td colSpan={head.length} className="px-4 py-10 text-center text-muted-foreground">Nothing to show.</td></tr> : children}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">{count}</p>
    </div>
  );
}

export function StudentsReportView() {
  const [preset, setPreset] = useState("today");
  const [range, setRange] = useState<[string, string]>(() => PRESETS[0]![2]());
  const [academy, setAcademy] = useState("");
  const [view, setView] = useState<View>("bookings");
  const [needle, setNeedle] = useState("");
  const [state, setState] = useState<State | "">("");
  const [attendance, setAttendance] = useState<Attendance | "">("full");
  const [cs, setCs] = useState<string | null>(null);
  const [from, to] = range;
  const q = useQuery({
    queryKey: ["portal-reports", "students", from, to, academy],
    queryFn: async () => (await api.get("/portal-reports/students", { params: { from, to, ...(academy ? { academy } : {}) } })).data.data as Report,
    retry: 1,
  });
  const data = q.data;
  const find = needle.trim().toLowerCase();
  const hit = (...parts: unknown[]) => !find || parts.join(" ").toLowerCase().includes(find);
  const personText = (p: Person) => [p.name, p.email, p.phone, p.cs.name, p.cs.team, p.cs.code];

  // A few thousand rows at most: filtered on each render.
  const bookings = (data?.bookings ?? []).filter((b) => (!state || b.state === state) && hit(...personText(b.student), b.class.title, b.class.course, b.class.mentor));
  const students = (data?.students ?? []).filter((s) => hit(...personText(s)));
  const classes = (data?.classes ?? []).filter((c) => hit(c.title, c.course, c.mentor));
  const fullList = students.filter((s) => !attendance || s.attendance === attendance);
  const idle = (data?.inactive.students ?? []).filter((s) => (cs === null || s.cs.name.toLowerCase() === cs) && hit(...personText(s)));

  const pick = (key: string) => { const p = PRESETS.find((x) => x[0] === key)!; setPreset(key); setRange(p[2]()); };
  const setDay = (i: 0 | 1, v: string) => {
    if (!v) return;
    setPreset("custom");
    setRange((r) => { const next: [string, string] = [...r]; next[i] = v; if (next[0] > next[1]) next[i === 0 ? 1 : 0] = v; return next; });
  };

  if (q.error instanceof AxiosError && q.error.response?.status === 403) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">You do not have access to this report.</CardContent></Card>;
  }

  const t = data?.totals;
  const due = t ? t.attended + t.missed : 0;
  const f = data?.fullness;
  const cards: [string, string | number, string, () => void][] = [
    ["Bookings", t?.seats ?? "…", t ? `${t.cancelledSeats} cancelled by students${t.cancelledClassSeats ? ` · ${t.cancelledClassSeats} on cancelled classes` : ""}` : "", () => { setView("bookings"); setState(""); }],
    ["Upcoming", t ? t.upcoming + t.live : "…", t?.live ? `${t.live} on now` : "booked, still to come", () => { setView("bookings"); setState("upcoming"); }],
    ["Joined", t?.attended ?? "…", due ? `${Math.round(((t?.attended ?? 0) / due) * 100)}% of those due` : "none due yet", () => { setView("bookings"); setState("attended"); }],
    ["Missed", t?.missed ?? "…", "booked, didn't join", () => { setView("bookings"); setState("missed"); }],
    ["Students", t?.students ?? "…", "who booked a class", () => setView("students")],
    ["Classes", t?.classes ?? "…", "with a booking", () => setView("classes")],
    ["Attended fully", f?.full ?? "…", f ? `${f.some} missed some · ${f.none} missed all` : "", () => { setView("attendance"); setAttendance("full"); }],
    [`Non-active ${data?.inactive.days ?? 14}+ days`, data?.inactive.total ?? "…", data ? `${data.inactive.never} never signed in · any dates` : "", () => { setView("inactive"); setCs(null); }],
  ];
  const listed = (n: number, all: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}${all > n ? ` (first ${n} of ${all})` : ""}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Dates">
          {PRESETS.map(([k, l]) => <Button key={k} size="sm" variant={preset === k ? "default" : "outline"} onClick={() => pick(k)}>{l}</Button>)}
        </div>
        <Input type="date" value={from} max={to} onChange={(e) => setDay(0, e.target.value)} className="h-9 w-[9.5rem]" aria-label="From" />
        <span className="text-muted-foreground">–</span>
        <Input type="date" value={to} min={from} onChange={(e) => setDay(1, e.target.value)} className="h-9 w-[9.5rem]" aria-label="To" />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Dubai days</span>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw className={cn(q.isFetching && "animate-spin")} /> Refresh</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Academy">
        {[{ slug: "", name: "Both academies" }, ...(data?.academies ?? [{ slug: "dubai", name: "Dubai" }, { slug: "bangalore", name: "Bangalore" }])].map((a) => (
          <Button key={a.slug || "all"} size="sm" variant={academy === a.slug ? "secondary" : "ghost"} onClick={() => { setAcademy(a.slug); setCs(null); }}>{a.name}</Button>
        ))}
      </div>

      {q.isError ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            {message(q.error, q.error instanceof AxiosError && q.error.response?.status === 404 ? "Root's server is still on the previous version — this tab shows once it is updated." : "Could not load the report. Refresh in a moment.")}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {cards.map(([label, value, sub, go]) => (
              <button key={label} type="button" disabled={!data} onClick={go} className="text-left disabled:cursor-default">
                <Card className="h-full transition-colors hover:border-primary/40"><CardContent className="p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                  <p className="mt-1 text-2xl font-bold">{q.isLoading ? "…" : value}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>
                </CardContent></Card>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1" role="group" aria-label="View">
            {VIEWS.map(([k, l]) => <Button key={k} size="sm" variant={view === k ? "default" : "outline"} onClick={() => setView(k)}>{l}</Button>)}
          </div>

          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-3">
                <div className="relative w-full max-w-xs">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={needle} onChange={(e) => setNeedle(e.target.value)} placeholder={view === "classes" ? "Find a class or mentor…" : "Find a student or CS…"} className="h-9 pl-9" />
                </div>
                {view === "bookings" && (
                  <div className="flex flex-wrap gap-1">
                    {([["", "All"], ...Object.entries(STATE).map(([k, [l]]) => [k, l])] as [State | "", string][]).map(([k, l]) => (
                      <Button key={k || "all"} size="sm" variant={state === k ? "secondary" : "ghost"} onClick={() => setState(k)}>{l}</Button>
                    ))}
                  </div>
                )}
                {view === "attendance" && (
                  <div className="flex flex-wrap gap-1">
                    {(Object.keys(ATTENDANCE) as Attendance[]).map((k) => (
                      <Button key={k} size="sm" variant={attendance === k ? "secondary" : "ghost"} onClick={() => setAttendance(k)}>{ATTENDANCE[k][0]} · {f?.[k] ?? 0}</Button>
                    ))}
                  </div>
                )}
              </div>

              {q.isLoading ? (
                <p className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></p>
              ) : !data ? null : view === "bookings" ? (
                <Table head={["Class time", "Class", "Student", "CS", "Seat"]} empty={!bookings.length}
                  count={`${listed(bookings.length, state || find ? bookings.length : data.totals.seats, "booking")}`}>
                  {bookings.map((b) => (
                    <tr key={b.id} className="hover:bg-muted/30">
                      <td className="whitespace-nowrap py-2.5 pl-4 pr-3 tabular-nums">{when(b.class.start)}</td>
                      <td className="px-3 py-2.5"><p className="font-medium">{b.class.title}</p><p className="text-xs text-muted-foreground">{[b.class.course, b.class.mentor, b.class.online ? "" : "In person"].filter(Boolean).join(" · ")}</p></td>
                      <td className="px-3 py-2.5"><Who p={b.student} /></td>
                      <td className="px-3 py-2.5"><CsCell cs={b.student.cs} /></td>
                      <td className="px-3 py-2.5"><Tag tone={STATE[b.state][1]}>{STATE[b.state][0]}</Tag></td>
                    </tr>
                  ))}
                </Table>
              ) : view === "students" ? (
                <Table head={["#", "Student", "CS", ["Booked", "right"], ["Joined", "right"], ["Missed", "right"], ["Upcoming", "right"], "Attendance"]} empty={!students.length}
                  count={listed(students.length, find ? students.length : data.totals.students, "student")}>
                  {students.map((s, i) => (
                    <tr key={s.id} className="hover:bg-muted/30">
                      <td className="py-2.5 pl-4 pr-3 tabular-nums text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2.5"><Who p={s} /></td>
                      <td className="px-3 py-2.5"><CsCell cs={s.cs} /></td>
                      <Num v={s.booked} tone="font-semibold" /><Num v={s.attended} tone="text-emerald-500" /><Num v={s.missed} tone="text-amber-500" /><Num v={s.upcoming + s.live} tone="text-sky-500" />
                      <td className="px-3 py-2.5"><Tag tone={ATTENDANCE[s.attendance][1]}>{ATTENDANCE[s.attendance][0]}</Tag></td>
                    </tr>
                  ))}
                </Table>
              ) : view === "classes" ? (
                <Table head={["#", "Class", "When", "Mentor", ["Booked", "right"], ["Joined", "right"], ["Missed", "right"], ["Upcoming", "right"]]} empty={!classes.length}
                  count={listed(classes.length, find ? classes.length : data.totals.classes, "class")}>
                  {classes.map((c, i) => (
                    <tr key={c.id} className="hover:bg-muted/30">
                      <td className="py-2.5 pl-4 pr-3 tabular-nums text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2.5"><p className="font-medium">{c.title}</p><p className="text-xs text-muted-foreground">{[c.course, c.academy, c.online ? "" : "In person"].filter(Boolean).join(" · ")}</p></td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{when(c.start)}</td>
                      <td className="px-3 py-2.5">{c.mentor || <span className="text-muted-foreground">—</span>}</td>
                      <Num v={c.booked} tone="font-semibold" /><Num v={c.attended} tone="text-emerald-500" /><Num v={c.missed} tone="text-amber-500" /><Num v={c.upcoming + c.live} tone="text-sky-500" />
                    </tr>
                  ))}
                </Table>
              ) : view === "attendance" ? (
                <Table head={["Student", "CS", ["Booked", "right"], ["Joined", "right"], ["Missed", "right"], ["Upcoming", "right"]]} empty={!fullList.length}
                  count={listed(fullList.length, fullList.length, "student")}>
                  {fullList.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/30">
                      <td className="py-2.5 pl-4 pr-3"><Who p={s} /></td>
                      <td className="px-3 py-2.5"><CsCell cs={s.cs} /></td>
                      <Num v={s.booked} tone="font-semibold" /><Num v={s.attended} tone="text-emerald-500" /><Num v={s.missed} tone="text-amber-500" /><Num v={s.upcoming + s.live} tone="text-sky-500" />
                    </tr>
                  ))}
                </Table>
              ) : (
                <div className="grid gap-0 lg:grid-cols-[minmax(260px,320px)_1fr]">
                  {/* By CS — a row narrows the list beside it to their students. */}
                  <div className="border-b border-border/60 lg:border-b-0 lg:border-r">
                    <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">By CS · not signed in {data.inactive.days}+ days</p>
                    <div className="max-h-[32rem] divide-y divide-border/40 overflow-y-auto p-2">
                      <button type="button" onClick={() => setCs(null)} className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-muted/40", cs === null && "bg-muted/60 font-medium")}>
                        <span>Every CS</span><span className="tabular-nums">{data.inactive.total}</span>
                      </button>
                      {data.inactive.byCs.map((r) => {
                        const key = r.cs.toLowerCase();
                        return (
                          <button key={key || "none"} type="button" onClick={() => setCs(key)} className={cn("flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted/40", cs === key && "bg-muted/60 font-medium")}>
                            <span className="min-w-0">
                              <span className={cn("block truncate", !r.cs && "text-muted-foreground")}>{r.cs || NO_CS}</span>
                              {(r.team || r.never > 0) && <span className="block truncate text-xs font-normal text-muted-foreground">{[r.team, r.never ? `${r.never} never signed in` : ""].filter(Boolean).join(" · ")}</span>}
                            </span>
                            <span className="font-semibold tabular-nums">{r.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <Table head={["Student", "CS", "Last sign-in", ["Days away", "right"], "Phone"]} empty={!idle.length}
                    count={listed(idle.length, cs === null && !find ? data.inactive.total : idle.length, "student")}>
                    {idle.map((s) => (
                      <tr key={s.id} className="hover:bg-muted/30">
                        <td className="py-2.5 pl-4 pr-3"><Who p={s} /></td>
                        <td className="px-3 py-2.5"><CsCell cs={s.cs} /></td>
                        <td className="whitespace-nowrap px-3 py-2.5">{s.lastLoginAt ? date(s.lastLoginAt) : <Tag tone="bg-rose-500/10 text-rose-500">Never</Tag>}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{s.daysAway ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{s.phone || "—"}</td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
