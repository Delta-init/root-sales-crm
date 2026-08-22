"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Today in a given org's timezone.
 *
 * en-CA is the shortest route to a real YYYY-MM-DD from Intl. This has to be
 * per-org: Dubai and Kolkata are 90 minutes apart, so between 20:00 and 21:30
 * UTC it is already tomorrow in Bangalore. Hardcoding Gulf time meant the
 * Banglore page opened on the wrong day during that window — and, worse, the
 * max bound below then disabled the arrow that would have reached the right one.
 */
export const todayIn = (timezone = "Asia/Dubai") =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());

/** Gulf-time today, for views that span all three orgs. */
export const gulfToday = () => todayIn("Asia/Dubai");

const shiftDay = (date: string, days: number) =>
  new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

export function DayPicker({
  value,
  timezone,
  onChange,
}: {
  value: string;
  /** The org's zone, so "today" and the max bound match what the org sees. */
  timezone?: string;
  onChange: (date: string) => void;
}) {
  const today = todayIn(timezone);
  const isToday = value === today;

  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex items-center rounded-lg border border-border/60 bg-card">
        <button
          onClick={() => onChange(shiftDay(value, -1))}
          className="rounded-l-lg px-2 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Previous day"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <input
          type="date"
          value={value}
          max={today}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="border-x border-border/60 bg-transparent px-2 py-1.5 text-xs outline-none"
        />

        <button
          onClick={() => onChange(shiftDay(value, 1))}
          // Tomorrow has no data by definition, so forward stops at today.
          disabled={isToday}
          className="rounded-r-lg px-2 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
          title="Next day"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <button
        onClick={() => onChange(today)}
        className={cn(
          "rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-medium transition-colors",
          isToday
            ? "bg-primary text-primary-foreground"
            : "bg-card text-muted-foreground hover:text-foreground"
        )}
      >
        Today
      </button>
    </div>
  );
}
