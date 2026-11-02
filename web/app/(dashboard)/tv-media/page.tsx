"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AxiosError } from "axios";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ArrowUp, Film, ImageIcon, Images, Loader2, Trash2, Tv, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/axios";
import { cn } from "@/lib/utils";

/**
 * TV photos & videos (the user, 2026-11-02): "every TV we can apply the photos on the root, 1 min interval, first show
 * the photos then the actual thing — multiple photos and videos". Every office TV — Root's Sales TV and Manager TV,
 * the four CRMs' leaderboards, the CS Portal TVs and the HRMS pod board — plays the ones meant for it, then its board
 * for its board time, and again. Root admins only.
 */

interface Screen { key: string; name: string; where: string; boardSeconds: number; enabled: boolean; showing: number; breakSeconds: number }
interface Media {
  id: string; kind: "image" | "video"; name: string; mime: string; size: number; durationSec: number; seconds: number;
  allScreens: boolean; screens: string[]; order: number; active: boolean; fromDay: string; toDay: string;
  showingToday: boolean; addedBy: string; createdAt: string; url: string;
}
interface Overview {
  media: Media[]; screens: Screen[]; storeMissing: string[]; today: string;
  limits: { image: { types: string[]; maxBytes: number }; video: { types: string[]; maxBytes: number } };
}
interface Target { allScreens: boolean; screens: string[] }
interface Uploading { id: string; name: string; progress: number; error: string }

const forbidden = (e: unknown) => e instanceof AxiosError && e.response?.status === 403;
const notYet = (e: unknown) => e instanceof AxiosError && e.response?.status === 404;
const size = (n: number) => (n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const length = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);
const label = (s: Pick<Screen, "where" | "name">) => `${s.where} · ${s.name}`;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm";

/** A video's length, read by the browser before it goes up — shown here as how long a round lasts. */
const videoLength = (file: File) =>
  new Promise<number>((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (n: number) => { URL.revokeObjectURL(url); resolve(Number.isFinite(n) ? n : 0); };
    v.preload = "metadata";
    v.onloadedmetadata = () => done(v.duration);
    v.onerror = () => done(0);
    v.src = url;
  });

/** The file straight into the TV media bucket, with progress. */
const put = (url: string, headers: Record<string, string>, file: File, onProgress: (p: number) => void) =>
  new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    Object.entries(headers).forEach(([k, v]) => x.setRequestHeader(k, v));
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`Storage answered ${x.status}`)));
    x.onerror = () => reject(new Error("The upload didn't reach storage — its CORS rule may be missing"));
    x.send(file);
  });

