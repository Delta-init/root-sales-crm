"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, BarChart3, Loader2 } from "lucide-react";
import { api } from "@/lib/axios";
import { timeIn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import type { Organization } from "@/lib/types";

export default function DashboardPage() {
  const { admin } = useAuth();

  const { data: orgs, isLoading, isError } = useQuery({
    queryKey: ["orgs"],
    queryFn: async () => {
      const { data } = await api.get("/orgs");
      return data.data as Organization[];
    },
  });

  const canLaunch = admin?.role === "root_admin";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Organisations</h1>
        <p className="mt-1 text-sm text-slate-500">
          {canLaunch
            ? "Open any CRM. One-click sign-in arrives in Phase 2 — for now each CRM still asks for its own login."
            : "Your account can view the group report but cannot open the CRMs."}
        </p>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load organisations.
        </div>
      )}

      {orgs && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orgs.map((org) => (
            <div
              key={org.id}
              className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
            >
              <div
                className="absolute inset-x-0 top-0 h-1"
                style={{ backgroundColor: org.accent }}
              />

              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className="font-semibold tracking-tight">{org.name}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {org.currency} · {timeIn(org.timezone)} local
                  </p>
                </div>
              </div>

              {/* Phase 2 replaces this with an SSO launch that lands the admin
                  already signed in. Until then it is a plain link, so the CRM's
                  own login still applies. */}
              <a
                href={org.appUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-900 hover:underline"
              >
                Open CRM
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5">
        <div className="flex items-center gap-2.5 text-slate-400">
          <BarChart3 className="h-4 w-4" />
          <span className="text-sm font-medium">Group report</span>
        </div>
        <p className="mt-1.5 text-sm text-slate-500">
          Consolidated view across all three organisations — arriving in Phase 3.
        </p>
      </div>
    </div>
  );
}
