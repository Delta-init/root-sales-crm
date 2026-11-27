"use client";

import { useParams } from "next/navigation";
import { ReportViewer } from "@/components/report-org/finance/ReportViewer";

/** One financial-controls report by its ID (/report-org/controls/fc-02), in the shared viewer. */
export default function ReportOrgControlsReportPage() {
  const { report } = useParams<{ report: string }>();
  return <ReportViewer id={report} />;
}
