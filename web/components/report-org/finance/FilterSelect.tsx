"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * The Report Org's dropdowns (the user, 2026-11-27: "by drop down instead of button… multiple select option also").
 *
 * Two of them. Select picks one of a few — which organization, a month or a year. MultiSelect picks any number of a
 * filter's values — several salespeople, two payment methods — from a list that can be searched, each with how many
 * records it has; none picked means all.
 */

export interface Choice { key: string; name: string; count?: number }

const BOX = "h-8 rounded-md border border-input bg-background text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** One of a few. */
export function Select({ label, value, options, onChange, className }: { label: string; value: string; options: Choice[]; onChange: (key: string) => void; className?: string }) {
  return (
    <label className="inline-flex">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} title={label} className={cn(BOX, "max-w-[16rem] cursor-pointer px-2", className)}>
        {options.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
      </select>
    </label>
  );
}

/** Any number of a filter's values. Nothing picked is everything. */
export function MultiSelect({ label, choices, value, onChange }: { label: string; choices: Choice[]; value: string[]; onChange: (keys: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? choices.filter((c) => c.name.toLowerCase().includes(q)) : choices;
  }, [choices, query]);
  const names = new Map(choices.map((c) => [c.key, c.name]));
  const on = value.length > 0;
  const toggle = (key: string) => onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(BOX, "inline-flex max-w-[15rem] items-center gap-1.5 px-2.5", on && "border-primary bg-primary/10 text-primary")}
      >
        <span className="truncate">
          {label}
          {value.length === 1 && <>: {names.get(value[0]) ?? value[0]}</>}
          {value.length > 1 && <> · {value.length}</>}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
      </button>

      {open && (
        <div className="absolute left-0 top-9 z-30 w-64 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
          {choices.length > 8 && (
            <div className="relative mb-1.5">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Find in ${label.toLowerCase()}`}
                aria-label={`Find in ${label}`}
                className={cn(BOX, "w-full pl-7 pr-2")}
              />
            </div>
          )}
          <ul role="listbox" aria-multiselectable="true" aria-label={label} className="max-h-64 overflow-y-auto">
            {shown.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted-foreground">{choices.length ? "Nothing matches." : "Nothing to pick from in this period."}</li>}
            {shown.map((c) => {
              const picked = value.includes(c.key);
              return (
                <li key={c.key} role="option" aria-selected={picked}>
                  <button type="button" onClick={() => toggle(c.key)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", picked ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                      {picked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {c.count !== undefined && <span className="shrink-0 tabular-nums text-muted-foreground">{c.count.toLocaleString("en-US")}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {on && (
            <button type="button" onClick={() => onChange([])} className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded border-t border-border/60 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
              Clear, to show all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
