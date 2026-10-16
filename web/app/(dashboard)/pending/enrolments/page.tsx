"use client";

import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import { cn } from "@/lib/utils";
import type { EnrolmentFlow } from "@/lib/types";
import { EnrolmentFlowView } from "@/components/pending/EnrolmentFlow";

/** Every sales CRM's enrolment workflow — the same chart as before, on a page of its own (2026-10-17). */
export default function PendingEnrolmentsPage() {
  const flow = useQuery({
    queryKey: ["pending-enrolments"],
    queryFn: async () => (await api.get("/pending/enrolments")).data.data as EnrolmentFlow,
    refetchInterval: 3 * 60_000,
  });
  if (flow.error instanceof AxiosError && flow.error.response?.status === 403) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">Pending is for root admins.</CardContent></Card>;
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => flow.refetch()} disabled={flow.isFetching}>
          <RefreshCw className={cn(flow.isFetching && "animate-spin")} /> Refresh
        </Button>
      </div>
      {flow.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : flow.isError || !flow.data ? (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            {flow.error instanceof AxiosError && flow.error.response?.status === 404
              ? "Root's server is still on the previous version — the workflow shows once it is updated."
              : "Could not load the enrolment workflow. Refresh in a moment."}
          </CardContent>
        </Card>
      ) : (
        <EnrolmentFlowView flow={flow.data} />
      )}
    </div>
  );
}
