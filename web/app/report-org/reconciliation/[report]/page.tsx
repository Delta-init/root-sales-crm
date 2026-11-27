"use client";

import { useParams } from "next/navigation";
import { ReportViewer } from "@/components/report-org/finance/ReportViewer";

/** One reconciliation report by its ID (/report-org/reconciliation/rc-01), in the shared viewer. */
export default function ReportOrgReconciliationReportPage() {
  const { report } = useParams<{ report: string }>();
  return <ReportViewer id={report} />;
}
