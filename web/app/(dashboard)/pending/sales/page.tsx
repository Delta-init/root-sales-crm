"use client";

import { PortalsView } from "@/components/pending/PortalsView";

/** The sales portals: the Sales CRM, Draw, Remote and Banglore. */
export default function PendingSalesPage() {
  return <PortalsView only={(p) => !!p.crm} empty="No sales CRM is set up in Root." />;
}
