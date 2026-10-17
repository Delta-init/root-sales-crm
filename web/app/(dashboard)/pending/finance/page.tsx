"use client";

import { FinanceWatchView } from "@/components/pending/FinanceWatch";

/** Finance: approvals waiting (past 30 minutes delayed) and entries typed with an old date. */
export default function PendingFinancePage() {
  return <FinanceWatchView />;
}
