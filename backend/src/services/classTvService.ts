import { callTarget, httpError, resolveTarget } from "../lib/targetClient.js";
import { hrmsSigningConfigured, workModes } from "../lib/hrmsClient.js";
import { ClassVoice } from "../models/ClassVoice.js";

/*
 * Class TV (the user, 2026-11-14: "a public link for the mentors who have classes… with the mentor's name, with
 * audio; text to speech never works, so record from here"): an open screen for the office — one for Dubai, one for
 * Bangalore — with the academy's classes today: who teaches each, the course, the time, where (the pod or room), and
 * whether it is still to come, on now or over. Five minutes before a class and again as it starts, the screen calls
 * its mentor: a chime, then the mentor's own recorded line and a common one after it. The lines are recorded on the
 * Mentor voices page and kept here (models/ClassVoice.ts) — nothing is spoken by a browser.
 *
 * The classes are the LMS's (GET /service/mentors, the call the Mentor calendar makes), asked at most once a minute
 * for each academy however many screens there are; faces are HRMS photos, as on the Sales TV. Classes only — never a
 * mentor's meetings, which have a student in them. The open answer carries names, courses, times and places: never an
 * email.
 */

export const ACADEMIES = ["dubai", "bangalore"] as const;
export type Academy = (typeof ACADEMIES)[number];
const ZONES: Record<Academy, { name: string; zone: string; offsetMin: number }> = {
  dubai: { name: "Dubai", zone: "Asia/Dubai", offsetMin: 240 },
  bangalore: { name: "Bangalore", zone: "Asia/Kolkata", offsetMin: 330 },
};
/** How long before a class the screen first calls its mentor. */
export const LEAD_MINUTES = 5;
const EVERY_MS = 60_000;
const PHOTO_MS = 10 * 60_000;
const PHOTO_FAIL_MS = 2 * 60_000;
const PHOTO_WAIT_MS = 2_500;
/** A recording as it is kept: a WAV of at most this much — the page stops at 12 seconds of mono speech, about 530 KB;
 *  as base64 it must stay inside this API's 1 MB body. */
export const VOICE_MAX_BYTES = 640 * 1024;
const COMMON_KEYS = ["common:soon", "common:now"] as const;
const KEY = /^(mentor:[a-f\d]{24}|common:soon|common:now)$/i;

export const academyOf = (v: unknown): Academy => (String(v ?? "").toLowerCase() === "bangalore" ? "bangalore" : "dubai");
/** "Bangalore Academy" / "Banglore" → bangalore; anything else, or nothing → dubai (as CS Portal reads a location). */
const academyNamed = (name: unknown): Academy => (/bangal|banglo|bengal/i.test(String(name ?? "")) ? "bangalore" : "dubai");

// ── The LMS's answer ─────────────────────────────────────────────────────────

interface LmsClass {
  id: string; title: string | null; startsAt: string; durationMins: number; status: string;
  course?: string | null; module?: string | null;
  /** From an LMS that says where a class is held (2026-11-14); absent from one before that. */
  online?: boolean; place?: string | null; academy?: string | null;
}
interface LmsMentor { id: string; name: string; email: string; academy?: { id: string; name: string } | null; classes?: LmsClass[] }

