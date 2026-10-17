"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronRight, DatabaseBackup, Loader2, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { BackupsSummary } from "@/lib/types";

/**
 * Backups on Pending (the user, 2026-10-17): one line saying whether every
 * portal is backed up — or which are not, and why — opening the Backups page.
 * Says nothing on a server from before backups (404) or for somebody who is
 * not a root admin (403).
 */
const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";

export function BackupStatusCard() {
  const q = useQuery({
    queryKey: ["backups-summary"],
    queryFn: async () => (await api.get("/backups/summary")).data.data as BackupsSummary,
    retry: false,
    refetchInterval: 5 * 60_000,
  });
  const s = q.data;
  if (!s) return null;

  const tone = !s.ready ? "warn" : s.problems.length ? "bad" : "good";
  const Icon = s.running ? Loader2 : tone === "good" ? CheckCircle2 : tone === "bad" ? XCircle : AlertTriangle;
  const headline = !s.ready
    ? "Backups are not set up — nothing is being backed up"
    : s.problems.length
      ? `${s.problems.length} of ${s.portals} portals not backed up`
      : `All ${s.portals} portals backed up`;
  const detail = !s.ready
    ? `Missing on the Root server: ${s.missing.join(", ")}`
    : s.problems.length
      ? s.problems.map((p) => `${p.label} (${p.reason})`).join(" · ")
      : s.lastScheduled
        ? `Last run ${s.lastScheduled.slot} Dubai: ${s.lastScheduled.ok}/${s.lastScheduled.total} · next ${when(s.next)}`
        : `Next run ${when(s.next)}`;

  return (
    <Link href="/backups" className="block">
      <Card className={cn("transition-colors hover:bg-muted/40",
        tone === "bad" && "border-destructive/50 bg-destructive/5", tone === "warn" && "border-amber-500/40 bg-amber-500/5")}>
        <CardContent className="flex items-center gap-3 py-3">
          <DatabaseBackup className="h-5 w-5 shrink-0 text-muted-foreground" />
          <Icon className={cn("h-5 w-5 shrink-0", s.running && "animate-spin",
            tone === "good" && "text-emerald-500", tone === "bad" && "text-destructive", tone === "warn" && "text-amber-500")} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{s.running ? "Backing up now…" : headline}</p>
            <p className="truncate text-xs text-muted-foreground" title={detail}>{detail}</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}
