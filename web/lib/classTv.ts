import { API_URL } from "@/lib/axios";

/*
 * The Class TV's data (backend services/classTvService.ts, 2026-11-14) and what the screen makes of it: where each
 * class stands against the clock, and the moments its mentor is called — five minutes before, and as it starts.
 */

export type Academy = "dubai" | "bangalore";
export interface TvVoice { url: string; seconds: number }
export interface TvMentor { id: string; name: string; photoUrl: string | null; voice: TvVoice | null }
export interface TvClass {
  id: string; title: string; course: string; module: string; startsAt: string; endsAt: string; durationMins: number;
  /** As the LMS has it: scheduled, live, ended or cancelled. */
  status: string; online: boolean; place: string; mentors: TvMentor[];
}
export interface ClassTvData {
  academy: Academy; academyName: string; timezone: string; day: string; serverTime: string; updatedAt: string | null;
  leadMinutes: number; status: "ok" | "error" | "loading"; error: string | null;
  classes: TvClass[]; voices: { soon: TvVoice | null; now: TvVoice | null };
}

/** A recording's address under the API. */
export const voiceUrl = (v: TvVoice | null | undefined) => (v ? `${API_URL}${v.url}` : null);

export async function fetchClassTv(academy: Academy): Promise<ClassTvData> {
  const res = await fetch(`${API_URL}/public/class-tv?academy=${academy}`, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { data?: ClassTvData; message?: string };
  if (!res.ok || !body.data) throw new Error(body.message ?? `Root answered ${res.status}`);
  return body.data;
}

export type Stage = "live" | "soon" | "later" | "done" | "cancelled";

/** Where a class stands at `now`: on, within a quarter of an hour, later today, over, or called off. */
export function stageOf(c: TvClass, now: number): Stage {
  if (c.status === "cancelled") return "cancelled";
  const start = Date.parse(c.startsAt), end = Date.parse(c.endsAt);
  if (c.status === "ended" || now >= end) return "done";
  if (now >= start) return "live";
  return start - now <= 15 * 60_000 ? "soon" : "later";
}

export type Moment = "soon" | "now";
export interface Call { key: string; moment: Moment; cls: TvClass }

/** How long after its moment a call may still be made — a screen that was busy, or just opened, is not too late. */
const CALL_WINDOW_MS = 75_000;

/**
 * The calls due at `now` that `said` doesn't have yet: `leadMinutes` before each class and as it starts. A class moved
 * to another time is called again at its new one (the time is in the key); a cancelled or ended class never.
 */
export function callsDue(classes: TvClass[], now: number, leadMinutes: number, said: (key: string) => boolean): Call[] {
  const due: Call[] = [];
  for (const cls of classes) {
    if (cls.status === "cancelled" || cls.status === "ended") continue;
    const start = Date.parse(cls.startsAt);
    if (!Number.isFinite(start)) continue;
    for (const [moment, at] of [["soon", start - leadMinutes * 60_000], ["now", start]] as [Moment, number][]) {
      const key = `${cls.id}|${cls.startsAt}|${moment}`;
      if (now >= at && now < at + CALL_WINDOW_MS && !said(key)) due.push({ key, moment, cls });
    }
  }
  // The class about to start is called before the one five minutes off.
  return due.sort((a, b) => (a.moment === b.moment ? a.cls.startsAt.localeCompare(b.cls.startsAt) : a.moment === "now" ? -1 : 1));
}

/** The lines a call plays after the chime: each mentor's own, then the common one for the moment. */
export function linesOf(call: Pick<Call, "moment" | "cls">, voices: ClassTvData["voices"]): string[] {
  return [...call.cls.mentors.map((m) => voiceUrl(m.voice)), voiceUrl(call.moment === "now" ? voices.now : voices.soon)].filter((u): u is string => !!u);
}

/** "3:00 pm", on the academy's own clock whatever the screen's. */
export const timeIn = (iso: string, zone: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true });

/** "5 min", "1 h 20 min" — rounded up, so a class 4½ minutes off reads "5 min". */
export function inWords(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
/** "Forex Mastery · Module 3", or the class's own title when it has no course. */
export const subjectOf = (c: TvClass) => [c.course || c.title, c.module].filter(Boolean).join(" · ") || "Class";
export const namesOf = (c: TvClass) => {
  const n = c.mentors.map((m) => m.name).filter(Boolean);
  return n.length <= 1 ? n[0] ?? "Mentor" : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
};
