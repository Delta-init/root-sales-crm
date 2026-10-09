"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, Coins, Lock } from "lucide-react";
import { AxiosError } from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import type { CommissionSlabRow, CrmCommissionPlan } from "@/lib/types";

/**
 * Commission plans (the user, 2026-10-09): each sales CRM's commission plan —
 * every course's amounts, the Sales Manager, the logins that earn nothing and
 * the salary slabs — read only. Nobody edits a plan any more, in the CRMs or
 * here. Root admins only.
 */

const forbidden = (e: unknown) => e instanceof AxiosError && e.response?.status === 403;
/** The portal's server from before this page: it has no /commission-plans yet. */
const notYet = (e: unknown) => e instanceof AxiosError && e.response?.status === 404;
const aed = (n: number) => (n ? `AED ${n.toLocaleString("en-US")}` : "—");
const money = (n: number) => n.toLocaleString("en-US");
const SLAB_ROLES = [
  { key: "sales", label: "Sales Staff" },
  { key: "tl", label: "Team Leader" },
  { key: "sm", label: "Sales Manager" },
] as const;
const monthLabel = (m: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));

/** The CRM tab last looked at. */
const TAB_STORE = "root.commission.crm";

export default function CommissionPlansPage() {
  const plans = useQuery({
    queryKey: ["commission-plans"],
    queryFn: async () => (await api.get("/commission-plans")).data.data as CrmCommissionPlan[],
  });
  const [tab, setTab] = useState("");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TAB_STORE);
      if (saved) setTab(saved);
    } catch {
      /* private window or blocked storage: the first CRM */
    }
  }, []);
  const choose = (code: string) => {
    setTab(code);
    try {
      window.localStorage.setItem(TAB_STORE, code);
    } catch {
      /* nothing to remember it in */
    }
  };

  if (forbidden(plans.error)) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">Commission plans are for root admins.</CardContent>
      </Card>
    );
  }

  const list = plans.data ?? [];
  const plan = list.find((p) => p.code === tab) ?? list[0];
  const tlPaid = plan?.tlRule !== "never";

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Coins className="h-6 w-6 text-primary" /> Commission plans
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-muted-foreground">
            <Lock className="h-3.5 w-3.5" /> Each sales CRM&apos;s plan as it stands — read only, here and in the CRMs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="tablist">
          {list.map((p) => (
            <Button key={p.code} size="sm" role="tab" aria-selected={p.code === plan?.code}
              variant={p.code === plan?.code ? "default" : "outline"} onClick={() => choose(p.code)}>
              {p.name}
            </Button>
          ))}
          {plans.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-28" />)}
        </div>
      </motion.div>

      {notYet(plans.error) && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            The portal&apos;s server is still on the previous version, so this page has nothing to show yet. It works once the server is updated.
          </CardContent>
        </Card>
      )}

      {plan && !plan.available && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium">{plan.name} could not be read</p>
              <p className="mt-1 text-muted-foreground">{plan.error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {plan?.available && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Sales Manager</p>
                <p className="mt-1 text-lg font-semibold">{plan.salesManager ?? "Not set"}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Team leaders</p>
                <p className="mt-1 text-sm">{plan.tlRuleLabel}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Earn nothing</p>
                <p className="mt-1 text-sm">{plan.excluded.length ? plan.excluded.join(", ") : "No one"}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-baseline justify-between gap-2 text-base">
                <span>Per course, for each sale</span>
                <span className="shrink-0 text-sm font-normal text-muted-foreground">{plan.courses.length} courses</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {plan.courses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No courses.</p>
              ) : (
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Course</th>
                      <th className="pb-2 pr-3 font-medium">Fee</th>
                      <th className="pb-2 pr-3 text-right font-medium">Sales Staff</th>
                      {tlPaid && <th className="pb-2 pr-3 text-right font-medium">Team Leader</th>}
                      <th className="pb-2 pr-3 text-right font-medium">Sales Manager</th>
                      <th className="pb-2 text-right font-medium">MT5 credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.courses.map((c) => (
                      <tr key={c.id} className="border-b border-border/50 last:border-0">
                        <td className="py-2.5 pr-3">
                          <span className="font-medium">{c.name}</span>
                          {c.status && c.status !== "active" && (
                            <Badge variant="secondary" className="ml-2 capitalize">{c.status}</Badge>
                          )}
                        </td>
                        <td className="whitespace-nowrap py-2.5 pr-3 text-muted-foreground">{aed(c.fee)}</td>
                        <td className="whitespace-nowrap py-2.5 pr-3 text-right">{aed(c.sales)}</td>
                        {tlPaid && <td className="whitespace-nowrap py-2.5 pr-3 text-right">{aed(c.tl)}</td>}
                        <td className="whitespace-nowrap py-2.5 pr-3 text-right">{aed(c.sm)}</td>
                        <td className="whitespace-nowrap py-2.5 text-right">{c.creditUsd ? `$${money(c.creditUsd)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-baseline justify-between gap-2 text-base">
                <span>Salary slabs</span>
                <span className="shrink-0 text-sm font-normal text-muted-foreground">
                  {plan.slabs ? `In force since ${monthLabel(plan.slabs.from)}` : "The CRM's built-in slabs"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {plan.slabs ? (
                <div className="grid gap-6 lg:grid-cols-3">
                  {SLAB_ROLES.filter((r) => plan.slabs![r.key].length).map((r) => (
                    <SlabTable key={r.key} label={r.label} rows={plan.slabs![r.key]} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No slabs saved in this CRM, so it pays from the slabs built into its code.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
      {plans.isLoading && <Skeleton className="h-64 w-full" />}
    </div>
  );
}

function SlabTable({ label, rows }: { label: string; rows: CommissionSlabRow[] }) {
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-sm font-medium">{label}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="pb-2 pr-3 font-medium">Slab</th>
            <th className="pb-2 pr-3 text-right font-medium">From (AED)</th>
            <th className="pb-2 pr-3 text-right font-medium">Salary</th>
            <th className="pb-2 text-right font-medium">Commission</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.name + s.target} className="border-b border-border/50 last:border-0">
              <td className="py-2 pr-3 font-medium">{s.name}</td>
              <td className="py-2 pr-3 text-right">{money(s.target)}</td>
              <td className="py-2 pr-3 text-right">{money(s.salary)}</td>
              <td className="py-2 text-right">{s.percent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
