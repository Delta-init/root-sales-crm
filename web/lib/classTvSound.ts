import { useSyncExternalStore } from "react";

/*
 * The Class TV's sound (the user, 2026-11-14: "text to speech never works, so record from here"). Nothing is spoken
 * by the browser: a chime made here with WebAudio, then recorded lines — short WAVs kept in Root — played through the
 * same audio engine as the chime. That is what the office TVs taught (lib/saleAnnouncement.ts, 2026-10-29): a TV's
 * browser plays whatever the engine is given once the screen has had one tap, and refuses an <audio> started later
 * without a word. The <audio> stays as the fallback for a browser that can't decode a line.
 *
 * Browsers keep a page silent until somebody taps it, which a TV nobody touches never does — so the screen asks for
 * that tap once. Sound can be muted per device; the call still shows.
 */

const SOUND_KEY = "root_class_tv_sound"; // "off" when muted on this device
const CHANGED = "root:class-tv-sound";
let mutedHere = false;

export function soundMuted(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "off";
  } catch {
    return mutedHere;
  }
}

export function setSoundMuted(muted: boolean): void {
  mutedHere = muted;
  try {
    if (muted) localStorage.setItem(SOUND_KEY, "off");
    else localStorage.removeItem(SOUND_KEY);
  } catch {
    /* kept for this tab only */
  }
  if (muted) stopSound();
  window.dispatchEvent(new Event(CHANGED));
}

// ── The engine ───────────────────────────────────────────────────────────────

let ctx: AudioContext | null = null;

function engine(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      ctx.addEventListener?.("statechange", () => window.dispatchEvent(new Event(CHANGED)));
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

/** Whether this page may make a sound now (the browser has had its tap). */
export const soundReady = () => engine()?.state === "running";

/** Called from a tap: lets the engine run, so a call that comes later is heard. */
export function unlockSound(): void {
  const ac = engine();
  if (ac) {
    // A silent blip, which is what actually lets the context run on some browsers.
    try {
      const src = ac.createBufferSource();
      src.buffer = ac.createBuffer(1, 1, 22050);
      src.connect(ac.destination);
      src.start(0);
    } catch {
      /* fine */
    }
  }
  window.dispatchEvent(new Event(CHANGED));
}

// Any tap or key on the page starts the sound, once.
if (typeof window !== "undefined") {
  const wake = () => {
    unlockSound();
    window.removeEventListener("pointerdown", wake, true);
    window.removeEventListener("keydown", wake, true);
  };
  window.addEventListener("pointerdown", wake, true);
  window.addEventListener("keydown", wake, true);
}

/** { ready: the page may make a sound, muted: this device asked for none } — kept current. */
export function useSound(): { ready: boolean; muted: boolean } {
  const sub = (cb: () => void) => {
    window.addEventListener(CHANGED, cb);
    window.addEventListener("storage", cb);
    return () => {
      window.removeEventListener(CHANGED, cb);
      window.removeEventListener("storage", cb);
    };
  };
  const ready = useSyncExternalStore(sub, () => ctx?.state === "running", () => false);
  const muted = useSyncExternalStore(sub, soundMuted, () => false);
  return { ready, muted };
}

// ── The chime ────────────────────────────────────────────────────────────────

/** One struck note: a sine with two quiet overtones, left to ring. */
function note(ac: AudioContext, out: AudioNode, freq: number, at: number, level: number, ring: number): void {
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(level, at + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, at + ring);
  env.connect(out);
  for (const [mult, part] of [[1, 1], [2, 0.3], [3, 0.12]] as const) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq * mult;
    gain.gain.value = part;
    osc.connect(gain).connect(env);
    osc.start(at);
    osc.stop(at + ring + 0.05);
  }
}

