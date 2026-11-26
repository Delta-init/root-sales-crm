"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiErrorMessage } from "@/lib/axios";
import { count, money, paymentsText, type ForeignLine, type Period } from "./api";

/* Small pieces the Finance and revenue pages share. */

const utc = (day: string) => new Date(`${day}T00:00:00Z`);

/** "3 Nov 2026" */
export const dayText = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(utc(day));

/** "3 Nov" — for a chart's axis, where the year is already in the page's period. */
export const dayShort = (day: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(utc(day));

/** "November 2026" from "2026-11". */
export const monthText = (month: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(utc(`${month}-01`));

/** A period in words: a whole month by its name, a whole year by its number, anything else by its two dates. */
export function periodText(p: Period): string {
  const f = utc(p.from), t = utc(p.to);
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  const sameYear = f.getUTCFullYear() === t.getUTCFullYear();
  if (sameYear && f.getUTCMonth() === t.getUTCMonth() && f.getUTCDate() === 1 && t.getUTCDate() === lastDay) return monthText(p.from.slice(0, 7));
  if (sameYear && p.from.endsWith("-01-01") && p.to.endsWith("-12-31")) return p.from.slice(0, 4);
  return `${dayText(p.from)} – ${dayText(p.to)}`;
}

/**
 * Every day of a period, both ends included — up to today, since the days still to come have nothing to draw, and at
 * most 400. A chart of days needs the days nothing happened on too: joining one busy day to the next with a line says
 * money came in on the days between.
 */
export function daysBetween(from: string, to: string): string[] {
  const today = new Date().toISOString().slice(0, 10);
  const end = to < today ? to : today;
  const out: string[] = [];
  for (let t = utc(from).getTime(); out.length < 400; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (day > end) break;
    out.push(day);
  }
  return out;
}

/** "14:32" in the viewer's own clock — when finance answered. */
export const timeText = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** For a chart's axis only, where a whole figure would not fit: 1.2M, 340k. Tables and cards always show the exact amount. */
export const axisMoney = (minor: number) => {
  const n = minor / 100, a = Math.abs(n);
  return a >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : a >= 1_000 ? `${Math.round(n / 1_000)}k` : String(Math.round(n));
};

export function ErrorCard({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="flex items-start gap-2 text-sm text-foreground">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>{apiErrorMessage(error, "Finance's figures could not be read.")}</span>
        </p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw />
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function CardsLoading({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading figures">
      {Array.from({ length: n }, (_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
    </div>
  );
}

export interface BarRow { label: string; value: string; percent: number; hint?: string; /** A line under the row, for money that is not in the bar — paid in another currency. */ extra?: string }

/** A labelled bar per row, the longest full width. */
export function Bars({ rows, empty }: { rows: BarRow[]; empty: string }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-3.5">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-muted-foreground">
              {row.label}
              {row.hint && <span className="ml-1.5 text-xs opacity-70">{row.hint}</span>}
            </span>
            <span className="shrink-0 font-medium tabular-nums text-foreground">{row.value}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, row.percent))}%` }} />
          </div>
          {row.extra && <p className="mt-1 text-xs tabular-nums text-amber-600 dark:text-amber-400">{row.extra}</p>}
        </div>
      ))}
    </div>
  );
}

/*
 * Money paid in another currency than the invoices' own — rupees on an AED invoice (the user, 2026-11-26: "if they
 * collected INR payments it needs to show as INR instead of summing in the AED, same as the finance payment stats
 * card"). Finance keeps it out of Collected and gives it as it was paid; here it is a card of its own per currency,
 * beside the report's figures and never in them, with what finance recorded it as.
 */
export function ForeignCards({ lines, cur, label }: { lines: ForeignLine[] | undefined; cur: string; label: string }) {
  return (
    <>
      {(lines ?? []).filter((l) => l.count > 0).map((l) => (
        <Card key={l.currency} className="border-amber-500/40">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{label} in {l.currency}</p>
            <p className="mt-1.5 break-words text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{money(l.amountMinor, l.currency)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {paymentsText(l.count)}, as paid. {l.recordedMinor ? `Recorded as ${money(l.recordedMinor, cur)}, not in the ${cur} figure.` : `Not in the ${cur} figure.`}
            </p>
          </CardContent>
        </Card>
      ))}
    </>
  );
}

/** Payments made in another currency whose amount in it was never recorded: still counted in the report's own, and said. */
export function ForeignUnknown({ lines, cur }: { lines: ForeignLine[] | undefined; cur: string }) {
  const unknown = (lines ?? []).filter((l) => (l.unknownCount ?? 0) > 0);
  if (!unknown.length) return null;
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
      {unknown.map((l) => (
        <span key={l.currency} className="block">
          {count(l.unknownCount ?? 0)} {l.currency} {l.unknownCount === 1 ? "payment has" : "payments have"} no {l.currency} amount on record, so {l.unknownCount === 1 ? "it is" : "they are"} still
          counted in {cur}: {money(l.unknownMinor ?? 0, cur)}.
        </span>
      ))}
    </p>
  );
}

/** "INR 1,25,000 paid in INR" for each line — what a row has in other currencies, never added to its own amount. */
export const foreignText = (lines: ForeignLine[] | undefined) => (lines ?? []).map((f) => `${money(f.amountMinor, f.currency)} paid in ${f.currency}, not added`).join(" · ");

/** Rows of a table as a CSV file the browser saves. */
export function saveCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  // The byte-order mark makes Excel read names in other alphabets correctly.
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
