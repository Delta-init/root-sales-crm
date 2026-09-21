"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { MobileNav } from "@/components/layout/MobileNav";
import { ImpersonationBanner } from "@/components/shared/ImpersonationBanner";
import { useAuth } from "@/providers/AuthProvider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { admin, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !admin) router.replace("/login");
  }, [admin, isLoading, router]);

  if (isLoading || !admin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Above the header, and on every screen rather than the one where the
          impersonation started — whose account you are in is not something to
          be told once. */}
      <ImpersonationBanner />
      <Header />
      {/* The bottom bar is fixed, so the page needs room to end above it —
          otherwise the last thing on every screen sits underneath the nav. */}
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 md:px-6 md:pb-8 md:pt-8">{children}</main>
      <MobileNav />
    </div>
  );
}
