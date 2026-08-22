"use client";

import { cn } from "@/lib/utils";
import type { MetricDef } from "@/lib/types";

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    notation: n >= 100_000 ? "compact" : "standard",
  }).format(n);

const num = (n: number) => new Intl.NumberFormat("en-AE").format(n);

const tone = (pct: number) =>
  pct >= 100 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";

/**
 * Team total against target, per metric.
 *
 * This is the spreadsheet's TEAM TOTAL / DAILY TARGET / ACHIEVED % block, lifted
 * out of the table footer. In the table those three rows sat past the right edge
 * and below the fold, so the numbers the sheet exists to show were the ones
 * nobody could see.
 */
export function TargetProgress({
  metrics,
  totals,
  targets,
  achieved,
  currency,
}: {
  metrics: MetricDef[];
  totals: Record<string, number>;
  targets: Record<string, number>;
  achieved: Record<string, number | null>;
  currency: string;
}) {
  const withTargets = metrics.filter((m) => (targets[m.key] ?? 0) > 0);

  if (!withTargets.length) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No targets set for this organisation yet, so there is nothing to measure
        against.
      </p>
    );
  }

  return (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {withTargets.map((m) => {
        const total = totals[m.key] ?? 0;
        const target = targets[m.key] ?? 0;
        const pct = achieved[m.key] ?? 0;
        const fmt = (n: number) =>
          m.key === "convRate" ? `${n}%` : m.money ? money(n, currency) : num(n);

        return (
          <div key={m.key}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground">
                {m.label}
                {m.source === "manual" && (
                  <span className="ml-1.5 text-[9px] uppercase tracking-wide opacity-60">
                    entered
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs tabular-nums">
                <span className="font-semibold text-foreground">{fmt(total)}</span>
                <span className="text-muted-foreground"> / {fmt(target)}</span>
              </span>
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-all", tone(pct))}
                  // Bar caps at 100 so an over-delivered metric cannot render a
                  // bar wider than its track; the figure beside it keeps the
                  // real number.
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <span
                className={cn(
                  "w-12 shrink-0 text-right text-[11px] font-medium tabular-nums",
                  pct >= 100
                    ? "text-emerald-500"
                    : pct >= 50
                      ? "text-amber-500"
                      : "text-rose-500"
                )}
              >
                {pct}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
