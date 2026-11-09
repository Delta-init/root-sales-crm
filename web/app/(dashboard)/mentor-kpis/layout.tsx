"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Eye, Gauge } from "lucide-react";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import { dubaiWhen, type PortalSettings } from "@/components/mentor-kpis/types";

/*
 * Mentor KPIs (the user, 2026-11-09: "edit only from Root — weightage, targets, and Root calculates the points").
 * Scores: every mentor's month, worked out here. Plan: the categories, subcategories, KPIs, weights and targets,
 * drafted and approved here only. Root admins only for now — a preview before anyone else sees a score.
 */
const TABS = [
  { href: "/mentor-kpis", label: "Scores" },
  { href: "/mentor-kpis/plan", label: "Plan" },
  // Corrections to frozen months, asked and decided (2026-11-09).
  { href: "/mentor-kpis/corrections", label: "Corrections" },
];

export default function MentorKpisLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const settings = useQuery({
    queryKey: ["mentor-kpis", "settings"],
    queryFn: async () => (await api.get("/mentor-kpis/settings")).data.data as PortalSettings,
  });
  const open = settings.data?.open;
  const active = (href: string) => (href === "/mentor-kpis" ? path === href || /^\/mentor-kpis\/\d{4}-\d{2}\//.test(path) : path.startsWith(href));
  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Gauge className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Mentor KPIs</h1>
            <p className="text-sm text-muted-foreground">The plan is edited and approved here only; Root works out every mentor&apos;s points.</p>
          </div>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Observation mode: not used for salary, commission, bonuses or penalties.{" "}
            {open
              ? `Open to the CS Portal since ${dubaiWhen(settings.data!.since)} — observation until ${dubaiWhen(settings.data!.observationUntil)}.`
              : "A preview for root admins: mentors and chiefs don't see any of this until it's opened to the CS Portal (Plan tab)."}
          </span>
        </div>
        <nav className="flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                active(t.href) ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </motion.div>
      {children}
    </div>
  );
}
