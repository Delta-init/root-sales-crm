"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useReportOrgFilters } from "../ReportOrgShell";
import { count, money, useFinanceFc, useFinanceOrgs } from "./api";
import { CONTROLS, hrefOf } from "./catalog";
import { FinanceFilters, pickOrg } from "./FinanceFilters";
import { Select } from "./FilterSelect";
import { CardsLoading, ErrorCard, dayText, periodText, timeText } from "./parts";

/*
 * Report Org → Financial controls (Phase 6, 2026-11-28): live from finance's controls reports — the sample section it
 * replaces showed made-up figures. The indicators at the top, each opening the report behind it; then the report
 * groups. Read-only: nothing here approves, pays, reconciles or closes anything.
 */

const REPORT_ID: Record<string, string> = { approvals: "fc-02", risks: "fc-03", liquidity: "fc-04", expenses: "fc-05", payroll: "fc-06", vat: "fc-07", closing: "fc-08", audit: "fc-09" };
const WARN = new Set(["overdue", "critical", "high", "unreconciled", "psp_overdue", "doc_gaps"]);

export function ControlsHome() {
  const f = useReportOrgFilters();
  const orgs = useFinanceOrgs();
  const org = pickOrg(orgs.data, f.entity);
  const [currency, setCurrency] = useState("");
  const q = useFinanceFc(org?.id, f.range, "overview");
  const data = q.data;
  const base = data?.currency ?? org?.currency ?? "";
  const currencies = Array.from(new Set((data?.indicators ?? []).map((i) => i.currency)));
  const cur = currency && currencies.includes(currency) ? currency : base;
  const shown = (data?.indicators ?? []).filter((i) => i.currency === cur);
  const error = orgs.error ?? q.error;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Financial controls</h1>
        <p className="max-w-4xl text-xs text-muted-foreground">
          Live from finance: approvals waiting, financial risks and exceptions, payments and liquidity, expense, payroll and commission controls, VAT, monthly closing readiness and recorded activity. Report Org shows only — approvals, payments and corrections are made in finance, and no period is closed here.
          {data && <> As of {dayText(data.asOf)} · {periodText(data.period)} · from finance at {timeText(data.generatedAt)}.</>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <FinanceFilters orgs={orgs.data} org={org} space="fc-home" filters={[]} />
        {currencies.length > 1 && <Select label="Currency" value={cur} onChange={setCurrency} options={currencies.map((c) => ({ key: c, name: c === base ? `${c} (the organization's)` : `${c} (apart, never converted)` }))} />}
      </div>
      {(data?.warnings ?? []).length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="mb-1 font-medium">Data completeness</p>
          {data!.warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}
      {error ? (
        <ErrorCard error={error} onRetry={() => { void orgs.refetch(); void q.refetch(); }} />
      ) : !data ? (
        <CardsLoading n={8} />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {shown.map((i) => {
            const warn = WARN.has(i.key) && (i.value ?? 0) !== 0;
            return (
              <Link key={i.key} href={`/report-org/controls/${REPORT_ID[i.report] ?? "fc-02"}`} title="Open the report behind it">
                <Card className={cn("h-full transition-colors hover:border-primary/60 hover:bg-muted/30", warn && "border-amber-300 dark:border-amber-700")}>
                  <CardContent className="space-y-1 p-4">
                    <p className="text-xs text-muted-foreground">{i.label}</p>
                    <p className={cn("text-lg font-semibold", warn ? "text-amber-700 dark:text-amber-400" : "text-foreground")}>{i.value === null ? "Not available" : i.as === "money" ? money(i.value, cur) : count(i.value)}</p>
                    {i.note && <p className="text-[11px] text-muted-foreground">{i.note}</p>}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
      {(data?.notes ?? []).map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Reports</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {CONTROLS[0]!.reports.filter((r) => r.id !== "FC-01").map((r) => (
            <Link key={r.id} href={hrefOf(r)} className="rounded-lg border border-border p-3 transition-colors hover:border-primary/60 hover:bg-muted/30">
              <p className="text-sm font-medium text-foreground"><span className="mr-2 font-mono text-xs font-normal text-primary">{r.id}</span>{r.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{r.about}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
