"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CseFundingRow, CseFundingStage, CseUpgradeRow } from "@/lib/types";

/*
 * The CSEs pages' money in Tetra Commission's way (the user, 2026-10-14):
 * fully in AED — and a Bangalore CSE's in INR, apart, at the portal's fixed
 * rates — funding requests with where each is paused and the commission it
 * earned, and the recent course upgrades.
 */

export const AED_PER_USD = 3.67;
/** Tetra Commission's fixed rates: 1 USD = 3.67 AED, 1 INR = 0.010 USD — so AED 1 ≈ INR 27.25. */
export const USD_PER_INR = 0.01;
const INR_PER_AED = 1 / (AED_PER_USD * USD_PER_INR);
/** 1,000 · 110.10 — cents only when there are any, and then both digits. */
const num = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2, maximumFractionDigits: 2 });
export const aedText = (n: number) => `AED ${num(n)}`;

/** An AED amount in a CSE's currency: AED, or INR for Bangalore (as Tetra Commission shows it them). */
export const money = (aed: number, location?: string | null) =>
  location === "bangalore" ? `INR ${num(Math.round((Number(aed) || 0) * INR_PER_AED * 100) / 100)}` : aedText(Number(aed) || 0);
/** A USD amount (commission, a bonus) the same way: AED at 3.67, or INR. */
export const moneyOfUsd = (usd: number, location?: string | null) => money((Number(usd) || 0) * AED_PER_USD, location);

export const STAGE_LABEL: Record<CseFundingStage, { label: string; cls: string }> = {
  sent_back: { label: "Sent back to the CSE", cls: "border-rose-500/40 text-rose-500" },
  with_finance: { label: "With finance", cls: "border-sky-500/40 text-sky-500" },
  waiting_broker: { label: "Waiting for a broker admin", cls: "border-amber-500/40 text-amber-500" },
  approved: { label: "Approved", cls: "border-emerald-500/40 text-emerald-500" },
  rejected: { label: "Rejected", cls: "border-border text-muted-foreground" },
};
const WAITING = new Set<CseFundingStage>(["sent_back", "with_finance", "waiting_broker"]);

const gst = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
};

/** Funding requests: waiting ones first (where each is paused), then the period's decided ones. */
export function FundingTable({ rows: given, total, showCs = true, studentHref, location }: {
  rows: CseFundingRow[];
  total: number;
  showCs?: boolean;
  /** One CSE's page: their location, for a request Tetra Commission has not located. */
  location?: CseFundingRow["location"];
  studentHref?: (studentId: string) => string | null;
}) {
  const [filter, setFilter] = useState<"waiting" | "all">("waiting");
  const rows = location ? given.map((r) => (r.location ? r : { ...r, location })) : given;
  const waiting = rows.filter((r) => WAITING.has(r.stage));
  const shown = filter === "waiting" ? waiting : rows;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={filter === "waiting" ? "default" : "outline"} onClick={() => setFilter("waiting")}>Waiting · {waiting.length}</Button>
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>All · {rows.length}</Button>
        {total > rows.length && <span className="text-xs text-muted-foreground">the first {rows.length} of {total}</span>}
      </div>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{filter === "waiting" ? "No funding request is waiting." : "No funding requests in this period."}</p>
      ) : (
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Requested</th>
                <th className="pb-2 pr-3 font-medium">Student</th>
                {showCs && <th className="pb-2 pr-3 font-medium">CSE</th>}
                <th className="pb-2 pr-3 font-medium">Request</th>
                <th className="pb-2 pr-3 text-right font-medium">Amount</th>
                <th className="pb-2 pr-3 font-medium">Where it is</th>
                <th className="pb-2 text-right font-medium">Commission earned</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const st = STAGE_LABEL[r.stage];
                const href = studentHref?.(r.studentId) ?? null;
                return (
                  <tr key={r.id} className="border-b border-border/20 align-top last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{gst(r.requestedAt)}</td>
                    <td className="py-2 pr-3">
                      {href ? <a href={href} target="_blank" rel="noreferrer" className="hover:underline">{r.student || "—"}</a> : r.student || "—"}
                      {r.code && <span className="ml-1 text-xs text-muted-foreground">{r.code}</span>}
                    </td>
                    {showCs && <td className="py-2 pr-3">{r.cs || <span className="text-muted-foreground/60">—</span>}</td>}
                    <td className="py-2 pr-3">{r.label}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {r.location === "bangalore" && r.typedInr
                        ? `INR ${r.typedInr.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                        : r.aed ? money(r.aed, r.location) : <span className="text-xs text-muted-foreground">through finance</span>}
                      {/* A course payment's MT5 bonus, when it is not the amount itself. */}
                      {r.bonusAed && Math.abs(r.bonusAed - r.aed) > 0.01 ? <div className="text-[11px] text-muted-foreground">MT5 bonus {money(r.bonusAed, r.location)}</div> : null}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className={cn("py-0 text-[11px]", st.cls)}>{st.label}</Badge>
                      {r.reason && <div className="mt-0.5 max-w-[260px] text-xs text-muted-foreground">{r.reason}</div>}
                      {r.decidedAt && <div className="mt-0.5 text-[11px] text-muted-foreground">{gst(r.decidedAt)}</div>}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {r.commissionUsd ? <span className="text-primary">{moneyOfUsd(r.commissionUsd, r.location)}</span> : <span className="text-muted-foreground/60">—</span>}
                      {r.mineUsd ? <div className="text-[11px] text-muted-foreground">theirs {moneyOfUsd(r.mineUsd, r.location)}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const UPGRADE_STATUS: Record<string, string> = { open: "In progress", done: "Paid in full", cancelled: "Cancelled" };

/** The period's course upgrades, newest first. */
export function UpgradesTable({ rows, studentHref }: { rows: CseUpgradeRow[]; studentHref?: (studentId: string) => string | null }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">No course upgrades started or paid on in this period.</p>;
  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full min-w-[700px] text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
            <th className="pb-2 pr-3 font-medium">Started</th>
            <th className="pb-2 pr-3 font-medium">Student</th>
            <th className="pb-2 pr-3 font-medium">Course</th>
            <th className="pb-2 pr-3 font-medium">CSE</th>
            <th className="pb-2 pr-3 text-right font-medium">Paid in period</th>
            <th className="pb-2 text-right font-medium">Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u, i) => {
            const href = studentHref?.(u.studentId) ?? null;
            return (
              <tr key={i} className="border-b border-border/20 align-top last:border-0">
                <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{gst(u.at)}</td>
                <td className="py-2 pr-3">
                  {href ? <a href={href} target="_blank" rel="noreferrer" className="hover:underline">{u.student || "—"}</a> : u.student || "—"}
                  {u.code && <span className="ml-1 text-xs text-muted-foreground">{u.code}</span>}
                </td>
                <td className="py-2 pr-3">
                  {u.course}
                  <div className="text-xs text-muted-foreground">{[u.plan === "full" ? "full payment" : "instalments", UPGRADE_STATUS[u.status] ?? u.status].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="py-2 pr-3">{u.cs || <span className="text-muted-foreground/60">—</span>}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{u.paidAed ? money(u.paidAed, u.location) : <span className="text-muted-foreground/60">—</span>}</td>
                <td className="py-2 text-right tabular-nums">{money(u.dueAed, u.location)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
