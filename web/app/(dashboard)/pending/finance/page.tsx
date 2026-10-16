"use client";

import { PortalsView } from "@/components/pending/PortalsView";

/** Finance — each organisation's approvals, by who raised them. */
export default function PendingFinancePage() {
  return <PortalsView only={(p) => p.code.startsWith("finance")} empty="Finance is not set up in Root." />;
}
