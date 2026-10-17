"use client";

import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CseStatCard, type StatAccent } from "@/components/cses/CseStatCard";
import { BreakdownDialog, Bars, type BreakdownTab } from "@/components/common/Breakdown";
import { cn } from "@/lib/utils";
import { talkTime } from "@/lib/calls";

/*
 * A Reports tab's body (2026-10-17), shared by the CS portal, the sales CRMs and finance:
 * a card per section with its key figure; the section picked, with its own
 * cards, every person's / team's / month's figures and the rows behind them;
 * a person opens their own rows.
 */

export type Num = Record<string, number>;
export type Row = Record<string, any>;
export interface Group {
  total: Num; people: (Num & Record<string, any>)[]; teams: (Num & Record<string, any>)[]; months: (Num & { month: string })[]; rows: Row[];
  available?: boolean; message?: string;
}
export type Fmt = "n" | "usd" | "aed" | "secs" | "pct" | "money" | "mins";
export interface Col { key: string; label: string; fmt?: Fmt }
export interface Section<K extends string = string> {
  key: K; label: string; icon: LucideIcon; accent: StatAccent;
  headline: (t: Num) => string; headlineHint: (t: Num) => string;
  cards: (t: Num) => { title: string; value: string; hint?: string; alert?: boolean }[];
  cols: Col[];
  rowHead: string[];
  row: (r: Row, link: (r: Row) => ReactNode) => ReactNode[];
  /** Something of its own under the cards — lost reasons, lead sources. */
  extra?: (g: Group) => ReactNode;
  /** Said when the section could not be read (g.available === false). */
  unavailable?: string;
  /** What its people and teams are — "By submitter", "By department"; null leaves that view out. */
  views?: { people?: string; teams?: string | null };
  /** Not built yet: said in place of its figures. */
  soon?: string;
}

