"use client";

import { useParams } from "next/navigation";
import { SalesReportView } from "@/components/portal-reports/SalesReport";

/** One sales CRM's report: leads, follow-ups, closings, revenue, lost, calls, commission. */
export default function SalesCrmReportPage() {
  const { code } = useParams<{ code: string }>();
  return <SalesReportView key={code} code={code} />;
}
