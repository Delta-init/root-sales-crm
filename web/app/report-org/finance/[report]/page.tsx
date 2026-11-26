"use client";

import { useParams } from "next/navigation";
import { ReportViewer } from "@/components/report-org/finance/ReportViewer";

/** One report of Finance and revenue, by its ID (/report-org/finance/rev-04), in the shared viewer. */
export default function ReportOrgFinanceReportPage() {
  const { report } = useParams<{ report: string }>();
  return <ReportViewer id={report} />;
}
