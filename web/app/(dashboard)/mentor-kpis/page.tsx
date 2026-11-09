"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/axios";
import { cn } from "@/lib/utils";
import {
  CATEGORY_COLOURS, QUALITY_LABEL, SOURCE_SHORT, dubaiMonth, fmtScore, monthLabel, scoreBar, scoreMonths, scoreTone,
  type KpiSource, type ScoresAnswer, type ScoresRow,
} from "@/components/mentor-kpis/types";

/**
 * Every mentor's month, worked out by Root with the plan approved for it (2026-11-09): the ranking, each mentor's
 * total and category scores, how much of the plan could be scored, and which systems knew them. A row opens the
 * mentor's KPIs one by one.
 */

const SOURCES: KpiSource[] = ["lms", "cs_portal", "hrms"];
const ROLE_FILTERS = [
  { key: "", label: "All roles" },
  { key: "junior_mentor", label: "Junior" },
  { key: "senior_mentor", label: "Senior" },
  { key: "chief_mentor", label: "Chief" },
  { key: "none", label: "No role" },
];

function csv(rows: ScoresRow[], cats: ScoresAnswer["categories"], month: string) {
  const head = ["Rank", "Mentor", "Email", "Role", "Score", "Coverage %", ...cats.map((c) => c.name), "LMS", "CS Portal", "HRMS"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [
    r.rank ?? "", r.name, r.email, r.roleLabel, r.score ?? "", r.coverage,
    ...cats.map((c) => r.categories.find((x) => x.key === c.key)?.score ?? ""),
    ...SOURCES.map((s) => QUALITY_LABEL[r.quality[s]]),
  ].map(esc).join(","));
  const blob = new Blob([[head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mentor-kpis-${month}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function MentorKpiScoresPage() {
  const router = useRouter();
  const [month, setMonth] = useState(dubaiMonth());
  const [role, setRole] = useState("");
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["mentor-kpis", "scores", month],
    queryFn: async () => (await api.get("/mentor-kpis/scores", { params: { month } })).data.data as ScoresAnswer,
    staleTime: 60_000,
  });
  const data = q.data;
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.mentors ?? []).filter((m) =>
      (!role || (role === "none" ? !m.role : m.role === role)) &&
      (!term || m.name.toLowerCase().includes(term) || m.email.includes(term)));
  }, [data, role, search]);
  const scored = (data?.mentors ?? []).filter((m) => m.score != null);
  const avg = scored.length ? scored.reduce((a, m) => a + (m.score ?? 0), 0) / scored.length : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Month"
        >
          {scoreMonths().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Role">
          {ROLE_FILTERS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a mentor" className="h-9 w-56 pl-8" />
        </div>
        <div className="flex-1" />
        {data?.plan && rows.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => csv(rows, data.categories, month)}>
            <Download className="mr-1.5 h-4 w-4" /> Download CSV
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : q.isError ? (
        <Card><CardContent className="flex items-center gap-2 pt-6 text-sm text-red-500"><AlertTriangle className="h-4 w-4" />{apiErrorMessage(q.error)}</CardContent></Card>
      ) : !data?.plan ? (
        <Card>
          <CardContent className="space-y-2 pt-6 text-sm">
            <p className="font-medium">No approved plan covers {monthLabel(month)}.</p>
            <p className="text-muted-foreground">A plan applies from the month it starts in. Draft one, set its targets and approve it on the <Link href="/mentor-kpis/plan" className="text-primary underline-offset-2 hover:underline">Plan</Link> tab.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Mentors ranked" value={`${scored.length}`} sub={`of ${data.mentors.length} in CS Portal's report`} />
            <Stat label="Average score" value={fmtScore(avg)} sub={data.elapsed < 100 ? `${data.elapsed}% of the month gone — counts pro-rated` : "Whole month"} />
            <Stat label="Plan" value={`From ${monthLabel(data.plan.from)}`} sub={data.plan.approvedBy ? `Approved by ${data.plan.approvedBy}` : ""} />
            <Card>
              <CardContent className="space-y-1.5 pt-4 text-sm">
                <p className="text-xs text-muted-foreground">Sources</p>
                {SOURCES.map((s) => (
                  <p key={s} className="flex items-center gap-1.5">
                    {data.sources?.[s]?.available
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                    <span>{SOURCE_SHORT[s]}</span>
                    {!data.sources?.[s]?.available && <span className="truncate text-xs text-muted-foreground">{data.sources?.[s]?.message ?? "didn't answer"}</span>}
                  </p>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Mentor</th>
                    <th className="px-3 py-2 font-medium">Score</th>
                    <th className="px-3 py-2 font-medium" title="How much of the plan's weight had data to score">Scored</th>
                    {data.categories.map((c, i) => (
                      <th key={c.key} className="px-3 py-2 font-medium">
                        <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: CATEGORY_COLOURS[i % CATEGORY_COLOURS.length] }} />
                        {c.name} <span className="font-normal">{c.share}%</span>
                      </th>
                    ))}
                    <th className="px-3 py-2 font-medium">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={5 + data.categories.length} className="px-3 py-8 text-center text-muted-foreground">No mentors match.</td></tr>
                  ) : rows.map((m) => (
                    <tr
                      key={m.email || m.id}
                      onClick={() => m.email && router.push(`/mentor-kpis/${month}/${encodeURIComponent(m.email)}`)}
                      className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{m.rank ?? "—"}</td>
                      <td className="px-3 py-2">
                        <p className="font-medium">{m.name}</p>
                        <p className="text-xs text-muted-foreground">{m.roleLabel}</p>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className={cn("w-10 font-semibold tabular-nums", scoreTone(m.score))}>{fmtScore(m.score)}</span>
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                            <div className={cn("h-full rounded-full", scoreBar(m.score))} style={{ width: `${m.score ?? 0}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{m.coverage}%</td>
                      {data.categories.map((c) => {
                        const v = m.categories.find((x) => x.key === c.key)?.score ?? null;
                        return <td key={c.key} className={cn("px-3 py-2 tabular-nums", scoreTone(v))}>{fmtScore(v)}</td>;
                      })}
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          {SOURCES.map((s) => (
                            <Badge
                              key={s}
                              variant={m.quality[s] === "complete" ? "success" : "warning"}
                              title={`${SOURCE_SHORT[s]}: ${QUALITY_LABEL[m.quality[s]]}`}
                              className="px-1.5 text-[10px]"
                            >
                              {SOURCE_SHORT[s] === "CS Portal" ? "CS" : SOURCE_SHORT[s]}
                            </Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            A KPI with no data (a system that doesn&apos;t send it yet, a mentor it doesn&apos;t know by address, too few classes or reviews to
            judge) is left out and its weight spread over the rest — never scored as zero. &ldquo;Scored&rdquo; is how much of the plan
            had data. Mentors without a CS Portal role are listed, not ranked.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
