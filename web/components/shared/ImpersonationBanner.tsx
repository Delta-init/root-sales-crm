"use client";

import { useEffect, useState } from "react";
import { Eye, X } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";

/**
 * A standing reminder of whose account you are looking at.
 *
 * An impersonated session is deliberately indistinguishable from the person
 * signing in themselves — that is the whole point, and it is also the danger.
 * Without something on the screen at all times, the way this goes wrong is
 * somebody wandering off, coming back, and acting in a colleague's account
 * believing it is their own.
 *
 * So it is loud, it is fixed to the top, and it says the address rather than
 * the name: two people called Ahmed are one mistake, and the address is what
 * every system on the other side matches on anyway.
 *
 * The countdown is there because the session ends by itself after half an
 * hour. Somebody mid-way through looking at something should be able to see
 * that coming rather than meet it as a sudden bounce back to their own
 * account.
 */
export function ImpersonationBanner() {
  const { admin, stopImpersonation } = useAuth();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!admin?.impersonatedBy) return;
    const tick = () => {
      const endsAt = Number(localStorage.getItem("impersonationEndsAt") ?? 0);
      setLeft(endsAt ? Math.max(0, Math.floor((endsAt - Date.now()) / 1000)) : null);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [admin?.impersonatedBy]);

  if (!admin?.impersonatedBy) return null;

  const mins = left === null ? null : Math.floor(left / 60);
  const secs = left === null ? null : left % 60;

  return (
    <div className="sticky top-0 z-50 border-b border-amber-500/40 bg-amber-500/15 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm md:px-6">
        <Eye className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="text-foreground">
          You are viewing the portal as{" "}
          <span className="font-semibold">{admin.email}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          Anything you open is recorded as them.
        </span>
        {left !== null && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {mins}:{String(secs).padStart(2, "0")} left
          </span>
        )}
        <button
          type="button"
          onClick={stopImpersonation}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-amber-500/40 px-2 py-1 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
        >
          <X className="h-3 w-3" />
          Back to my account
        </button>
      </div>
    </div>
  );
}
