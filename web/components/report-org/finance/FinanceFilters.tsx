"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { monthRange, rangeLabel, shiftMonth, useReportOrgFilters, yearRange, type Range } from "../ReportOrgShell";
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

const MODES: Choice[] = [{ key: "month", name: "Month" }, { key: "year", name: "Year" }, { key: "custom", name: "Dates" }];
const DATE = "h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function PeriodPicker() {
  const { range, setRange, thisMonth } = useReportOrgFilters();
  const thisYear = Number(thisMonth.slice(0, 4));
  const month = range.from.slice(0, 7);
  const year = Number(range.from.slice(0, 4));

  const pick = (mode: string) => {
    if (mode === range.mode) return;
    // A month or a year is the one the current period ends in, never one that has not started.
    const endMonth = range.to.slice(0, 7) > thisMonth ? thisMonth : range.to.slice(0, 7);
    if (mode === "month") setRange(monthRange(endMonth));
    else if (mode === "year") setRange(yearRange(Number(endMonth.slice(0, 4))));
    else setRange({ ...range, mode: "custom" });
  };
  const step = (by: number) => setRange(range.mode === "year" ? yearRange(year + by) : monthRange(shiftMonth(month, by)));
  const atEnd = range.mode === "year" ? year >= thisYear : month >= thisMonth;

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
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={range.mode === "year" ? "Previous year" : "Previous month"} onClick={() => step(-1)}>
            <ChevronLeft />
          </Button>
          <span className="min-w-[7.5rem] text-center text-xs font-medium tabular-nums text-foreground">{rangeLabel(range)}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={range.mode === "year" ? "Next year" : "Next month"} disabled={atEnd} onClick={() => step(1)}>
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}

/** A filter a table offers: which of finance's dimensions, and what to call it. */
export interface FilterDef { key: string; label: string }

/**
 * The bar: organization, period, then the table's own filters — each a dropdown taking several values — and a way to
 * clear them. `space` is the kind of table the picks belong to; `options` is what finance says each can be set to.
 */
export function FinanceFilters({ orgs, org, period = true, space, filters = [], options, fixed, children }: {
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
