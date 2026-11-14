"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, GraduationCap, MapPin, Video, Volume2, VolumeX } from "lucide-react";
import { boardFont } from "@/components/sales-tv/font";
import { cn } from "@/lib/utils";
import {
  callsDue, fetchClassTv, initials, inWords, linesOf, namesOf, stageOf, subjectOf, timeIn, voiceUrl,
  type Academy, type Call, type ClassTvData, type Stage, type TvClass, type TvMentor,
} from "@/lib/classTv";
import { playCall, preloadLines, setSoundMuted, unlockSound, useSound } from "@/lib/classTvSound";

/*
 * The Class TV (the user, 2026-11-14): an academy's classes today for the office screen — who teaches each, the
 * course, the time, the pod or room, and whether it is still to come, on now or over. Five minutes before a class and
 * again as it starts the screen calls its mentor: a pop-up with their name, a chime, then their recorded line and the
 * common one (lib/classTvSound.ts). Solid colours, the Sales TV's own.
 */

const POLL_MS = 30_000;
/** A call stays up at least this long, and never longer than its lines plus a moment. */
const CALL_MIN_MS = 9_000;
const CALL_MAX_MS = 40_000;
const MAX_ROWS = 16;
const SAID_KEY = "root_class_tv_said";

const CSS = `
.ctv{--bg:#0f0a07;--panel:#160e09;--panel2:#1d130c;--head:#24180f;--line:#2f2117;--ink:#f8f1ea;--ink2:#dccbbd;--mute:#9d8776;
--accent:#ff6b1a;--good:#5ad17f;--warn:#f5a524;--bad:#ff5a4f;
background:var(--bg);color:var(--ink)}
body:has(.ctv){background:#0f0a07}
.ctv .num{font-variant-numeric:tabular-nums lining-nums}
@keyframes ctv-blink{0%,55%{opacity:1}56%,100%{opacity:.3}}
.ctv-blink{animation:ctv-blink 1.2s steps(1,end) infinite}
@keyframes ctv-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
.ctv-in{animation:ctv-in .35s ease-out both}
@media (prefers-reduced-motion:reduce){.ctv-blink,.ctv-in{animation:none}}
`;

const T = {
  tiny: "text-[clamp(0.7rem,0.8vw,1.05rem)]",
  small: "text-[clamp(0.8rem,0.95vw,1.25rem)]",
  body: "text-[clamp(1rem,1.25vw,1.7rem)]",
  title: "text-[clamp(1.2rem,1.6vw,2.2rem)]",
};

/** The calls already made, kept for the tab — a reload a few seconds after a call doesn't make it again. */
function saidStore() {
  let keys = new Set<string>();
  try { keys = new Set(JSON.parse(sessionStorage.getItem(SAID_KEY) ?? "[]") as string[]); } catch { /* a browser that keeps nothing */ }
  return {
    has: (k: string) => keys.has(k),
    add: (k: string) => {
      keys.add(k);
      // Only the last few hundred: a screen left on for weeks never fills its store.
      if (keys.size > 400) keys = new Set(Array.from(keys).slice(-300));
      try { sessionStorage.setItem(SAID_KEY, JSON.stringify(Array.from(keys))); } catch { /* kept in memory */ }
    },
  };
}

function Face({ m, size }: { m: TvMentor; size: string }) {
  const [broken, setBroken] = useState(false);
  return m.photoUrl && !broken ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={m.photoUrl} alt="" onError={() => setBroken(true)} className={cn("shrink-0 rounded-full border border-[color:var(--line)] object-cover", size)} />
  ) : (
    <span className={cn("grid shrink-0 place-items-center rounded-full border border-[color:var(--line)] bg-[color:var(--head)] font-semibold text-[color:var(--ink2)]", size)}>
      <span style={{ fontSize: "0.4em" }}>{initials(m.name)}</span>
    </span>
  );
}

const STAGE_STYLE: Record<Stage, string> = {
  live: "border-[color:var(--good)] text-[color:var(--good)]",
  soon: "border-[color:var(--warn)] text-[color:var(--warn)]",
  later: "border-[color:var(--line)] text-[color:var(--ink2)]",
  done: "border-[color:var(--line)] text-[color:var(--mute)]",
  cancelled: "border-[color:var(--bad)] text-[color:var(--bad)]",
};

