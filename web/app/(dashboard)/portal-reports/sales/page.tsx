"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import type { SalesPortalInfo } from "@/lib/types";

/** Reports → Sales opens on its first CRM. */
export default function SalesReportsPage() {
  const router = useRouter();
  const crms = useQuery({
    // Its own list (2026-10-27): the CRMs somebody was given on Reports, apart from Pending's.
    queryKey: ["report-sales-crms"],
    queryFn: async () => (await api.get("/portal-reports/sales")).data.data as SalesPortalInfo[],
    staleTime: 5 * 60_000,
  });
  const first = crms.data?.[0]?.code;
  useEffect(() => { if (first) router.replace(`/portal-reports/sales/${first}`); }, [first, router]);
  if (crms.isError || (crms.data && !first)) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{crms.data && !first ? "No sales CRM is set up in Root." : "Could not load the sales CRMs. Refresh in a moment."}</CardContent></Card>;
  }
  return <Skeleton className="h-96 w-full" />;
}
