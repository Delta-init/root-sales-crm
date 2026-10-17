"use client";

import { useParams } from "next/navigation";
import { SalesPortalView } from "@/components/pending/SalesPortal";

/** One sales CRM's tab: inactive leads, overdue reminders, not connected, lost and calls, per salesperson. */
export default function PendingSalesCrmPage() {
  const { code } = useParams<{ code: string }>();
  return <SalesPortalView key={code} code={code} />;
}
