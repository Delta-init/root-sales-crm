"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useReportOrgFilters } from "../ReportOrgShell";
import { count, money, useFinanceOrgs, useFinanceRc } from "./api";
import { RECONCILIATION, hrefOf } from "./catalog";
import { FinanceFilters, pickOrg } from "./FinanceFilters";
import { Select } from "./FilterSelect";
import { CardsLoading, ErrorCard, dayText, periodText, timeText } from "./parts";

/*
 * Report Org → Reconciliation (Phase 5, 2026-11-27): live from finance's reconciliation reports — the sample section
 * it replaces showed made-up figures. The indicators at the top, each opening the report behind it; then the eight
 * report groups. Read-only: nothing here reconciles, adjusts or deletes anything.
 */

const REPORT_ID: Record<string, string> = { bank: "rc-01", psp: "rc-02", invoices: "rc-03", expenses: "rc-04", payroll: "rc-05", advances: "rc-06", historical: "rc-07", exceptions: "rc-08" };
const WARN = new Set(["unreconciled", "differences", "psp_differences", "invoice_issues", "historical", "duplicates", "critical_high"]);

export function ReconciliationHome() {
  const f = useReportOrgFilters();
  const orgs = useFinanceOrgs();
  const org = pickOrg(orgs.data, f.entity);
  const [currency, setCurrency] = useState("");
  const q = useFinanceRc(org?.id, f.range, "summary");
  const data = q.data;
  const base = data?.currency ?? org?.currency ?? "";
  const currencies = Array.from(new Set((data?.indicators ?? []).map((i) => i.currency)));
  const cur = currency && currencies.includes(currency) ? currency : base;
  const shown = (data?.indicators ?? []).filter((i) => i.currency === cur);
  const error = orgs.error ?? q.error;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Reconciliation</h1>
        <p className="max-w-4xl text-xs text-muted-foreground">
          Live from finance: bank accounts against their statements, payment gateways against settlements, invoices against payments and bank lines, expenses, payroll and commission, employee advances, migrated records — and every exception that needs action. Nothing here reconciles, adjusts or deletes a record.
          {data && <> As of {dayText(data.asOf)} · {periodText(data.period)} · cutover proposed {dayText(data.cutover)} · from finance at {timeText(data.generatedAt)}.</>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <FinanceFilters orgs={orgs.data} org={org} space="rc-home" filters={[]} />
        {currencies.length > 1 && <Select label="Currency" value={cur} onChange={setCurrency} options={currencies.map((c) => ({ key: c, name: c === base ? `${c} (the organization's)` : `${c} (apart, never converted)` }))} />}
      </div>
      {error ? (
        <ErrorCard error={error} onRetry={() => { void orgs.refetch(); void q.refetch(); }} />
      ) : !data ? (
        <CardsLoading n={8} />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {shown.map((i) => {
            const warn = WARN.has(i.key) && i.value !== 0;
            return (
              <Link key={i.key} href={`/report-org/reconciliation/${REPORT_ID[i.report] ?? "rc-08"}`} title="Open the report behind it">
                <Card className={cn("h-full transition-colors hover:border-primary/60 hover:bg-muted/30", warn && "border-amber-300 dark:border-amber-700")}>
                  <CardContent className="space-y-1 p-4">
                    <p className="text-xs text-muted-foreground">{i.label}</p>
                    <p className={cn("text-lg font-semibold", warn ? "text-amber-700 dark:text-amber-400" : "text-foreground")}>{i.as === "money" ? money(i.value, cur) : count(i.value)}</p>
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
          {RECONCILIATION[0]!.reports.map((r) => (
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
