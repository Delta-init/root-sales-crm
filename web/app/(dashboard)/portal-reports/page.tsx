"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { mayOpenReport } from "@/components/portal-reports/access";

/** Reports opens on its first tab, the CS portal — or the first one somebody was given (2026-10-27). */
const ORDER = ["/portal-reports/cs", "/portal-reports/sales", "/portal-reports/finance", "/portal-reports/hrms", "/portal-reports/mentors"];

export default function PortalReportsPage() {
  const router = useRouter();
  const { admin } = useAuth();
  const first = ORDER.find((href) => mayOpenReport(admin, href));
  useEffect(() => { if (first) router.replace(first); }, [first, router]);
  return null;
}
