"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { BackupStatusCard } from "@/components/backups/BackupStatusCard";

/*
 * Pending, a page per tab (the user, 2026-10-17: "add separate tab view for
 * each portal … initial will be the CS portal"): the CS portal first, then the
 * sales portals (the four CRMs), Finance, HRMS and Media ERP, the enrolment
 * workflow on its own page, and every portal together as before.
 */
const TABS = [
  { href: "/pending/cs", label: "CS portal" },
  { href: "/pending/sales", label: "Sales" },
  { href: "/pending/finance", label: "Finance" },
  { href: "/pending/hrms", label: "HRMS" },
  { href: "/pending/media", label: "Media ERP" },
  { href: "/pending/enrolments", label: "Enrolments" },
  { href: "/pending/all", label: "All portals" },
];

export default function PendingLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Inbox className="h-6 w-6 text-primary" /> Pending
        </h2>
        <p className="mt-1 text-muted-foreground">
          What is waiting in each portal, and for whom — the counts each portal&apos;s own sidebar shows.
        </p>
      </motion.div>
      {/* Every portal backed up or not, on every Pending tab (2026-10-17). */}
      <BackupStatusCard />
      {/* Scrolls sideways on a phone rather than wrapping into a block of buttons. */}
      <nav className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Pending tabs">
        <div className="flex w-max gap-1 border-b border-border/60">
          {TABS.map((t) => {
            const on = path === t.href || path.startsWith(`${t.href}/`);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {children}
    </div>
  );
}
