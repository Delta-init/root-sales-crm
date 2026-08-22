"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { GroupTimeline } from "@/lib/types";

/**
 * One line per org, sharing an x-axis of the union of all buckets.
 *
 * Buckets are computed server-side in each org's OWN timezone — Dubai and
 * Kolkata are 1h30 apart, so a shared UTC axis would shift Banglore's
 * late-evening leads into the neighbouring day.
 */
export function LeadsTimeline({ data }: { data: GroupTimeline }) {
  const rows = data.buckets.map((bucket) => {
    const row: Record<string, string | number> = { bucket };
    for (const s of data.series) {
      row[s.org.code] = s.points.find((p) => p.bucket === bucket)?.leads ?? 0;
    }
    return row;
  });

  if (!rows.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No leads in this period.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" vertical={false} />
        <XAxis
          dataKey="bucket"
          tick={{ fontSize: 11 }}
          className="fill-muted-foreground"
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          className="fill-muted-foreground"
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "0.5rem",
            fontSize: "12px",
          }}
          labelStyle={{ color: "hsl(var(--foreground))" }}
        />
        {data.series.map((s) => (
          <Line
            key={s.org.code}
            type="monotone"
            dataKey={s.org.code}
            name={s.org.name}
            stroke={s.org.accent}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
