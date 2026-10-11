"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, ChevronRight, Search, Users2 } from "lucide-react";
import { AxiosError } from "axios";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { RangePicker, resolveRange, REPORT_TZ_LABEL, type Range, type RangeKey } from "@/components/reports/RangePicker";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { SalespeopleList } from "@/lib/types";

/**
 * Salespeople (the user, 2026-10-11): everyone in the sales CRMs — Delta,
 * Banglore, Draw and Remote — with the period's leads, closings and revenue,
 * each opening their own page. Cut in Gulf time. Root admins only.
 */

const money = (n: number, currency: string) =>
  `${currency} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const notYet = (e: unknown) => e instanceof AxiosError && e.response?.status === 404;
const forbidden = (e: unknown) => e instanceof AxiosError && e.response?.status === 403;

export default function SalespeoplePage() {
  const [range, setRange] = useState<RangeKey>("month");
  const [custom, setCustom] = useState<Range>({});
  const [crm, setCrm] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showLeft, setShowLeft] = useState(false);
  const period = resolveRange(range, custom);

  const list = useQuery({
    queryKey: ["salespeople", period],
    queryFn: async () => (await api.get("/salespeople", { params: period })).data.data as SalespeopleList,
  });

  const needle = search.trim().toLowerCase();
  const rows = useMemo(() => (list.data?.crms ?? [])
    .filter((c) => crm === "all" || c.code === crm)
    .flatMap((c) => c.people.map((p) => ({ ...p, crm: c })))
    .filter((p) => (showLeft || p.active) && (!needle || p.name.toLowerCase().includes(needle) || p.email.includes(needle)))
    .sort((a, b) => b.closings - a.closings || b.leads - a.leads || a.name.localeCompare(b.name)),
  [list.data, crm, needle, showLeft]);

  if (forbidden(list.error)) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">Salespeople is for root admins.</CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Users2 className="h-6 w-6 text-primary" /> Salespeople
          </h2>
          <p className="mt-1 text-muted-foreground">
            Everyone in the sales CRMs — their leads, closings and revenue. Open anyone for their full page.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <RangePicker value={range} custom={custom} onChange={(k, c) => { setRange(k); if (c) setCustom(c); }} />
          <span className="text-xs text-muted-foreground">{REPORT_TZ_LABEL}</span>
        </div>
      </motion.div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={crm === "all" ? "default" : "outline"} onClick={() => setCrm("all")}>All CRMs</Button>
          {(list.data?.crms ?? []).map((c) => (
            <Button key={c.code} size="sm" variant={crm === c.code ? "default" : "outline"} onClick={() => setCrm(c.code)}>{c.name}</Button>
          ))}
          <Button size="sm" variant={showLeft ? "default" : "outline"} onClick={() => setShowLeft((v) => !v)}>Show people who left</Button>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a person" className="pl-8" aria-label="Find a person" />
        </div>
      </div>

      {(list.data?.failures ?? []).map((f) => (
        <div key={f.code} className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span className="text-muted-foreground">{f.name} could not be read — {f.error}</span>
        </div>
      ))}

      {list.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : list.isError ? (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            {notYet(list.error) ? "The portal's server is still on the previous version — this page works once it is updated." : "Could not load the salespeople. Refresh in a moment."}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto pt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Person</th>
                  <th className="pb-2 pr-3 font-medium">CRM · team</th>
                  <th className="pb-2 pr-3 text-right font-medium">Leads</th>
                  <th className="pb-2 pr-3 text-right font-medium">Closings</th>
                  <th className="pb-2 pr-3 text-right font-medium">Revenue</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">{needle ? "Nobody by that name." : "Nobody here."}</td></tr>
                ) : rows.map((p) => (
                  <tr key={`${p.crm.code}:${p.id}`} className="border-b border-border/20 last:border-0 hover:bg-muted/30">
                    <td className="py-2.5 pr-3">
                      <Link href={`/salespeople/${p.crm.code}/${p.id}`} className={cn("font-medium hover:underline", !p.active && "text-muted-foreground")}>{p.name}</Link>
                      {!p.active && <span className="ml-1.5 text-xs text-muted-foreground">(left)</span>}
                      <div className="text-xs text-muted-foreground">{p.email}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-xs">
                      <span className="font-medium">{p.crm.name}</span>
                      {p.teams.length > 0 && <span className="text-muted-foreground"> · {p.teams.join(", ")}</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{p.leads || <span className="text-muted-foreground/60">—</span>}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{p.closings || <span className="font-normal text-muted-foreground/60">—</span>}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{p.revenue ? money(p.revenue, p.crm.currency) : <span className="text-muted-foreground/60">—</span>}</td>
                    <td className="py-2.5 text-right">
                      <Link href={`/salespeople/${p.crm.code}/${p.id}`} aria-label={`Open ${p.name}`}><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
