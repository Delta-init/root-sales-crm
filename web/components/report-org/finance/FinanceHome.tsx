"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useReportOrgFilters } from "../ReportOrgShell";
import { change, count, expensesText, invoicesText, money, paymentsText, percent, useFinanceOrgs, useFinanceOverview, type Overview, type Pair } from "./api";
import { FinanceFilters, pickOrg, usePicks } from "./FinanceFilters";
import { Bars, CardsLoading, ErrorCard, ForeignCards, ForeignUnknown, axisMoney, dayShort, dayText, daysBetween, foreignText, periodText, timeText } from "./parts";

/*
 * Report Org → Finance and revenue (2026-11-26): the section's own page.
 *
 * The headline figures are finance's, read as the page opens — invoiced and collected from its Revenue report,
 * expenses and profit from its Profit & Loss, what is owed from its aged lists. The profit is income less expenses
 * from invoices, bills and expenses: finance keeps no ledger, and the card says so rather than calling it net profit
 * as a set of books would. The reports themselves are in the side menu.
 */

/** The CRMs the headline figures can be kept to — the sales CRMs, CS Portal, and what was typed in finance itself. */
const HOME_CRMS = [
  { key: "delta", name: "Sales CRM" }, { key: "draw", name: "Draw" }, { key: "remote", name: "Remote CRM" }, { key: "banglore", name: "Banglore CRM" },
  { key: "tetra-course", name: "CS Portal" }, { key: "old_books", name: "Old books" }, { key: "__none", name: "Typed in finance" },
];

const ACCOUNT_TYPE: Record<string, string> = { current: "Bank", savings: "Savings", petty_cash: "Petty cash", internal: "Internal", psp: "Payment provider" };

