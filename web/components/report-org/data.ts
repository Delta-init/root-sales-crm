/*
 * The Report Org: what is on each of its screens (2026-11-26).
 *
 * An org that lives inside Root rather than behind a door Root opens — the
 * user, 2026-11-26: "inside application under root but ui will be different",
 * "mainly focusing report of every crms". Screens first, data later: every
 * figure here is a SAMPLE, taken from the Phase 1 UI handoff the user supplied
 * (delta-finance.md / delta-finance.html), and the pages say so on every one.
 * Nothing in this file is read from a CRM, finance or any other system.
 *
 * Kept as data so that connecting a section later is replacing its numbers,
 * not rebuilding its screen.
 *
 * Finance and revenue was the first connected (2026-11-26) and is no longer
 * in this file — see components/report-org/finance. The four sections here
 * are still samples.
 */
import type { LucideIcon } from "lucide-react";
import { ArrowLeftRight, Banknote, LayoutDashboard, ShieldCheck, Users2 } from "lucide-react";

/** The CRMs the picker offers. "all" is every CRM together. */
export const CRMS = [
  { code: "all", label: "All" },
  { code: "delta", label: "Sales" },
  { code: "draw", label: "Draw" },
  { code: "remote", label: "Remote" },
  { code: "banglore", label: "Bangalore" },
] as const;
export type CrmCode = (typeof CRMS)[number]["code"];

/** AED and INR are shown apart and never added together, as finance shows them. */
export const CURRENCIES = ["AED", "INR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface Metric {
  label: string;
  /** A sample figure. Money is a whole number in the page's currency. */
  value: number;
  as: "money" | "count" | "percent";
  hint?: string;
}

export interface BarRow { label: string; value: number; as: Metric["as"]; percent: number }

export type Panel =
  | { title: string; type: "bars"; rows: BarRow[]; note?: string }
  | { title: string; type: "table"; head: string[]; rows: string[][]; note?: string };

/** What opens under a report in the library. Most are planned and say so. */
export type ReportDetail =
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "checklist"; items: string[] };

export interface Report { name: string; detail?: ReportDetail }

export interface Section {
  slug: string;
  label: string;
  title: string;
  about: string;
  icon: LucideIcon;
  metrics: Metric[];
  panels: [Panel, Panel];
  reports: Report[];
}

export const SECTIONS: Section[] = [
  /* The Executive dashboard is not here: it is live, read from finance (Phase 7, 2026-11-28, components/report-org/finance/ExecutiveHome). */
  {
    slug: "sales",
    label: "Sales and CRMs",
    title: "Sales and CRMs",
    about: "Leads, closings and revenue in every sales CRM, together or one at a time.",
    icon: Users2,
    metrics: [
      { label: "New leads", value: 1_240, as: "count" },
      { label: "Closed sales", value: 96, as: "count" },
      { label: "Conversion", value: 7.7, as: "percent" },
      { label: "Revenue", value: 475_000, as: "money" },
      { label: "Follow-ups due", value: 212, as: "count" },
      { label: "Balance due", value: 58_200, as: "money" },
    ],
    panels: [
      {
        title: "Revenue by CRM", type: "bars",
        rows: [
          { label: "Sales", value: 245_000, as: "money", percent: 52 },
          { label: "Draw", value: 140_000, as: "money", percent: 29 },
          { label: "Remote", value: 90_000, as: "money", percent: 19 },
        ],
        note: "Bangalore is in rupees: shown apart under INR, never added in.",
      },
      {
        title: "Lead flow", type: "bars",
        rows: [
          { label: "Came in", value: 1_240, as: "count", percent: 100 },
          { label: "Contacted", value: 860, as: "count", percent: 69 },
          { label: "Meeting", value: 310, as: "count", percent: 25 },
          { label: "Closed", value: 96, as: "count", percent: 8 },
        ],
      },
    ],
    reports: [
      { name: "Leads by source" },
      { name: "Lead flow" },
      { name: "Closings" },
      { name: "Revenue by salesperson" },
      { name: "Follow-ups" },
      { name: "Lost leads and reasons" },
      { name: "3CX calls" },
      { name: "Commission" },
      { name: "Balance payments" },
    ],
  },
  /* Finance and revenue is not here: it is live, read from finance, with its own pages (components/report-org/finance). */
  /* Reconciliation is not here either: it is live, read from finance (Phase 5, 2026-11-27, components/report-org/finance/ReconciliationHome). */
  /* Financial controls is not here either: it is live, read from finance (Phase 6, 2026-11-28, components/report-org/finance/ControlsHome). */
];

export const sectionBySlug = (slug: string) => SECTIONS.find((s) => s.slug === slug) ?? null;

/**
 * The menu, in order. Finance and revenue sits among the sample sections but is not one of them: it shows finance's
 * own figures (2026-11-26), the first section connected.
 */
export const NAV: { slug: string; label: string; icon: LucideIcon; live?: boolean }[] = [
  { slug: "executive", label: "Executive", icon: LayoutDashboard, live: true },
  { slug: "sales", label: "Sales and CRMs", icon: Users2 },
  { slug: "finance", label: "Finance and revenue", icon: Banknote, live: true },
  { slug: "reconciliation", label: "Reconciliation", icon: ArrowLeftRight, live: true },
  { slug: "controls", label: "Financial controls", icon: ShieldCheck, live: true },
];

/** A sample figure as the page shows it: exact, never "800K" — Root's reports show whole figures. */
export function figure(value: number, as: Metric["as"], currency: Currency): string {
  if (as === "percent") return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  if (as === "count") return value.toLocaleString("en-US");
  return `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
