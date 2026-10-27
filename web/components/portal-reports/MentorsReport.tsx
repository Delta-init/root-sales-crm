"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { AlertTriangle, ChevronDown, Loader2, RefreshCw, Search, Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import { BreakdownDialog, MeetingsTab, Opens, ProgramsTab, type Spec } from "@/components/portal-reports/MentorBreakdown";

/**
 * Reports → Mentors (the user, 2026-10-24: "the mentors report, same as the commission portal's"): every mentor, day
 * by day — classes held and cancelled, students' bookings and how many cancelled, attended, missed, their 1:1
 * meetings and the reviews students left, from the LMS, with the commission Tetra Commission credited them (pool
 * shares included). Tetra Commission's own Mentor Report as a Super Admin sees it (GET /service/mentor-report);
 * a row opens the mentor's days and reviews. Dubai days. Root admins only; read-only.
 */

interface Figures {
  classes?: number; held?: number; classesCancelled?: number; bookings?: number; bookingsCancelled?: number; attended?: number; missed?: number;
  meetings?: number; meetingsCancelled?: number; reviews?: number; lowRatings?: number; avgRating?: number | null;
  ratingCounts?: Record<string, number>; commission_usd?: number;
  /** Different students who booked / who came (a mentor's whole dates only, 2026-10-27). */
  students?: number; studentsAttended?: number;
}
interface Mentor { id: string; name: string; email: string; role: string; in_lms: boolean; lms_id?: string; total: Figures; days: (Figures & { day: string })[] }
interface Report { from: string; to: string; everyone: boolean; mentors: Mentor[]; lms: { available: boolean; message?: string }; students?: { booked: number; attended: number } | null }
interface Review {
  _id?: string; id?: string; rating: number; comment?: string; createdAt?: string; studentId?: { name?: string }; liveClassId?: { title?: string };
  /** A mentor rating or the feedback left after the class (2026-10-25); a rating may carry the same student's class comment. */
  kind?: "mentor_rating" | "class_feedback"; classComment?: string;
}