function Kpi({ label, value, note, pair, before, good = "up" }: { label: string; value: string; note: string; pair?: Pair; before?: string; good?: "up" | "down" }) {
  const moved = pair ? change(pair.minor, pair.priorMinor) : null;
  return (
    <Card className="border-border/50">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1.5 break-words text-xl font-semibold tabular-nums text-foreground">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
        {pair && before && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {moved === null ? (
              `Nothing in ${before} to compare`
            ) : (
              <>
                <span className={cn("font-medium tabular-nums", (moved >= 0) === (good === "up") ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                  {percent(moved)}
                </span>{" "}
                on {before}
              </>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
        <div className="mt-4">{children}</div>
      </CardContent>
    </Card>
  );
}

function Trend({ o }: { o: Overview }) {
  const cur = o.org.currency;
  if (!o.trend) return <p className="py-10 text-center text-sm text-muted-foreground">This period has too many records to draw day by day. Pick a shorter one.</p>;
  if (!o.trend.length) return <p className="py-10 text-center text-sm text-muted-foreground">Nothing was invoiced or collected in this period.</p>;
  // Every day of the period, the quiet ones at nothing — so the line falls to zero rather than gliding over them.
  const byDay = new Map(o.trend.map((d) => [d.day, d]));
  const days = daysBetween(o.period.from, o.period.to);
  const points = days.length ? days.map((day) => byDay.get(day) ?? { day, invoicedMinor: 0, collectedMinor: 0 }) : o.trend;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-primary" />Invoiced</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded border-t-2 border-dashed border-sky-500" />Collected</span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" vertical={false} />
          <XAxis dataKey="day" tickFormatter={dayShort} tick={{ fontSize: 11 }} className="fill-muted-foreground" tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tickFormatter={axisMoney} tick={{ fontSize: 11 }} className="fill-muted-foreground" tickLine={false} axisLine={false} width={44} />
          <Tooltip
            labelFormatter={(d) => dayText(String(d))}
            formatter={(v, name) => [money(Number(v), cur), name === "invoicedMinor" ? "Invoiced" : "Collected"]}
            contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "hsl(var(--foreground))" }}
          />
          <Line type="linear" dataKey="invoicedMinor" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          <Line type="linear" dataKey="collectedMinor" stroke="#0ea5e9" strokeWidth={2} strokeDasharray="5 4" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Figures({ o }: { o: Overview }) {
  const cur = o.org.currency;
  const k = o.kpis;
  const before = periodText(o.before);
  const methodTop = Math.max(0, ...o.methods.map((m) => m.amountMinor));
  const collected = k.collections.minor;
  const aging: [string, number][] = [
    ["Not yet due", o.receivables.current], ["1–30 days late", o.receivables.band1to30], ["31–60 days late", o.receivables.band31to60],
    ["61–90 days late", o.receivables.band61to90], ["Over 90 days late", o.receivables.band90plus],
  ];
  const agingTop = Math.max(0, ...aging.map(([, v]) => v));
  const foreign = o.collectedForeign?.lines ?? [];
  const spentOther = o.expensesOther ?? [];
  // Which CRMs the figures were kept to. A finance server from before the multi-select answers with one name, not a
  // list — taken either way, so a newer page over an older finance does not fall over (it did, 2026-11-27).
  const keptTo = Array.isArray(o.crm) ? o.crm : o.crm ? [String(o.crm)] : [];

  return (
    <div className="space-y-6">
      {keptTo.length > 0 && (
        <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          Invoiced and collected are kept to {keptTo.map((k) => HOME_CRMS.find((c) => c.key === k)?.name ?? k).join(", ")} alone. Expenses, profit, what is owed, VAT and the bank are {o.org.name}&apos;s as a whole.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Gross invoiced" value={money(k.grossInvoiced.minor, cur)} note={`${invoicesText(k.grossInvoiced.count ?? 0)}, by issue date. VAT included.`} pair={k.grossInvoiced} before={before} />
        <Kpi label="Net invoiced" value={money(k.netInvoiced.minor, cur)} note={`After ${money(k.creditNotes.minor, cur)} of credit notes`} pair={k.netInvoiced} before={before} />
        <Kpi label={foreign.length ? `Collections in ${cur}` : "Collections"} value={money(collected, cur)} note={`${paymentsText(k.collections.count ?? 0)}, by the day paid`} pair={k.collections} before={before} />
        <ForeignCards lines={foreign} cur={cur} label="Collections" />
        <Kpi label={spentOther.length ? `Expenses in ${cur}` : "Expenses"} value={money(k.expenses.minor, cur)} note={`${expensesText(k.expenses.count ?? 0)} that count in profit and loss, approved or waiting`} pair={k.expenses} before={before} good="down" />
        {spentOther.map((c) => (
          <Card key={c.currency} className="border-amber-500/40">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Expenses in {c.currency}</p>
              <p className="mt-1.5 break-words text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{money(c.amountMinor, c.currency)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{expensesText(c.count)}. Not in the {cur} figure, nor in the profit.</p>
            </CardContent>
          </Card>
        ))}
        <Kpi label="Income less expenses" value={money(k.netProfit.minor, cur)} note="Invoices before VAT, less the expenses beside it. Finance keeps no ledger." pair={k.netProfit} before={before} />
        <Kpi label="Receivables" value={money(o.receivables.grand, cur)} note={`Still owed on invoices, as of ${dayText(o.receivables.asOf)}`} />
        <Kpi label="Payables" value={money(o.payables.grand, cur)} note={`Still owed on bills, as of ${dayText(o.payables.asOf)}`} />
        <Kpi label="VAT position" value={money(o.vat.netPayableMinor, cur)} note={`Output ${money(o.vat.outputMinor, cur)} less input ${money(o.vat.inputMinor, cur)}`} />
      </div>

      <ForeignUnknown lines={foreign} cur={cur} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Invoiced and collected, day by day" note={`${periodText(o.period)} · ${cur}${foreign.length ? ". What was paid in another currency is not drawn." : ""}`}>
          <Trend o={o} />
        </Panel>
        <Panel title="Collected by payment method" note={`${periodText(o.period)} · ${cur}`}>
          <Bars
            empty="No payment was received in this period."
            rows={o.methods.slice(0, 8).map((m) => {
              const away = (m.foreign ?? []).reduce((n, f) => n + f.count, 0);
              return {
                label: m.name, hint: count(m.count + away),
                // A method taken in another currency only has nothing here: a dash, and its money on the line below.
                value: m.count === 0 && away ? "—" : money(m.amountMinor, cur),
                percent: methodTop ? (m.amountMinor / methodTop) * 100 : 0,
                extra: foreignText(m.foreign) || undefined,
              };
            })}
          />
        </Panel>
        <Panel title="Receivables by age" note={`As of ${dayText(o.receivables.asOf)}, whatever the period · ${cur}`}>
          <Bars empty="Nothing is owed." rows={agingTop ? aging.map(([label, v]) => ({ label, value: money(v, cur), percent: (v / agingTop) * 100 })) : []} />
        </Panel>
        <Panel title="Bank and cash now" note="What each account holds in finance at this moment, whatever the period">
          {o.bank.accounts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Finance has no account for this organization.</p>
          ) : (
            <>
              <ul className="divide-y divide-border/50 text-sm">
                {o.bank.accounts.map((a) => (
                  <li key={`${a.type}:${a.name}`} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-muted-foreground">
                      {a.name} <span className="text-xs opacity-70">· {ACCOUNT_TYPE[a.type] ?? a.type}</span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums text-foreground">{money(a.balanceMinor, a.currency)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                Together, each currency on its own:{" "}
                {o.bank.byCurrency.map((b, i) => (
                  <span key={b.currency} className="font-medium tabular-nums text-foreground">{i > 0 && " · "}{money(b.balanceMinor, b.currency)}</span>
                ))}
              </p>
            </>
          )}
        </Panel>
      </div>

      <p className="text-xs text-muted-foreground">
        Not shown: recognized and deferred revenue (finance does not record when a course is delivered). Pending settlements, commission owed and reconciliation
        exceptions are in finance but not connected here yet.
      </p>
    </div>
  );
}

export function FinanceHome() {
  const f = useReportOrgFilters();
  const orgs = useFinanceOrgs();
  const org = pickOrg(orgs.data, f.entity);
  const crm = usePicks("revenue").crm ?? [];
  const overview = useFinanceOverview(org?.id, f.range, crm);
  const error = orgs.error ?? overview.error;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">Reports and intelligence</p>
          <h1 className="mt-1 text-2xl font-bold text-foreground">Finance and revenue</h1>
          <p className="mt-1 text-sm text-muted-foreground">Revenue, collections and what is owed, as finance counts them.</p>
        </div>
        {overview.data && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-md bg-primary/10 px-2.5 py-1 font-medium text-primary">Live</span>
            From finance at {timeText(overview.data.generatedAt)}
          </p>
        )}
      </div>

      <FinanceFilters orgs={orgs.data} org={org} space="revenue" filters={[{ key: "crm", label: "CRM" }]} fixed={{ crm: HOME_CRMS }} />

      {error ? (
        <ErrorCard error={error} onRetry={() => { void orgs.refetch(); void overview.refetch(); }} />
      ) : overview.data ? (
        <Figures o={overview.data} />
      ) : (
        <CardsLoading n={8} />
      )}

    </div>
  );
}
