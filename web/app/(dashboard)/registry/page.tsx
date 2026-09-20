"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Building2, Check, GraduationCap, Server, Wallet, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { RegistryTarget, TargetKind } from "@/lib/types";

/**
 * Every system the portal can send somebody to, and whether it is configured.
 *
 * This screen used to be where addresses and secrets were typed in, and it was
 * the wrong place for them. They were set in the environment, copied into the
 * database by the bootstrap seed, and then editable here — so there were two
 * sources of truth and this one was editing the copy. Change a secret in the
 * environment and the portal kept the stale value; change it here and the next
 * deploy could put the old one back.
 *
 * So the environment is the only source now and this screen only reports. It
 * exists because "which of the six are actually configured" is a real question
 * with no other way to answer it from a running deployment, and because an
 * unconfigured system otherwise announces itself as a failed launch with a
 * message nobody can act on.
 *
 * It names the exact variables that are missing, so the answer to "why can
 * nobody open finance" is on the screen rather than in the code.
 */

const KIND: Record<TargetKind, { label: string; icon: typeof Building2; className: string }> = {
  crm: { label: "Sales CRM", icon: Building2, className: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  finance: { label: "Finance", icon: Wallet, className: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  hrms: { label: "HRMS", icon: GraduationCap, className: "text-violet-400 bg-violet-500/10 border-violet-500/20" },
};

export default function RegistryPage() {
  const targets = useQuery({
    queryKey: ["registry"],
    queryFn: async () => (await api.get<{ data: RegistryTarget[] }>("/orgs/all")).data.data,
  });

  const rows = targets.data ?? [];
  const unconfigured = rows.filter((t) => t.missing.length > 0);

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2">
          <Server className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Systems</h1>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Everywhere the portal can send somebody, and whether it can reach them
        </p>
      </motion.div>

      <Card className="border-border bg-muted/20">
        <CardContent className="p-4 text-xs text-muted-foreground">
          Set from this server&apos;s environment, not from here — so a value cannot be
          changed in one place and quietly overwritten from another. Editing any of these
          means changing the environment and restarting the portal.
        </CardContent>
      </Card>

      {/* Said up front: an unconfigured system is the reason a launch into it
          fails, and that is not obvious from the failure. */}
      {unconfigured.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-amber-400">
              {unconfigured.length} system{unconfigured.length === 1 ? " is" : "s are"} not
              configured yet
            </p>
            <p className="pt-0.5 text-xs text-muted-foreground">
              Nobody can be sent to {unconfigured.length === 1 ? "it" : "them"} until the
              variables below are set.
            </p>
          </CardContent>
        </Card>
      )}

      {targets.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((t) => {
            const k = KIND[t.kind] ?? KIND.crm;
            const Icon = k.icon;
            const ready = t.missing.length === 0;

            return (
              <Card key={t.code} className={cn(!t.isActive && "opacity-60", !ready && "border-amber-500/30")}>
                <CardContent className="flex flex-wrap items-start gap-4 p-4">
                  <div className={cn("rounded-lg border p-2", k.className)}>
                    <Icon className="h-5 w-5" />
                  </div>

                  <div className="min-w-[180px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{t.name}</p>
                      <Badge variant="outline" className="text-[10px]">{k.label}</Badge>
                      {!t.isActive && <Badge variant="outline">Off</Badge>}
                    </div>
                    <p className="font-mono text-[11px] text-muted-foreground">{t.code}</p>
                    <p className="pt-1 font-mono text-[10px] text-muted-foreground/70">
                      {t.envPrefix}_*
                    </p>
                  </div>

                  <div className="flex-[2] space-y-1 text-xs text-muted-foreground">
                    <Row label="App" value={t.appUrl} />
                    <Row label="API" value={t.apiUrl} />
                    <Row label="Signs in as" value={t.serviceEmail} />
                    <div className="flex flex-wrap gap-3 pt-0.5">
                      <Flag on={t.hasSsoSecret} label="Shared secret" />
                      {t.kind === "crm" && <Flag on={t.hasMongoUri} label="Report access" />}
                    </div>

                    {/* The exact variables, so nobody has to go and look them up. */}
                    {t.missing.length > 0 && (
                      <div className="pt-1.5">
                        <p className="text-[11px] text-amber-400">Not configured — set:</p>
                        <p className="font-mono text-[11px] text-amber-400/80">
                          {t.missing.join("  ")}
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 opacity-70">{label}</span>
      <span className={cn("truncate", !value && "italic opacity-50")}>{value || "not set"}</span>
    </div>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", on ? "text-emerald-400" : "text-muted-foreground")}>
      {on ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {label}
    </span>
  );
}