function Row({ c, now, zone }: { c: TvClass; now: number; zone: string }) {
  const stage = stageOf(c, now);
  const dim = stage === "done" || stage === "cancelled";
  const label = stage === "live" ? "Live now" : stage === "done" ? "Done" : stage === "cancelled" ? "Cancelled" : `In ${inWords(Date.parse(c.startsAt) - now)}`;
  return (
    <li data-testid={`class-${c.id}`} data-stage={stage}
      className={cn("flex min-w-0 items-center gap-[clamp(0.6rem,0.9vw,1.4rem)] rounded-[clamp(0.8rem,1vw,1.4rem)] border border-[color:var(--line)] bg-[color:var(--panel)] px-[clamp(0.7rem,1vw,1.5rem)] py-[clamp(0.5rem,0.7vw,1rem)]",
        stage === "live" && "border-[color:var(--good)]", stage === "soon" && "border-[color:var(--warn)]", dim && "opacity-55")}>
      <span className="flex shrink-0 -space-x-[0.28em] text-[clamp(2.4rem,3vw,4.2rem)]">
        {c.mentors.slice(0, 3).map((m) => <Face key={m.id} m={m} size="h-[1em] w-[1em]" />)}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate font-semibold leading-tight", T.body, stage === "cancelled" && "line-through")}>{namesOf(c)}</span>
        <span className={cn("block truncate text-[color:var(--mute)]", T.small)}>{subjectOf(c)}</span>
      </span>
      {(c.place || !c.online) && (
        <span className={cn("inline-flex max-w-[28%] shrink-0 items-center gap-1.5 truncate rounded-full border border-[color:var(--line)] px-[0.8em] py-[0.25em] font-medium text-[color:var(--ink2)]", T.small)}>
          {c.online ? <Video className="h-[1em] w-[1em] shrink-0" /> : <MapPin className="h-[1em] w-[1em] shrink-0" />}
          <span className="truncate">{c.place || "In person"}</span>
        </span>
      )}
      <span className={cn("num w-[5.2em] shrink-0 text-right font-semibold", T.body)}>{timeIn(c.startsAt, zone)}</span>
      <span className={cn("num w-[8.2em] shrink-0 rounded-full border px-[0.8em] py-[0.25em] text-center font-semibold", T.small, STAGE_STYLE[stage])}>
        {stage === "live" && <span className="ctv-blink mr-[0.5em] inline-block h-[0.55em] w-[0.55em] rounded-full bg-[color:var(--good)] align-middle" />}
        {label}
      </span>
    </li>
  );
}

function CallCard({ call, zone, silent, lead, onClose }: { call: Call; zone: string; silent: boolean; lead: number; onClose: () => void }) {
  const c = call.cls;
  return (
    // A tap anywhere puts the call away (and is the tap a silent screen needs for its sound).
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#0f0a07]/90 p-[4vw]" role="alert" data-testid="class-call" onClick={onClose}>
      <div className="ctv-in w-full max-w-[min(92vw,70rem)] rounded-[clamp(1.2rem,2vw,2.6rem)] border-2 border-[color:var(--accent)] bg-[color:var(--panel2)] p-[clamp(1.2rem,3vw,3.5rem)] text-center">
        <p className={cn("inline-flex items-center gap-[0.5em] font-semibold uppercase tracking-[0.12em] text-[color:var(--accent)]", T.title)}>
          <BellRing className="h-[1.1em] w-[1.1em]" /> {call.moment === "now" ? "Class starting now" : `Class starts in ${lead} minutes`}
        </p>
        <div className="mt-[clamp(1rem,2vw,2.4rem)] flex justify-center -space-x-[0.25em] text-[clamp(5rem,11vw,12rem)]">
          {c.mentors.slice(0, 3).map((m) => <Face key={m.id} m={m} size="h-[1em] w-[1em] border-4" />)}
        </div>
        <p className="mt-[clamp(0.8rem,1.6vw,2rem)] text-[clamp(2rem,5vw,6rem)] font-extrabold leading-[1.05]">{namesOf(c)}</p>
        <p className={cn("mt-[0.5em] text-[color:var(--ink2)]", T.title)}>{subjectOf(c)}</p>
        <p className={cn("num mt-[0.9em] inline-flex flex-wrap items-center justify-center gap-x-[1em] gap-y-1 font-semibold", T.title)}>
          <span>{timeIn(c.startsAt, zone)}</span>
          {(c.place || !c.online) && (
            <span className="inline-flex items-center gap-[0.35em] rounded-full border border-[color:var(--line)] px-[0.8em] py-[0.15em] text-[color:var(--ink)]">
              {c.online ? <Video className="h-[0.9em] w-[0.9em]" /> : <MapPin className="h-[0.9em] w-[0.9em]" />} {c.place || "In person"}
            </span>
          )}
        </p>
        {silent && <p className={cn("mt-[1.2em] text-[color:var(--warn)]", T.small)}>No sound yet: tap this screen once to switch it on.</p>}
      </div>
    </div>
  );
}

