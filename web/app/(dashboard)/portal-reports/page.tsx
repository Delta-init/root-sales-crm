import { redirect } from "next/navigation";

/** Reports opens on its first tab, the CS portal. */
export default function PortalReportsPage() {
  redirect("/portal-reports/cs");
}
