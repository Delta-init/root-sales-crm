"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AxiosError } from "axios";
import { toast } from "sonner";
import { BellRing, Copy, ExternalLink, GraduationCap, Loader2, Mic, Play, Search, Square, Trash2, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { API_URL, api, apiErrorMessage } from "@/lib/axios";
import { cn } from "@/lib/utils";
import { playCall, playLine, stopSound, unlockSound } from "@/lib/classTvSound";
import { MAX_SECONDS, asDataUrl, micProblem, startRecording, toWav, type Recording } from "@/lib/wavRecorder";

/**
 * Class TV (the user, 2026-11-14: "a public link for the mentors who have classes… with the mentor's name, with
 * audio; text to speech never works, so record from here"): the open screens for the office — today's classes, and
 * each mentor called by name five minutes before their class and as it starts. The screens speak with nothing but
 * what is recorded here: each mentor's own line, and a common line played after it. Root admins only.
 */

interface Voice { url: string; seconds: number; bytes: number; recordedBy: string; recordedAt: string }
interface Mentor { id: string; name: string; email: string; academy: "dubai" | "bangalore"; classesToday: number; voice: Voice | null }
interface Overview { error: string | null; leadMinutes: number; maxBytes: number; common: { soon: Voice | null; now: Voice | null }; mentors: Mentor[] }

const forbidden = (e: unknown) => e instanceof AxiosError && e.response?.status === 403;
const notYet = (e: unknown) => e instanceof AxiosError && e.response?.status === 404;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const AUDIO_FILES = "audio/*,.wav,.mp3,.m4a,.ogg,.webm,.aac";
const SCREENS = [
  { academy: "dubai", label: "Dubai", path: "/public/class-tv" },
  { academy: "bangalore", label: "Bangalore", path: "/public/class-tv?academy=bangalore" },
] as const;

interface LineProps {
  lineKey: string; label: string; sub: string; voice: Voice | null; name?: string;
  /** What "Hear the call" plays after this line — the common one, for a mentor's. */
  after?: Voice | null;
  recording: { key: string; seconds: number } | null; saving: string | null;
  onRecord: (key: string, name?: string) => void; onStop: () => void; onUpload: (key: string, file: File, name?: string) => void; onRemove: (key: string) => void;
}

function Line({ lineKey, label, sub, voice, name, after, recording, saving, onRecord, onStop, onUpload, onRemove }: LineProps) {
  const file = useRef<HTMLInputElement>(null);
  const [asking, setAsking] = useState(false);
  const mine = recording?.key === lineKey;
  const busy = saving === lineKey;
  const blocked = (!!recording && !mine) || (!!saving && !busy);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3" data-testid={`line-${lineKey}`}>
      <div className="min-w-0 flex-1 basis-56">
        <p className="truncate text-sm font-medium text-foreground">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{sub}</p>
      </div>
      <p className={cn("text-xs", mine ? "font-medium text-destructive" : voice ? "text-emerald-500" : "text-muted-foreground")}>
        {mine ? `Recording ${recording!.seconds}s of ${MAX_SECONDS}` : busy ? "Saving…" : voice ? `Recorded · ${voice.seconds}s · ${when(voice.recordedAt)}` : "Not recorded"}
      </p>
      <div className="flex items-center gap-1.5">
        {mine ? (
          <Button size="sm" variant="destructive" onClick={onStop}><Square className="mr-1.5 h-3.5 w-3.5" /> Stop</Button>
        ) : asking ? (
          <>
            <Button size="sm" variant="destructive" onClick={() => { setAsking(false); onRemove(lineKey); }}>Remove</Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Keep</Button>
          </>
        ) : (
          <>
            {voice && (
              <Button size="sm" variant="ghost" aria-label={`Play ${label}`} disabled={blocked || busy}
                onClick={() => { unlockSound(); stopSound(); void playLine(`${API_URL}${voice.url}`); }}>
                <Play className="h-4 w-4" />
              </Button>
            )}
            {voice && after !== undefined && (
              <Button size="sm" variant="ghost" aria-label={`Hear the call for ${label}`} title="Hear it as the TV plays it" disabled={blocked || busy}
                onClick={() => { unlockSound(); stopSound(); playCall([voice, after].filter((v): v is Voice => !!v).map((v) => `${API_URL}${v.url}`), { force: true }); }}>
                <BellRing className="h-4 w-4" />
              </Button>
            )}
            <Button size="sm" variant={voice ? "outline" : "default"} disabled={blocked || busy} onClick={() => onRecord(lineKey, name)}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Mic className="mr-1.5 h-3.5 w-3.5" />} {voice ? "Record again" : "Record"}
            </Button>
            <Button size="sm" variant="ghost" aria-label={`Upload a recording for ${label}`} title="Upload a recording" disabled={blocked || busy} onClick={() => file.current?.click()}>
              <Upload className="h-4 w-4" />
            </Button>
            <input ref={file} type="file" accept={AUDIO_FILES} className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onUpload(lineKey, f, name); }} />
            {voice && (
              <Button size="sm" variant="ghost" aria-label={`Remove the recording for ${label}`} disabled={blocked || busy} onClick={() => setAsking(true)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export default function ClassTvPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["class-tv-voices"], queryFn: async () => (await api.get("/class-tv/voices")).data.data as Overview, refetchInterval: 120_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ["class-tv-voices"] });
  const o = q.data;

  const [search, setSearch] = useState("");
  const [academy, setAcademy] = useState<"all" | "dubai" | "bangalore">("all");
  const mentors = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (o?.mentors ?? []).filter((m) => (academy === "all" || m.academy === academy) && (!s || m.name.toLowerCase().includes(s) || m.email.includes(s)));
  }, [o, search, academy]);
  const recorded = (o?.mentors ?? []).filter((m) => m.voice).length;
  const teachingUnrecorded = (o?.mentors ?? []).filter((m) => m.classesToday > 0 && !m.voice).length;

  // ── Recording: one line at a time ──
  const rec = useRef<{ key: string; name?: string; handle: Recording } | null>(null);
  const [recording, setRecording] = useState<{ key: string; seconds: number } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => setRecording((r) => (r ? { ...r, seconds: Math.min(MAX_SECONDS, r.seconds + 1) } : r)), 1000);
    return () => window.clearInterval(t);
  }, [recording?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving the page lets the microphone go.
  useEffect(() => () => { rec.current?.handle.cancel(); stopSound(); }, []);

  const keep = async (key: string, input: Blob, name?: string) => {
    setSaving(key);
    try {
      const { wav, seconds } = await toWav(input);
      if (o && wav.size > o.maxBytes) throw new Error(`That is ${Math.round(wav.size / 1024)} KB; up to ${Math.round(o.maxBytes / 1024)} KB fits. Keep it under ${MAX_SECONDS} seconds`);
      await api.put(`/class-tv/voices/${encodeURIComponent(key)}`, { audio: await asDataUrl(wav), seconds, ...(name ? { name } : {}) });
      toast.success(`Recorded, ${seconds}s. The TVs have it within a minute`);
      await refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, (e as Error)?.message || "The recording wasn't saved"));
    } finally {
      setSaving(null);
    }
  };
  const stop = async () => {
    const cur = rec.current;
    if (!cur) return;
    rec.current = null;
    setRecording(null);
    await keep(cur.key, await cur.handle.stop(), cur.name);
  };
  const record = async (key: string, name?: string) => {
    if (rec.current || saving) return;
    stopSound();
    try {
      const handle = await startRecording(() => void stop());
      rec.current = { key, name, handle };
      setRecording({ key, seconds: 0 });
    } catch (e) {
      toast.error(micProblem(e));
    }
  };
  const remove = async (key: string) => {
    try {
      await api.delete(`/class-tv/voices/${encodeURIComponent(key)}`);
      toast.success("Removed. The TVs stop playing it within a minute");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Not removed"));
    }
    await refresh();
  };
  const line = { recording, saving, onRecord: record, onStop: () => void stop(), onUpload: (key: string, f: File, name?: string) => void keep(key, f, name), onRemove: (key: string) => void remove(key) };

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.success("Link copied"); } catch { toast.error("Couldn't copy. Select the link and copy it"); }
  };

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <GraduationCap className="h-6 w-6 text-primary" /> Class TV
        </h2>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          An open screen for the office with today&apos;s classes: who teaches each, the course, the time and the pod or room. It calls
          each mentor {o?.leadMinutes ?? 5} minutes before their class and again as it starts, with a chime and the lines recorded here.
          Nothing is spoken by the browser, so a mentor with no recording is called on screen only.
        </p>
      </motion.div>

      {notYet(q.error) && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">The portal&apos;s server is still on the previous version, so this page has nothing to show yet. It works once the server is updated.</CardContent></Card>
      )}
      {forbidden(q.error) && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">This page is for root admins.</CardContent></Card>
      )}
      {q.error && !forbidden(q.error) && !notYet(q.error) && (
        <Card><CardContent className="pt-6 text-sm text-destructive">{apiErrorMessage(q.error, "The recordings couldn't be loaded")}</CardContent></Card>
      )}
      {o?.error && (
        <Card><CardContent className="pt-6 text-sm text-amber-500">The LMS couldn&apos;t be read just now, so the mentors and today&apos;s classes below may be incomplete: {o.error}</CardContent></Card>
      )}

      {/* The screens */}
      <Card>
        <CardHeader><CardTitle className="text-base">The TV links</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {SCREENS.map((s) => (
            <div key={s.academy} className="flex flex-wrap items-center gap-3">
              <Badge variant="secondary" className="w-24 justify-center">{s.label}</Badge>
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs">{origin}{s.path}</code>
              <Button size="sm" variant="outline" onClick={() => void copy(`${origin}${s.path}`)}><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy</Button>
              <Button size="sm" variant="outline" asChild><a href={s.path} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open</a></Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            No sign-in. On each TV, tap the screen once after opening the link: a browser plays no sound until then. The Test button on the screen plays a sample call.
          </p>
        </CardContent>
      </Card>

      {/* The common lines */}
      <Card>
        <CardHeader><CardTitle className="text-base">Common lines</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!o ? <div className="p-6"><Skeleton className="h-16 w-full" /></div> : (
            <ul className="divide-y divide-border">
              <Line {...line} lineKey="common:soon" label={`${o.leadMinutes} minutes before`} sub={'Played after the mentor’s name, such as "your class starts in five minutes"'} voice={o.common.soon} />
              <Line {...line} lineKey="common:now" label="As the class starts" sub={'Such as "your class is starting now"'} voice={o.common.now} />
            </ul>
          )}
          <p className="px-6 pb-4 pt-2 text-xs text-muted-foreground">With only one of the two recorded, it is played at both moments.</p>
        </CardContent>
      </Card>

      {/* The mentors */}
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Mentors</CardTitle>
            {o && (
              <p className="text-sm text-muted-foreground">
                {recorded} of {o.mentors.length} recorded{teachingUnrecorded > 0 ? ` · ${teachingUnrecorded} teaching today with no recording` : ""}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="class-tv-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a mentor" className="pl-9" />
            </div>
            {([["all", "Both academies"], ["dubai", "Dubai"], ["bangalore", "Bangalore"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setAcademy(k)}
                className={cn("rounded-full border px-2.5 py-0.5 text-xs", academy === k ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                {label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {q.isLoading ? <div className="p-6"><Skeleton className="h-40 w-full" /></div>
            : !o ? null
            : mentors.length === 0 ? <p className="p-6 text-sm text-muted-foreground">{o.mentors.length ? "No mentor matches that." : "The LMS has no mentors to show."}</p>
            : (
              <ul className="divide-y divide-border">
                {mentors.map((m) => (
                  <Line key={m.id} {...line} lineKey={`mentor:${m.id}`} name={m.name} label={m.name || "No name"}
                    sub={`${m.academy === "bangalore" ? "Bangalore" : "Dubai"} · ${m.classesToday === 0 ? "no class today" : m.classesToday === 1 ? "1 class today" : `${m.classesToday} classes today`}`}
                    voice={m.voice} after={o.common.soon ?? o.common.now} />
                ))}
              </ul>
            )}
          <p className="px-6 pb-4 pt-3 text-xs text-muted-foreground">
            Say the mentor&apos;s name, in any language, up to {MAX_SECONDS} seconds. The silence before and after is trimmed. The bell plays it as the TV will: chime, the name, then the common line.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
