"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Columns3, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/*
 * The Report Org's table (the user, 2026-11-26, with a trading terminal's report as the picture: "show table only,
 * with filter and pagination and columns reorder").
 *
 * A report is one dense table and nothing else: columns that can be dragged into another order, hidden and brought
 * back, sorted by a click on their heading; a row of totals that stays in view under the rows; and pages. The order
 * and the hidden columns are remembered per table in this browser, so a report opens the way it was left.
 */

export interface GridColumn<T> {
  key: string;
  header: string;
  align?: "right";
  /** What a click on the heading sorts by. Absent: the column does not sort. */
  sort?: string;
  /** Always shown and always first — the column that names the row. */
  fixed?: boolean;
  /** Hidden until it is picked from the Columns menu. */
  hidden?: boolean;
  cell: (row: T, index: number) => ReactNode;
  /** The cell as plain text or a number, for an export. Absent: the column is left out of exports. */
  text?: (row: T, index: number) => string | number;
  /** Its cell in the totals row, and the same for an export. */
  total?: ReactNode;
  totalText?: string | number;
}

interface Saved { order: string[]; hidden: string[] }

/** A table's columns as this browser last left them: their order, and which are hidden. */
export function useGridColumns<T>(id: string, columns: GridColumn<T>[]) {
  const storageKey = `report-org:grid:${id}`;
  const [saved, setSaved] = useState<Saved | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? (JSON.parse(raw) as Saved) : null;
      setSaved(parsed && Array.isArray(parsed.order) && Array.isArray(parsed.hidden) ? parsed : null);
    } catch {
      setSaved(null);
    }
  }, [storageKey]);

  const write = useCallback((next: Saved | null) => {
    setSaved(next);
    try {
      if (next) localStorage.setItem(storageKey, JSON.stringify(next));
      else localStorage.removeItem(storageKey);
    } catch {
      // A browser that will not store it still reorders for now.
    }
  }, [storageKey]);

  return useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const kept = (saved?.order ?? []).filter((k) => byKey.has(k));
    // Columns the saved order has never seen (a new one, another currency's) go after the rest, as the report lists them.
    const keys = [...kept, ...columns.map((c) => c.key).filter((k) => !kept.includes(k))];
    const fixed = columns.filter((c) => c.fixed).map((c) => c.key);
    const all = [...fixed, ...keys.filter((k) => !fixed.includes(k))].map((k) => byKey.get(k)!);
    const isHidden = (c: GridColumn<T>) => !c.fixed && (saved && saved.order.includes(c.key) ? saved.hidden.includes(c.key) : !!c.hidden);
    const now = (): Saved => ({ order: all.map((c) => c.key), hidden: all.filter(isHidden).map((c) => c.key) });
    return {
      all,
      visible: all.filter((c) => !isHidden(c)),
      isHidden,
      changed: saved !== null,
      toggle(key: string) {
        const s = now();
        write({ ...s, hidden: s.hidden.includes(key) ? s.hidden.filter((k) => k !== key) : [...s.hidden, key] });
      },
      /** Put one column where another is. */
      move(key: string, onto: string) {
        if (key === onto) return;
        const s = now();
        const order = s.order.filter((k) => k !== key);
        const at = order.indexOf(onto);
        order.splice(at < 0 ? order.length : at, 0, key);
        write({ ...s, order });
      },
      reset: () => write(null),
    };
  }, [columns, saved, write]);
}

export type GridColumns<T> = ReturnType<typeof useGridColumns<T>>;

