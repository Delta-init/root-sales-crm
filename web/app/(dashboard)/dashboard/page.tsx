"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Building2,
  Clapperboard,
  Clock,
  Coins,
  Globe2,
  GraduationCap,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import { cn, timeIn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import type { Organization, TargetKind } from "@/lib/types";

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

/*
 * Keyed by what a system is, not by its code.
 *
 * This was a list of the three CRMs, so every system added since fell through
 * to Delta's blue building: the two finance organizations, HRMS, the LMS and
 * the media ERP were all drawn and labelled as though they were Delta. Keying
 * by kind means a new system of a known kind is right without being listed.
 */
const KIND: Record<TargetKind, { label: string; icon: typeof Building2; color: string; bg: string }> = {
  crm: { label: "Sales CRM", icon: Building2, color: "text-blue-400", bg: "bg-blue-500/10" },
  finance: { label: "Finance", icon: Wallet, color: "text-amber-400", bg: "bg-amber-500/10" },
  hrms: { label: "HRMS", icon: GraduationCap, color: "text-violet-400", bg: "bg-violet-500/10" },
  lms: { label: "LMS", icon: BookOpen, color: "text-purple-400", bg: "bg-purple-500/10" },
  erp: { label: "Media ERP", icon: Clapperboard, color: "text-pink-400", bg: "bg-pink-500/10" },
};

/*
 * Where these applications keep their icon.
 *
 * Tried in order, because they disagree: the CRMs answer /icon, finance
 * /icon.png, HRMS /icon-192.png, the LMS /icons/icon.svg and the media ERP
 * /favicon.ico. Only one of the seven serves the conventional path, so asking
 * for that alone would have fallen back to a generic shape almost everywhere
 * and looked like the feature simply did not work.
 *
 * Each application does declare its own path in its HTML, and with a build
 * hash on it — but reading that would mean fetching and parsing seven pages
 * from the browser, and the hash changes on every deploy. These paths resolve
 * without it.
 */
const ICON_PATHS = ["/icon", "/icon.png", "/icon-192.png", "/icons/icon.svg", "/favicon.ico"];

/**
 * A system's own icon, falling back to the mark for its kind.
 *
 * The icon is what people already recognise from the tab they keep open all
 * day, which tells seven systems apart better than five tinted shapes. Each
 * candidate is tried in turn and a system that serves none of them — or has no
 * address configured yet — keeps the icon it had before rather than showing a
 * broken image.
 */
function SystemMark({ org }: { org: Organization }) {
  const k = KIND[org.kind] ?? KIND.crm;
  const Icon = k.icon;
  const [attempt, setAttempt] = useState(0);

  const base = org.appUrl ? org.appUrl.replace(/\/+$/, "") : "";
  const src = base && attempt < ICON_PATHS.length ? `${base}${ICON_PATHS[attempt]}` : "";

  return (
    <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", k.bg)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a remote icon
        // from a host that is configuration, not a domain known at build time.
        <img
          key={src}
          src={src}
          alt=""
          width={18}
          height={18}
          className="h-[18px] w-[18px] rounded-sm object-contain"
          onError={() => setAttempt((n) => n + 1)}
        />
      ) : (
        <Icon className={cn("h-4 w-4", k.color)} />
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { admin } = useAuth();
  const canLaunch = admin?.role === "root_admin";
  const router = useRouter();

  /**
   * The CRM opens inside the portal at /org/[code], which keeps the org
   * switcher and a way home above it. That page mints its own SSO token, so
   * nothing is handed off through the URL here.
   */
  const open = (org: Organization) => router.push(`/org/${org.code}`);

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
          {/* Counted rather than written down: it said "the three CRMs" while
              seven systems were listed underneath it. */}
          {canLaunch
            ? `Open any of the ${orgs?.length ?? ""} systems below, or review the CRMs together in the group report.`.replace("  ", " ")
            : "Your account can view the group report but cannot open these systems."}
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
            return (
              <motion.div key={org.id} variants={itemVariants}>
                <Card className="group h-full border-border/50 transition-colors hover:border-border">
                  <CardContent className="flex h-full flex-col p-4">
                    <div className="flex items-start gap-3">
                      <SystemMark org={org} />
                      <div className="min-w-0 flex-1">
                        {/* The name first and largest. Every card used to lead
                            with the word "Organisation", which was the one
                            thing they all had in common. */}
                        <p className="truncate text-lg font-semibold leading-tight text-foreground">
                          {org.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(KIND[org.kind] ?? KIND.crm).label}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
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
                        onClick={() => open(org)}
                        className="mt-auto inline-flex items-center gap-1 pt-4 text-xs text-muted-foreground transition-colors hover:text-primary"
                      >
                        Open
                        <ArrowUpRight className="h-3 w-3" />
                      </button>
                    ) : (
                      <p className="mt-auto pt-4 text-xs text-muted-foreground/60">
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
            <Link
              href="/reports"
              className="text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              Open report →
            </Link>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-3 rounded-lg border border-border/40 p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/60">
                <Globe2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <Link href="/reports" className="text-sm text-muted-foreground hover:text-foreground">
                Leads, conversion and revenue across the CRMs — normalised to
                AED and each one&apos;s own timezone.
              </Link>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