export function ClassTvBoard({ academy }: { academy: Academy }) {
  const [data, setData] = useState<ClassTvData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  /** This screen's clock against the server's — an office TV's own may be minutes out, and a call must not be. */
  const skew = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const [call, setCall] = useState<Call | null>(null);
  const [silent, setSilent] = useState(false);
  const busy = useRef(false);
  /** Calls waiting their turn — several classes often start on the same hour. */
  const waiting = useRef<{ call: Call; force: boolean }[]>([]);
  /** Puts away the call on screen now. */
  const dismiss = useRef<() => void>(() => undefined);
  const said = useRef<ReturnType<typeof saidStore> | null>(null);
  const sound = useSound();
  const latest = useRef<ClassTvData | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await fetchClassTv(academy);
      skew.current = Date.parse(d.serverTime) - Date.now();
      latest.current = d;
      setData(d);
      setFailed(null);
      // The lines for the classes still to come, fetched ahead of their calls.
      const soon = d.classes.filter((c) => c.status !== "cancelled" && Date.parse(c.startsAt) > Date.now() + skew.current - 120_000);
      preloadLines([...soon.flatMap((c) => c.mentors.map((m) => voiceUrl(m.voice))), voiceUrl(d.voices.soon), voiceUrl(d.voices.now)].filter((u): u is string => !!u).slice(0, 40));
    } catch (err) {
      setFailed((err as Error)?.message || "Root can't be reached");
    }
  }, [academy]);

  useEffect(() => {
    said.current = saidStore();
    void load();
    const poll = window.setInterval(() => void load(), POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now() + skew.current), 1000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); };
  }, [load]);

  /** The next call in the line: the pop-up, the chime and the lines. With others waiting it stays up a shorter while. */
  const next = useCallback(() => {
    if (busy.current) return;
    const turn = waiting.current.shift();
    if (!turn) return;
    busy.current = true;
    setCall(turn.call);
    const d = latest.current;
    const started = Date.now();
    const playing = playCall(d ? linesOf(turn.call, d.voices) : [], { force: turn.force });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      playing.stop();
      setCall(null);
      setSilent(false);
      busy.current = false;
      window.setTimeout(next, 400);
    };
    dismiss.current = close;
    void playing.done.then((heard) => {
      setSilent(heard === "silent");
      const least = waiting.current.length > 2 ? CALL_MIN_MS * 0.6 : CALL_MIN_MS;
      window.setTimeout(close, Math.max(1200, least - (Date.now() - started)));
    });
    window.setTimeout(close, CALL_MAX_MS);
  }, []);

  // Every second: the calls now due join the line, each once.
  useEffect(() => {
    if (!data || !said.current) return;
    const store = said.current;
    for (const due of callsDue(data.classes, now, data.leadMinutes, store.has)) {
      store.add(due.key);
      waiting.current.push({ call: due, force: false });
    }
    next();
  }, [now, data, next]);

  const zone = data?.timezone ?? "Asia/Dubai";
  const rows = useMemo(() => {
    const order: Record<Stage, number> = { live: 0, soon: 1, later: 2, done: 3, cancelled: 4 };
    return [...(data?.classes ?? [])].sort((a, b) => {
      const sa = stageOf(a, now), sb = stageOf(b, now);
      if (sa !== sb) return order[sa] - order[sb];
      // What is over: the latest first. Everything else: the soonest first.
      return sa === "done" ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt);
    });
  }, [data, now]);
  const counts = useMemo(() => {
    const n: Record<Stage, number> = { live: 0, soon: 0, later: 0, done: 0, cancelled: 0 };
    for (const c of data?.classes ?? []) n[stageOf(c, now)] += 1;
    return n;
  }, [data, now]);
  const shown = rows.slice(0, MAX_ROWS);
  const down = !!failed || data?.status === "error";

  const test = () => {
    unlockSound();
    const coming = rows.filter((r) => ["soon", "later"].includes(stageOf(r, now)));
    const c = coming.find((r) => r.mentors.some((m) => m.voice)) ?? coming[0] ?? rows.find((r) => stageOf(r, now) !== "cancelled") ?? {
      id: "test", title: "Sample class", course: "Sample course", module: "", startsAt: new Date(now + 5 * 60_000).toISOString(), endsAt: new Date(now + 65 * 60_000).toISOString(),
      durationMins: 60, status: "scheduled", online: true, place: "Pod 1", mentors: [{ id: "test", name: "Test mentor", photoUrl: null, voice: null }],
    };
    waiting.current.push({ call: { key: `test-${Date.now()}`, moment: "soon", cls: c }, force: true });
    window.setTimeout(next, 150);
  };

  return (
    <div className={cn("ctv flex min-h-screen flex-col gap-[clamp(0.7rem,1vw,1.4rem)] p-[clamp(0.8rem,1.4vw,2.2rem)]", boardFont.className)}>
      <style>{CSS}</style>
      <header className="flex flex-wrap items-center gap-[clamp(0.6rem,1vw,1.4rem)]">
        <span className="grid h-[clamp(2.4rem,2.8vw,3.8rem)] w-[clamp(2.4rem,2.8vw,3.8rem)] place-items-center rounded-xl bg-[color:var(--accent)] text-white">
          <GraduationCap className="h-[55%] w-[55%]" />
        </span>
        <div className="min-w-0">
          <h1 className={cn("truncate font-bold leading-tight", T.title)}>Today&apos;s classes · {data?.academyName ?? (academy === "bangalore" ? "Bangalore" : "Dubai")}</h1>
          <p className={cn("text-[color:var(--mute)]", T.small)} suppressHydrationWarning>
            {new Date(now).toLocaleDateString("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <span className={cn("ml-auto inline-flex items-center gap-2 rounded-full border px-3 py-1 font-medium", T.small, down ? "border-[color:var(--warn)] text-[color:var(--warn)]" : "border-[color:var(--line)] text-[color:var(--ink2)]")}>
          <span className={cn("inline-block h-2 w-2 rounded-full", down ? "bg-[color:var(--warn)]" : "ctv-blink bg-[color:var(--accent)]")} />
          {down ? "Reconnecting" : "Live"}
        </span>
        <button type="button" onClick={() => { if (sound.muted || !sound.ready) { unlockSound(); setSoundMuted(false); } else setSoundMuted(true); }}
          className={cn("inline-flex items-center gap-1.5 rounded-full border border-[color:var(--line)] px-3 py-1 font-medium text-[color:var(--ink2)] hover:text-[color:var(--ink)]", T.small)}>
          {sound.ready && !sound.muted ? <Volume2 className="h-[1em] w-[1em]" /> : <VolumeX className="h-[1em] w-[1em]" />}
          {sound.muted ? "Muted" : sound.ready ? "Sound on" : "Sound off"}
        </button>
        <button type="button" onClick={test} className={cn("rounded-full border border-[color:var(--line)] px-3 py-1 font-medium text-[color:var(--ink2)] hover:text-[color:var(--ink)]", T.small)}>Test</button>
        <span className={cn("num font-bold", T.title)} suppressHydrationWarning>
          {timeIn(new Date(now).toISOString(), zone)}
        </span>
      </header>

      {!sound.ready && !sound.muted && (
        <button type="button" onClick={unlockSound} data-testid="sound-prompt"
          className={cn("flex w-full items-center justify-center gap-[0.6em] rounded-[clamp(0.8rem,1vw,1.4rem)] border border-[color:var(--warn)] bg-[color:var(--panel2)] px-4 py-[0.7em] font-semibold text-[color:var(--warn)]", T.body)}>
          <VolumeX className="h-[1.1em] w-[1.1em]" /> Tap this screen once to switch the sound on
        </button>
      )}

      {!data ? (
        <p className={cn("m-auto text-[color:var(--mute)]", T.body)}>{failed ? "Today's classes can't be reached right now." : "Loading today's classes…"}</p>
      ) : shown.length === 0 ? (
        <p className={cn("m-auto text-center text-[color:var(--mute)]", T.title)}>{data.status === "error" ? data.error : "No classes today."}</p>
      ) : (
        <ul className={cn("grid min-h-0 flex-1 content-start gap-[clamp(0.45rem,0.6vw,0.9rem)]", shown.length > 8 && "xl:grid-cols-2")}>
          {shown.map((c) => <Row key={`${c.id}-${c.startsAt}`} c={c} now={now} zone={zone} />)}
        </ul>
      )}

      {data && data.classes.length > 0 && (
        <footer className={cn("num flex flex-wrap items-center gap-x-[1.4em] gap-y-1 text-[color:var(--mute)]", T.small)}>
          <span>{data.classes.length - counts.cancelled} classes today</span>
          <span>{counts.live} on now</span>
          <span>{counts.soon + counts.later} to come</span>
          <span>{counts.done} done</span>
          {counts.cancelled > 0 && <span>{counts.cancelled} cancelled</span>}
          {rows.length > shown.length && <span className="text-[color:var(--ink2)]">+{rows.length - shown.length} more not shown</span>}
          {data.status === "error" && <span className="text-[color:var(--warn)]">{data.error}</span>}
        </footer>
      )}

      {call && <CallCard call={call} zone={zone} silent={silent} lead={data?.leadMinutes ?? 5} onClose={() => dismiss.current()} />}
    </div>
  );
}
