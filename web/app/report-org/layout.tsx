"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ReportOrgShell } from "@/components/report-org/ReportOrgShell";
import { useAuth } from "@/providers/AuthProvider";

/*
 * The Report Org, an org that lives inside Root (2026-11-26).
 *
 * Outside the (dashboard) group on purpose, so it gets its own frame rather
 * than Root's header and tabs.
 *
 * Root admins only for now. Somebody viewing as another person has that
 * person's role, so they are sent back too — which is right: they are seeing
 * what that person would see. The pages hold sample figures and nothing else,
 * so this check is what keeps the menu honest rather than what protects data;
 * when a section is connected to live figures, the endpoint that serves them
 * has to refuse everybody else itself.
 */
export default function ReportOrgLayout({ children }: { children: React.ReactNode }) {
  const { admin, isLoading } = useAuth();
  const router = useRouter();
  const allowed = admin?.role === "root_admin";

  useEffect(() => {
    if (isLoading) return;
    if (!admin) router.replace("/login");
    else if (!allowed) router.replace("/dashboard");
  }, [admin, allowed, isLoading, router]);

  if (isLoading || !admin || !allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <ReportOrgShell>{children}</ReportOrgShell>;
}