/** Which columns show: tick or untick; drag a heading in the table to move one. */
export function ColumnsMenu<T>({ grid }: { grid: GridColumns<T> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Columns3 />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-56 overflow-y-auto">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Tick to show. Drag a heading to move it.</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {grid.all.map((c) => {
          const shown = !grid.isHidden(c);
          return (
            <DropdownMenuItem
              key={c.key}
              disabled={c.fixed}
              // Stays open, so several can be ticked in one go.
              onSelect={(e) => { e.preventDefault(); grid.toggle(c.key); }}
              className="cursor-pointer gap-2 text-sm"
            >
              <span className={cn("flex h-4 w-4 items-center justify-center rounded border", shown ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                {shown && <Check className="h-3 w-3" />}
              </span>
              {c.header}
            </DropdownMenuItem>
          );
        })}
        {grid.changed && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => grid.reset()} className="cursor-pointer gap-2 text-sm">
              <RotateCcw className="h-3.5 w-3.5" />
              Back to how it came
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface GridSort { key: string; dir: "asc" | "desc" }

export function DataGrid<T>({
  grid, rows, rowKey, sort, onSort, loading, empty, rowClass, totals = true,
}: {
  grid: GridColumns<T>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  sort?: GridSort;
  onSort?: (key: string) => void;
  /** Rows are on their way: the ones on screen dim rather than vanish. */
  loading?: boolean;
  empty: string;
  rowClass?: (row: T) => string | undefined;
  totals?: boolean;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const cols = grid.visible;
  const hasTotals = totals && rows.length > 0 && cols.some((c) => c.total !== undefined);

  return (
    <div className="max-h-[calc(100vh-15rem)] min-h-[9rem] overflow-auto rounded-lg border border-border/60 bg-card/40">
      <table className={cn("w-full border-separate border-spacing-0 text-xs transition-opacity", loading && rows.length > 0 && "opacity-60")}>
        <thead>
          <tr>
            {cols.map((c) => {
              const sorted = sort && c.sort === sort.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  draggable={!c.fixed}
                  onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.key); e.dataTransfer.effectAllowed = "move"; setDragged(c.key); }}
                  onDragOver={(e) => { if (dragged && !c.fixed) { e.preventDefault(); setOver(c.key); } }}
                  onDragLeave={() => setOver((k) => (k === c.key ? null : k))}
                  onDrop={(e) => { e.preventDefault(); if (dragged && !c.fixed) grid.move(dragged, c.key); setDragged(null); setOver(null); }}
                  onDragEnd={() => { setDragged(null); setOver(null); }}
                  aria-sort={sorted ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                  title={c.fixed ? undefined : "Drag to move this column"}
                  className={cn(
                    "sticky top-0 z-10 whitespace-nowrap border-b border-border bg-card px-2.5 py-2 text-left text-[11px] font-medium text-muted-foreground",
                    c.align === "right" && "text-right",
                    !c.fixed && "cursor-grab active:cursor-grabbing",
                    dragged === c.key && "opacity-40",
                    over === c.key && dragged !== c.key && "border-l-2 border-l-primary",
                  )}
                >
                  {c.sort && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.sort!)}
                      className={cn("inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", c.align === "right" && "flex-row-reverse", sorted && "text-foreground")}
                    >
                      {c.header}
                      {sorted && (sort!.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className="px-4 py-10 text-center text-sm text-muted-foreground">{loading ? "Reading finance's figures…" : empty}</td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={rowKey(row, i)} className={cn("hover:bg-muted/40", rowClass?.(row))}>
                {cols.map((c) => (
                  <td key={c.key} className={cn("whitespace-nowrap border-b border-border/40 px-2.5 py-1.5 text-foreground", c.align === "right" && "text-right tabular-nums")}>
                    {c.cell(row, i)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {hasTotals && (
          <tfoot>
            <tr>
              {cols.map((c) => (
                <td key={c.key} className={cn("sticky bottom-0 z-10 whitespace-nowrap border-t border-border bg-card px-2.5 py-2 font-semibold text-foreground", c.align === "right" && "text-right tabular-nums")}>
                  {c.total ?? ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

const SIZES = [25, 50, 100, 250];

/** Which rows are on screen, and the way to the others. */
export function Pager({ page, pageSize, total, onPage, onPageSize, noun = "Rows" }: {
  page: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize: (size: number) => void; noun?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? page * pageSize + 1 : 0;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <p className="tabular-nums">{total ? `${noun} ${from.toLocaleString("en-US")} – ${to.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}` : `No ${noun.toLowerCase()}`}</p>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {SIZES.map((n) => <option key={n} value={n}>{n} per page</option>)}
          </select>
        </label>
        <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Previous page" disabled={page <= 0} onClick={() => onPage(page - 1)}>
          <ChevronLeft />
        </Button>
        <span className="min-w-[5.5rem] text-center tabular-nums">Page {(page + 1).toLocaleString("en-US")} of {pages.toLocaleString("en-US")}</span>
        <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/** A table as the rows of a file: the columns on screen, in their order, then the totals when there are any. */
export function gridCsv<T>(cols: GridColumn<T>[], rows: T[], totals = true): (string | number)[][] {
  const out = cols.filter((c) => c.text);
  const lines: (string | number)[][] = [out.map((c) => c.header), ...rows.map((r, i) => out.map((c) => c.text!(r, i)))];
  if (totals && out.some((c) => c.totalText !== undefined)) lines.push(out.map((c) => c.totalText ?? ""));
  return lines;
}