export const n0 = (v: number | undefined) => (v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const usd = (v: number | undefined) => `$${n0(v)}`;
export const aed = (v: number | undefined) => `AED ${n0(v)}`;
export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
export const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
};
export const minutes = (v: number | undefined) => { const m = Math.round(v ?? 0); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim(); };
export const monthName = (ym: string) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`));
const fmtOf = (currency: string) => (v: number | undefined, f: Fmt = "n") =>
  f === "usd" ? usd(v) : f === "aed" ? aed(v) : f === "money" ? `${currency} ${n0(v)}` : f === "secs" ? talkTime(v ?? 0) : f === "pct" ? `${n0(v)}%` : f === "mins" ? minutes(v) : n0(v);

type View = "people" | "teams" | "months" | "rows";

export function ReportBody<K extends string>({ sections, data, link, personLabel, ownerKey, currency = "AED", note }: {
  sections: Section<K>[];
  data: Record<K, Group>;
  link: (r: Row) => ReactNode;
  /** "CS", "Salesperson". */
  personLabel: string;
  /** The row field naming whose it is: cs_id, owner_id. */
  ownerKey: string;
  currency?: string;
  note: ReactNode;
}) {
  const [section, setSection] = useState<K>(sections[0]!.key);
  const [view, setView] = useState<View>("people");
  const [personPick, setPersonPick] = useState<{ id: string; name: string } | null>(null);
  const sec = sections.find((s) => s.key === section) ?? sections[0]!;
  const g = data[sec.key];
  const fmt = fmtOf(currency);
  const people = sec.views?.people ?? `By ${personLabel}`, teams = sec.views?.teams === undefined ? "By team" : sec.views.teams;
  const views: { key: View; label: string }[] = sec.soon ? [] : [{ key: "people" as View, label: people }, ...(teams ? [{ key: "teams" as View, label: teams }] : []), { key: "months", label: "By month" }, { key: "rows", label: "List" }];

  const rowsTable = (rows: Row[]) => rows.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Nothing in this period.</p> : (
    <div className="max-h-[60vh] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background"><tr className="border-b border-border/40 text-left text-xs text-muted-foreground">{sec.rowHead.map((h) => <th key={h} className="pb-2 pr-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={`${r.id ?? ""}-${r.at}-${i}`} className="border-b border-border/20 align-top last:border-0">{sec.row(r, link).map((c, j) => <td key={j} className="py-2 pr-3">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className={cn("grid grid-cols-2 gap-3", sections.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
        {sections.map((s, i) => (
          <div key={s.key} className={cn("rounded-2xl", section === s.key && "ring-2 ring-primary/60")}>
            <CseStatCard icon={s.icon} accent={s.accent} title={s.label} value={s.headline(data[s.key]?.total ?? {})} hint={s.headlineHint(data[s.key]?.total ?? {})} delay={i * 0.03}
              onClick={() => { setSection(s.key); setView("people"); }} />
          </div>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base"><sec.icon className="h-4 w-4 text-primary" /> {sec.label}</CardTitle>
            <div className="flex flex-wrap gap-1.5" role="tablist">
              {views.map((v) => <Button key={v.key} size="sm" role="tab" aria-selected={view === v.key} variant={view === v.key ? "default" : "outline"} onClick={() => setView(v.key)}>{v.label}{v.key === "rows" ? ` · ${g?.rows.length ?? 0}` : ""}</Button>)}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {sec.soon ? <p className="py-12 text-center text-sm text-muted-foreground">{sec.soon}</p> : <>
          {g && g.available === false && (
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span className="text-muted-foreground">{sec.unavailable ?? "Could not be read"} — {g.message || "it did not answer"}.</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {sec.cards(g?.total ?? {}).map((c) => (
              <motion.div key={c.title} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border/60 p-3">
                <p className="text-xs text-muted-foreground">{c.title}</p>
                <p className="mt-1 text-lg font-bold tabular-nums">{c.value}</p>
                {c.hint && <p className={cn("mt-0.5 text-xs", c.alert ? "text-rose-500" : "text-muted-foreground")}>{c.hint}</p>}
              </motion.div>
            ))}
          </div>
          {g && sec.extra?.(g)}
          {view === "rows" ? rowsTable(g?.rows ?? []) : <GroupTable view={view} cols={sec.cols} g={g} fmt={fmt} heads={{ people: people.replace(/^By /, ""), teams: (teams || "Team").replace(/^By /, "") }} onPerson={setPersonPick} />}
          <p className="text-xs text-muted-foreground">{note}</p>
          </>}
        </CardContent>
      </Card>

      {personPick && (() => {
        const rows = (g?.rows ?? []).filter((r) => r[ownerKey] === personPick.id);
        const tabs: BreakdownTab[] = [{ key: "list", label: `List · ${rows.length}`, content: rowsTable(rows) }];
        const months = new Map<string, number>();
        for (const r of rows) { const m = String(r.at ?? "").slice(0, 7); if (m) months.set(m, (months.get(m) ?? 0) + 1); }
        if (months.size > 1) tabs.push({ key: "months", label: "By month", content: <Bars sort={false} rows={Array.from(months).sort().map(([m, v]) => ({ key: m, label: monthName(m), value: v }))} /> });
        return <BreakdownDialog open onClose={() => setPersonPick(null)} title={`${personPick.name} · ${sec.label}`} description="Their rows in the period, newest first." tabs={tabs} />;
      })()}
    </>
  );
}

function GroupTable({ view, cols, g, fmt, heads, onPerson }: {
  view: Exclude<View, "rows">; cols: Col[]; g?: Group; fmt: (v: number | undefined, f?: Fmt) => string; heads: { people: string; teams: string }; onPerson: (p: { id: string; name: string }) => void;
}) {
  const list = (view === "people" ? g?.people : view === "teams" ? g?.teams : g?.months) ?? [];
  if (!list.length) return <p className="py-8 text-center text-sm text-muted-foreground">Nothing in this period.</p>;
  const nameOf = (x: any) => (view === "people" ? x.name : view === "teams" ? x.team : monthName(x.month));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
            <th className="pb-2 pr-3 font-medium">{view === "people" ? heads.people.charAt(0).toUpperCase() + heads.people.slice(1) : view === "teams" ? heads.teams.charAt(0).toUpperCase() + heads.teams.slice(1) : "Month"}</th>
            {cols.map((c) => <th key={c.key} className="whitespace-nowrap pb-2 pr-3 text-right font-medium">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {list.map((x: any, i: number) => (
            <tr key={x.id ?? x.team ?? x.month ?? i} className="border-b border-border/20 last:border-0">
              <td className="py-2 pr-3">
                {view === "people"
                  ? <button type="button" className="text-left font-medium hover:underline" onClick={() => onPerson({ id: x.id, name: x.name })}>{nameOf(x)}</button>
                  : <span className="font-medium">{nameOf(x)}</span>}
                {view === "people" && <div className="text-xs text-muted-foreground">{x.team}{x.location === "bangalore" ? " · Bangalore" : ""}{x.active === false ? " · left" : ""}</div>}
                {view === "teams" && x.location === "bangalore" && <div className="text-xs text-muted-foreground">Bangalore</div>}
              </td>
              {cols.map((c) => <td key={c.key} className={cn("py-2 pr-3 text-right tabular-nums", !x[c.key] && "text-muted-foreground/60", x[c.key] < 0 && "text-rose-500")}>{x[c.key] ? fmt(x[c.key], c.fmt) : "—"}</td>)}
            </tr>
          ))}
        </tbody>
        {view !== "months" && g?.total && (
          <tfoot>
            <tr className="border-t border-border/60 font-semibold">
              <td className="pt-2 pr-3">Total</td>
              {cols.map((c) => <td key={c.key} className="pt-2 pr-3 text-right tabular-nums">{fmt(g.total[c.key], c.fmt)}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
