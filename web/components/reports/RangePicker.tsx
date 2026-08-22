"use client";

import { useState } from "react";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type RangeKey =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "30d"
  | "90d"
  | "12m"
  | "all"
  | "custom";

export interface Range {
  from?: string;
  to?: string;
}

/**
 * Reporting timezone for range boundaries.
 *
 * Delta and Draw run on Asia/Dubai and Banglore on Asia/Kolkata, so there is
 * no single "today" across the group. Boundaries are cut in Gulf time and the
 * UI says so, rather than defaulting to UTC — a UTC midnight belongs to no
 * org, and on a one-day range that misplaces up to four hours of leads.
 *
 * Neither zone observes DST, so fixed-offset arithmetic is exact here. This
 * deliberately avoids toLocaleString({ timeZone }), which silently falls back
 * to the host timezone on a small-icu build.
 */
export const REPORT_TZ_LABEL = "Gulf time (UTC+4)";
const TZ_OFFSET_MIN = 4 * 60;

const shift = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

/** Start of the local day containing `d`, as a UTC instant. */
const startOfLocalDay = (d: Date): Date => {
  const local = shift(d, TZ_OFFSET_MIN);
  local.setUTCHours(0, 0, 0, 0);
  return shift(local, -TZ_OFFSET_MIN);
};

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** End of the local day containing `d`, as a UTC instant. */
const endOfLocalDay = (d: Date): Date =>
  new Date(addDays(startOfLocalDay(d), 1).getTime() - 1);

export const RANGES: { key: RangeKey; label: string; group: "quick" | "long" }[] = [
  { key: "today", label: "Today", group: "quick" },
  { key: "yesterday", label: "Yesterday", group: "quick" },
  { key: "week", label: "This week", group: "quick" },
  { key: "month", label: "This month", group: "quick" },
  { key: "30d", label: "Last 30 days", group: "long" },
  { key: "90d", label: "Last 90 days", group: "long" },
  { key: "12m", label: "Last 12 months", group: "long" },
  { key: "all", label: "All time", group: "long" },
];

/**
 * Resolve a preset to an instant window.
 *
 * Same-day and this-week ranges send full ISO timestamps so the boundary lands
 * on Gulf midnight rather than UTC midnight. The longer presets send bare
 * dates, where a few hours of skew is noise against months of data.
 */
export const resolveRange = (key: RangeKey, custom?: Range): Range => {
  const now = new Date();

  if (key === "all") return {};
  if (key === "custom") return custom ?? {};

  if (key === "today") {
    return { from: startOfLocalDay(now).toISOString(), to: endOfLocalDay(now).toISOString() };
  }

  if (key === "yesterday") {
    const y = addDays(now, -1);
    return { from: startOfLocalDay(y).toISOString(), to: endOfLocalDay(y).toISOString() };
  }

  if (key === "week") {
    // Monday-first, matching how the sales teams report.
    const local = shift(now, TZ_OFFSET_MIN);
    const dow = (local.getUTCDay() + 6) % 7;
    return {
      from: startOfLocalDay(addDays(now, -dow)).toISOString(),
      to: endOfLocalDay(now).toISOString(),
    };
  }

  if (key === "month") {
    const local = shift(now, TZ_OFFSET_MIN);
    const first = addDays(now, -(local.getUTCDate() - 1));
    return {
      from: startOfLocalDay(first).toISOString(),
      to: endOfLocalDay(now).toISOString(),
    };
  }

  const d = new Date();
  if (key === "30d") d.setDate(d.getDate() - 30);
  if (key === "90d") d.setDate(d.getDate() - 90);
  if (key === "12m") d.setMonth(d.getMonth() - 12);
  return { from: d.toISOString().slice(0, 10) };
};

/** Day granularity only makes sense on ranges short enough to read. */
export const granularityFor = (key: RangeKey, range: Range): "day" | "month" => {
  if (key === "12m" || key === "all") return "month";
  if (key === "custom" && range.from) {
    const days = (Date.now() - new Date(range.from).getTime()) / 86_400_000;
    return days > 120 ? "month" : "day";
  }
  return "day";
};

const todayInput = () => startOfLocalDay(new Date()).toISOString().slice(0, 10);

export function RangePicker({
  value,
  custom,
  onChange,
}: {
  value: RangeKey;
  custom: Range;
  onChange: (key: RangeKey, custom?: Range) => void;
}) {
  const [draft, setDraft] = useState<Range>(custom);
  const [open, setOpen] = useState(false);

  const current = RANGES.find((r) => r.key === value);
  const label =
    value === "custom"
      ? custom.from
        ? `${custom.from} → ${custom.to ?? todayInput()}`
        : "Custom range"
      : current?.label ?? "Select range";

  const applyCustom = () => {
    if (!draft.from) return;
    // Guard the inverted range here rather than letting the API reject it —
    // the picker knows both ends, so it can say so immediately.
    const to = draft.to ?? todayInput();
    if (draft.from > to) return;
    onChange("custom", { from: draft.from, to });
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Quick presets stay one click away */}
      <div className="inline-flex rounded-lg border border-border/60 bg-card p-0.5">
        {RANGES.filter((r) => r.group === "quick").map((r) => (
          <button
            key={r.key}
            onClick={() => onChange(r.key)}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              value === r.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card px-2.5 py-1.5 text-xs font-medium transition-colors",
              (value === "custom" || current?.group === "long")
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            <span className="max-w-[190px] truncate">{label}</span>
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-72">
          {RANGES.filter((r) => r.group === "long").map((r) => (
            <DropdownMenuItem key={r.key} onClick={() => onChange(r.key)} className="gap-2">
              <span className="flex-1">{r.label}</span>
              {value === r.key && <Check className="h-3.5 w-3.5" />}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Custom range
          </DropdownMenuLabel>

          {/* Stop clicks inside the form from closing the menu */}
          <div
            className="space-y-2 px-2 pb-2"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  From
                </span>
                <input
                  type="date"
                  max={draft.to ?? todayInput()}
                  value={draft.from ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  To
                </span>
                <input
                  type="date"
                  min={draft.from ?? undefined}
                  max={todayInput()}
                  value={draft.to ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                />
              </label>
            </div>

            <button
              onClick={applyCustom}
              disabled={!draft.from}
              className="w-full rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-50"
            >
              Apply
            </button>

            <p className="text-[10px] leading-snug text-muted-foreground">
              Days are cut in {REPORT_TZ_LABEL}. Banglore runs 1h30 ahead, so its
              day boundary differs slightly.
            </p>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
