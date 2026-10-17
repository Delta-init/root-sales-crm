"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { SalesPortalInfo } from "@/lib/types";

/* Reports → Sales: a tab of its own for each sales CRM, as on Pending (2026-10-17). */
export default function SalesReportsLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const crms = useQuery({
    queryKey: ["pending-sales-crms"],
    queryFn: async () => (await api.get("/pending/sales")).data.data as SalesPortalInfo[],
    staleTime: 5 * 60_000,
  });
  return (
    <div className="space-y-5">
      {(crms.data?.length ?? 0) > 0 && (
        <nav className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Sales CRMs">
          <div className="flex w-max gap-1.5">
            {crms.data!.map((c) => {
              const href = `/portal-reports/sales/${c.code}`;
              const on = path === href;
              return (
                <Link key={c.code} href={href} aria-current={on ? "page" : undefined}
                  className={cn("flex items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
                  <span className="h-2 w-2 rounded-full" style={{ background: c.accent || "hsl(var(--primary))" }} />
                  {c.name}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
      {children}
    </div>
  );
}