/** The academy's day now — its date, and the instants it starts and ends. */
export function dayOf(academy: Academy, now = Date.now()): { day: string; from: Date; to: Date } {
  const off = ZONES[academy].offsetMin * 60_000;
  const day = new Date(now + off).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${day}T00:00:00.000Z`) - off);
  return { day, from, to: new Date(from.getTime() + 86_400_000 - 1) };
}

interface BoardMentor { id: string; name: string; email: string }
interface BoardClass {
  id: string; title: string; course: string; module: string; startsAt: string; endsAt: string; durationMins: number;
  status: string; online: boolean; place: string; mentors: BoardMentor[];
}
interface Loaded { day: string; classes: BoardClass[]; mentors: Array<BoardMentor & { academy: Academy }> }

/**
 * The academy's classes today, each once with everybody who teaches it (a co-mentored class comes under each of them).
 * A class is the academy's by its own academy when the LMS says it, else by its first mentor's.
 */
export function classesOf(academy: Academy, mentors: LmsMentor[], window: { day: string; from: Date; to: Date }): Loaded {
  const byId = new Map<string, { c: LmsClass; mentors: LmsMentor[] }>();
  for (const m of mentors) {
    for (const c of m.classes ?? []) {
      if (!c?.id) continue;
      const had = byId.get(c.id);
      if (had) had.mentors.push(m);
      else byId.set(c.id, { c, mentors: [m] });
    }
  }
  const classes: BoardClass[] = [];
  for (const { c, mentors: who } of byId.values()) {
    const at = Date.parse(c.startsAt);
    if (!Number.isFinite(at) || at < window.from.getTime() || at > window.to.getTime()) continue;
    if (academyNamed(c.academy ?? who[0]?.academy?.name) !== academy) continue;
    const mins = Number(c.durationMins) > 0 ? Number(c.durationMins) : 60;
    classes.push({
      id: c.id, title: String(c.title ?? "").trim(), course: String(c.course ?? "").trim(), module: String(c.module ?? "").trim(),
      startsAt: new Date(at).toISOString(), endsAt: new Date(at + mins * 60_000).toISOString(), durationMins: mins,
      status: String(c.status ?? "scheduled"), online: c.online !== false, place: String(c.place ?? "").trim(),
      mentors: who.map((m) => ({ id: m.id, name: String(m.name ?? "").trim(), email: String(m.email ?? "").toLowerCase() }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  classes.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title));
  return {
    day: window.day, classes,
    mentors: mentors.map((m) => ({ id: m.id, name: String(m.name ?? "").trim(), email: String(m.email ?? "").toLowerCase(), academy: academyNamed(m.academy?.name) })),
  };
}

const state = new Map<Academy, { data: Loaded | null; at: number; askedAt: number; error: string | null; inflight: Promise<void> | null }>();
const stateOf = (academy: Academy) => {
  let s = state.get(academy);
  if (!s) { s = { data: null, at: 0, askedAt: 0, error: null, inflight: null }; state.set(academy, s); }
  return s;
};

function refresh(academy: Academy, now: number): Promise<void> {
  const s = stateOf(academy);
  if (s.inflight) return s.inflight;
  // A day's board never outlives its day: asked again at once when the date has moved on.
  const window = dayOf(academy, now);
  if (now - s.askedAt < EVERY_MS && s.data?.day === window.day) return Promise.resolve();
  if (now - s.askedAt < EVERY_MS && !s.data && s.error) return Promise.resolve();
  s.askedAt = now;
  s.inflight = (async () => {
    try {
      const target = await resolveTarget("lms");
      const params = new URLSearchParams({ from: window.from.toISOString(), to: window.to.toISOString(), allAcademies: "1" });
      if (target.remoteOrgId) params.set("remoteOrgId", target.remoteOrgId);
      const answer = await callTarget<{ mentors?: LmsMentor[] }>(target, `/mentors?${params.toString()}`, { method: "GET", verb: "list today's classes" });
      s.data = classesOf(academy, answer.mentors ?? [], window);
      s.at = Date.now();
      s.error = null;
    } catch (err) {
      s.error = (err as Error)?.message || "The LMS can't be reached";
      // Yesterday's classes are not today's: kept through a failure only while it is still their day.
      if (s.data && s.data.day !== window.day) s.data = null;
    } finally {
      s.inflight = null;
    }
  })();
  return s.inflight;
}

// ── Faces (HRMS, as the Sales TV's) ──────────────────────────────────────────

const photos = new Map<string, { url: string | null; until: number }>();
let photoInflight: Promise<void> | null = null;
const within = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise((ok) => setTimeout(ok, ms))]);

function refreshPhotos(people: BoardMentor[], now: number): Promise<void> {
  if (photoInflight) return photoInflight;
  if (!hrmsSigningConfigured()) return Promise.resolve();
  const want = new Map<string, string>();
  for (const p of people) {
    if (!p.email || want.size >= 300) continue;
    const known = photos.get(p.email);
    if (!known || known.until <= now) want.set(p.email, p.name);
  }
  if (!want.size) return Promise.resolve();
  const asked = [...want].map(([email, name]) => ({ email, name: name || undefined }));
  photoInflight = (async () => {
    try {
      const rows = await workModes(asked);
      const at = Date.now();
      asked.forEach((p, i) => {
        const url = rows[i] && typeof rows[i]!.photoUrl === "string" && /^https?:\/\//.test(rows[i]!.photoUrl!) ? rows[i]!.photoUrl : null;
        photos.set(p.email, { url, until: at + PHOTO_MS });
      });
    } catch {
      const at = Date.now();
      for (const p of asked) photos.set(p.email, { url: null, until: at + PHOTO_FAIL_MS });
    } finally {
      photoInflight = null;
    }
  })();
  return photoInflight;
}

// ── The recordings ───────────────────────────────────────────────────────────

interface VoiceRow { _id: unknown; key: string; name: string; bytes: number; seconds: number; version: number; recordedBy: string; updatedAt: Date }
/** Where a screen fetches a recording — under this API; the version makes a new recording a new address. */
const voiceLink = (v: Pick<VoiceRow, "_id" | "version" | "seconds">) => ({ url: `/public/class-tv/voice/${String(v._id)}?v=${v.version}`, seconds: v.seconds });
const voiceRows = async () => new Map((await ClassVoice.find().select("-audio").lean<VoiceRow[]>()).map((v) => [v.key, v]));

// ── The board ────────────────────────────────────────────────────────────────

/** The board for one academy. `publicView`: the open link — a plain sentence for an error, never the LMS's own. */
export async function classTv(academyAsked: unknown, opts: { publicView?: boolean } = {}) {
  const academy = academyOf(academyAsked);
  const now = Date.now();
  const s = stateOf(academy);
  // The first screen of the day waits for the LMS; after that a slow LMS never holds a screen up — it gets what is kept.
  if (s.data?.day === dayOf(academy, now).day) void refresh(academy, now); else await refresh(academy, now);
  const d = s.data;
  const people = [...new Map((d?.classes ?? []).flatMap((c) => c.mentors).map((m) => [m.id, m])).values()];
  await within(refreshPhotos(people, now), PHOTO_WAIT_MS);
  const voices = await voiceRows();
  const common = (key: (typeof COMMON_KEYS)[number]) => { const v = voices.get(key); return v ? voiceLink(v) : null; };
  // One common line recorded: it serves both moments.
  const soon = common("common:soon") ?? common("common:now"), nowLine = common("common:now") ?? common("common:soon");
  return {
    academy, academyName: ZONES[academy].name, timezone: ZONES[academy].zone, day: d?.day ?? dayOf(academy, now).day,
    serverTime: new Date().toISOString(), updatedAt: s.at ? new Date(s.at).toISOString() : null, leadMinutes: LEAD_MINUTES,
    status: s.error ? "error" : d ? "ok" : "loading",
    error: s.error ? (opts.publicView ? "Today's classes can't be reached right now." : s.error) : null,
    classes: (d?.classes ?? []).map((c) => ({
      id: c.id, title: c.title, course: c.course, module: c.module, startsAt: c.startsAt, endsAt: c.endsAt, durationMins: c.durationMins,
      status: c.status, online: c.online, place: c.place,
      mentors: c.mentors.map((m) => {
        const v = voices.get(`mentor:${m.id}`);
        return { id: m.id, name: m.name, photoUrl: (m.email && photos.get(m.email)?.url) || null, voice: v ? voiceLink(v) : null };
      }),
    })),
    voices: { soon, now: nowLine },
  };
}

/** One recording's sound, for a screen (GET /public/class-tv/voice/:id). Null when there is none by that id. */
export async function voiceAudio(id: string): Promise<Buffer | null> {
  if (!/^[a-f\d]{24}$/i.test(id)) return null;
  const v = await ClassVoice.findById(id).select("audio").lean<{ audio: Buffer | { buffer: ArrayBuffer } } | null>();
  if (!v?.audio) return null;
  return Buffer.isBuffer(v.audio) ? v.audio : Buffer.from((v.audio as { buffer: ArrayBuffer }).buffer);
}

// ── The Mentor voices page ───────────────────────────────────────────────────

const view = (v: VoiceRow | undefined) => (v ? { ...voiceLink(v), bytes: v.bytes, recordedBy: v.recordedBy, recordedAt: new Date(v.updatedAt).toISOString() } : null);

/** Every mentor the LMS has, with how many classes they have today and their recording; the two common lines. */
export async function mentorVoices() {
  const now = Date.now();
  await Promise.all(ACADEMIES.map((a) => refresh(a, now)));
  const voices = await voiceRows();
  const mentors = new Map<string, { id: string; name: string; email: string; academy: Academy; classesToday: number }>();
  const errors: string[] = [];
  for (const a of ACADEMIES) {
    const s = stateOf(a);
    if (s.error) errors.push(s.error);
    for (const m of s.data?.mentors ?? []) if (!mentors.has(m.id)) mentors.set(m.id, { ...m, classesToday: 0 });
    for (const c of s.data?.classes ?? []) {
      if (c.status === "cancelled") continue;
      for (const m of c.mentors) { const row = mentors.get(m.id); if (row) row.classesToday += 1; }
    }
  }
  // Somebody recorded who has since left the LMS's list keeps their row, so the recording can still be removed.
  for (const v of voices.values()) {
    const id = /^mentor:(.+)$/i.exec(v.key)?.[1];
    if (id && !mentors.has(id)) mentors.set(id, { id, name: v.name || "No longer a mentor", email: "", academy: "dubai", classesToday: 0 });
  }
  return {
    error: errors[0] ?? null, leadMinutes: LEAD_MINUTES, maxBytes: VOICE_MAX_BYTES,
    common: { soon: view(voices.get("common:soon")), now: view(voices.get("common:now")) },
    mentors: [...mentors.values()]
      .map((m) => ({ ...m, voice: view(voices.get(`mentor:${m.id}`)) }))
      .sort((a, b) => b.classesToday - a.classesToday || a.name.localeCompare(b.name)),
  };
}

/**
 * Keep a recording: { audio: a WAV as base64 (a data: URL or bare), seconds, name? }. A WAV only — the page makes one
 * of whatever the microphone gave, since a TV's browser may play nothing else. The recordings are read with every
 * answer, so a new one is on the screens with their next look.
 */
export async function saveVoice(keyAsked: string, body: Record<string, unknown>, by: string) {
  const key = String(keyAsked ?? "").toLowerCase();
  if (!KEY.test(key)) throw httpError("No such line to record", 404);
  const raw = String(body.audio ?? "");
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(raw);
  const audio = Buffer.from(m ? m[2]! : raw, "base64");
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") throw httpError("The recording must be a WAV", 400);
  if (audio.length > VOICE_MAX_BYTES) throw httpError(`The recording is ${Math.round(audio.length / 1024)} KB; up to ${VOICE_MAX_BYTES / 1024} KB fits — about 12 seconds`, 400);
  const seconds = Math.round(Math.min(60, Math.max(0, Number(body.seconds) || 0)) * 10) / 10;
  const name = String(body.name ?? "").trim().slice(0, 120);
  const saved = await ClassVoice.findOneAndUpdate(
    { key },
    { $set: { audio, bytes: audio.length, seconds, recordedBy: by, ...(name ? { name } : {}) }, $inc: { version: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).select("-audio").lean<VoiceRow>();
  return view(saved ?? undefined);
}

export async function removeVoice(keyAsked: string) {
  const key = String(keyAsked ?? "").toLowerCase();
  if (!KEY.test(key)) throw httpError("No such line", 404);
  const r = await ClassVoice.deleteOne({ key });
  if (!r.deletedCount) throw httpError("Already removed", 404);
  return { removed: true };
}
