"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowUpRight,
  BarChart3,
  Building2,
  Clock,
  Coins,
  Loader2,
  Globe2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/axios";
import { cn, timeIn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import type { Organization, OrgCode } from "@/lib/types";

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

// Kept in the same idiom as the CRM dashboard's stat tiles: a soft 10% tinted
// square behind a 400-weight icon.
const ORG_STYLES: Record<OrgCode, { color: string; bg: string }> = {
  delta: { color: "text-blue-400", bg: "bg-blue-500/10" },
  banglore: { color: "text-green-400", bg: "bg-green-500/10" },
  draw: { color: "text-fuchsia-400", bg: "bg-fuchsia-500/10" },
};

export default function DashboardPage() {
  const { admin } = useAuth();
  const canLaunch = admin?.role === "root_admin";
  const [launching, setLaunching] = useState<string | null>(null);

  /**
   * Ask the portal for a one-time handoff URL, then send the browser there.
   *
   * The tab is opened synchronously, before the await, because a popup opened
   * from inside a promise callback is no longer attributable to the click and
   * gets blocked. It is pointed at the real URL once the token arrives, and
   * closed if the launch fails.
   */
  const launch = async (org: Organization) => {
    if (launching) return;
    setLaunching(org.code);

    const tab = window.open("", "_blank", "noopener,noreferrer");

    try {
      const { data } = await api.post("/sso/launch", { org: org.code });
      const url = data.data.url as string;
      if (tab) tab.location.href = url;
      else window.location.href = url; // popup blocked — fall back to this tab
    } catch (error) {
      tab?.close();
      toast.error(apiErrorMessage(error, `Could not open ${org.name}`));
    } finally {
      setLaunching(null);
    }
  };

  const { data: orgs, isLoading, isError } = useQuery({
    queryKey: ["orgs"],
    queryFn: async () => {
      const { data } = await api.get("/orgs");
      return data.data as Organization[];
    },
  });

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <h2 className="text-2xl font-bold text-foreground">
          Welcome back, {admin?.name?.split(" ")[0]} 👋
        </h2>
        <p className="mt-1 text-muted-foreground">
          {canLaunch
            ? "Open any of the three CRMs below, or review them together in the group report."
            : "Your account can view the group report but cannot open the CRMs."}
        </p>
      </motion.div>

      {/* Organisations */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 w-full rounded-lg" />
          ))}
        </div>
      )}

      {isError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6 text-sm text-destructive">
            Could not load organisations.
          </CardContent>
        </Card>
      )}

      {orgs && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {orgs.map((org) => {
            const style = ORG_STYLES[org.code] ?? ORG_STYLES.delta;

            return (
              <motion.div key={org.id} variants={itemVariants}>
                <Card className="group h-full border-border/50 transition-colors hover:border-border">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Organisation
                    </CardTitle>
                    <div className={cn("rounded-lg p-2", style.bg)}>
                      <Building2 className={cn("h-4 w-4", style.color)} />
                    </div>
                  </CardHeader>

                  <CardContent>
                    <p className="text-3xl font-bold text-foreground">{org.name}</p>

                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Coins className="h-3 w-3" />
                        {org.currency}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {timeIn(org.timezone)} local
                      </span>
                    </div>

                    {canLaunch ? (
                      <button
                        onClick={() => launch(org)}
                        disabled={launching !== null}
                        className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
                      >
                        {launching === org.code ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Signing in…
                          </>
                        ) : (
                          <>
                            Open CRM
                            <ArrowUpRight className="h-3 w-3" />
                          </>
                        )}
                      </button>
                    ) : (
                      <p className="mt-4 text-xs text-muted-foreground/60">
                        Not permitted
                      </p>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Group report */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.22, duration: 0.4 }}
      >
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <BarChart3 className="h-4 w-4 text-amber-400" />
              Group Report
            </CardTitle>
            <span className="text-xs text-muted-foreground">Phase 3</span>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-3 rounded-lg border border-border/40 p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/60">
                <Globe2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                Leads, conversion and revenue across all three organisations —
                normalised to AED and each org&apos;s own timezone.
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
