"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { admin, isLoading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !admin) router.replace("/login");
  }, [admin, isLoading, router]);

  if (isLoading || !admin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900">
              <ShieldCheck className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm font-semibold tracking-tight">Root Sales CRM</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-medium leading-tight">{admin.name}</div>
              <div className="text-xs leading-tight text-slate-500">
                {admin.role === "root_admin" ? "Root admin" : "Viewer"}
              </div>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
