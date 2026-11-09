"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/axios";
import { cn } from "@/lib/utils";
import {
  CATEGORY_COLOURS, QUALITY_LABEL, SOURCE_SHORT, fmtScore, fmtValue, monthLabel, pct1, scoreBar, scoreMonths, scoreTone,
  type KpiResult, type KpiSource, type MentorDetail,
} from "@/components/mentor-kpis/types";

/**
 * One mentor's month (2026-11-09): every KPI's value against its target and the points it earned, up through the
 * subcategories and categories to the total; which systems knew them; and their last three months.
 */

const SOURCES: KpiSource[] = ["lms", "cs_portal", "hrms"];

export default function MentorKpiDetailPage() {
  const params = useParams<{ month: string; email: string }>();
  const router = useRouter();
  const month = params.month;
  const email = decodeURIComponent(params.email);
  const q = useQuery({
    queryKey: ["mentor-kpis", "mentor", email, month],
    queryFn: async () => (await api.get("/mentor-kpis/scores/mentor", { params: { email, month } })).data.data as MentorDetail,
  });
  const d = q.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/mentor-kpis" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All mentors
        </Link>
        <div className="flex-1" />
        <select
          value={month}
          onChange={(e) => router.push(`/mentor-kpis/${e.target.value}/${encodeURIComponent(email)}`)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Month"
        >
          {scoreMonths().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : q.isError || !d ? (
        <Card><CardContent className="flex items-center gap-2 pt-6 text-sm text-red-500"><AlertTriangle className="h-4 w-4" />{apiErrorMessage(q.error, "Could not load this mentor")}</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardContent className="flex flex-wrap items-center gap-6 pt-5">
                <div>
                  <p className="text-lg font-semibold">{d.mentor.name}</p>
                  <p className="text-sm text-muted-foreground">{d.mentor.roleLabel} · {d.mentor.email}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {SOURCES.map((s) => (
                      <Badge key={s} variant={d.mentor.quality[s] === "complete" ? "success" : "warning"}>
                        {SOURCE_SHORT[s]}: {QUALITY_LABEL[d.mentor.quality[s]]}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex-1" />
                <div className="text-right">
                  <p className={cn("text-4xl font-semibold tabular-nums", scoreTone(d.mentor.score))}>{fmtScore(d.mentor.score)}</p>
                  <p className="text-xs text-muted-foreground">
                    {monthLabel(month)} · {d.mentor.coverage}% of the plan scored{d.elapsed < 100 ? ` · ${d.elapsed}% of the month gone` : ""}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-2 pt-5">
                <p className="text-xs text-muted-foreground">Last three months</p>
                <div className="flex h-24 items-end gap-3">
                  {d.trend.map((t) => (
                    <div key={t.month} className="flex flex-1 flex-col items-center gap-1">
                      <span className={cn("text-xs tabular-nums", scoreTone(t.score))}>{fmtScore(t.score)}</span>
                      <div className="flex h-16 w-full items-end rounded bg-muted/50">
                        <div className={cn("w-full rounded", scoreBar(t.score))} style={{ height: `${t.score ?? 0}%` }} />
                      </div>
                      <span className="text-[11px] text-muted-foreground">{monthLabel(t.month).split(" ")[0].slice(0, 3)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">Each month with the plan approved for it; — where no plan covered it.</p>
              </CardContent>
            </Card>
          </div>

          {d.mentor.categories.map((c, ci) => (
            <Card key={c.key}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLOURS[ci % CATEGORY_COLOURS.length] }} />
                  {c.name}
                  <span className="text-sm font-normal text-muted-foreground">{c.weight}% of the score</span>
                  <span className="flex-1" />
                  <span className={cn("tabular-nums", scoreTone(c.score))}>{fmtScore(c.score)}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {c.subs.map((s) => (
                  <div key={s.key} className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-xs text-muted-foreground">{pct1(s.share)} of the score</span>
                      <span className="flex-1" />
                      <span className={cn("tabular-nums", scoreTone(s.score))}>{fmtScore(s.score)}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="py-1 pr-2 font-medium">KPI</th>
                            <th className="py-1 pr-2 font-medium">Actual</th>
                            <th className="py-1 pr-2 font-medium">Target</th>
                            <th className="py-1 pr-2 font-medium">Points</th>
                            <th className="py-1 pr-2 font-medium">Share</th>
                            <th className="py-1 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.kpis.map((k) => <KpiRow key={k.metric} k={k} labels={d.statusLabels} />)}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

function KpiRow({ k, labels }: { k: KpiResult; labels: MentorDetail["statusLabels"] }) {
  const prorated = k.effectiveTarget != null && k.target != null && k.effectiveTarget !== k.target;
  return (
    <tr className="border-t align-top">
      <td className="py-1.5 pr-2">
        <p>{k.name}</p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {SOURCE_SHORT[k.source]} · {k.direction === "up" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {k.direction === "up" ? "more is better" : "fewer is better"}
          {k.sample > 0 && k.sampleOf ? ` · ${Math.round(k.sample)} ${k.sampleOf}` : ""}
        </p>
      </td>
      <td className="py-1.5 pr-2 tabular-nums">{fmtValue(k.value, k.unit)}</td>
      <td className="py-1.5 pr-2 tabular-nums">
        {k.target == null ? "—" : fmtValue(k.target, k.unit)}
        {k.targetFrom === "mentor" && <span className="ml-1 text-xs text-primary">own</span>}
        {prorated && <p className="text-xs text-muted-foreground">{fmtValue(k.effectiveTarget, k.unit)} so far</p>}
      </td>
      <td className={cn("py-1.5 pr-2 tabular-nums", scoreTone(k.score))}>{fmtScore(k.score)}</td>
      <td className="py-1.5 pr-2 tabular-nums text-muted-foreground">{k.mode === "scored" ? pct1(k.share) : "—"}</td>
      <td className="py-1.5">
        <Badge variant={k.status === "scored" ? "success" : k.status === "monitoring" ? "secondary" : "warning"}>{labels[k.status] ?? k.status}</Badge>
        {k.note && k.status !== "scored" && <p className="mt-0.5 max-w-[260px] text-xs text-muted-foreground">{k.note}</p>}
      </td>
    </tr>
  );
}
