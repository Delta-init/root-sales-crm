"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Lock, LogOut, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/shared/Logo";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { repApi, REP_ACCESS, REP_REFRESH } from "@/lib/repAxios";
import { apiErrorMessage } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { MetricDef, MyTracker, Rep } from "@/lib/types";

const num = (n: number) => new Intl.NumberFormat("en-AE").format(n);
const money = (n: number, c: string) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: c || "AED", maximumFractionDigits: 0 }).format(n);

const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });

const scoreTone = (s: number) =>
  s >= 75 ? "text-emerald-500" : s >= 40 ? "text-amber-500" : s > 0 ? "text-rose-500" : "text-muted-foreground";

export default function MyTrackerPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [rep, setRep] = useState<Rep | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(REP_ACCESS)) {
      router.replace("/my/login");
      return;
    }
    repApi.get("/rep/me").then(({ data }) => setRep(data.data)).catch(() => {});
  }, [router]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["my-tracker"],
    queryFn: async () => (await repApi.get("/rep/me/tracker")).data.data as MyTracker,
    enabled: Boolean(rep),
  });

  // Seed the form once. Re-seeding on every refetch would overwrite whatever
  // the rep is part-way through typing.
  useEffect(() => {
    if (data && !seeded) {
      const manual = data.metrics.filter((m) => m.source === "manual" && !m.text);
      setValues(Object.fromEntries(manual.map((m) => [m.key, String(data.row.values[m.key] ?? 0)])));
      setTexts(
        Object.fromEntries(
          data.metrics.filter((m) => m.text).map((m) => [m.key, data.row.texts?.[m.key] ?? ""])
        )
      );
      setSeeded(true);
    }
  }, [data, seeded]);

  const save = useMutation({
    mutationFn: async () =>
      repApi.put("/rep/me/entry", {
        date: data!.date,
        metrics: Object.fromEntries(
          Object.entries(values).map(([k, v]) => [k, Math.max(0, Number(v) || 0)])
        ),
        texts,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-tracker"] });
      toast.success("Today's tracker saved");
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not save")),
  });

  const signOut = () => {
    localStorage.removeItem(REP_ACCESS);
    localStorage.removeItem(REP_REFRESH);
    router.replace("/my/login");
  };

  const { auto, manual, textFields } = useMemo(() => {
    const rel = (data?.metrics ?? []).filter(
      (m) => !m.reliableIn || m.reliableIn.includes(data?.org.code ?? "")
    );
    return {
      auto: rel.filter((m) => m.source === "auto"),
      manual: rel.filter((m) => m.source === "manual" && !m.text),
      textFields: rel.filter((m) => m.text),
    };
  }, [data]);

  const fmt = (m: MetricDef, v: number) =>
    m.key === "convRate" ? `${v}%` : m.money ? money(v, data?.org.currency ?? "AED") : num(v);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/40 bg-background/80 px-4 backdrop-blur-sm md:px-6">
        <Logo width={120} />
        <div className="flex items-center gap-2">
          {rep && (
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium leading-tight">{rep.name}</div>
              <div className="text-xs leading-tight text-muted-foreground">{rep.org.name}</div>
            </div>
          )}
          <ThemeToggle />
          <button onClick={signOut} aria-label="Sign out"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 md:px-6">
        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-64 rounded-lg" />
          </div>
        )}

        {isError && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="pt-6 text-sm text-destructive">
              {apiErrorMessage(error, "Could not load your tracker")}
            </CardContent>
          </Card>
        )}

        {data && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }} className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold">{dayLabel(data.date)}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Today&apos;s score{" "}
                <span className={cn("font-semibold", scoreTone(data.row.score))}>
                  {data.row.score}
                </span>
                /100 · measured against your share of {data.org.name}&apos;s targets
              </p>
            </div>

            {/* ── Measured for you ─────────────────────────────────── */}
            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Counted automatically
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Taken from the CRM as you work. Nothing to fill in — these update
                  on their own.
                </p>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {auto.map((m) => (
                    <div key={m.key}
                      className="rounded-lg border border-border/40 bg-muted/30 p-3"
                      title={m.note ?? undefined}>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Lock className="h-2.5 w-2.5" />
                        {m.label}
                      </div>
                      <p className="mt-1 text-lg font-semibold tabular-nums">
                        {fmt(m, data.row.values[m.key] ?? 0)}
                      </p>
                      {(data.repTargets[m.key] ?? 0) > 0 && (
                        <p className="text-[10px] text-muted-foreground">
                          target {fmt(m, Math.round((data.repTargets[m.key] ?? 0) * 10) / 10)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* ── Yours to fill ────────────────────────────────────── */}
            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Fill in yourself</CardTitle>
                <p className="text-xs text-muted-foreground">
                  The CRM has no way of knowing these, so they only count if you
                  enter them.
                </p>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="grid gap-3 sm:grid-cols-2">
                  {manual.map((m) => (
                    <div key={m.key} className="flex items-center gap-3">
                      <label htmlFor={`f-${m.key}`} className="flex-1 text-sm">
                        {m.label}
                        {(data.repTargets[m.key] ?? 0) > 0 && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground">
                            target {Math.round((data.repTargets[m.key] ?? 0) * 10) / 10}
                          </span>
                        )}
                      </label>
                      <input id={`f-${m.key}`} type="number" min={0} inputMode="numeric"
                        disabled={!data.isToday}
                        value={values[m.key] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [m.key]: e.target.value }))}
                        className="w-24 shrink-0 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-primary disabled:opacity-50" />
                    </div>
                  ))}
                </div>

                {textFields.map((m) => (
                  <div key={m.key} className="space-y-1">
                    <label htmlFor={`t-${m.key}`} className="text-sm">{m.label}</label>
                    <textarea id={`t-${m.key}`} rows={3} maxLength={1000}
                      disabled={!data.isToday}
                      value={texts[m.key] ?? ""}
                      placeholder="What did you learn today?"
                      onChange={(e) => setTexts((t) => ({ ...t, [m.key]: e.target.value }))}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50" />
                  </div>
                ))}

                {data.row.remarks || data.row.actionRequired ? (
                  <div className="rounded-lg border border-border/40 bg-muted/30 p-3 text-xs">
                    <p className="mb-1 font-medium">From your manager</p>
                    {data.row.remarks && <p className="text-muted-foreground">{data.row.remarks}</p>}
                    {data.row.actionRequired && (
                      <p className="mt-0.5 text-amber-600 dark:text-amber-500">
                        ⚑ {data.row.actionRequired}
                      </p>
                    )}
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-3 pt-1">
                  <p className="text-[11px] text-muted-foreground">
                    {data.isToday
                      ? `Locks at midnight ${data.org.timezone.split("/").pop()} time.`
                      : "This day is closed and can no longer be edited."}
                  </p>
                  <button onClick={() => save.mutate()}
                    disabled={save.isPending || !data.isToday}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
                    {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Save today
                  </button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </main>
    </div>
  );
}
