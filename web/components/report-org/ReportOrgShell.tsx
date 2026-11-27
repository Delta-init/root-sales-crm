"use client";

import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { ImpersonationBanner } from "@/components/shared/ImpersonationBanner";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { cn } from "@/lib/utils";
import { NAV, type CrmCode, type Currency } from "./data";
import { FinanceMenu } from "./finance/FinanceMenu";

/*
 * The Report Org's own frame (2026-11-26).
 *
 * Deliberately not Root's: a menu down the side where Root has tabs along the
 * top, and green where Root is blue — the user asked for an org that sits
 * inside Root "but ui will be different". The green is set on this wrapper
 * alone, by overriding the two theme variables the shared buttons, links and
 * focus rings already read, so nothing outside the Report Org changes colour
 * and the shared components need no second variant.
 */
const ACCENT = { "--primary": "161 69% 37%", "--ring": "161 69% 37%" } as CSSProperties;

/** This month in Dubai, as YYYY-MM — the office's month, not the browser's. */
export const dubaiMonth = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit" }).format(new Date());

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/**
 * A period for the live reports: a whole month, a whole year, or two dates. Days are YYYY-MM-DD and both are
 * included, as finance reads them.
 */
export interface Range { mode: "month" | "year" | "custom"; from: string; to: string }

export const monthRange = (month: string): Range => {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { mode: "month", from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
};

export const yearRange = (year: number): Range => ({ mode: "year", from: `${year}-01-01`, to: `${year}-12-31` });

const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

/** "November 2026", "2026", or "3 Nov 2026 – 18 Nov 2026". */
export const rangeLabel = (r: Range) =>
  r.mode === "month" ? monthLabel(r.from.slice(0, 7)) : r.mode === "year" ? r.from.slice(0, 4) : `${dayLabel(r.from)} – ${dayLabel(r.to)}`;

interface Filters {
  crm: CrmCode;
  currency: Currency;
  month: string;
  thisMonth: string;
  setCrm: (crm: CrmCode) => void;
  setCurrency: (currency: Currency) => void;
  setMonth: (month: string) => void;
  reset: () => void;
  /** The live sections: which finance organization (null: the first finance lists), and the period. */
  entity: string | null;
  setEntity: (entity: string) => void;
  range: Range;
  setRange: (range: Range) => void;
  /**
   * What each filter of the live tables is set to — several values each — kept per kind of table ("revenue",
   * "expenses", "receivables", "payables"), since a salesperson picked for revenue means nothing to a list of bills.
   * Kept here so it stays as one report is left for the next of its kind.
   */
  picked: Record<string, Record<string, string[]>>;
  setPicked: (space: string, filter: string, values: string[]) => void;
  clearPicked: (space: string) => void;
}

const FiltersContext = createContext<Filters | null>(null);

/**
 * Which CRM, currency and month the Report Org is showing.
 *
 * Held here rather than on each page so that going from one section to the
 * next keeps what was picked: somebody looking at Draw in the sales section
 * means Draw in the finance one too.
 */
export function useReportOrgFilters(): Filters {
  const value = useContext(FiltersContext);
  if (!value) throw new Error("useReportOrgFilters must be used inside ReportOrgShell");
  return value;
}

/**
 * The same filters, held apart (2026-11-27): a breakdown opened from a headline card starts on the page's organization,
 * period and picks, and whatever is changed inside it stays inside it — the page behind keeps its own.
 */
export function FiltersScope({ children, carry = {} }: { children: ReactNode; carry?: Record<string, [string, string]> }) {
  const outer = useReportOrgFilters();
  const [entity, setEntity] = useState<string | null>(outer.entity);
  const [range, setRange] = useState<Range>(outer.range);
  // `carry`: a pick of one kind of table that starts another's — the page's CRM, for the open invoices and their VAT.
  const [picked, setPickedState] = useState<Record<string, Record<string, string[]>>>(() => {
    const all = { ...outer.picked };
    for (const [to, [from, filter]] of Object.entries(carry)) {
      const values = outer.picked[from]?.[filter];
      if (values?.length) all[to] = { ...(all[to] ?? {}), [filter]: values };
    }
    return all;
  });
  const filters = useMemo<Filters>(
    () => ({
      ...outer,
      entity, setEntity, range, setRange, picked,
      setPicked: (space, filter, values) => setPickedState((all) => ({ ...all, [space]: { ...(all[space] ?? {}), [filter]: values } })),
      clearPicked: (space) => setPickedState((all) => ({ ...all, [space]: {} })),
    }),
    [outer, entity, range, picked],
  );
  return <FiltersContext.Provider value={filters}>{children}</FiltersContext.Provider>;
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
        R
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-tight text-foreground">Report Org</p>
        <p className="text-xs text-muted-foreground">Built in Root</p>
      </div>
    </div>
  );
}

