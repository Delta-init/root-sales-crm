"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { mayOpenPending } from "@/components/pending/access";

/** Pending opens on its first tab, the CS portal — or the first one somebody was given (2026-10-24). */
const ORDER = ["/pending/cs", "/pending/sales", "/pending/finance", "/pending/hrms", "/pending/media", "/pending/enrolments", "/pending/all"];

export default function PendingPage() {
  const router = useRouter();
  const { admin } = useAuth();
  const first = ORDER.find((href) => mayOpenPending(admin, href));
  useEffect(() => { if (first) router.replace(first); }, [first, router]);
  return null;
}