const dubaiToday = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const PRESETS: [string, string, () => [string, string]][] = [
  ["today", "Today", () => { const t = dubaiToday(); return [t, t]; }],
  ["yesterday", "Yesterday", () => { const y = shift(dubaiToday(), -1); return [y, y]; }],
  ["week", "Last 7 days", () => { const t = dubaiToday(); return [shift(t, -6), t]; }],
  ["month", "This month", () => { const t = dubaiToday(); return [`${t.slice(0, 8)}01`, t]; }],
];
const usd = (n: unknown) => `$${(Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }) : "");
const ROLE: Record<string, string> = { chief_mentor: "Chief Mentor", senior_mentor: "Senior Mentor", junior_mentor: "Junior Mentor", subjunior_mentor: "Sub-junior Mentor", assistance: "Assistance" };
const STAR_TONE: Record<number, string> = { 5: "bg-emerald-500", 4: "bg-emerald-400", 3: "bg-amber-400", 2: "bg-orange-500", 1: "bg-rose-500" };
const message = (e: unknown, fallback: string) => (e instanceof AxiosError && (e.response?.data as { message?: string } | undefined)?.message) || fallback;

function Rating({ f }: { f: Figures }) {
  if (!f.reviews) return <span className="text-muted-foreground/50">—</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
      <span className="font-semibold">{f.avgRating ?? "—"}</span>
      <span className="text-muted-foreground">({f.reviews}{f.lowRatings ? <span className="text-rose-500"> · {f.lowRatings} low</span> : null})</span>
    </span>
  );
}

/**
 * The figures of one row — a mentor's total or one of their days. Each number opens what is behind it (2026-10-27):
 * `open(kind, label)`. Only a mentor's whole dates count different students.
 */
function Cells({ r, open, total }: { r: Figures; open: (kind: string, label: string) => void; total?: boolean }) {
  const meetings = (r.meetings || 0) - (r.meetingsCancelled || 0);
  const o = (v: number | undefined, kind: string, label: string, tone: string) => <Opens value={v} onOpen={() => open(kind, label)} className={tone}>{v || 0}</Opens>;
  return (
    <>
      <td className="px-3 py-2.5 text-right tabular-nums">{o(r.held, "classes", "classes", "font-semibold")}<span className="text-muted-foreground"> / {r.classes || 0}</span></td>
      <td className="px-3 py-2.5 text-right tabular-nums">{o(r.classesCancelled, "cancelled_classes", "cancelled classes", "text-rose-500")}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{o(r.bookings, "bookings", "bookings", "font-semibold")}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{o(r.bookingsCancelled, "cancelled_bookings", "cancelled bookings", "text-rose-500")}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {total ? <>{o(r.students, "students", "students", "")}<span className="text-muted-foreground"> · {r.studentsAttended || 0} came</span></> : <span className="text-muted-foreground/50">·</span>}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{o(r.attended, "attended", "who came", "text-emerald-500")}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{o(r.missed, "missed", "who missed", "text-amber-500")}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {o(meetings, "meetings", "meetings", "")}
        {r.meetingsCancelled ? <span className="text-rose-500"> · <Opens value={r.meetingsCancelled} onOpen={() => open("cancelled_meetings", "cancelled meetings")} className="text-rose-500">{r.meetingsCancelled}✕</Opens></span> : null}
      </td>
      <td className="px-3 py-2.5"><Opens value={r.reviews} onOpen={() => open("classes", "classes and their reviews")}><Rating f={r} /></Opens></td>
      <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", r.commission_usd ? "text-emerald-500" : "text-muted-foreground/50")}>
        <Opens value={r.commission_usd} onOpen={() => open("commission", "commission")} className="text-emerald-500">{usd(r.commission_usd)}</Opens>
      </td>
    </>
  );
}

/** A mentor's reviews in the dates: how many of each star, and every review — the student, the class, the words. */
function MentorReviews({ m, from, to }: { m: Mentor; from: string; to: string }) {
  const counts = m.total.ratingCounts ?? {};
  const max = Math.max(1, ...[1, 2, 3, 4, 5].map((k) => counts[k] || 0));
  const [pages, setPages] = useState(1);
  const q = useQuery({
    queryKey: ["portal-reports", "mentor-reviews", m.lms_id, from, to, pages], retry: false, enabled: !!m.lms_id,
    queryFn: async () => {
      const all: Review[] = [];
      let total = 0;
      for (let page = 1; page <= pages; page++) {
        const d = (await api.get("/portal-reports/mentors/reviews", { params: { instructorId: m.lms_id, from, to, page } })).data.data as { reviews?: Review[]; total?: number };
        all.push(...(d?.reviews ?? []));
        total = d?.total ?? all.length;
      }
      return { reviews: all, total };
    },
  });
  const reviews = q.data?.reviews ?? [];
  return (
    <div className="grid gap-4 rounded-xl border border-border/60 bg-background p-4 md:grid-cols-[220px_1fr]">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reviews</p>
        <p className="mt-1 flex items-center gap-1.5 text-2xl font-bold">
          <Star className="h-5 w-5 fill-amber-400 text-amber-400" />{m.total.avgRating ?? "—"}
          <span className="text-sm font-normal text-muted-foreground">· {m.total.reviews} review{m.total.reviews === 1 ? "" : "s"}</span>
        </p>
        <div className="mt-3 space-y-1.5">
          {[5, 4, 3, 2, 1].map((k) => (
            <div key={k} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex w-7 items-center gap-0.5">{k}<Star className="h-3 w-3 fill-amber-400 text-amber-400" /></span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <span className={cn("block h-full rounded-full", STAR_TONE[k])} style={{ width: `${((counts[k] || 0) / max) * 100}%` }} />
              </span>
              <span className="w-6 text-right tabular-nums">{counts[k] || 0}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        {!m.lms_id ? <p className="text-sm text-muted-foreground">Not matched to an LMS instructor.</p>
          : q.isLoading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading the reviews…</p>
          : q.isError ? <p className="text-sm text-amber-500">{message(q.error, "The reviews didn't load.")}</p>
          : !reviews.length ? <p className="text-sm text-muted-foreground">No reviews in these dates.</p>
          : (
            <div className="max-h-96 divide-y divide-border/40 overflow-y-auto pr-1">
              {reviews.map((v, i) => (
                <div key={v._id || v.id || i} className="py-2.5 first:pt-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="inline-flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => <Star key={s} className={cn("h-3.5 w-3.5", v.rating >= s ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")} />)}
                    </span>
                    <span className="font-medium">{v.studentId?.name || "A student"}</span>
                    {v.liveClassId?.title && <span className="text-xs text-muted-foreground">· {v.liveClassId.title}</span>}
                    {/* Which kind (2026-10-25): a mentor rating, or the feedback left after the class. */}
                    {v.kind && (
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", v.kind === "class_feedback" ? "bg-sky-500/10 text-sky-500" : "bg-muted text-muted-foreground")}>
                        {v.kind === "class_feedback" ? "Class feedback" : "Mentor rating"}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">{when(v.createdAt)}</span>
                  </div>
                  {v.comment && <p className="mt-1 text-sm">{v.comment}</p>}
                  {v.classComment && <p className="mt-1 text-sm"><span className="text-xs font-medium text-sky-500">After the class: </span>{v.classComment}</p>}
                  {!v.comment && !v.classComment && <p className="mt-1 text-xs italic text-muted-foreground">No comment</p>}
                </div>
              ))}
              {(q.data?.total ?? 0) > reviews.length && (
                <button type="button" onClick={() => setPages((p) => p + 1)} className="w-full py-2 text-center text-xs font-medium text-primary hover:underline">
                  Show more ({(q.data?.total ?? 0) - reviews.length} left)
                </button>
              )}
            </div>
          )}
      </div>
    </div>
  );
}

const SUM_KEYS = ["held", "classes", "classesCancelled", "bookings", "bookingsCancelled", "attended", "missed", "meetings", "meetingsCancelled", "reviews", "commission_usd"] as const;

export function MentorsReportView() {
  const [preset, setPreset] = useState("today");
  const [range, setRange] = useState<[string, string]>(() => PRESETS[0]![2]());
  const [needle, setNeedle] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  // Mentors, Programs or Meetings (2026-10-27), and the breakdown window that is open, if any.
  const [tab, setTab] = useState<"mentors" | "programs" | "meetings">("mentors");
  const [spec, setSpec] = useState<Spec | null>(null);
  const [from, to] = range;
  const q = useQuery({
    queryKey: ["portal-reports", "mentors", from, to],
    queryFn: async () => (await api.get("/portal-reports/mentors", { params: { from, to } })).data.data as Report,
    retry: 1,
  });
  const data = q.data;
  const find = needle.trim().toLowerCase();
  const rows = useMemo(() => (data?.mentors ?? []).filter((m) => !find || `${m.name} ${m.email}`.toLowerCase().includes(find)), [data, find]);
  const sum = useMemo(() => {
    const t = Object.fromEntries(SUM_KEYS.map((k) => [k, 0])) as Record<(typeof SUM_KEYS)[number], number>;
    let ratingSum = 0;
    for (const m of rows) {
      for (const k of SUM_KEYS) t[k] += Number(m.total?.[k]) || 0;
      ratingSum += (Number(m.total?.avgRating) || 0) * (Number(m.total?.reviews) || 0);
    }
    return { ...t, avg: t.reviews ? Math.round((ratingSum / t.reviews) * 10) / 10 : null };
  }, [rows]);

  const pick = (key: string) => { const p = PRESETS.find((x) => x[0] === key)!; setPreset(key); setRange(p[2]()); setOpen(null); };
  const setDay = (i: 0 | 1, v: string) => {
    if (!v) return;
    setPreset("custom");
    setRange((r) => { const next: [string, string] = [...r]; next[i] = v; if (next[0] > next[1]) next[i === 0 ? 1 : 0] = v; return next; });
  };

  if (q.error instanceof AxiosError && q.error.response?.status === 403) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">Reports are for root admins.</CardContent></Card>;
  }

  // The whole list's — or, searched down to one mentor, theirs alone.
  const one = find && rows.length === 1 ? rows[0]! : null;
  const who = one ? one.name : find ? null : "Every mentor";
  const openKind = (kind: string, label: string) =>
    setSpec({ kind, from, to, ...(one ? { mentorId: one.lms_id || one.id } : {}), title: `${who ? `${who} — ` : ""}${label}` });
  const attendance = sum.attended + sum.missed ? Math.round((sum.attended / (sum.attended + sum.missed)) * 100) : null;
  const students = one ? { booked: one.total.students, attended: one.total.studentsAttended } : data?.students;
  // Each card opens what is behind it (2026-10-27) — [label, value, under it, kind, anything there].
  const cards: [string, string | number, string, string, number | undefined][] = [
    ["Classes held", `${sum.held} / ${sum.classes}`, "held / scheduled", "classes", sum.classes],
    ["Classes cancelled", sum.classesCancelled, "which, and how many had booked", "cancelled_classes", sum.classesCancelled],
    ["Bookings", sum.bookings, `${sum.bookingsCancelled} cancelled`, "bookings", sum.bookings],
    ["Bookings cancelled", sum.bookingsCancelled, "by the students", "cancelled_bookings", sum.bookingsCancelled],
    ["Students", students?.booked ?? "—", students ? `${students.attended ?? 0} came — each once` : "needs the updates", "students", students?.booked],
    ["Attended", sum.attended, attendance === null ? "—" : `${attendance}% of those due`, "attended", sum.attended],
    ["Missed", sum.missed, "booked, didn't come", "missed", sum.missed],
    ["Meetings", sum.meetings - sum.meetingsCancelled, `${sum.meetingsCancelled} cancelled`, "meetings", sum.meetings],
    ["Reviews", sum.reviews, sum.avg !== null ? `★ ${sum.avg} average · by class` : "none yet", "classes", sum.reviews],
    ["Commission", usd(sum.commission_usd), "credited, pool shares included", "commission", sum.commission_usd],
  ];

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

      {data?.lms && !data.lms.available && (
        <p className="flex gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />LMS figures aren&apos;t available: {data.lms.message}. Commission still shows.</p>
      )}

      {q.isError ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            {message(q.error, q.error instanceof AxiosError && q.error.response?.status === 404 ? "Root's server is still on the previous version — this tab shows once it is updated." : "Could not load the report. Refresh in a moment.")}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mentors, Programs, Meetings (2026-10-27). */}
          <div className="flex flex-wrap gap-1" role="group" aria-label="View">
            {([["mentors", "Mentors"], ["programs", "Programs"], ["meetings", "Meetings"]] as const).map(([k, l]) => (
              <Button key={k} size="sm" variant={tab === k ? "default" : "outline"} onClick={() => setTab(k)}>{l}</Button>
            ))}
          </div>
          {tab === "programs" && <ProgramsTab from={from} to={to} onOpen={setSpec} />}
          {tab === "meetings" && <MeetingsTab from={from} to={to} />}
          {tab === "mentors" && <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {cards.map(([label, value, sub, kind, has]) => (
              <button key={label} type="button" disabled={!has || q.isLoading} className="text-left disabled:cursor-default"
                onClick={() => (kind === "meetings" && !one ? setTab("meetings") : openKind(kind, label.toLowerCase()))}>
                <Card className={cn("h-full transition-colors", has && "hover:border-primary/40")}><CardContent className="p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                  <p className="mt-1 text-2xl font-bold">{q.isLoading ? "…" : value}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>
                </CardContent></Card>
              </button>
            ))}
          </div>

          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="flex items-center gap-2 border-b border-border/60 p-3">
                <div className="relative w-full max-w-xs">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={needle} onChange={(e) => setNeedle(e.target.value)} placeholder="Find a mentor…" className="h-9 pl-9" />
                </div>
                <span className="ml-auto text-sm text-muted-foreground">{rows.length} mentor{rows.length === 1 ? "" : "s"}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Mentor</th>
                      <th className="px-3 py-3 text-right font-semibold" title="Classes held / scheduled">Classes held</th>
                      <th className="px-3 py-3 text-right font-semibold" title="Classes cancelled">Class cancelled</th>
                      <th className="px-3 py-3 text-right font-semibold" title="Students' bookings on their classes">Bookings</th>
                      <th className="px-3 py-3 text-right font-semibold" title="Bookings the students cancelled">Booking cancelled</th>
                      <th className="px-3 py-3 text-right font-semibold" title="Different students who booked · who came">Students</th>
                      <th className="px-3 py-3 text-right font-semibold">Attended</th>
                      <th className="px-3 py-3 text-right font-semibold">Missed</th>
                      <th className="px-3 py-3 text-right font-semibold" title="1:1 meetings held or booked · cancelled">Meetings</th>
                      <th className="px-3 py-3 font-semibold" title="Reviews students left (average, how many, low = 1–2★)">Reviews</th>
                      <th className="px-3 py-3 text-right font-semibold" title="Commission credited in these dates">Commission</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {q.isLoading && <tr><td colSpan={11} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
                    {!q.isLoading && !rows.length && <tr><td colSpan={11} className="px-4 py-10 text-center text-muted-foreground">No mentors to show.</td></tr>}
                    {rows.map((m) => {
                      const key = m.email || m.id || m.name;
                      const isOpen = open === key;
                      return (
                        <Fragment key={key}>
                          <tr className={cn("cursor-pointer hover:bg-muted/40", isOpen && "bg-muted/40")} onClick={() => setOpen(isOpen ? null : key)}>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                                <div className="min-w-0">
                                  <p className="truncate font-medium">{m.name}</p>
                                  <p className="truncate text-xs text-muted-foreground">{ROLE[m.role] || m.role || "LMS only"}{!m.in_lms && m.role ? " · no LMS activity" : ""}</p>
                                </div>
                              </div>
                            </td>
                            <Cells r={m.total} total open={(kind, label) => setSpec({ kind, from, to, mentorId: m.lms_id || m.id, title: `${m.name} — ${label}` })} />
                          </tr>
                          {isOpen && (m.days.length ? m.days.map((d) => (
                            <tr key={d.day} className="bg-muted/20 text-[13px]">
                              <td className="py-2 pl-12 pr-4 text-muted-foreground">{dayLabel(d.day)}</td>
                              <Cells r={d} open={(kind, label) => setSpec({ kind, from: d.day, to: d.day, mentorId: m.lms_id || m.id, title: `${m.name} — ${label}, ${dayLabel(d.day)}` })} />
                            </tr>
                          )) : (
                            <tr className="bg-muted/20"><td colSpan={11} className="py-3 pl-12 text-sm text-muted-foreground">Nothing in these dates.</td></tr>
                          ))}
                          {isOpen && (m.total.reviews ?? 0) > 0 && (
                            <tr className="bg-muted/20"><td colSpan={11} className="px-4 pb-4 pt-1 sm:pl-12"><MentorReviews m={m} from={from} to={to} /></td></tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          </>}
        </>
      )}
      <BreakdownDialog spec={spec} onClose={() => setSpec(null)} />
    </div>
  );
}
