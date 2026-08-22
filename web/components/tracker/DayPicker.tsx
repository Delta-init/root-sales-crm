"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Gulf-time today, matching the boundary the backend and report picker use. */
export const gulfToday = () =>
  new Date(Date.now() + 4 * 60 * 60_000).toISOString().slice(0, 10);

const shiftDay = (date: string, days: number) =>
  new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

export function DayPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (date: string) => void;
}) {
  const today = gulfToday();
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
