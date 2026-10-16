"use client";

import { PortalsView } from "@/components/pending/PortalsView";

/** HRMS — its approval inbox, by who it waits on. */
export default function PendingHrmsPage() {
  return <PortalsView only={(p) => p.code === "hrms"} empty="HRMS is not set up in Root." />;
}
