"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Clock, Inbox, RefreshCw, Search } from "lucide-react";
import { AxiosError } from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { PendingOverview, PendingPortal } from "@/lib/types";

/**
 * Pending (the user, 2026-10-06): what is waiting in every portal, and for
 * whom — each portal's own sidebar counts on one page, per person, and one
 * person's across all of them. The sales CRMs first; the other portals join as
 * each gets an endpoint of its own. Root admins only.
 */

const VIEWS = [
  { key: "portal", label: "By portal" },
  { key: "person", label: "By person" },
] as const;
type View = (typeof VIEWS)[number]["key"];

/** A portal's card lists this many people before "Show all". */
const FIRST = 8;

const forbidden = (e: unknown) => e instanceof AxiosError && e.response?.status === 403;
/** The portal's server from before this page: it has no /pending yet. */
const notYet = (e: unknown) => e instanceof AxiosError && e.response?.status === 404;
/** "1 reminder", "3 reminders": the kind's label, singular for one. */
const howMany = (count: number, label: string) => `${count} ${(count === 1 ? label.replace(/s$/, "") : label).toLowerCase()}`;
const time = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export default function PendingPage() {
  const [view, setView] = useState<View>("portal");
  const [search, setSearch] = useState("");
  const pending = useQuery({
    queryKey: ["pending"],
    queryFn: async () => (await api.get("/pending")).data.data as PendingOverview,
    refetchInterval: 60_000,
  });
  const data = pending.data;

  const needle = search.trim().toLowerCase();
  const matches = (name: string, email: string) => !needle || name.toLowerCase().includes(needle) || email.includes(needle);
  const people = useMemo(() => (data?.people ?? []).filter((p) => matches(p.name, p.email)), [data, needle]); // eslint-disable-line react-hooks/exhaustive-deps

  if (forbidden(pending.error)) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">Pending is for root admins.</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-wrap items-start justify-between gap-4"
      >
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Inbox className="h-6 w-6 text-primary" /> Pending
          </h2>
          <p className="mt-1 text-muted-foreground">
            What is waiting in each portal, and for whom — the counts each portal&apos;s own sidebar shows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className="text-xs text-muted-foreground">
              Updated {time(data.generatedAt)} · every minute
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => pending.refetch()} disabled={pending.isFetching}>
            <RefreshCw className={cn(pending.isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>
      </motion.div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <Button
              key={v.key}
              role="tab"
              aria-selected={view === v.key}
              size="sm"
              variant={view === v.key ? "default" : "outline"}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </Button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a person"
            className="pl-8"
            aria-label="Find a person"
          />
        </div>
      </div>

      {pending.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      ) : pending.isError || !data ? (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            {notYet(pending.error)
              ? "The portal's server is still on the previous version, so it cannot answer this page yet. It works once the server is updated."
              : "Could not load what is pending. Refresh in a moment."}
          </CardContent>
        </Card>
      ) : view === "portal" ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {data.portals.map((p, i) => (
              <PortalCard key={p.code} portal={p} index={i} matches={matches} />
            ))}
          </div>
          {data.comingNext.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Not on this page yet: {data.comingNext.map((c) => c.name).join(", ")} — each joins once it has its own pending endpoint.
            </p>
          )}
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Everybody, across the portals · {people.length}</CardTitle>
          </CardHeader>
          <CardContent>
            {people.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {needle ? "Nobody by that name has anything pending." : "Nothing is pending anywhere."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40 text-left text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Person</th>
                      <th className="pb-2 pr-3 font-medium">Waiting on them</th>
                      <th className="pb-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p, i) => (
                      <motion.tr
                        key={p.key}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i, 15) * 0.02 }}
                        className="border-b border-border/20 align-top"
                      >
                        <td className="py-2.5 pr-3">
                          <div className="font-medium">{p.name}</div>
                          {p.email && <div className="text-xs text-muted-foreground">{p.email}</div>}
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="flex flex-wrap gap-1.5">
                            {p.items.map((it) => (
                              <span
                                key={`${it.portal}-${it.key}`}
                                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-xs"
                              >
                                <span className="text-muted-foreground">{it.portalName}</span>
                                <span className="font-medium">{howMany(it.count, it.label)}</span>
                                {it.overdue ? <span className="text-rose-500">· {it.overdue} overdue</span> : null}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 text-right font-semibold tabular-nums">{p.total}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PortalCard({ portal: p, index, matches }: {
  portal: PendingPortal;
  index: number;
  matches: (name: string, email: string) => boolean;
}) {
  const [all, setAll] = useState(false);
  const people = p.people.filter((x) => matches(x.name, x.email));
  const shown = all ? people : people.slice(0, FIRST);
  const reminders = p.kinds.find((k) => k.key === "reminders");

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.accent || "hsl(var(--primary))" }} />
              <span className="truncate">{p.name}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {p.available && <span className="text-2xl font-bold tabular-nums">{p.total}</span>}
              <Button asChild size="sm" variant="ghost">
                <Link href={`/org/${p.code}`}>
                  Open <ArrowRight />
                </Link>
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!p.available ? (
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span className="text-muted-foreground">Could not be read — {p.error}</span>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {p.kinds.map((k) => (
                  <Badge key={k.key} variant="outline" className="gap-1 py-1">
                    {k.label} <span className="font-semibold">{k.total}</span>
                    {k.overdue ? <span className="text-rose-500">· {k.overdue} overdue</span> : null}
                  </Badge>
                ))}
              </div>
              {people.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {p.people.length ? "Nobody by that name here." : "Nothing pending."}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-2 font-medium">Person</th>
                      <th className="pb-2 pr-2 text-right font-medium">New leads</th>
                      <th className="pb-2 pr-2 text-right font-medium">Reminders</th>
                      <th className="pb-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((x) => (
                      <tr key={x.id} className="border-b border-border/20 last:border-0">
                        <td className="py-2 pr-2">
                          <span className={cn("font-medium", !x.active && "text-muted-foreground")}>{x.name}</span>
                          {!x.active && <span className="ml-1.5 text-xs text-muted-foreground">(left)</span>}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums">{x.counts.new_leads || <span className="text-muted-foreground/60">—</span>}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">
                          {x.counts.reminders || <span className="text-muted-foreground/60">—</span>}
                          {x.counts.reminders_overdue ? (
                            <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-rose-500">
                              <Clock className="h-3 w-3" />
                              {x.counts.reminders_overdue}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 text-right font-semibold tabular-nums">{x.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {people.length > FIRST && (
                <Button size="sm" variant="ghost" className="w-full" onClick={() => setAll((v) => !v)}>
                  {all ? "Show fewer" : `Show all ${people.length}`}
                </Button>
              )}
              {reminders?.overdue ? (
                <p className="text-xs text-muted-foreground">
                  <Clock className="mr-1 inline h-3 w-3 text-rose-500" />
                  Overdue reminders are counted inside Reminders, as the portal&apos;s badge counts them.
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
