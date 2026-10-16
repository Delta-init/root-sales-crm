"use client";

import { PortalsView } from "@/components/pending/PortalsView";

/** Media ERP — chats, the leader desk and verifications. */
export default function PendingMediaPage() {
  return <PortalsView only={(p) => p.code.includes("media")} empty="Media ERP is not set up in Root." />;
}
