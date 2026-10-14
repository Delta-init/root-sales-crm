"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BreakdownHint, cardButton } from "@/components/common/Breakdown";

/*
 * A figure on the CSEs pages, in the look of Tetra Commission's own dashboard
 * cards (the user, 2026-10-11): the label, a tinted icon, the figure large and
 * a line under it. Tinted with alpha so it reads in both themes.
 */

const ACCENTS = {
  blue: { chip: "bg-blue-500/10 text-blue-500 ring-blue-500/20", bar: "from-blue-600 to-sky-400" },
  emerald: { chip: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20", bar: "from-emerald-500 to-teal-300" },
  cyan: { chip: "bg-cyan-500/10 text-cyan-500 ring-cyan-500/20", bar: "from-cyan-500 to-teal-300" },
  violet: { chip: "bg-violet-500/10 text-violet-500 ring-violet-500/20", bar: "from-violet-500 to-fuchsia-400" },
  amber: { chip: "bg-amber-500/10 text-amber-500 ring-amber-500/20", bar: "from-amber-400 to-orange-400" },
  rose: { chip: "bg-rose-500/10 text-rose-500 ring-rose-500/20", bar: "from-rose-500 to-red-400" },
} as const;
export type StatAccent = keyof typeof ACCENTS;

export function CseStatCard({ title, value, hint, icon: Icon, accent = "blue", alert, delay = 0, onClick }: {
  title: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  accent?: StatAccent;
  /** The hint in red: something is late. */
  alert?: boolean;
  delay?: number;
  /** Opens the figure's breakdown (2026-10-14). */
  onClick?: () => void;
}) {
  const a = ACCENTS[accent];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className={cn("group relative min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5",
        onClick && "cursor-pointer pb-6 hover:border-primary/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary")}
      {...cardButton(onClick)}
    >
      <span className={cn("absolute inset-x-0 top-0 h-[3px] origin-left scale-x-[0.18] bg-gradient-to-r transition-transform duration-500 group-hover:scale-x-100", a.bar)} />
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", a.chip)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      {/* Wraps rather than cuts: "AED 49,500 · USD 3,700" in half a phone's width. */}
      <p className="mt-2 break-words text-xl font-bold leading-tight tracking-tight tabular-nums sm:text-[1.7rem]">{value}</p>
      {hint && <p className={cn("mt-1.5 line-clamp-2 text-xs", alert ? "text-rose-500" : "text-muted-foreground")} title={hint}>{hint}</p>}
      {onClick && <BreakdownHint />}
    </motion.div>
  );
}
