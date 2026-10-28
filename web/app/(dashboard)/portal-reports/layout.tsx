"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { FileBarChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import { mayOpenReport } from "@/components/portal-reports/access";

/*
 * Reports, a page per tab like Pending (the user, 2026-10-17: "same as the
 * pending page, each portal its own tab") — what got done in a period, where
 * Pending is what waits now. The CS portal first; the others follow, one at a
 * time, each checked before the next.
 */
const TABS = [
  { href: "/portal-reports/cs", label: "CS portal" },
  { href: "/portal-reports/sales", label: "Sales" },
  { href: "/portal-reports/finance", label: "Finance" },
  { href: "/portal-reports/hrms", label: "HRMS" },
  // CS Portal's Mentor Report: classes, bookings, meetings, reviews and commission per mentor (2026-10-24).
  { href: "/portal-reports/mentors", label: "Mentors" },
  { href: "/portal-reports/media", label: "Media ERP", soon: true },
];

export default function PortalReportsLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { admin } = useAuth();
  // Somebody given some tabs (2026-10-27) sees those; a tab they weren't given sends them to their first.
  const root = admin?.role === "root_admin";
  const tabs = TABS.filter((t) => (t.soon ? root : mayOpenReport(admin, t.href)));
  const allowed = path === "/portal-reports" || mayOpenReport(admin, path);
  const home = tabs[0]?.href;
  useEffect(() => { if (!allowed && home) router.replace(home); }, [allowed, home, router]);
  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <FileBarChart className="h-6 w-6 text-primary" /> Reports
        </h2>
        <p className="mt-1 text-muted-foreground">What got done in each portal over a period, and by whom.</p>
      </motion.div>
      <nav className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Report tabs">
        <div className="flex w-max gap-1 border-b border-border/60">
          {tabs.map((t) => {
            const on = path === t.href || path.startsWith(`${t.href}/`);
            return (
              <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
                className={cn("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {t.label}
                {t.soon && <span className="rounded bg-muted px-1 text-[10px] font-normal text-muted-foreground">next</span>}
              </Link>
            );
          })}
        </div>
      </nav>
      {allowed ? children : null}
    </div>
  );
}