/** The call's chime — three rising notes, as before an announcement. Returns how long to wait before the lines, in ms (0 with no sound here). */
export function playChime(): number {
  const ac = engine();
  if (!ac || ac.state !== "running") return 0;
  const t0 = ac.currentTime + 0.03;
  const out = ac.createGain();
  out.gain.value = 0.5;
  out.connect(ac.destination);
  [659.25, 783.99, 1046.5].forEach((f, i) => note(ac, out, f, t0 + i * 0.32, 0.5, 1.3));
  window.setTimeout(() => out.disconnect(), 3000);
  return 1500;
}

// ── The recorded lines ───────────────────────────────────────────────────────

const decoded = new Map<string, Promise<AudioBuffer | null>>();
let source: AudioBufferSourceNode | null = null;
let element: HTMLAudioElement | null = null;

/** A line, fetched and decoded once (kept for the next call); null when it can't be. */
function bufferFor(url: string): Promise<AudioBuffer | null> {
  const ac = engine();
  if (!ac || typeof fetch === "undefined") return Promise.resolve(null);
  let p = decoded.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((bytes) => new Promise<AudioBuffer>((ok, no) => ac.decodeAudioData(bytes, ok, no)))
      .catch(() => null);
    decoded.set(url, p);
    void p.then((b) => { if (!b) decoded.delete(url); });
    // A long day of new recordings: the oldest are let go.
    if (decoded.size > 80) decoded.delete(decoded.keys().next().value as string);
  }
  return p;
}

/** Fetched ahead, so a call doesn't wait for its lines. */
export function preloadLines(urls: string[]): void {
  for (const url of urls) void bufferFor(url);
}

/** One line to its end (or until stopped). False when nothing could play it here. */
export async function playLine(url: string): Promise<boolean> {
  const ac = engine();
  if (ac && ac.state === "running") {
    const buf = await bufferFor(url);
    if (buf) {
      const played = await new Promise<boolean>((resolve) => {
        try {
          const src = ac.createBufferSource();
          src.buffer = buf;
          src.connect(ac.destination);
          src.onended = () => {
            if (source === src) source = null;
            resolve(true);
          };
          source = src;
          src.start();
        } catch {
          resolve(false);
        }
      });
      if (played) return true;
    }
  }
  return new Promise((resolve) => {
    if (typeof Audio === "undefined") return resolve(false);
    let done = false;
    let started = false;
    const a = new Audio(url);
    const finish = () => {
      if (done) return;
      done = true;
      if (element === a) element = null;
      resolve(started);
    };
    a.addEventListener("playing", () => { started = true; }, { once: true });
    a.addEventListener("ended", finish, { once: true });
    a.addEventListener("error", finish, { once: true });
    a.addEventListener("pause", finish, { once: true });
    window.setTimeout(() => { a.pause(); finish(); }, 20_000);
    element = a;
    a.play().catch(finish);
  });
}

export function stopSound(): void {
  try { source?.stop(); } catch { /* nothing playing */ }
  source = null;
  try { element?.pause(); } catch { /* nothing playing */ }
  element = null;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * A call as the TV plays it: the chime, then each line in turn. Nothing when muted (unless `force`, the Test).
 * Resolves with what was heard — "played", or "silent" when this page may not make a sound yet. `stop()` ends it.
 */
export function playCall(lines: string[], opts: { force?: boolean } = {}): { done: Promise<"played" | "silent" | "muted">; stop: () => void } {
  let stopped = false;
  const done = (async () => {
    if (!opts.force && soundMuted()) return "muted" as const;
    const wait = playChime();
    if (!wait) {
      // No engine yet: a plain <audio> may still be allowed (a desktop browser somebody has clicked in).
      let any = false;
      for (const url of lines) { if (stopped) break; any = (await playLine(url)) || any; }
      return any ? ("played" as const) : ("silent" as const);
    }
    await sleep(wait);
    for (const url of lines) {
      if (stopped) break;
      await playLine(url);
      if (!stopped) await sleep(180);
    }
    return "played" as const;
  })();
  return { done, stop: () => { stopped = true; stopSound(); } };
}
