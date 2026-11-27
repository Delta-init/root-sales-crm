"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { comparePeriod, dayRange, dubaiDay, monthRange, periodLabel, quarterRange, rangeLabel, shiftMonth, useReportOrgFilters, yearRange, type CompareMode } from "../ReportOrgShell";
import { askFresh } from "./api";
import type { FinanceOrg } from "./api";
import { MultiSelect, Select, type Choice } from "./FilterSelect";

/*
 * What the live finance tables are asked for, as one bar of dropdowns (the user, 2026-11-27: "by drop down instead of
 * button", "CS Portal filter also, and salesperson wise and department wise, payment method filter — everywhere we
 * need filter with columns").
 *
 * The organization decides the currency — Delta's dirhams and Bangalore's rupees are two organizations in finance —
 * so there is no "both": the two are never added. Every other filter takes several values at once, and its choices
 * are the ones finance says the period has, each with its count, so nothing is offered that would come back empty.
 */

const MODES: Choice[] = [{ key: "day", name: "Day" }, { key: "month", name: "Month" }, { key: "quarter", name: "Quarter" }, { key: "year", name: "Year" }, { key: "custom", name: "Dates" }];
const COMPARES: Choice[] = [{ key: "none", name: "No comparison" }, { key: "previous", name: "Previous period" }, { key: "last_year", name: "Same period last year" }, { key: "custom", name: "Custom dates" }];
const DATE = "h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function PeriodPicker() {
  const { range, setRange, thisMonth } = useReportOrgFilters();
  const thisYear = Number(thisMonth.slice(0, 4));
  const month = range.from.slice(0, 7);
  const year = Number(range.from.slice(0, 4));

  const today = dubaiDay();
  const pick = (mode: string) => {
    if (mode === range.mode) return;
    // A day, month, quarter or year is the one the current period ends in, never one that has not started.
    const endMonth = range.to.slice(0, 7) > thisMonth ? thisMonth : range.to.slice(0, 7);
    const endDay = range.to > today ? today : range.to;
    if (mode === "day") setRange(dayRange(endDay));
    else if (mode === "month") setRange(monthRange(endMonth));
    else if (mode === "quarter") setRange(quarterRange(endMonth));
    else if (mode === "year") setRange(yearRange(Number(endMonth.slice(0, 4))));
    else setRange({ ...range, mode: "custom" });
  };
  const addDay = (d: string, by: number) => new Date(Date.parse(`${d}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
  const step = (by: number) =>
    setRange(range.mode === "year" ? yearRange(year + by) : range.mode === "quarter" ? quarterRange(shiftMonth(month, by * 3)) : range.mode === "day" ? dayRange(addDay(range.from, by)) : monthRange(shiftMonth(month, by)));
  const atEnd = range.mode === "year" ? year >= thisYear : range.mode === "day" ? range.from >= today : range.mode === "quarter" ? range.to.slice(0, 7) >= thisMonth : month >= thisMonth;
  const unit = range.mode === "year" ? "year" : range.mode === "quarter" ? "quarter" : range.mode === "day" ? "day" : "month";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select label="Period" value={range.mode} options={MODES} onChange={pick} />
      {range.mode === "custom" ? (
        <>
          <input type="date" aria-label="From" value={range.from} max={range.to} className={DATE}
            onChange={(e) => e.target.value && setRange({ mode: "custom", from: e.target.value, to: e.target.value > range.to ? e.target.value : range.to })} />
          <span className="text-xs text-muted-foreground">to</span>
          <input type="date" aria-label="To" value={range.to} min={range.from} className={DATE}
            onChange={(e) => e.target.value && setRange({ mode: "custom", from: e.target.value < range.from ? e.target.value : range.from, to: e.target.value })} />
        </>
      ) : (
        <div className="flex items-center">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Previous ${unit}`} onClick={() => step(-1)}>
            <ChevronLeft />
          </Button>
          <span className="min-w-[7.5rem] text-center text-xs font-medium tabular-nums text-foreground">{rangeLabel(range)}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Next ${unit}`} disabled={atEnd} onClick={() => step(1)}>
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The comparison (Phase 7, 2026-11-28): offered only by the reports that use one — the Executive Dashboard, the profit
 * and loss, management profitability and cash flow. The period it compares with is shown beside it.
 */
export function ComparePicker() {
  const { range, compare, setCompare, compareCustom, setCompareCustom } = useReportOrgFilters();
  const other = comparePeriod(range, compare, compareCustom);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select label="Compare" value={compare} options={COMPARES} onChange={(v) => setCompare(v as CompareMode)} />
      {compare === "custom" && (
        <>
          <input type="date" aria-label="Compare from" value={compareCustom.from} max={compareCustom.to || undefined} className={DATE}
            onChange={(e) => setCompareCustom({ from: e.target.value, to: compareCustom.to && compareCustom.to < e.target.value ? e.target.value : compareCustom.to })} />
          <span className="text-xs text-muted-foreground">to</span>
          <input type="date" aria-label="Compare to" value={compareCustom.to} min={compareCustom.from || undefined} className={DATE}
            onChange={(e) => setCompareCustom({ from: compareCustom.from && compareCustom.from > e.target.value ? e.target.value : compareCustom.from, to: e.target.value })} />
        </>
      )}
      {other && compare !== "custom" && <span className="text-xs text-muted-foreground">with {periodLabel(other)}</span>}
    </div>
  );
}

/**
 * Refresh and full screen (Phase 7). Finance keeps a heavy report for 60 seconds; Refresh asks every report on the
 * page again and finance works it out afresh.
 */
export function ToolbarActions() {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const refresh = async () => {
    setBusy(true);
    askFresh();
    try { await client.refetchQueries({ queryKey: ["report-org", "finance"], type: "active" }); } finally { setBusy(false); }
  };
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={refresh} disabled={busy} title="Ask finance for these figures again, now">
        <RefreshCw className={busy ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
        Refresh
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleFull} aria-label={full ? "Leave full screen" : "Full screen"} title={full ? "Leave full screen" : "Full screen"}>
        {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </Button>
    </div>
  );
}

/** A filter a table offers: which of finance's dimensions, and what to call it. */
export interface FilterDef { key: string; label: string }

/**
 * The bar: organization, period, then the table's own filters — each a dropdown taking several values — and a way to
 * clear them. `space` is the kind of table the picks belong to; `options` is what finance says each can be set to.
 */
export function FinanceFilters({ orgs, org, period = true, space, filters = [], options, fixed, children, compare = false, actions = true }: {
  orgs: FinanceOrg[] | undefined;
  org: FinanceOrg | undefined;
  /** Off for balances as they stand today, which have no period. */
  period?: boolean;
  space?: string;
  filters?: FilterDef[];
  options?: Record<string, Choice[]> | undefined;
  /** Choices for a filter whose list does not come from finance — the headline page's CRMs. */
  fixed?: Record<string, Choice[]>;
  children?: ReactNode;
  /** The comparison picker — only on the reports that compare (Phase 7). */
  compare?: boolean;
  /** Refresh and full screen (Phase 7); on everywhere unless a page has its own. */
  actions?: boolean;
}) {
  const f = useReportOrgFilters();
  const mine = space ? (f.picked[space] ?? {}) : {};
  const any = Object.values(mine).some((v) => v.length > 0);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {orgs && orgs.length > 0 && (
        <Select label="Organization" value={org?.id ?? ""} onChange={f.setEntity} options={orgs.map((o) => ({ key: o.id, name: `${o.name} · ${o.currency}` }))} />
      )}
      {period && <PeriodPicker />}
      {period && compare && <ComparePicker />}
      {space && filters.map((d) => {
        // What is picked stays listed even when the period no longer has it, so it can be unpicked.
        const given = fixed?.[d.key] ?? options?.[d.key] ?? [];
        const kept = (mine[d.key] ?? []).filter((k) => !given.some((c) => c.key === k)).map((k) => ({ key: k, name: k, count: 0 }));
        return <MultiSelect key={d.key} label={d.label} choices={[...given, ...kept]} value={mine[d.key] ?? []} onChange={(v) => f.setPicked(space, d.key, v)} />;
      })}
      {children}
      {space && any && (
        <button type="button" onClick={() => f.clearPicked(space)} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
          Clear filters
        </button>
      )}
      {actions && <div className="ml-auto"><ToolbarActions /></div>}
    </div>
  );
}

/** The organization picked — the first finance lists until one is. */
export const pickOrg = (orgs: FinanceOrg[] | undefined, entity: string | null) => orgs?.find((o) => o.id === entity) ?? orgs?.[0];

/** A table's picks with the empty ones left out — what is sent to finance, and what a query is keyed by. */
export function usePicks(space: string): Record<string, string[]> {
  const { picked } = useReportOrgFilters();
  const mine = picked[space] ?? {};
  return Object.fromEntries(Object.entries(mine).filter(([, v]) => v.length > 0));
}
