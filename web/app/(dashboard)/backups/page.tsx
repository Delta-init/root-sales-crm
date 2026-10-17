"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AxiosError } from "axios";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Clock, DatabaseBackup, Download, Loader2, Play, RotateCcw, SkipForward, Square, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { BackupRow, BackupStatus, BackupsOverview } from "@/lib/types";

/**
 * Backups (the user, 2026-10-16): every portal's whole database into R2 twice
 * a day — the lunch break and the night, Dubai time — kept 30 days. Each
 * portal's last backup and whether it worked, the recent runs, a download of
 * any archive, and "Back up now". Root admins only.
 */

const forbidden = (e: unknown) => e instanceof AxiosError && e.response?.status === 403;
/** The portal's server from before this page: it has no /backups yet. */
const notYet = (e: unknown) => e instanceof AxiosError && e.response?.status === 404;

const size = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
    : "—";
const ago = (iso: string) => {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
};
const secs = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.max(1, Math.round(ms / 1000))} s`);

/**
 * The answer, with anything a Root API from before the counts (b8abc7f) leaves
 * out filled in — the web deploys on its own and can be ahead of the API, and
 * a page that crashes on a missing field shows nothing at all. `counted` says
 * whether the counts and failures came back; without them those sections say
 * the API needs updating instead.
 */
function normalise(d: Partial<BackupsOverview>): BackupsOverview & { counted: boolean } {
  const portals = (d.portals ?? []).map((p) => ({
    ...p,
    window: p.window ?? { ok: 0, failed: 0, skipped: 0, stopped: 0 },
    history: p.history ?? [],
  }));
  return {
    store: d.store ?? { ready: false, missing: [], bucket: "" },
    schedule: d.schedule ?? { times: [], timezone: "Dubai", next: null, keepDays: 30, worker: false },
    running: !!d.running,
    runs: (d.runs ?? []).map((r) => ({ ...r, backups: r.backups ?? [] })),
    portals,
    counted: !!d.totals,
    staleHours: d.staleHours ?? 14,
    failures: d.failures ?? [],
    retry: d.retry ?? [],
    totals: d.totals ?? {
      stored: { count: portals.reduce((n, p) => n + (p.kept ?? 0), 0), bytes: portals.reduce((n, p) => n + (p.keptBytes ?? 0), 0) },
      window: { days: d.schedule?.keepDays ?? 30, runs: 0, ok: 0, failed: 0, skipped: 0 },
    },
  };
}

const STATUS: Record<BackupStatus, { label: string; variant: "success" | "destructive" | "warning" | "secondary" }> = {
  complete: { label: "Backed up", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  skipped: { label: "Not backed up", variant: "warning" },
  running: { label: "Running", variant: "secondary" },
  stopped: { label: "Stopped", variant: "secondary" },
};

/** A Root API from before Stop and Retry (2026-10-17) has no such endpoints. */
const buttonError = (e: unknown, fallback: string) =>
  notYet(e) ? "The Root API needs updating before this button works" : apiErrorMessage(e, fallback);

export default function BackupsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["backups"],
    queryFn: async () => normalise((await api.get("/backups")).data.data as Partial<BackupsOverview>),
    // Every few seconds while a backup runs, so the page follows it.
    refetchInterval: (query) => ((query.state.data as BackupsOverview | undefined)?.running ? 3000 : 60_000),
  });

  const run = useMutation({
    mutationFn: async (portals?: string[]) => (await api.post("/backups/run", portals ? { portals } : {})).data,
    onSuccess: () => {
      toast.success("Backup started");
      qc.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not start the backup")),
  });

  /** Stop, Finish, Restart, Retry failed (2026-10-17). */
  const act = useMutation({
    mutationFn: async (what: "stop" | "finish" | "restart" | "retry") => {
      await api.post(`/backups/${what}`);
      return what;
    },
    onSuccess: (what) => {
      toast.success(
        what === "stop" ? "Stopping now" : what === "finish" ? "Stopping after this portal" : what === "restart" ? "Restarting from the first portal" : "Retrying the failed ones"
      );
      qc.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (e) => toast.error(buttonError(e, "That did not work")),
  });
  const ask = (what: "stop" | "finish" | "restart", question: string) => {
    if (window.confirm(question)) act.mutate(what);
  };

  const download = useMutation({
    mutationFn: async (id: string) => (await api.get(`/backups/${id}/link`)).data.data as { url: string; file: string },
    onSuccess: (d) => {
      window.location.href = d.url;
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not get the file")),
  });

  if (forbidden(q.error)) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">Backups are for root admins.</CardContent>
      </Card>
    );
  }

  const o = q.data;
  const busy = !!o?.running || run.isPending;
  /** The run going now, and whether a stop is already asked of it. */
  const live = o?.running ? o.runs.find((r) => r.status === "running") : undefined;
  const stopping = live?.stop ?? "";

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
        className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <DatabaseBackup className="h-6 w-6 text-primary" /> Backups
          </h2>
          <p className="mt-1 text-muted-foreground">
            {o
              ? `Every portal's database into R2 (${o.store.bucket}) at ${o.schedule.times.join(" and ")} Dubai time, kept ${o.schedule.keepDays} days.`
              : "Every portal's database into R2, twice a day."}
          </p>
          {o?.schedule.next && o.store.ready && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Next backup {when(o.schedule.next)}
              {!o.schedule.worker && " — the schedule is off on this server (BACKUP_WORKER=false)"}
            </p>
          )}
        </div>
        {o?.running ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {stopping === "now" ? (live?.restart ? "Restarting…" : "Stopping…") : stopping === "after" ? "Stopping after this portal…" : "Backing up…"}
            </span>
            <Button variant="destructive" size="sm" disabled={act.isPending || stopping === "now"}
              onClick={() => ask("stop", "Stop the backup now? The portal being copied is dropped; the ones already done keep their backups.")}>
              <Square className="mr-1.5 h-3.5 w-3.5" /> Stop
            </Button>
            <Button variant="outline" size="sm" disabled={act.isPending || !!stopping}
              onClick={() => ask("finish", "Finish the portal being copied, then stop?")}>
              <SkipForward className="mr-1.5 h-3.5 w-3.5" /> Finish
            </Button>
            <Button variant="outline" size="sm" disabled={act.isPending || !!live?.restart}
              onClick={() => ask("restart", "Stop this backup and start again from the first portal?")}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restart
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {!!o?.retry?.length && (
              <Button variant="outline" disabled={busy || act.isPending || !o.store.ready} onClick={() => act.mutate("retry")}
                title={`Back up again: ${o.retry.join(", ")}`}>
                <RotateCcw className="mr-2 h-4 w-4" /> Retry failed ({o.retry.length})
              </Button>
            )}
            <Button onClick={() => run.mutate(undefined)} disabled={busy || !o?.store.ready}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              {busy ? "Backing up…" : "Back up now"}
            </Button>
          </div>
        )}
      </motion.div>

      {notYet(q.error) && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            The portal&apos;s server is still on the previous version, so this page has nothing to show yet. It works once the server is updated.
          </CardContent>
        </Card>
      )}

      {o && !o.store.ready && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium">Backups are not set up on the Root server yet — nothing is being backed up</p>
              <p className="mt-1 text-muted-foreground">Missing: {o.store.missing.join(", ")}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {o && !o.counted && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            The Root API is on the previous version, so the 30-day counts and the failures list are not shown yet. They appear once the API is updated.
          </CardContent>
        </Card>
      )}

      {o?.counted && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Stored now" value={o.totals.stored.count.toLocaleString("en-US")} sub={size(o.totals.stored.bytes)} />
          <Tile label={`Backed up · ${o.totals.window.days} days`} value={o.totals.window.ok.toLocaleString("en-US")}
            sub={`in ${o.totals.window.runs} run${o.totals.window.runs === 1 ? "" : "s"}`} tone="good" />
          <Tile label={`Failed · ${o.totals.window.days} days`} value={o.totals.window.failed.toLocaleString("en-US")}
            sub="a portal's server or R2 did not answer" tone={o.totals.window.failed ? "bad" : undefined} />
          <Tile label={`Not backed up · ${o.totals.window.days} days`} value={o.totals.window.skipped.toLocaleString("en-US")}
            sub="a portal not set up" tone={o.totals.window.skipped ? "warn" : undefined} />
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {q.isLoading && [0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-40" />)}
        {o?.portals.map((p) => {
          const good = p.lastGood;
          const stale = !good || (Date.now() - new Date(good.startedAt).getTime()) / 3_600_000 > o.staleHours;
          const last = p.last;
          return (
            <Card key={p.code} className={cn(stale && o.store.ready && "border-destructive/40")}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{p.label}</CardTitle>
                    <p className="truncate text-xs text-muted-foreground">{p.database || "no database"}</p>
                  </div>
                  {last && <Badge variant={STATUS[last.status].variant}>{STATUS[last.status].label}</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {p.problem ? (
                  <p className="flex gap-2 text-amber-500"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{p.problem}</p>
                ) : last?.status === "failed" ? (
                  <p className="flex gap-2 text-destructive"><XCircle className="mt-0.5 h-4 w-4 shrink-0" />{when(last.startedAt)}: {last.error}</p>
                ) : null}
                {good ? (
                  <div className={cn("flex gap-2", stale ? "text-destructive" : "text-muted-foreground")}>
                    <CheckCircle2 className={cn("mt-0.5 h-4 w-4 shrink-0", !stale && "text-emerald-500")} />
                    <span>
                      Last good {ago(good.startedAt)} · {size(good.bytes)} · {good.documents.toLocaleString("en-US")} record{good.documents === 1 ? "" : "s"}
                      {stale && " — a backup was missed"}
                    </span>
                  </div>
                ) : (
                  !p.problem && <p className="text-muted-foreground">No backup yet.</p>
                )}
                {p.history.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      {p.window.ok} of {p.history.length} worked in {o.totals.window.days} days
                      {p.window.failed > 0 && <span className="text-destructive"> · {p.window.failed} failed</span>}
                      {p.window.skipped > 0 && <span className="text-amber-500"> · {p.window.skipped} not backed up</span>}
                      {!!p.window.stopped && <span> · {p.window.stopped} stopped</span>}
                    </p>
                    {/* A dot per backup, oldest first: a portal that keeps failing is a red streak. */}
                    <div className="flex flex-wrap gap-1" aria-label={`${p.label}: each backup in ${o.totals.window.days} days`}>
                      {p.history.map((h) => (
                        <span key={h.id} title={`${when(h.startedAt)} — ${STATUS[h.status].label}${h.error ? `: ${h.error}` : ""}`}
                          className={cn("h-2 w-2 rounded-full",
                            h.status === "complete" ? "bg-emerald-500" : h.status === "failed" ? "bg-destructive" : h.status === "stopped" ? "bg-muted-foreground/40" : "bg-amber-500")} />
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-xs text-muted-foreground">{p.kept} kept · {size(p.keptBytes)}</span>
                  <div className="flex gap-2">
                    {!p.problem && (
                      <Button size="sm" variant="outline" disabled={busy || !o.store.ready} onClick={() => run.mutate([p.code])}>Back up</Button>
                    )}
                    {good && !good.expired && (
                      <Button size="sm" variant="outline" disabled={download.isPending} onClick={() => download.mutate(good.id)}>
                        <Download className="mr-1.5 h-3.5 w-3.5" /> Latest
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {o?.counted && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Failures · {o.totals.window.days} days</h3>
          {o.failures.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nothing failed in {o.totals.window.days} days.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">When (Dubai)</th>
                    <th className="px-4 py-2 font-medium">Portal</th>
                    <th className="px-4 py-2 font-medium">What happened</th>
                  </tr>
                </thead>
                <tbody>
                  {o.failures.map((f) => (
                    <tr key={f.id} className="border-t align-top">
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums">{when(f.startedAt)}</td>
                      <td className="whitespace-nowrap px-4 py-2">{f.label}</td>
                      <td className="px-4 py-2">
                        <Badge variant={STATUS[f.status].variant}>{STATUS[f.status].label}</Badge>
                        <span className="ml-2 text-muted-foreground">{f.error}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Recent backups</h3>
        {o && !o.runs.length && <p className="text-sm text-muted-foreground">None yet.</p>}
        {o?.runs.map((r, i) => {
          const done = r.backups.filter((b) => b.status === "complete");
          return (
            <details key={r.id} open={i === 0} className="rounded-lg border bg-card">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <span className="font-medium">{r.trigger === "scheduled" ? `${r.slot} (Dubai)` : when(r.startedAt)}</span>
                <span className="text-muted-foreground">{r.trigger === "scheduled" ? "Scheduled" : `By ${r.triggeredBy}`}</span>
                <Badge variant={r.status === "complete" ? "success" : r.status === "failed" ? "destructive" : "secondary"}>
                  {r.status === "running" ? "Running" : `${done.length}/${r.backups.length} backed up`}
                  {r.status === "stopped" && " · stopped"}
                </Badge>
                <span className="text-muted-foreground">{size(done.reduce((n, b) => n + b.bytes, 0))}</span>
              </summary>
              <div className="overflow-x-auto border-t">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Portal</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 text-right font-medium">Size</th>
                      <th className="px-4 py-2 text-right font-medium">Records</th>
                      <th className="px-4 py-2 text-right font-medium">Took</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {r.backups.map((b: BackupRow) => (
                      <tr key={b.id} className="border-t">
                        <td className="px-4 py-2">{b.label}</td>
                        <td className="px-4 py-2">
                          <Badge variant={STATUS[b.status].variant}>{STATUS[b.status].label}</Badge>
                          {b.error && <span className="ml-2 text-xs text-muted-foreground">{b.error}</span>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{b.bytes ? size(b.bytes) : "—"}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{b.status === "complete" ? b.documents.toLocaleString("en-US") : "—"}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{b.finishedAt ? secs(b.durationMs) : "—"}</td>
                        <td className="px-4 py-2 text-right">
                          {b.status === "complete" && (b.expired ? (
                            <span className="text-xs text-muted-foreground">Removed after {o.schedule.keepDays} days</span>
                          ) : (
                            <Button size="sm" variant="ghost" disabled={download.isPending} onClick={() => download.mutate(b.id)}>
                              <Download className="h-4 w-4" />
                              <span className="sr-only">Download {b.file}</span>
                            </Button>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </section>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Putting one back</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Download the file, then on the Root backend check it and restore it into a <strong>new</strong> database — it never
            writes over one that has data. Look at the copy, then decide what to bring back.
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">{`bun --no-env-file src/scripts/backup-restore.ts <file> --sha256 <checksum>
bun --no-env-file src/scripts/backup-restore.ts <file> --to 'mongodb://…/lms_restored?authSource=admin' --write`}</pre>
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn("mt-1 text-2xl font-bold tabular-nums",
          tone === "good" && "text-emerald-500", tone === "bad" && "text-destructive", tone === "warn" && "text-amber-500")}>{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}
