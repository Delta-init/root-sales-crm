"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { BackupStatusCard } from "@/components/backups/BackupStatusCard";
import { mayOpenPending } from "@/components/pending/access";
import { useAuth } from "@/providers/AuthProvider";

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
  const router = useRouter();
  const { admin } = useAuth();
  const root = admin?.role === "root_admin";
  // Somebody given some tabs (2026-10-24) sees those; a tab they weren't given sends them to their first.
  const tabs = TABS.filter((t) => mayOpenPending(admin, t.href));
  const allowed = path === "/pending" || mayOpenPending(admin, path);
  const home = tabs[0]?.href;
  useEffect(() => { if (!allowed && home) router.replace(home); }, [allowed, home, router]);
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
      {/* Every portal backed up or not, on every Pending tab (2026-10-17) — root admins only, like Backups. */}
      {root && <BackupStatusCard />}
      {/* Scrolls sideways on a phone rather than wrapping into a block of buttons. */}
      <nav className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Pending tabs">
        <div className="flex w-max gap-1 border-b border-border/60">
          {tabs.map((t) => {
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
      {tabs.length === 0
        ? <p className="text-sm text-muted-foreground">You haven&apos;t been given any Pending tab. A root admin gives them on Users.</p>
        : allowed ? children : null}
    </div>
  );
}