export function ReportOrgShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [thisMonth] = useState(dubaiMonth);
  const [crm, setCrm] = useState<CrmCode>("all");
  const [currency, setCurrency] = useState<Currency>("AED");
  const [month, setMonth] = useState(thisMonth);
  const [entity, setEntity] = useState<string | null>(null);
  const [range, setRange] = useState<Range>(() => monthRange(thisMonth));
  const [picked, setPickedState] = useState<Record<string, Record<string, string[]>>>({});

  const filters = useMemo<Filters>(
    () => ({
      crm, currency, month, thisMonth, setCrm, setCurrency, setMonth,
      reset: () => { setCrm("all"); setCurrency("AED"); setMonth(thisMonth); },
      entity, setEntity, range, setRange,
      picked,
      setPicked: (space, filter, values) => setPickedState((all) => ({ ...all, [space]: { ...(all[space] ?? {}), [filter]: values } })),
      clearPicked: (space) => setPickedState((all) => ({ ...all, [space]: {} })),
    }),
    [crm, currency, month, thisMonth, entity, range, picked],
  );

  const isOn = (slug: string) => path === `/report-org/${slug}` || path.startsWith(`/report-org/${slug}/`);

  // Finance and revenue opens to its report groups in the side menu: open while one of its pages is, and whenever
  // it is opened by hand; closing it by hand keeps it closed until the section is left and come back to.
  const inFinance = path === "/report-org/finance" || path.startsWith("/report-org/finance/");
  const [financeOpen, setFinanceOpen] = useState(inFinance);
  useEffect(() => { if (inFinance) setFinanceOpen(true); }, [inFinance]);

  return (
    <FiltersContext.Provider value={filters}>
      <div className="min-h-screen bg-background text-foreground" style={ACCENT}>
        <ImpersonationBanner />
        <div className="md:grid md:grid-cols-[17rem_minmax(0,1fr)]">
          {/* Wide screens: the menu down the side, always in view. */}
          <aside className="hidden border-r border-border/60 bg-card/40 px-3 py-4 md:sticky md:top-0 md:flex md:h-screen md:flex-col">
            <div className="px-2 pb-5">
              <Brand />
            </div>
            <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Reports</p>
            {/* The menu scrolls by itself: with a report group open it is longer than the screen, and the way back to
                Root stays in view under it. */}
            <nav className="-mr-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-2" aria-label="Report Org sections">
              {NAV.map((s) => {
                const on = isOn(s.slug);
                const Icon = s.icon;
                // The section with report groups under it: its own row is the page that is open only when no report is.
                const tree = s.slug === "finance";
                const here = on && (!tree || path === "/report-org/finance");
                return (
                  <div key={s.slug}>
                    <div
                      className={cn(
                        "flex items-center rounded-md transition-colors",
                        here ? "bg-primary/10 font-medium text-primary" : on ? "font-medium text-foreground hover:bg-muted/60" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <Link href={`/report-org/${s.slug}`} aria-current={here ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{s.label}</span>
                      </Link>
                      {tree && (
                        <button
                          type="button"
                          aria-expanded={financeOpen}
                          aria-label={financeOpen ? "Hide the report groups" : "Show the report groups"}
                          onClick={() => setFinanceOpen((v) => !v)}
                          className="mr-1 rounded p-1 text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ChevronRight className={cn("h-4 w-4 transition-transform", financeOpen && "rotate-90")} />
                        </button>
                      )}
                    </div>
                    {tree && financeOpen && <FinanceMenu path={path} />}
                  </div>
                );
              })}
            </nav>
            <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
              <Link
                href="/dashboard"
                className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Root
              </Link>
              <ThemeToggle />
            </div>
          </aside>

          <div className="min-w-0">
            {/* Phones: the same menu as a row that scrolls, under the org's name. */}
            <header className="pwa-safe-top sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur md:hidden">
              <div className="flex items-center justify-between px-4 py-2.5">
                <Brand />
                <div className="flex items-center gap-1">
                  <ThemeToggle />
                  <Link
                    href="/dashboard"
                    className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Root
                  </Link>
                </div>
              </div>
              <nav className="overflow-x-auto px-3" aria-label="Report Org sections">
                <div className="flex w-max gap-1 pb-2">
                  {NAV.map((s) => {
                    const on = isOn(s.slug);
                    const Icon = s.icon;
                    return (
                      <Link
                        key={s.slug}
                        href={`/report-org/${s.slug}`}
                        aria-current={on ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs transition-colors",
                          on ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {s.label}
                      </Link>
                    );
                  })}
                </div>
              </nav>
            </header>

            <main className="mx-auto max-w-6xl px-4 pb-12 pt-5 md:px-8 md:pt-8">{children}</main>
          </div>
        </div>
      </div>
    </FiltersContext.Provider>
  );
}
