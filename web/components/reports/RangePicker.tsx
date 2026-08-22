"use client";

import { cn } from "@/lib/utils";

export type RangeKey = "30d" | "90d" | "12m" | "all";

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "12m", label: "12 months" },
  { key: "all", label: "All time" },
];

/** Resolve a preset to an ISO `from`, or undefined for all time. */
export const rangeFrom = (key: RangeKey): string | undefined => {
  if (key === "all") return undefined;
  const d = new Date();
  if (key === "30d") d.setDate(d.getDate() - 30);
  if (key === "90d") d.setDate(d.getDate() - 90);
  if (key === "12m") d.setMonth(d.getMonth() - 12);
  return d.toISOString().slice(0, 10);
};

export function RangePicker({
  value,
  onChange,
}: {
  value: RangeKey;
  onChange: (key: RangeKey) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border/60 bg-card p-0.5">
      {RANGES.map((r) => (
        <button
          key={r.key}
          onClick={() => onChange(r.key)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === r.key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
