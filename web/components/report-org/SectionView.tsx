"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CRMS, CURRENCIES, figure, type Currency, type Panel, type Report, type ReportDetail, type Section } from "./data";
import { monthLabel, shiftMonth, useReportOrgFilters } from "./ReportOrgShell";

/*
 * One section of the Report Org: six figures, two panels, and the reports
 * that belong to it (2026-11-26).
 *
 * No live data is connected yet, and the screen never pretends otherwise.
 * The sample figures exist for one view only — every CRM, in AED, this
 * month — and carry a "Sample data" badge. Pick a CRM, rupees or another
 * month and the figures become dashes with a sentence saying why, rather
 * than the same sample numbers under a different label, which would read as
 * Draw's revenue being identical to everybody's.
 */

const NONE = "—";

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
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

function SampleTable({ head, rows, sample }: { head: string[]; rows: string[][]; sample: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
            {head.map((h, i) => (
              <th key={h} className={cn("py-2 font-medium", i > 0 && "text-right")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-b border-border/40 last:border-0">
              {row.map((cell, i) => (
                <td key={i} className={cn("py-2", i > 0 && "text-right tabular-nums", i === 0 && "text-muted-foreground")}>
                  {/* The first column names the row; the rest are figures, and a view with no data has none. */}
                  {i === 0 || sample ? cell : NONE}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PanelCard({ panel, sample, currency }: { panel: Panel; sample: boolean; currency: Currency }) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-5">
        <h2 className="text-sm font-semibold text-foreground">{panel.title}</h2>
        <div className="mt-4">
          {panel.type === "bars" ? (
            <div className="space-y-3.5">
              {panel.rows.map((row) => (
                <div key={row.label}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-medium tabular-nums text-foreground">{sample ? figure(row.value, row.as, currency) : NONE}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${sample ? row.percent : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <SampleTable head={panel.head} rows={panel.rows} sample={sample} />
          )}
        </div>
        {panel.note && sample && <p className="mt-3 text-xs text-muted-foreground">{panel.note}</p>}
      </CardContent>
    </Card>
  );
}

function Detail({ detail, sample }: { detail?: ReportDetail; sample: boolean }) {
  const [ticked, setTicked] = useState<Record<string, boolean>>({});

  if (!detail) {
    return (
      <p className="text-sm text-muted-foreground">
        Planned report. It will have date filters, the transactions behind each figure, a comparison with the period
        before, and an export. It needs live data first.
      </p>
    );
  }
  if (detail.type === "table") {
    return (
      <div>
        <SampleTable head={detail.head} rows={detail.rows} sample={sample} />
        <p className="mt-2 text-xs text-muted-foreground">{sample ? "Sample figures." : "No live data is connected for this view yet."}</p>
      </div>
    );
  }
  return (
    <div>
      <ul className="space-y-2">
        {detail.items.map((item) => (
          <li key={item}>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
                checked={!!ticked[item]}
                onChange={(e) => setTicked((t) => ({ ...t, [item]: e.target.checked }))}
              />
              {item}
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">A demo checklist. Nothing is saved, and no period is closed.</p>
    </div>
  );
}

function ReportLibrary({ reports, sample }: { reports: Report[]; sample: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? reports.filter((r) => r.name.toLowerCase().includes(q)) : reports;
  }, [reports, query]);

  return (
    <Card className="border-border/50">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Report library</h2>
            <p className="text-xs text-muted-foreground">{reports.length} reports in this section</p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search reports"
              aria-label="Search reports"
              className="h-9 pl-9"
            />
          </div>
        </div>

        <ul className="mt-4 divide-y divide-border/50">
          {shown.map((report) => {
            const isOpen = open === report.name;
            return (
              <li key={report.name}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : report.name)}
                  className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className={cn("font-medium", isOpen ? "text-primary" : "text-foreground")}>{report.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {!report.detail && <span className="rounded bg-muted px-1.5 py-0.5">Planned</span>}
                    <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
                  </span>
                </button>
                {isOpen && (
                  <div className="mb-3 rounded-lg bg-muted/40 p-4">
                    <Detail detail={report.detail} sample={sample} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {shown.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No report here matches “{query.trim()}”.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function SectionView({ section }: { section: Section }) {
  const { crm, currency, month, thisMonth, setCrm, setCurrency, setMonth, reset } = useReportOrgFilters();

  // The one view the sample figures were written for. Anything else has no figures at all yet.
  const sample = crm === "all" && currency === "AED" && month === thisMonth;

  const exportCsv = () => {
    const rows = [["Metric", "Sample value"], ...section.metrics.map((m) => [m.label, figure(m.value, m.as, currency)])];
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-org-${section.slug}-sample.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">Reports and intelligence</p>
          <h1 className="mt-1 text-2xl font-bold text-foreground">{section.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{section.about}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
            Sample data
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={!sample}
            title={sample ? "Download these sample figures as a CSV file" : "Nothing to export for this view yet"}
          >
            <Download />
            Export
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="CRM">
          {CRMS.map((c) => (
            <Chip key={c.code} on={crm === c.code} onClick={() => setCrm(c.code)}>{c.label}</Chip>
          ))}
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Currency">
          {CURRENCIES.map((c) => (
            <Chip key={c} on={currency === c} onClick={() => setCurrency(c)}>{c}</Chip>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft />
          </Button>
          <span className="min-w-[8.5rem] text-center text-sm font-medium tabular-nums text-foreground">{monthLabel(month)}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Next month"
            disabled={month >= thisMonth}
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      {!sample && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          <p>
            No live data is connected yet. The sample figures are for every CRM together, in AED, for {monthLabel(thisMonth)}.
            {currency === "INR" && " Rupee figures stay apart from AED and are never added in."}
          </p>
          <button type="button" onClick={reset} className="shrink-0 font-medium text-primary underline-offset-4 hover:underline">
            Back to the sample view
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {section.metrics.map((m) => (
          <Card key={m.label} className="border-border/50">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="mt-1.5 break-words text-xl font-semibold tabular-nums text-foreground sm:text-2xl">
                {sample ? figure(m.value, m.as, currency) : NONE}
              </p>
              {m.hint && sample && <p className="mt-1 text-xs text-muted-foreground">{m.hint}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {section.panels.map((panel) => (
          <PanelCard key={panel.title} panel={panel} sample={sample} currency={currency} />
        ))}
      </div>

      <ReportLibrary reports={section.reports} sample={sample} />
    </div>
  );
}
