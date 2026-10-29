import type { ReportTab } from "@/lib/types";

/*
 * Reports for somebody who is not a root admin (the user, 2026-10-27: "same as the pending permission"). A root admin
 * gives the tabs on Users → their page, apart from Pending's; the API decides, this only keeps the screen from offering
 * what it would refuse.
 */
export const REPORT_TAB_OPTIONS: { tab: ReportTab; label: string }[] = [
  { tab: "cs", label: "CS portal" },
  { tab: "sales:delta", label: "Sales CRM (Dubai)" },
  { tab: "sales:draw", label: "Draw" },
  { tab: "sales:remote", label: "Remote" },
  { tab: "sales:banglore", label: "Banglore" },
  { tab: "finance", label: "Finance" },
  { tab: "hrms", label: "HRMS" },
  { tab: "mentors", label: "Mentors" },
  { tab: "students", label: "Students" },
];

type Who = { role: string; reportAccess?: string[] } | null | undefined;

/** Whether somebody may open a Reports tab by its address (`/portal-reports/sales` = any sales CRM). */
export function mayOpenReport(admin: Who, href: string): boolean {
  if (admin?.role === "root_admin") return true;
  const mine = admin?.reportAccess ?? [];
  const [tab = "", code = ""] = href.replace(/^\/portal-reports\/?/, "").split("/");
  if (tab === "sales") return code ? mine.includes(`sales:${code}`) : mine.some((t) => t.startsWith("sales:"));
  return tab !== "" && mine.includes(tab);
}

/** Has any Reports tab at all — the menu item shows. */
export const hasReports = (admin: Who) => admin?.role === "root_admin" || (admin?.reportAccess ?? []).length > 0;
