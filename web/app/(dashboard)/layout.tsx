"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Header } from "@/components/layout/Header";
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
      <main className="mx-auto max-w-6xl px-4 py-8 md:px-6">{children}</main>
    </div>
  );
}
