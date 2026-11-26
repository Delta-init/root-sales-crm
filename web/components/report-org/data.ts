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

const POS_SETTLEMENT = {
  head: ["Description", "AED"],
  rows: [
    ["Gross collections", "10,000.00"],
    ["Processing fee", "150.00"],
    ["VAT on fee", "7.50"],
    ["Expected settlement", "9,842.50"],
    ["Actual settlement", "9,842.36"],
    ["Variance", "-0.14"],
  ],
};

const PROFIT_AND_LOSS = {
  head: ["Description", "AED"],
  rows: [
    ["Revenue", "800,000"],
    ["Direct costs", "100,000"],
    ["Gross profit", "700,000"],
    ["Operating expenses", "520,000"],
    ["Operating profit", "180,000"],
    ["Other expenses and tax", "15,000"],
    ["Net profit", "165,000"],
  ],
};

const MIGRATION_REGISTER = {
  head: ["Account", "Migrated", "Verified", "Difference"],
  rows: [
    ["Bank A", "257,500", "245,000", "-12,500"],
    ["Bank B", "175,000", "180,000", "+5,000"],
    ["Cash", "17,000", "15,000", "-2,000"],
    ["Receivables", "290,000", "285,000", "-5,000"],
  ],
};

export const SECTIONS: Section[] = [
  {
    slug: "executive",
    label: "Executive",
    title: "Executive dashboard",
    about: "Targets, collections, department contribution, profit and cash.",
    icon: LayoutDashboard,
    metrics: [
      { label: "Collections", value: 800_000, as: "money" },
      { label: "Monthly target", value: 1_200_000, as: "money" },
      { label: "Achievement", value: 66.7, as: "percent" },
      { label: "Fixed expenses", value: 500_000, as: "money" },
      { label: "Net profit", value: 165_000, as: "money" },
      { label: "Available cash", value: 485_000, as: "money" },
    ],
    panels: [
      {
        title: "Target achievement", type: "bars",
        rows: [{ label: "Monthly target", value: 66.7, as: "percent", percent: 66.7 }],
        note: "Remaining to target: 400,000",
      },
      {
        title: "Department contribution", type: "bars",
        rows: [
          { label: "Sales", value: 475_000, as: "money", percent: 59 },
          { label: "CSE", value: 330_000, as: "money", percent: 41 },
        ],
        note: "Rounded sample split; the two do not add up to collections.",
      },
    ],
    reports: [
      { name: "Revenue and targets" },
      { name: "Department performance" },
      { name: "Profitability", detail: { type: "table", ...PROFIT_AND_LOSS } },
      { name: "Cash position" },
      { name: "Management alerts" },
    ],
  },
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
  {
    slug: "reconciliation",
    label: "Reconciliation",
    title: "Reconciliation",
    about: "Bank, POS, gateway, cash, invoices, intercompany, settlement fees and exceptions.",
    icon: ArrowLeftRight,
    metrics: [
      { label: "Transactions", value: 1_248, as: "count" },
      { label: "Matched", value: 1_210, as: "count" },
      { label: "Unmatched", value: 38, as: "count" },
      { label: "Match rate", value: 96.96, as: "percent" },
      { label: "Unresolved variance", value: 17_250, as: "money" },
      { label: "Pending settlements", value: 65_000, as: "money" },
    ],
    panels: [
      {
        title: "Reconciliation progress", type: "bars",
        rows: [
          { label: "Bank", value: 98, as: "percent", percent: 98 },
          { label: "POS", value: 96, as: "percent", percent: 96 },
          { label: "Gateway", value: 99, as: "percent", percent: 99 },
          { label: "Cash", value: 100, as: "percent", percent: 100 },
          { label: "Migration", value: 82, as: "percent", percent: 82 },
        ],
      },
      { title: "POS settlement example", type: "table", ...POS_SETTLEMENT },
    ],
    reports: [
      { name: "Bank reconciliation", detail: { type: "table", head: ["Statement", "Ledger", "Variance"], rows: [["245,000", "257,500", "-12,500"]] } },
      { name: "POS reconciliation", detail: { type: "table", ...POS_SETTLEMENT } },
      { name: "Payment gateway" },
      { name: "Cash reconciliation" },
      { name: "Invoice reconciliation" },
      { name: "Intercompany reconciliation" },
      { name: "Settlement and fee analysis" },
      { name: "Exceptions" },
    ],
  },
  {
    slug: "controls",
    label: "Financial controls",
    title: "Financial controls",
    about: "Migration adjustments, suspense, approvals, anomalies, period closing and audit trail.",
    icon: ShieldCheck,
    metrics: [
      { label: "Pending approvals", value: 8, as: "count" },
      { label: "Migration exceptions", value: 12, as: "count" },
      { label: "Suspense balance", value: 24_500, as: "money" },
      { label: "Duplicate flags", value: 3, as: "count" },
      { label: "Overdue accounts", value: 2, as: "count" },
      { label: "Closing progress", value: 75, as: "percent" },
    ],
    panels: [
      { title: "Migration register", type: "table", ...MIGRATION_REGISTER },
      {
        title: "Suspense aging", type: "bars",
        rows: [
          { label: "0–7 days", value: 3_500, as: "money", percent: 14 },
          { label: "8–30 days", value: 6_000, as: "money", percent: 24 },
          { label: "31–60 days", value: 5_000, as: "money", percent: 20 },
          { label: "60+ days", value: 10_000, as: "money", percent: 41 },
        ],
      },
    ],
    reports: [
      { name: "Opening balance adjustments", detail: { type: "table", ...MIGRATION_REGISTER } },
      { name: "Suspense accounts" },
      { name: "Journal approvals" },
      { name: "Financial anomalies" },
      { name: "Period closing", detail: { type: "checklist", items: ["Bank reconciled", "POS reconciled", "Trial balance verified", "Management approval"] } },
      { name: "Audit trail" },
    ],
  },
];

export const sectionBySlug = (slug: string) => SECTIONS.find((s) => s.slug === slug) ?? null;

/**
 * The menu, in order. Finance and revenue sits among the sample sections but is not one of them: it shows finance's
 * own figures (2026-11-26), the first section connected.
 */
export const NAV: { slug: string; label: string; icon: LucideIcon; live?: boolean }[] = [
  { slug: "executive", label: "Executive", icon: LayoutDashboard },
  { slug: "sales", label: "Sales and CRMs", icon: Users2 },
  { slug: "finance", label: "Finance and revenue", icon: Banknote, live: true },
  { slug: "reconciliation", label: "Reconciliation", icon: ArrowLeftRight },
  { slug: "controls", label: "Financial controls", icon: ShieldCheck },
];

/** A sample figure as the page shows it: exact, never "800K" — Root's reports show whole figures. */
export function figure(value: number, as: Metric["as"], currency: Currency): string {
  if (as === "percent") return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  if (as === "count") return value.toLocaleString("en-US");
  return `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
