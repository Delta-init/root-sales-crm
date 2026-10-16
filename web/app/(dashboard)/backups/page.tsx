"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AxiosError } from "axios";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Clock, DatabaseBackup, Download, Loader2, Play, XCircle } from "lucide-react";
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

/** Two runs a day: a good copy older than this means one was missed. */
const STALE_HOURS = 14;

const STATUS: Record<BackupStatus, { label: string; variant: "success" | "destructive" | "warning" | "secondary" }> = {
  complete: { label: "Backed up", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  skipped: { label: "Not backed up", variant: "warning" },
  running: { label: "Running", variant: "secondary" },
};

export default function BackupsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["backups"],
    queryFn: async () => (await api.get("/backups")).data.data as BackupsOverview,
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
        <Button onClick={() => run.mutate(undefined)} disabled={busy || !o?.store.ready}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {busy ? "Backing up…" : "Back up now"}
        </Button>
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

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {q.isLoading && [0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-40" />)}
        {o?.portals.map((p) => {
          const good = p.lastGood;
          const stale = !good || (Date.now() - new Date(good.startedAt).getTime()) / 3_600_000 > STALE_HOURS;
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
