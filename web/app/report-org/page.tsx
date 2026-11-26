import { redirect } from "next/navigation";

/** The Report Org opens on its executive dashboard. */
export default function ReportOrgHome() {
  redirect("/report-org/executive");
}
