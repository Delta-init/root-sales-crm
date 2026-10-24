"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "@/providers/AuthProvider";
import type { PendingTab } from "@/lib/types";

/*
 * Pending for somebody who is not a root admin (the user, 2026-10-24: Doney the CS portal, Abrar the Sales CRM
 * (Dubai), Maneesh Draw, dilshad Remote). A root admin gives the tabs on Users → their page; the API decides, this only
 * keeps the screen from offering what it would refuse.
 */
export const PENDING_TAB_OPTIONS: { tab: PendingTab; label: string }[] = [
  { tab: "cs", label: "CS portal" },
  { tab: "sales:delta", label: "Sales CRM (Dubai)" },
  { tab: "sales:draw", label: "Draw" },
  { tab: "sales:remote", label: "Remote" },
  { tab: "sales:banglore", label: "Banglore" },
  { tab: "finance", label: "Finance" },
  { tab: "hrms", label: "HRMS" },
  { tab: "media", label: "Media ERP" },
  { tab: "enrolments", label: "Enrolments" },
];

type Who = { role: string; pendingAccess?: string[] } | null | undefined;

/** Whether somebody may open a Pending tab by its address (`/pending/sales` = any sales CRM, `/pending/all` = root only). */
export function mayOpenPending(admin: Who, href: string): boolean {
  if (admin?.role === "root_admin") return true;
  const mine = admin?.pendingAccess ?? [];
  const tab = href.replace(/^\/pending\/?/, "").split("/")[0] ?? "";
  if (tab === "sales") return mine.some((t) => t.startsWith("sales:"));
  if (tab === "all" || tab === "") return false;
  return mine.includes(tab);
}

/** Has any Pending tab at all — the menu item shows. */
export const hasPending = (admin: Who) => admin?.role === "root_admin" || (admin?.pendingAccess ?? []).length > 0;

/**
 * A person's name: a link to their page (Salespeople, CSEs) for a root admin, who may open it; plain text for anybody
 * else, who would only be refused there.
 */
export function PersonLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const { admin } = useAuth();
  return admin?.role === "root_admin"
    ? <Link href={href} className={className}>{children}</Link>
    : <span className={className?.replace("hover:underline", "")}>{children}</span>;
}
