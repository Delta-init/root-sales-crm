"use client";

import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FiltersScope } from "../ReportOrgShell";
import { money } from "./api";
import type { LiveSpec } from "./catalog";
import { AgingTable, ExpenseTable, InPopup, LedgerTable, RevenueTable, type Titled } from "./ReportViewer";

/*
 * A headline card's breakdown (the user, 2026-11-27: "when click on the stats card we need to see break down as popup
 * with same table with filter and export option").
 *
 * The same tables the reports open in — filters, columns, paging, summary or records, export — in a popup that starts
 * on the page's organization, period and CRM, and keeps whatever is changed in it to itself (FiltersScope). Each
 * table adds up to its card: the same finance figures, counted the same way.
 */

export type CardKey = "invoiced" | "net" | "collected" | "expenses" | "expensesOther" | "profit" | "receivables" | "payables" | "vat" | "vatOut" | "collectedOther";

type Tab = { key: string; label: string; spec: LiveSpec; about: string };

const report = (key: string, name: string, about: string, spec: LiveSpec): Titled =>
  ({ id: `CARD-${key.toUpperCase()}`, name, about, state: "live", spec, category: { name: "Headline figures" } });

function tabsFor(card: CardKey, currency?: string): Tab[] {
  switch (card) {
    case "invoiced":
    case "net":
      return [{ key: card, label: "Invoices", about: card === "net" ? "The invoices issued in the period, less the credit notes issued in it." : "The invoices issued in the period, with their credit notes.", spec: { kind: "revenue", basis: "invoiced", groupBy: "day", period: "month", chart: "line", columns: ["collected", "owed"] } }];
    case "collected":
      return [{ key: card, label: "Payments", about: "Each payment received in the period.", spec: { kind: "revenue", basis: "collected", groupBy: "day", period: "month", chart: "line" } }];
    case "collectedOther":
      return [{ key: card, label: `Payments in ${currency}`, about: `Each payment made in ${currency}, as it was paid. Never converted or added to the organization's own currency.`, spec: { kind: "revenue", basis: "collected", groupBy: "day", period: "month", chart: "line", paidIn: currency } }];
    case "expenses":
      return [{ key: card, label: "Expenses", about: "The expenses counted in the card: profit-and-loss expenses, approved or waiting.", spec: { kind: "expenses", groupBy: "category", period: "month", chart: "bar" } }];
    case "expensesOther":
      return [{ key: card, label: `Expenses in ${currency}`, about: `The expenses in ${currency}, as they were recorded. Never converted or added to the other currency.`, spec: { kind: "expenses", groupBy: "category", period: "month", chart: "bar", currency } }];
    case "profit":
      return [
        { key: "income", label: "Income", about: "What the income is: each invoice before VAT.", spec: { kind: "ledger", source: "vat", groupBy: "month", view: "records", period: "month", params: { kind: "income" } } },
        { key: "spent", label: "Expenses", about: "What comes off it: the profit-and-loss expenses.", spec: { kind: "expenses", groupBy: "category", period: "month", chart: "bar" } },
      ];
    case "receivables":
      return [{ key: card, label: "Open invoices", about: "Every invoice still owed on, by how late it is.", spec: { kind: "aging", side: "receivables", groupBy: "band", view: "summary" } }];
    case "payables":
      return [{ key: card, label: "Open bills", about: "Every supplier bill still owed on, by how late it is.", spec: { kind: "aging", side: "payables", groupBy: "band", view: "summary" } }];
    case "vatOut":
      return [{ key: "output", label: "Output VAT", about: "VAT charged on sales.", spec: { kind: "ledger", source: "vat", groupBy: "month", view: "records", period: "month", params: { kind: "output" } } }];
    case "vat":
      return [
        { key: "output", label: "Output VAT", about: "VAT charged on sales.", spec: { kind: "ledger", source: "vat", groupBy: "month", view: "records", period: "month", params: { kind: "output" } } },
        { key: "input", label: "Input VAT", about: "VAT paid on supplier bills.", spec: { kind: "ledger", source: "vat", groupBy: "month", view: "records", period: "month", params: { kind: "input" } } },
      ];
  }
}

function Table({ tab, title }: { tab: Tab; title: string }) {
  const r = report(tab.key, title, tab.about, tab.spec);
  const s = tab.spec;
  if (s.kind === "revenue") return <RevenueTable report={r} spec={s} />;
  if (s.kind === "expenses") return <ExpenseTable report={r} spec={s} />;
  if (s.kind === "aging") return <AgingTable report={r} spec={s} />;
  if (s.kind === "ledger") return <LedgerTable report={r} spec={s} />;
  return null;
}

export interface CardOpen { card: CardKey; title: string; value: string; note?: ReactNode; currency?: string }

export function CardPopup({ open, onClose }: { open: CardOpen | null; onClose: () => void }) {
  return (
    <Dialog open={!!open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[min(96vw,80rem)] sm:max-w-[min(96vw,80rem)]">
        {open && <Body key={`${open.card}:${open.currency ?? ""}`} open={open} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ open }: { open: CardOpen }) {
  const tabs = tabsFor(open.card, open.currency);
  const [on, setOn] = useState(tabs[0]!.key);
  const tab = tabs.find((t) => t.key === on) ?? tabs[0]!;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{open.title}: {open.value}</DialogTitle>
        <DialogDescription>{open.note ?? "The rows behind the figure. Filters changed here stay here."}</DialogDescription>
      </DialogHeader>
      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.key} type="button" onClick={() => setOn(t.key)}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm transition-colors", t.key === tab.key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <InPopup.Provider value>
        <FiltersScope carry={{ receivables: ["revenue", "crm"], "vat-output": ["revenue", "crm"] }}>
          <Table key={tab.key} tab={tab} title={open.title} />
        </FiltersScope>
      </InPopup.Provider>
    </>
  );
}

/** "Income AED 1,000 less expenses AED 400" — said above the two tabs of "Income less expenses" and the VAT position. */
export const lessText = (a: [string, number], b: [string, number], cur: string) => `${a[0]} ${money(a[1], cur)} less ${b[0]} ${money(b[1], cur)}.`;
