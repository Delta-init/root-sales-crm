"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * A stat card's breakdown (the user, 2026-10-14: "when click on the stats card
 * it need to show the breakdown … every stat card"): one panel, with a tab per
 * way of cutting the figure — by person, by source, by day, the list itself.
 */

export interface BreakdownTab { key: string; label: string; content: ReactNode }

export function BreakdownDialog({ open, onClose, title, description, tabs }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  tabs: BreakdownTab[];
}) {
  const [tab, setTab] = useState(0);
  const shown = tabs[Math.min(tab, tabs.length - 1)];
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setTab(0); } }}>
      <DialogContent className="max-h-[88vh] max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {tabs.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="tablist">
            {tabs.map((t, i) => (
              <Button key={t.key} size="sm" role="tab" aria-selected={i === tab} variant={i === tab ? "default" : "outline"} onClick={() => setTab(i)}>{t.label}</Button>
            ))}
          </div>
        )}
        <div className="min-h-[120px]">{shown?.content}</div>
      </DialogContent>
    </Dialog>
  );
}

export interface BarRow { key: string; label: ReactNode; value: number; display?: string; sub?: ReactNode }

/** Rows with a bar each, the biggest first unless given in order (days). */
export function Bars({ rows, empty = "Nothing here.", sort = true, onPick }: { rows: BarRow[]; empty?: string; sort?: boolean; onPick?: (key: string) => void }) {
  const list = sort ? [...rows].sort((a, b) => b.value - a.value) : rows;
  const max = Math.max(1, ...list.map((r) => Math.abs(r.value)));
  const total = list.reduce((n, r) => n + r.value, 0);
  if (!list.length) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="max-h-[60vh] space-y-1 overflow-auto pr-1">
      {list.map((r) => {
        const Tag = onPick ? "button" : "div";
        return (
          <Tag key={r.key} type={onPick ? "button" : undefined} onClick={onPick ? () => onPick(r.key) : undefined}
            className={cn("flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm", onPick && "hover:bg-muted/50")}>
            <span className="w-44 shrink-0 truncate font-medium sm:w-56">{r.label}{r.sub ? <span className="block truncate text-xs font-normal text-muted-foreground">{r.sub}</span> : null}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, Math.round((Math.abs(r.value) / max) * 100))}%` }} />
            </span>
            <span className="w-28 shrink-0 text-right tabular-nums">{r.display ?? r.value.toLocaleString("en-US")}</span>
            <span className="hidden w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">{total ? `${Math.round((r.value / total) * 1000) / 10}%` : ""}</span>
          </Tag>
        );
      })}
    </div>
  );
}

/** A plain table for the list tab: headings, then rows of cells. */
export function ListTable({ head, rows, empty = "Nothing here.", note }: { head: ReactNode[]; rows: ReactNode[][]; empty?: string; note?: ReactNode }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="max-h-[60vh] overflow-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="sticky top-0 bg-background">
          <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">{head.map((h, i) => <th key={i} className="pb-2 pr-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/20 align-top last:border-0">{r.map((c, j) => <td key={j} className="py-2 pr-3">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/** "Breakdown ›" — the corner hint a clickable card shows. */
export const BreakdownHint = () => (
  <span className="pointer-events-none absolute bottom-2 right-3 flex items-center text-[10px] font-medium text-muted-foreground/70 transition-colors group-hover:text-primary">
    Breakdown <ChevronRight className="h-3 w-3" />
  </span>
);

/** Click or Enter / Space: what a card does as a button. */
export const cardButton = (onClick?: () => void) =>
  onClick
    ? {
        role: "button" as const,
        tabIndex: 0,
        onClick,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } },
      }
    : {};
