import Link from "next/link";
import { ArrowRight, Coins, FileBarChart, Layers } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The Report Org's card on the Organisations page (2026-11-26).
 *
 * Not a row in the registry like the cards beside it. Those are systems Root
 * sends somebody to — each with an address, a secret and accounts of its own —
 * and every screen that walks the registry (Pending, Users, the grant picker)
 * asks each one a question the Report Org could not answer. This org is Root's
 * own pages, so it is drawn here and opens a page rather than a door.
 */
export function ReportOrgCard() {
  return (
    <Card className="group h-full border-emerald-500/40 transition-colors hover:border-emerald-500/80">
      <CardContent className="flex h-full flex-col p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
            <FileBarChart className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold leading-tight text-foreground">Report Org</p>
            <p className="text-xs text-muted-foreground">Built in Root</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Coins className="h-3 w-3" />
            AED and INR, apart
          </span>
          <span className="flex items-center gap-1">
            <Layers className="h-3 w-3" />
            Every CRM
          </span>
        </div>

        <Link
          href="/report-org"
          className="mt-auto inline-flex items-center gap-1 pt-4 text-xs text-emerald-600 transition-colors hover:text-emerald-500 dark:text-emerald-400"
        >
          Open workspace
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
