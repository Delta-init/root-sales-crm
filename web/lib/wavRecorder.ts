/*
 * A line for the Class TV, recorded in the browser and turned into a short WAV (the Mentor voices page, 2026-11-14).
 *
 * A microphone gives whatever the browser likes — WebM/Opus in Chrome, MP4 in Safari — and an office TV's browser may
 * play neither. Every browser plays a plain WAV, so whatever comes in is decoded here, mixed to one channel, trimmed
 * of the silence before and after, brought to an even level, resampled to 22.05 kHz and written out as 16-bit PCM:
 * about 44 KB a second, 12 seconds at most.
 */

export const MAX_SECONDS = 12;
const RATE = 22_050;

export interface Recording { stop: () => Promise<Blob>; cancel: () => void }

/** A sentence for whatever went wrong asking for the microphone. */
export function micProblem(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "The browser didn't allow the microphone. Allow it for this site, then record again";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found on this device";
  if (name === "NotReadableError") return "The microphone is in use by another app";
  return (err as Error)?.message || "The microphone couldn't be started";
}

/** Starts recording now. `onAuto` is called when it stops itself at the limit. */
export async function startRecording(onAuto: () => void): Promise<Recording> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("This browser can't record. Upload a recording instead");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported?.(t));
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  rec.addEventListener("dataavailable", (e) => { if (e.data.size) chunks.push(e.data); });
  const release = () => stream.getTracks().forEach((t) => t.stop());
  const ended = new Promise<Blob>((resolve) => {
    rec.addEventListener("stop", () => { release(); resolve(new Blob(chunks, { type: rec.mimeType || type || "audio/webm" })); }, { once: true });
  });
  rec.start();
  const limit = window.setTimeout(() => { if (rec.state !== "inactive") { rec.stop(); onAuto(); } }, MAX_SECONDS * 1000);
  return {
    stop: () => { window.clearTimeout(limit); if (rec.state !== "inactive") rec.stop(); return ended; },
    cancel: () => { window.clearTimeout(limit); if (rec.state !== "inactive") rec.stop(); release(); },
  };
}

/** Where the sound starts and ends: the first and last sample above a whisper, with a little air kept either side. */
function soundBounds(samples: Float32Array, rate: number): [number, number] {
  const floor = 0.012;
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]!) < floor) first++;
  if (first >= samples.length) return [0, samples.length];
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]!) < floor) last--;
  const pad = Math.round(rate * 0.12);
  return [Math.max(0, first - pad), Math.min(samples.length, last + pad)];
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i)); };
  text(0, "RIFF"); out.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE"); text(12, "fmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); text(36, "data");
  out.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    out.setInt16(44 + i * 2, Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), true);
  }
  return new Blob([out], { type: "audio/wav" });
}

/** Any recording the browser can read — the microphone's, or a file — as the WAV the TVs play. */
export async function toWav(input: Blob): Promise<{ wav: Blob; seconds: number }> {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) throw new Error("This browser can't read a recording");
  const ac = new AC();
  let decoded: AudioBuffer;
  try {
    const bytes = await input.arrayBuffer();
    decoded = await new Promise<AudioBuffer>((ok, no) => ac.decodeAudioData(bytes, ok, no));
  } catch {
    throw new Error("That recording couldn't be read. Try again, or another file");
  } finally {
    void ac.close().catch(() => undefined);
  }
  // One channel: the mean of what came in.
  const mono = new Float32Array(decoded.length);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const data = decoded.getChannelData(ch);
    for (let i = 0; i < data.length; i++) mono[i]! += data[i]! / decoded.numberOfChannels;
  }
  const [from, to] = soundBounds(mono, decoded.sampleRate);
  const cut = mono.subarray(from, Math.min(to, from + Math.round(decoded.sampleRate * MAX_SECONDS)));
  if (cut.length < decoded.sampleRate * 0.2) throw new Error("Nothing was heard. Check the microphone and record again");
  let peak = 0;
  for (let i = 0; i < cut.length; i++) peak = Math.max(peak, Math.abs(cut[i]!));
  if (peak < 0.02) throw new Error("Nothing was heard. Check the microphone and record again");
  // Resampled by the browser itself, which filters as it goes.
  const frames = Math.max(1, Math.round((cut.length / decoded.sampleRate) * RATE));
  const off = new OfflineAudioContext(1, frames, RATE);
  const buf = off.createBuffer(1, cut.length, decoded.sampleRate);
  buf.copyToChannel(cut, 0);
  const src = off.createBufferSource();
  src.buffer = buf;
  // Brought up to an even level, so a quiet recording is heard across a room.
  const gain = off.createGain();
  gain.gain.value = Math.min(8, 0.9 / peak);
  src.connect(gain).connect(off.destination);
  src.start();
  const rendered = (await off.startRendering()).getChannelData(0);
  return { wav: encodeWav(rendered, RATE), seconds: Math.round((rendered.length / RATE) * 10) / 10 };
}

/** A blob as a data: URL, for sending in JSON. */
export const asDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("The recording couldn't be read"));
    r.readAsDataURL(blob);
  });
