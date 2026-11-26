"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORIES, STATE_LABEL, hrefOf, reportById, type Report } from "./catalog";

/*
 * Finance and revenue in the side menu (the user, 2026-11-26: "these links will be collapse style as in side bar —
 * show group as sub group item"): the twelve report groups under the section, each opening to its reports.
 *
 * The group holding the report that is open is open too, and stays so; the others open and close as they are
 * clicked. Every report is listed, not only the live ones — a dot says which it is — because a menu that left out
 * the reports that cannot be shown yet would read as their not existing.
 */

const DOT: Record<Report["state"], string> = { live: "bg-primary", planned: "bg-amber-500", none: "bg-muted-foreground/40" };

export function FinanceMenu({ path }: { path: string }) {
  const id = path.startsWith("/report-org/finance/") ? (path.split("/")[3] ?? "") : "";
  const current = id ? reportById(decodeURIComponent(id)) : null;
  const currentGroup = current?.category.slug ?? null;

  const [open, setOpen] = useState<Set<string>>(() => new Set(currentGroup ? [currentGroup] : []));
  useEffect(() => {
    if (currentGroup) setOpen((s) => (s.has(currentGroup) ? s : new Set(s).add(currentGroup)));
  }, [currentGroup]);
  const toggle = (slug: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  return (
    <div className="ml-[1.15rem] mt-0.5 border-l border-border/60 pl-2">
      <ul className="space-y-0.5" aria-label="Finance and revenue report groups">
        {CATEGORIES.map((c) => {
          const isOpen = open.has(c.slug);
          const live = c.reports.filter((r) => r.state === "live").length;
          return (
            <li key={c.slug}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggle(c.slug)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[13px] transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  currentGroup === c.slug ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isOpen && "rotate-90")} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70" title={`${live} of ${c.reports.length} live`}>
                  {live}/{c.reports.length}
                </span>
              </button>
              {isOpen && (
                <ul className="mb-1 ml-[0.55rem] space-y-px border-l border-border/40 pl-2">
                  {c.reports.map((r) => {
                    const on = current?.id === r.id;
                    // The KPI dashboard is the section's own page.
                    const href = r.state === "live" && r.spec.kind === "overview" ? "/report-org/finance" : hrefOf(r);
                    return (
                      <li key={r.id}>
                        <Link
                          href={href}
                          aria-current={on ? "page" : undefined}
                          title={`${r.id} · ${r.name} · ${STATE_LABEL[r.state]}`}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            on
                              ? "bg-primary/10 font-medium text-primary"
                              : r.state === "live"
                                ? "text-foreground/90 hover:bg-muted/60"
                                : "text-muted-foreground/70 hover:bg-muted/60 hover:text-muted-foreground",
                          )}
                        >
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[r.state])} aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{r.name}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p className="flex flex-wrap gap-x-3 gap-y-1 px-1.5 pb-1 pt-2 text-[11px] text-muted-foreground/80">
        {(["live", "planned", "none"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", DOT[s])} aria-hidden />
            {STATE_LABEL[s]}
          </span>
        ))}
      </p>
    </div>
  );
}
