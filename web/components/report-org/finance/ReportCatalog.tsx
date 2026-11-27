"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CATEGORIES, COUNTS, STATE_LABEL, hrefOf, type Report } from "./catalog";
import { useShowUnavailable } from "./showUnavailable";

/*
 * Every report the specification lists, found by name or ID. A live one opens; the others say why they cannot be
 * shown yet — or at all — rather than opening a page of zeros.
 */

const BADGE: Record<Report["state"], string> = {
  live: "bg-primary/10 text-primary",
  planned: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  none: "bg-muted text-muted-foreground",
};

export function StateBadge({ state }: { state: Report["state"] }) {
  return <span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium", BADGE[state])}>{STATE_LABEL[state]}</span>;
}

type Show = "all" | Report["state"];
const SHOWS: { key: Show; label: string; count: number }[] = [
  { key: "all", label: "All", count: COUNTS.all },
  { key: "live", label: STATE_LABEL.live, count: COUNTS.live },
  { key: "planned", label: STATE_LABEL.planned, count: COUNTS.planned },
  { key: "none", label: STATE_LABEL.none, count: COUNTS.none },
];

export function ReportCatalog() {
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [unavailable, setUnavailable] = useShowUnavailable();
  const shown: Show = unavailable ? show : "live";
  const [open, setOpen] = useState<string | null>(null);

  const categories = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATEGORIES.map((c) => ({
      ...c,
      total: c.reports.length,
      live: c.reports.filter((r) => r.state === "live").length,
      reports: c.reports.filter(
        (r) => (shown === "all" || r.state === shown) && (!q || r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)),
      ),
    })).filter((c) => c.reports.length > 0);
  }, [query, shown]);

  return (
    <section className="space-y-4" aria-label="Report catalog">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Report catalog</h2>
          <p className="text-sm text-muted-foreground">
            {COUNTS.all} reports in {CATEGORIES.length} groups. {COUNTS.live} show finance&apos;s live figures.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Course revenue, or REV-04" aria-label="Search reports by name or ID" className="h-9 pl-9" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
        <label className="mr-2 inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" checked={unavailable} onChange={(e) => setUnavailable(e.target.checked)} />
          Show unavailable ({COUNTS.planned + COUNTS.none})
        </label>
        {unavailable && SHOWS.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={show === s.key}
            onClick={() => setShow(s.key)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              show === s.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label} <span className="font-normal tabular-nums opacity-70">{s.count}</span>
          </button>
        ))}
      </div>

      {categories.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No report matches “{query.trim()}”.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {categories.map((c) => (
            <Card key={c.slug} className="border-border/50">
              <CardContent className="p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">{c.name}</h3>
                  <p className="text-xs tabular-nums text-muted-foreground">{c.live} of {c.total} live</p>
                </div>
                <ul className="mt-3 divide-y divide-border/50">
                  {c.reports.map((r) => {
                    const row = (
                      <>
                        <span className="w-14 shrink-0 font-mono text-[11px] text-muted-foreground">{r.id}</span>
                        <span className="min-w-0 flex-1 truncate">{r.name}</span>
                        <StateBadge state={r.state} />
                      </>
                    );
                    if (r.state === "live") {
                      return (
                        <li key={r.id}>
                          <Link
                            href={r.spec.kind === "overview" ? "/report-org/finance" : hrefOf(r)}
                            className="flex items-center gap-2 py-2.5 text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {row}
                            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          </Link>
                        </li>
                      );
                    }
                    const isOpen = open === r.id;
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => setOpen(isOpen ? null : r.id)}
                          className="flex w-full items-center gap-2 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {row}
                          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isOpen && "rotate-180")} />
                        </button>
                        {isOpen && <p className="pb-3 pl-16 pr-6 text-xs text-muted-foreground">{r.about}</p>}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