/** Which TVs: all of them, or the ones ticked. Unticking one while "All" is on leaves every other one ticked. */
function ScreenPicker({ screens, value, onChange, disabled }: { screens: Screen[]; value: Target; onChange: (v: Target) => void; disabled?: boolean }) {
  const on = (k: string) => value.allScreens || value.screens.includes(k);
  const toggle = (k: string) => {
    const now = screens.filter((s) => on(s.key)).map((s) => s.key);
    const next = now.includes(k) ? now.filter((x) => x !== k) : [...now, k];
    if (!next.length) { toast.error("Choose at least one TV"); return; }
    onChange(next.length === screens.length ? { allScreens: true, screens: [] } : { allScreens: false, screens: next });
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" disabled={disabled} onClick={() => onChange({ allScreens: true, screens: [] })}
        className={cn("rounded-full border px-2.5 py-0.5 text-xs", value.allScreens ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
        All TVs
      </button>
      {screens.map((s) => (
        <button key={s.key} type="button" disabled={disabled} onClick={() => toggle(s.key)} title={label(s)}
          className={cn("rounded-full border px-2.5 py-0.5 text-xs", on(s.key) ? "border-primary/60 bg-primary/10 text-foreground" : "border-border text-muted-foreground line-through hover:text-foreground")}>
          {label(s)}
        </button>
      ))}
    </div>
  );
}

export default function TvMediaPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tv-media"], queryFn: async () => (await api.get("/tv-media")).data.data as Overview, refetchInterval: 60_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ["tv-media"] });

  const [target, setTarget] = useState<Target>({ allScreens: true, screens: [] });
  const [photoSeconds, setPhotoSeconds] = useState(10);
  const [uploads, setUploads] = useState<Uploading[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const patch = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Partial<Media> }) => (await api.patch(`/tv-media/${id}`, body)).data,
    onSuccess: refresh,
    onError: (e) => { toast.error(apiErrorMessage(e, "Not saved")); refresh(); },
  });
  const order = useMutation({
    mutationFn: async (ids: string[]) => (await api.put("/tv-media/order", { ids })).data,
    onSuccess: refresh,
    onError: (e) => toast.error(apiErrorMessage(e, "The order wasn't saved")),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/tv-media/${id}`)).data,
    onSuccess: () => { toast.success("Taken off the TVs"); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e, "Not removed")),
  });
  const screen = useMutation({
    mutationFn: async ({ key, body }: { key: string; body: Partial<Screen> }) => (await api.put(`/tv-media/screens/${key}`, body)).data,
    onSuccess: refresh,
    onError: (e) => { toast.error(apiErrorMessage(e, "Not saved")); refresh(); },
  });

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const id = `${file.name}-${file.size}-${Date.now()}`;
      const set = (p: Partial<Uploading>) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...p } : x)));
      setUploads((u) => [...u, { id, name: file.name, progress: 0, error: "" }]);
      try {
        const durationSec = file.type.startsWith("video/") ? await videoLength(file) : 0;
        const start = (await api.post("/tv-media/uploads", { name: file.name, mime: file.type, size: file.size })).data.data as { key: string; uploadUrl: string; headers: Record<string, string> };
        await put(start.uploadUrl, start.headers, file, (progress) => set({ progress }));
        await api.post("/tv-media", { key: start.key, name: file.name.replace(/\.[^.]+$/, ""), mime: file.type, size: file.size, durationSec, seconds: photoSeconds, ...target });
        setUploads((u) => u.filter((x) => x.id !== id));
        refresh();
      } catch (e) {
        set({ error: apiErrorMessage(e, (e as Error).message || "Not uploaded") });
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  if (forbidden(q.error)) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">TV photos and videos are for root admins.</CardContent></Card>;
  }
  const o = q.data;
  const move = (i: number, by: -1 | 1) => {
    if (!o) return;
    const ids = o.media.map((m) => m.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    order.mutate(ids);
  };

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Images className="h-6 w-6 text-primary" /> TV photos & videos
        </h2>
        <p className="mt-1 text-muted-foreground">
          Every office TV plays the photos and videos meant for it, then shows its board for its board time (a minute unless changed below), and again. Videos play muted.
        </p>
      </motion.div>

      {notYet(q.error) && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">The portal&apos;s server is still on the previous version, so this page has nothing to show yet. It works once the server is updated.</CardContent></Card>
      )}
      {!!o?.storeMissing.length && (
        <Card className="border-amber-500/40">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
            <span>Uploads aren&apos;t set up on the server yet — it needs {o.storeMissing.join(", ")}.</span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Upload className="h-4 w-4" /> Add photos and videos</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">Show them on</p>
            {o ? <ScreenPicker screens={o.screens} value={target} onChange={setTarget} /> : <Skeleton className="h-6 w-full" />}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="space-y-1.5 text-sm">
              <span className="block text-muted-foreground">Each photo stays up (seconds)</span>
              <Input type="number" min={3} max={300} value={photoSeconds} className="w-28" onChange={(e) => setPhotoSeconds(Math.max(3, Math.min(300, Number(e.target.value) || 10)))} />
            </label>
            <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => add(e.target.files)} />
            <Button onClick={() => fileInput.current?.click()} disabled={!o || !!o.storeMissing.length}>
              <Upload className="mr-2 h-4 w-4" /> Choose files
            </Button>
            <p className="text-xs text-muted-foreground">JPG, PNG, WebP or GIF up to 10 MB · MP4 or WebM up to 200 MB</p>
          </div>
          {uploads.map((u) => (
            <div key={u.id} className="flex items-center gap-3 text-sm">
              {u.error ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <Loader2 className="h-4 w-4 animate-spin" />}
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              {u.error ? (
                <>
                  <span className="text-destructive">{u.error}</span>
                  <Button variant="ghost" size="sm" onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}>Dismiss</Button>
                </>
              ) : (
                <span className="w-12 text-right tabular-nums text-muted-foreground">{u.progress}%</span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">On the TVs, in order</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!o && <Skeleton className="h-24 w-full" />}
          {o && !o.media.length && <p className="text-sm text-muted-foreground">Nothing yet — the TVs show their boards only.</p>}
          {o?.media.map((m, i) => (
            <div key={m.id} className={cn("flex flex-col gap-3 rounded-lg border p-3 sm:flex-row", !m.active && "opacity-60")}>
              <a href={m.url || undefined} target="_blank" rel="noreferrer" className="block h-24 w-40 shrink-0 overflow-hidden rounded-md bg-black">
                {m.url && (m.kind === "image"
                  ? <img src={m.url} alt={m.name} className="h-full w-full object-contain" />
                  : <video src={m.url} muted preload="metadata" className="h-full w-full object-contain" />)}
              </a>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {m.kind === "image" ? <ImageIcon className="h-4 w-4 text-muted-foreground" /> : <Film className="h-4 w-4 text-muted-foreground" />}
                  <Input defaultValue={m.name} className="h-8 max-w-xs" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== m.name && patch.mutate({ id: m.id, body: { name: e.target.value } })} />
                  <span className="text-xs text-muted-foreground">{size(m.size)}{m.kind === "video" && m.durationSec ? ` · ${length(m.durationSec)}` : ""}</span>
                  {!m.active ? <Badge variant="secondary">Off</Badge> : !m.showingToday && <Badge variant="warning">Not today</Badge>}
                </div>
                <ScreenPicker screens={o.screens} value={m} disabled={patch.isPending} onChange={(v) => patch.mutate({ id: m.id, body: v })} />
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  {m.kind === "image" && (
                    <label className="flex items-center gap-1.5 text-muted-foreground">
                      Up for
                      <Input type="number" min={3} max={300} defaultValue={m.seconds} className="h-8 w-20"
                        onBlur={(e) => Number(e.target.value) !== m.seconds && patch.mutate({ id: m.id, body: { seconds: Number(e.target.value) } })} /> s
                    </label>
                  )}
                  <label className="flex items-center gap-1.5 text-muted-foreground">
                    From <Input type="date" defaultValue={m.fromDay} className="h-8 w-40" onBlur={(e) => e.target.value !== m.fromDay && patch.mutate({ id: m.id, body: { fromDay: e.target.value } })} />
                  </label>
                  <label className="flex items-center gap-1.5 text-muted-foreground">
                    until <Input type="date" defaultValue={m.toDay} className="h-8 w-40" onBlur={(e) => e.target.value !== m.toDay && patch.mutate({ id: m.id, body: { toDay: e.target.value } })} />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={m.active} onChange={(e) => patch.mutate({ id: m.id, body: { active: e.target.checked } })} /> On
                  </label>
                </div>
              </div>
              <div className="flex shrink-0 items-start gap-1">
                <Button variant="ghost" size="icon" aria-label="Earlier" disabled={i === 0 || order.isPending} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" aria-label="Later" disabled={i === o.media.length - 1 || order.isPending} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" aria-label="Remove" className="text-destructive"
                  onClick={() => window.confirm(`Take "${m.name}" off every TV and delete it?`) && remove.mutate(m.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Tv className="h-4 w-4" /> The TVs</CardTitle></CardHeader>
        <CardContent>
          {!o ? <Skeleton className="h-40 w-full" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="py-2 pr-4 font-medium">TV</th><th className="py-2 pr-4 font-medium">Showing today</th><th className="py-2 pr-4 font-medium">A round lasts</th><th className="py-2 pr-4 font-medium">Board between rounds</th><th className="py-2 font-medium">Photos on</th></tr>
                </thead>
                <tbody>
                  {o.screens.map((s) => (
                    <tr key={s.key} className="border-t">
                      <td className="py-2 pr-4">{label(s)}</td>
                      <td className="py-2 pr-4 tabular-nums">{s.showing}</td>
                      <td className="py-2 pr-4 tabular-nums">{s.showing ? `about ${length(s.breakSeconds)}` : "—"}</td>
                      <td className="py-2 pr-4">
                        <span className="flex items-center gap-1.5">
                          <Input type="number" min={10} max={3600} defaultValue={s.boardSeconds} className="h-8 w-24"
                            onBlur={(e) => Number(e.target.value) !== s.boardSeconds && screen.mutate({ key: s.key, body: { boardSeconds: Number(e.target.value) } })} /> s
                        </span>
                      </td>
                      <td className="py-2"><input type="checkbox" checked={s.enabled} onChange={(e) => screen.mutate({ key: s.key, body: { enabled: e.target.checked } })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
