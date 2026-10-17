"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import type { SalesPortalInfo } from "@/lib/types";

/** The Sales tab opens on its first CRM. */
export default function PendingSalesPage() {
  const router = useRouter();
  const crms = useQuery({
    queryKey: ["pending-sales-crms"],
    queryFn: async () => (await api.get("/pending/sales")).data.data as SalesPortalInfo[],
    staleTime: 5 * 60_000,
  });
  const first = crms.data?.[0]?.code;
  useEffect(() => { if (first) router.replace(`/pending/sales/${first}`); }, [first, router]);
  if (crms.isError || (crms.data && !first)) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="flex gap-3 pt-6 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          {crms.error instanceof AxiosError && crms.error.response?.status === 403 ? "Pending is for root admins."
            : crms.error instanceof AxiosError && crms.error.response?.status === 404 ? "Root's server is still on the previous version — this tab shows once it is updated."
              : crms.data && !first ? "No sales CRM is set up in Root." : "Could not load the sales CRMs. Refresh in a moment."}
        </CardContent>
      </Card>
    );
  }
  return <Skeleton className="h-96 w-full" />;
}
