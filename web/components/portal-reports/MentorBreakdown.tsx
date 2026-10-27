"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { Loader2, Search, Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";

/**
 * What is behind each number of Reports → Mentors (the user, 2026-10-27: "each count we can break down … do the root
 * mentors report also"), as Tetra Commission's Mentor Report shows it: one window for any number — every mentor's, one
 * mentor's, one day's or one Program's (GET /portal-reports/mentors/details → Tetra Commission → the LMS) — and the
 * Programs and Meetings tabs, each number of which opens it too.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
export interface Spec { kind: string; title: string; from: string; to: string; mentorId?: string; programId?: string }
interface Details { kind: string; total: number; rows: Row[]; lms?: { available: boolean; message?: string } }

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }) : "—");
const usd = (v: unknown) => `$${(Number(v) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const CATEGORY: Record<string, string> = { course_pitch: "Course pitch", overview: "Overview", other: "Other", "": "No category" };
const STATUS_TONE: Record<string, string> = { attended: "bg-emerald-500/10 text-emerald-500", missed: "bg-amber-500/10 text-amber-500", cancelled: "bg-rose-500/10 text-rose-500", booked: "bg-sky-500/10 text-sky-500" };
const message = (e: unknown, fallback: string) => (e instanceof AxiosError && (e.response?.data as { message?: string } | undefined)?.message) || fallback;

const Muted = ({ children }: { children: ReactNode }) => <span className="block text-xs text-muted-foreground">{children}</span>;
const Pill = ({ tone, children }: { tone?: string; children: ReactNode }) => <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", tone)}>{children}</span>;
function Rating({ avg, n }: { avg?: number | null; n?: number }) {
  if (!n) return <span className="text-muted-foreground/50">—</span>;
  return <span className="inline-flex items-center gap-1 whitespace-nowrap"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{avg ?? "—"}<span className="text-muted-foreground">({n})</span></span>;
}

type Col = [string, (r: Row) => ReactNode, ((r: Row) => string)?];
const CLASSES: Col[] = [
  ["When", (r) => when(r.start)],
  ["Class", (r) => <>{r.title}<Muted>{[r.program, r.course].filter(Boolean).join(" · ") || "—"}</Muted></>, (r) => `${r.title} ${r.program} ${r.course}`],
  ["Mentor", (r) => r.mentor, (r) => r.mentor],
  ["Booked", (r) => r.booked], ["Came", (r) => <span className="text-emerald-500">{r.attended}</span>], ["Missed", (r) => <span className="text-amber-500">{r.missed}</span>],
  ["Cancelled", (r) => <span className="text-rose-500">{r.cancelled}</span>], ["Reviews", (r) => <Rating avg={r.avgRating} n={r.reviews} />],
];
const BOOKINGS: Col[] = [
  ["Student", (r) => <>{r.student || "A student"}<Muted>{r.studentEmail}</Muted></>, (r) => `${r.student} ${r.studentEmail}`],
  ["Class", (r) => <>{r.class}<Muted>{when(r.classStart)}{r.program ? ` · ${r.program}` : ""}</Muted></>, (r) => `${r.class} ${r.program}`],
  ["Mentor", (r) => r.mentor, (r) => r.mentor],
  ["Status", (r) => <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>, (r) => r.status],
  ["Booked", (r) => when(r.bookedAt)],
  ["Came / cancelled", (r) => (r.status === "cancelled" ? <span className="text-rose-500">{when(r.cancelledAt)}</span> : r.attendedAt ? when(r.attendedAt) : "—")],
];
const MEETINGS: Col[] = [
  ["When", (r) => <>{when(r.start)}<Muted>{r.durationMins} min · {r.online ? "online" : r.location || "in person"}</Muted></>],
  ["Meeting", (r) => <>{r.title}<Muted>{CATEGORY[r.category] ?? r.category} · {r.meetingKind}</Muted></>, (r) => `${r.title} ${CATEGORY[r.category] ?? ""} ${r.meetingKind}`],
  ["Mentor", (r) => r.mentor, (r) => r.mentor],
  ["With", (r) => (r.attendees || []).join(", ") || "—", (r) => (r.attendees || []).join(" ")],
  ["Status", (r) => (r.cancelled ? <Pill tone={STATUS_TONE.cancelled}>cancelled {when(r.cancelledAt)}</Pill>
    : new Date(r.start) < new Date() ? <Pill tone={STATUS_TONE.attended}>held</Pill> : <Pill tone={STATUS_TONE.booked}>booked</Pill>)],
  ["Booked by", (r) => <>{r.bookedBy || "—"}<Muted>{r.bookedVia === "portal" ? "from Tetra Commission" : r.bookedVia === "lms" ? "in the LMS" : ""}</Muted></>, (r) => r.bookedBy],
];
const COLUMNS: Record<string, Col[]> = {
  classes: CLASSES, cancelled_classes: CLASSES,
  bookings: BOOKINGS, cancelled_bookings: BOOKINGS, attended: BOOKINGS, missed: BOOKINGS,
  students: [
    ["Student", (r) => <>{r.student || "A student"}<Muted>{r.studentEmail}</Muted></>, (r) => `${r.student} ${r.studentEmail}`],
    ["Booked", (r) => r.booked], ["Came", (r) => <span className="text-emerald-500">{r.attended}</span>], ["Missed", (r) => <span className="text-amber-500">{r.missed}</span>],
    ["Cancelled", (r) => <span className="text-rose-500">{r.cancelled}</span>], ["Classes", (r) => r.classes],
    ["Mentors", (r) => (r.mentors || []).join(", "), (r) => (r.mentors || []).join(" ")], ["Last class", (r) => when(r.lastClass)],
  ],
  meetings: MEETINGS, cancelled_meetings: MEETINGS,
  programs: [
    ["Program", (r) => <>{r.title}<Muted>{r.course}{r.status === "stopped" ? " · stopped" : ""} · {r.startDate} → {r.endDate}</Muted></>, (r) => `${r.title} ${r.course}`],
    ["Mentor", (r) => <>{r.mentor}{r.coMentors?.length ? <Muted>with {r.coMentors.join(", ")}</Muted> : null}</>, (r) => `${r.mentor} ${(r.coMentors || []).join(" ")}`],
    ["Students", (r) => r.students], ["Held", (r) => r.held], ["Cancelled", (r) => <span className="text-rose-500">{r.cancelled}</span>],
    ["Bookings", (r) => r.bookings], ["Came", (r) => <span className="text-emerald-500">{r.attended}</span>], ["Missed", (r) => <span className="text-amber-500">{r.missed}</span>],
    ["Attendance", (r) => (r.attendancePct == null ? "—" : `${r.attendancePct}%`)], ["Reviews", (r) => <Rating avg={r.avgRating} n={r.reviews} />],
  ],
  commission: [
    ["When", (r) => when(r.at)], ["Mentor", (r) => r.mentor, (r) => r.mentor],
    ["Student", (r) => <>{r.student || "—"}<Muted>{r.studentCode}</Muted></>, (r) => `${r.student} ${r.studentCode}`],
    ["From", (r) => <>{r.request || "—"}<Muted>{r.method}{r.pool ? " · pool share" : ""}</Muted></>, (r) => `${r.request} ${r.method}`],
    ["Commission", (r) => <span className="font-semibold text-emerald-500">{usd(r.usd)}</span>],
  ],
};

export function useDetails(spec: Partial<Spec> | null, enabled = true) {
  return useQuery({
    queryKey: ["portal-reports", "mentor-details", spec?.kind, spec?.from, spec?.to, spec?.mentorId ?? "", spec?.programId ?? ""],
    queryFn: async () => (await api.get("/portal-reports/mentors/details", {
      params: { kind: spec!.kind, from: spec!.from, to: spec!.to, ...(spec?.mentorId ? { mentorId: spec.mentorId } : {}), ...(spec?.programId ? { programId: spec.programId } : {}) },
    })).data.data as Details,
    enabled: enabled && !!spec?.kind, retry: false,
  });
}

/** The rows of one kind, with a search — in the window or on a tab. */
export function DetailTable({ kind, data, isLoading, error, maxHeight = "max-h-[60vh]" }: { kind: string; data?: Details; isLoading: boolean; error: unknown; maxHeight?: string }) {
  const [q, setQ] = useState("");
  const cols = COLUMNS[kind] ?? [];
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => !needle || cols.some(([, , text]) => text && String(text(r) ?? "").toLowerCase().includes(needle))), [data, needle, cols]);
  if (isLoading) return <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>;
  if (error) return <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm">{message(error, error instanceof AxiosError && error.response?.status === 404 ? "Root's server is still on the previous version — this shows once it is updated." : "Could not load these. Try again in a moment.")}</p>;
  if (data?.lms && !data.lms.available) return <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm">{data.lms.message}</p>;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find…" className="h-9 pl-9" />
        </div>
        <span className="ml-auto text-sm text-muted-foreground">{rows.length}{(data?.total ?? 0) > (data?.rows?.length ?? 0) ? ` of the first ${data!.rows.length} (${data!.total} in all)` : ""}</span>
      </div>
      <div className={cn("overflow-auto rounded-lg border border-border/60", maxHeight)}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>{cols.map(([h]) => <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {!rows.length && <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-muted-foreground">Nothing here.</td></tr>}
            {rows.map((r, i) => <tr key={r.id ?? i} className="align-top hover:bg-muted/40">{cols.map(([h, cell]) => <td key={h} className="px-3 py-2">{cell(r)}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The window: `spec` or null. */
export function BreakdownDialog({ spec, onClose }: { spec: Spec | null; onClose: () => void }) {
  const q = useDetails(spec, !!spec);
  return (
    <Dialog open={!!spec} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{spec?.title}</DialogTitle>
          <DialogDescription>{spec ? `${spec.from === spec.to ? spec.from : `${spec.from} – ${spec.to}`} · Dubai time` : ""}</DialogDescription>
        </DialogHeader>
        {spec && <DetailTable kind={spec.kind} data={q.data} isLoading={q.isLoading} error={q.error} />}
      </DialogContent>
    </Dialog>
  );
}

/** A number that opens what is behind it. */
export function Opens({ value, onOpen, className, children }: { value?: number; onOpen: () => void; className?: string; children?: ReactNode }) {
  if (!value) return <span className="text-muted-foreground/50">{children ?? 0}</span>;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className={cn("underline-offset-2 hover:underline", className)}>
      {children ?? value}
    </button>
  );
}

const Stat = ({ label, value }: { label: string; value: ReactNode }) => (
  <Card><CardContent className="p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></CardContent></Card>
);

/** Programs: each Program running in the dates — every number opens its list. */
export function ProgramsTab({ from, to, onOpen }: { from: string; to: string; onOpen: (s: Spec) => void }) {
  const q = useDetails({ kind: "programs", from, to });
  const rows = q.data?.rows ?? [];
  if (q.isLoading || q.error || (q.data?.lms && !q.data.lms.available)) return <DetailTable kind="programs" data={q.data} isLoading={q.isLoading} error={q.error} />;
  const sum = rows.reduce((t, r) => { for (const k of ["students", "held", "cancelled", "attended", "missed"]) t[k] = (t[k] ?? 0) + (r[k] || 0); return t; }, {} as Record<string, number>);
  const open = (r: Row, kind: string, label: string) => onOpen({ kind, title: `${r.title} — ${label}`, from, to, programId: r.id });
  const att = (sum.attended ?? 0) + (sum.missed ?? 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Programs" value={rows.length} /><Stat label="Students on them" value={sum.students ?? 0} /><Stat label="Classes held" value={sum.held ?? 0} />
        <Stat label="Cancelled" value={sum.cancelled ?? 0} /><Stat label="Attendance" value={att ? `${Math.round(((sum.attended ?? 0) / att) * 100)}%` : "—"} />
      </div>
      <Card className="overflow-hidden"><CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>{["Program", "Mentor", "Students", "Held", "Cancelled", "Bookings", "Booking cancelled", "Came", "Missed", "Attendance", "Reviews"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {!rows.length && <tr><td colSpan={11} className="px-4 py-10 text-center text-muted-foreground">No Programs running in these dates.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="align-top hover:bg-muted/40">
                <td className="px-3 py-2.5"><p className="font-medium">{r.title}</p><Muted>{r.course}{r.status === "stopped" ? " · stopped" : ""} · {r.repeat} · {r.startDate} → {r.endDate}</Muted></td>
                <td className="px-3 py-2.5">{r.mentor}{r.coMentors?.length ? <Muted>with {r.coMentors.join(", ")}</Muted> : null}</td>
                <td className="px-3 py-2.5"><Opens value={r.students} onOpen={() => open(r, "students", "students who booked")} /></td>
                <td className="px-3 py-2.5"><Opens value={r.held} onOpen={() => open(r, "classes", "classes")} className="font-semibold" /></td>
                <td className="px-3 py-2.5"><Opens value={r.cancelled} onOpen={() => open(r, "cancelled_classes", "cancelled classes")} className="text-rose-500" /></td>
                <td className="px-3 py-2.5"><Opens value={r.bookings} onOpen={() => open(r, "bookings", "bookings")} /></td>
                <td className="px-3 py-2.5"><Opens value={r.bookingsCancelled} onOpen={() => open(r, "cancelled_bookings", "cancelled bookings")} className="text-rose-500" /></td>
                <td className="px-3 py-2.5"><Opens value={r.attended} onOpen={() => open(r, "attended", "who came")} className="text-emerald-500" /></td>
                <td className="px-3 py-2.5"><Opens value={r.missed} onOpen={() => open(r, "missed", "who missed")} className="text-amber-500" /></td>
                <td className="px-3 py-2.5">{r.attendancePct == null ? "—" : `${r.attendancePct}%`}</td>
                <td className="px-3 py-2.5"><Opens value={r.reviews} onOpen={() => open(r, "classes", "classes and their reviews")}><Rating avg={r.avgRating} n={r.reviews} /></Opens></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}

type MeetingFilter = { mentor: string; category: string | null; cancelled: boolean | null };
const NO_FILTER: MeetingFilter = { mentor: "", category: null, cancelled: null };

/** Meetings: every meeting in the dates — by mentor and by category, each count a filter on the list below. */
export function MeetingsTab({ from, to }: { from: string; to: string }) {
  const q = useDetails({ kind: "meetings", from, to });
  const [filter, setFilter] = useState<MeetingFilter>(NO_FILTER);
  const all = useMemo(() => q.data?.rows ?? [], [q.data]);
  const byMentor = useMemo(() => {
    const m = new Map<string, Record<string, any>>();
    for (const r of all) {
      const x = m.get(r.mentor) ?? { mentor: r.mentor, total: 0, cancelled: 0, course_pitch: 0, overview: 0, other: 0, "": 0 };
      x.total++;
      if (r.cancelled) x.cancelled++; else x[r.category ?? ""] = (x[r.category ?? ""] || 0) + 1;
      m.set(r.mentor, x);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [all]);
  if (q.isLoading || q.error || (q.data?.lms && !q.data.lms.available)) return <DetailTable kind="meetings" data={q.data} isLoading={q.isLoading} error={q.error} />;
  const set = (f: Partial<MeetingFilter>) => setFilter({ ...NO_FILTER, ...f });
  const shown: Details = { ...q.data!, rows: all.filter((r) => (!filter.mentor || r.mentor === filter.mentor)
    && (filter.cancelled === null || r.cancelled === filter.cancelled) && (filter.category === null || (!r.cancelled && (r.category ?? "") === filter.category))) };
  const t = byMentor.reduce((s, x) => { for (const k of ["total", "cancelled", "course_pitch", "overview", "other"]) s[k] = (s[k] ?? 0) + (x[k] || 0); return s; }, {} as Record<string, number>);
  const count = (n: number, f: Partial<MeetingFilter>, tone?: string) => <Opens value={n} onOpen={() => set(f)} className={tone} />;
  const filtered = !!filter.mentor || filter.category !== null || filter.cancelled !== null;
  const cards: [string, number, Partial<MeetingFilter>][] = [
    ["Meetings", t.total ?? 0, {}], ["Held or booked", (t.total ?? 0) - (t.cancelled ?? 0), { cancelled: false }], ["Cancelled", t.cancelled ?? 0, { cancelled: true }],
    ["Course pitch", t.course_pitch ?? 0, { category: "course_pitch" }], ["Overview", t.overview ?? 0, { category: "overview" }], ["Other", t.other ?? 0, { category: "other" }],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {cards.map(([l, v, f]) => (
          <button key={l} type="button" onClick={() => set(f)} className="text-left">
            <Card className="h-full transition-colors hover:border-primary/40"><CardContent className="p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{l}</p><p className="mt-1 text-2xl font-bold">{v}</p></CardContent></Card>
          </button>
        ))}
      </div>
      <Card className="overflow-hidden"><CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>{["Mentor", "Meetings", "Course pitch", "Overview", "Other", "No category", "Cancelled"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {!byMentor.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No meetings in these dates.</td></tr>}
            {byMentor.map((x) => (
              <tr key={x.mentor} className={cn("hover:bg-muted/40", filter.mentor === x.mentor && "bg-muted/40")}>
                <td className="px-3 py-2.5 font-medium">{x.mentor || "—"}</td>
                <td className="px-3 py-2.5">{count(x.total, { mentor: x.mentor }, "font-semibold")}</td>
                <td className="px-3 py-2.5">{count(x.course_pitch, { mentor: x.mentor, category: "course_pitch" })}</td>
                <td className="px-3 py-2.5">{count(x.overview, { mentor: x.mentor, category: "overview" })}</td>
                <td className="px-3 py-2.5">{count(x.other, { mentor: x.mentor, category: "other" })}</td>
                <td className="px-3 py-2.5">{count(x[""], { mentor: x.mentor, category: "" })}</td>
                <td className="px-3 py-2.5">{count(x.cancelled, { mentor: x.mentor, cancelled: true }, "text-rose-500")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
      <div>
        <p className="mb-2 flex items-center gap-2 text-sm font-medium">
          {filtered ? [filter.mentor, filter.cancelled === true ? "cancelled" : filter.cancelled === false ? "held or booked" : null, filter.category !== null ? CATEGORY[filter.category] : null].filter(Boolean).join(" · ") : "Every meeting"}
          {filtered && <button type="button" onClick={() => set({})} className="text-xs font-normal text-primary hover:underline">Show all</button>}
        </p>
        <DetailTable kind="meetings" data={shown} isLoading={false} error={null} maxHeight="max-h-[70vh]" />
      </div>
    </div>
  );
}
