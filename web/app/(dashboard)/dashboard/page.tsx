"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowUpRight, BarChart3, Clock, Coins } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import { timeIn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import type { Organization } from "@/lib/types";

export default function DashboardPage() {
  const { admin } = useAuth();
  const canLaunch = admin?.role === "root_admin";

  const { data: orgs, isLoading, isError } = useQuery({
    queryKey: ["orgs"],
    queryFn: async () => {
      const { data } = await api.get("/orgs");
      return data.data as Organization[];
    },
  });

  return (
    <div className="space-y-8">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-bold tracking-tight">Organisations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {canLaunch
            ? "Open any CRM. One-click sign-in arrives in Phase 2 — for now each CRM still asks for its own login."
            : "Your account can view the group report but cannot open the CRMs."}
        </p>
      </div>

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orgs.map((org, index) => (
            <motion.div
              key={org.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06, duration: 0.3, ease: "easeOut" }}
            >
              <Card className="group relative h-full overflow-hidden transition-shadow hover:shadow-lg">
                <div
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ backgroundColor: org.accent }}
                />

                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg">{org.name}</CardTitle>
                    <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
                      {org.code}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Coins className="h-3.5 w-3.5" />
                      {org.currency}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      {timeIn(org.timezone)} local
                    </span>
                  </div>

                  {/* Phase 2 swaps this for an SSO launch that lands the admin
                      already signed in. */}
                  <Button
                    asChild={canLaunch}
                    disabled={!canLaunch}
                    variant="secondary"
                    className="w-full"
                  >
                    {canLaunch ? (
                      <a href={org.appUrl} target="_blank" rel="noopener noreferrer">
                        Open CRM
                        <ArrowUpRight className="h-4 w-4" />
                      </a>
                    ) : (
                      <span>Not permitted</span>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
            <BarChart3 className="h-4 w-4" />
            Group report
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Consolidated view across all three organisations — arriving in Phase 3.
        </CardContent>
      </Card>
    </div>
  );
}
