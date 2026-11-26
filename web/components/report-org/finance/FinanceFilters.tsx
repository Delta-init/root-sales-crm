"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CRMS } from "../data";
import { monthRange, rangeLabel, shiftMonth, useReportOrgFilters, yearRange, type Range } from "../ReportOrgShell";
import type { FinanceOrg } from "./api";

/*
 * What the live finance reports are asked for: which organization, which CRM's money, which period.
 *
 * The organization decides the currency — Delta's dirhams and Bangalore's rupees are two organizations in finance, and
 * picking one shows that one's figures in its own currency. There is no "both": the two are never added.
 */

export function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

const MODES: { mode: Range["mode"]; label: string }[] = [
  { mode: "month", label: "Month" },
  { mode: "year", label: "Year" },
  { mode: "custom", label: "Dates" },
];

function PeriodPicker() {
  const { range, setRange, thisMonth } = useReportOrgFilters();
  const thisYear = Number(thisMonth.slice(0, 4));
  const month = range.from.slice(0, 7);
  const year = Number(range.from.slice(0, 4));

  const pick = (mode: Range["mode"]) => {
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
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1" role="group" aria-label="Period">
        {MODES.map((m) => (
          <Chip key={m.mode} on={range.mode === m.mode} onClick={() => pick(m.mode)}>{m.label}</Chip>
        ))}
      </div>
      {range.mode === "custom" ? (
        <div className="flex items-center gap-1.5 text-sm">
          <input
            type="date"
            aria-label="From"
            value={range.from}
            max={range.to}
            onChange={(e) => e.target.value && setRange({ mode: "custom", from: e.target.value, to: e.target.value > range.to ? e.target.value : range.to })}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="text-muted-foreground">to</span>
          <input
            type="date"
            aria-label="To"
            value={range.to}
            min={range.from}
            onChange={(e) => e.target.value && setRange({ mode: "custom", from: e.target.value < range.from ? e.target.value : range.from, to: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={range.mode === "year" ? "Previous year" : "Previous month"} onClick={() => step(-1)}>
            <ChevronLeft />
          </Button>
          <span className="min-w-[8.5rem] text-center text-sm font-medium tabular-nums text-foreground">{rangeLabel(range)}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={range.mode === "year" ? "Next year" : "Next month"} disabled={atEnd} onClick={() => step(1)}>
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}

export function FinanceFilters({ orgs, org, crm = true, period = true }: { orgs: FinanceOrg[] | undefined; org: FinanceOrg | undefined; crm?: boolean; /** Off for balances as they stand today, which have no period. */ period?: boolean }) {
  const f = useReportOrgFilters();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      {orgs && orgs.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Organization">
          {orgs.map((o) => (
            <Chip key={o.id} on={o.id === org?.id} onClick={() => f.setEntity(o.id)} title={`${o.name}, in ${o.currency}`}>
              {o.name} <span className="font-normal opacity-70">· {o.currency}</span>
            </Chip>
          ))}
        </div>
      )}
      {crm && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="CRM">
          {CRMS.map((c) => (
            <Chip key={c.code} on={f.crm === c.code} onClick={() => f.setCrm(c.code)}>{c.label}</Chip>
          ))}
        </div>
      )}
      {period && (
        <div className="sm:ml-auto">
          <PeriodPicker />
        </div>
      )}
    </div>
  );
}

/** The organization picked — the first finance lists until one is. */
export const pickOrg = (orgs: FinanceOrg[] | undefined, entity: string | null) => orgs?.find((o) => o.id === entity) ?? orgs?.[0];
