"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Logo } from "@/components/shared/Logo";
import { api, apiErrorMessage } from "@/lib/axios";
import { cn, timeIn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import type { Organization } from "@/lib/types";

const EMBEDDED_PATH_PARAM = "appPath";
const HISTORY_CHANNEL = "root-portal-history-v1";

function safeEmbeddedPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096 || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname === "/sso" || url.pathname.startsWith("/api/")) return null;
    for (const key of ["token", "ssoToken", "access_token", "refresh_token", "id_token", "code"]) {
      url.searchParams.delete(key);
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function readEmbeddedPath(): string | null {
  return new URL(window.location.href).searchParams.get(EMBEDDED_PATH_PARAM);
}

function writeEmbeddedPath(path: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(EMBEDDED_PATH_PARAM, path);
  window.history.replaceState(window.history.state, "", url);
}

/**
 * The CRM is embedded rather than linked out to, so the portal keeps its own
 * chrome — org switcher, back to home — above whichever CRM is open.
 *
 * Each mount mints a fresh single-use SSO token and points the iframe at it.
 * Nothing is reused: switching org, reloading, or opening in a new tab each
 * asks for a new token, because the previous one is spent the moment the CRM
 * redeems it.
 */
export default function OrgWorkspacePage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = params.code;
  const { admin, isLoading: authLoading } = useAuth();

  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameReadyRef = useRef(false);
  const frameOrigin = useMemo(() => {
    if (!src) return null;
    try { return new URL(src).origin; } catch { return null; }
  }, [src]);

  useEffect(() => {
    if (!authLoading && !admin) router.replace("/login");
  }, [admin, authLoading, router]);

  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  useEffect(() => {
    api
      .get("/orgs")
      .then(({ data }) => setOrgs(data.data as Organization[]))
      .catch(() => setOrgs([]));
  }, []);

  const org = useMemo(() => orgs?.find((o) => o.code === code) ?? null, [orgs, code]);

  /** Mint a token and return the landing URL. Callers decide where to put it. */
  const mint = useCallback(async () => {
    const { data } = await api.post("/sso/launch", { org: code });
    return data.data.url as string;
  }, [code]);

  const load = useCallback(async () => {
    setError(null);
    setLoaded(false);
    setSlow(false);
    setSrc(null);
    try {
      setSrc(await mint());
    } catch (e) {
      setError(apiErrorMessage(e, "Could not open this CRM"));
    }
  }, [mint]);

  useEffect(() => {
    if (admin) void load();
  }, [admin, load]);

  // A cross-origin iframe gives no readable failure signal — onError does not
  // fire for a blocked or refused frame. So rather than claim a failure we
  // cannot detect, surface the escape hatch once it is clearly taking too long
  // and let the admin decide.
  useEffect(() => {
    if (!src || loaded) return;
    const t = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(t);
  }, [src, loaded]);

  useEffect(() => {
    if (!src || !frameOrigin) return;

    const sendNavigation = (path: string) => {
      frameRef.current?.contentWindow?.postMessage(
        { channel: HISTORY_CHANNEL, type: "navigate", path },
        frameOrigin,
      );
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== frameOrigin || event.source !== frameRef.current?.contentWindow) return;
      const message = event.data as { channel?: unknown; type?: unknown; path?: unknown } | null;
      if (!message || message.channel !== HISTORY_CHANNEL) return;

      const childPath = safeEmbeddedPath(message.path);
      if (message.type === "ready") {
        frameReadyRef.current = true;
        const savedPath = safeEmbeddedPath(readEmbeddedPath());
        if (savedPath && savedPath !== childPath) sendNavigation(savedPath);
        else if (childPath) writeEmbeddedPath(childPath);
        return;
      }
      if (message.type === "route" && childPath) {
        const current = safeEmbeddedPath(readEmbeddedPath());
        if (current !== childPath) writeEmbeddedPath(childPath);
      }
    };

    const onPopState = () => {
      if (!frameReadyRef.current) return;
      const path = safeEmbeddedPath(readEmbeddedPath());
      if (path) sendNavigation(path);
    };

    frameReadyRef.current = false;
    window.addEventListener("message", onMessage);
    window.addEventListener("popstate", onPopState);
    return () => {
      frameReadyRef.current = false;
      window.removeEventListener("message", onMessage);
      window.removeEventListener("popstate", onPopState);
    };
  }, [src, frameOrigin]);

  const openInNewTab = async () => {
    const tab = window.open("about:blank", "_blank");
    try {
      const url = await mint();
      if (tab && !tab.closed) {
        tab.opener = null;
        tab.location.replace(url);
      } else {
        window.location.href = url;
      }
    } catch (e) {
      tab?.close();
      toast.error(apiErrorMessage(e, "Could not open this CRM"));
    }
  };

  if (authLoading || !admin) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  /*
   * Only the ones that would actually open.
   *
   * The switcher is a list of places to go next, and a system this person has
   * no account in yet is not one of them — offering it would hand them a
   * refusal from the far side of a redirect instead of simply not being
   * there.
   */
  const others = (orgs ?? []).filter((o) => o.code !== code && o.reach === "open");

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* ── Portal chrome ─────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-background px-3 md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/dashboard"
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Back to Root portal"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Portal</span>
          </Link>

          <div className="hidden h-6 w-px bg-border sm:block" />
          <Logo width={104} className="hidden shrink-0 md:block" />
          <div className="hidden h-6 w-px bg-border md:block" />

          {/* Org switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: org?.accent ?? "#64748b" }}
                />
                <span className="truncate text-sm font-semibold">
                  {org?.name ?? code}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Switch organisation
              </DropdownMenuLabel>
              <DropdownMenuSeparator />

              {(orgs ?? []).filter((o) => o.reach === "open" || o.code === code).map((o) => (
                <DropdownMenuItem
                  key={o.code}
                  onClick={() => o.code !== code && router.push(`/org/${o.code}`)}
                  className="gap-2"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: o.accent }}
                  />
                  <span className="flex-1 truncate">{o.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {o.currency} · {timeIn(o.timezone)}
                  </span>
                  {o.code === code && <Check className="h-3.5 w-3.5" />}
                </DropdownMenuItem>
              ))}

              <DropdownMenuSeparator />
              {/* Root admins only — the report is theirs now, and offering it
                  to anybody else only sends them to a refusal. */}
              {admin?.role === "root_admin" && (
                <DropdownMenuItem onClick={() => router.push("/reports")} className="gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Group report
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => router.push("/dashboard")} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Root home
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {others.length > 0 && (
            <div className="ml-1 hidden items-center gap-1 lg:flex">
              {others.map((o) => (
                <button
                  key={o.code}
                  onClick={() => router.push(`/org/${o.code}`)}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {o.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => void load()}
            title="Reload — signs in again with a fresh link"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className={cn("h-4 w-4", !loaded && src && "animate-spin")} />
          </button>
          <button
            onClick={() => void openInNewTab()}
            title="Open in a new tab"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ── Embedded CRM ──────────────────────────────────────────────── */}
      <div className="relative flex-1 overflow-hidden">
        {error ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-sm text-center">
              <TriangleAlert className="mx-auto h-6 w-6 text-destructive" />
              <p className="mt-3 font-medium">Could not open {org?.name ?? code}</p>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              <button
                onClick={() => void load()}
                className="mt-4 text-sm font-medium text-primary hover:underline"
              >
                Try again
              </button>
            </div>
          </div>
        ) : (
          <>
            {src && (
              <iframe
                ref={frameRef}
                key={src}
                src={src}
                onLoad={() => setLoaded(true)}
                title={org?.name ?? code}
                className="h-full w-full border-0"
                // Same capabilities the CRM has standalone. Sandboxing here
                // would strip its storage and break the sign-in it is about
                // to perform.
                allow="clipboard-write; fullscreen"
                referrerPolicy="origin"
              />
            )}

            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-background">
                <div className="max-w-sm px-6 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Signing you in to {org?.name ?? code}…
                  </p>
                  {slow && (
                    <p className="mt-4 text-xs text-muted-foreground">
                      Taking longer than usual. Some browsers block embedded
                      sign-in.{" "}
                      <button
                        onClick={() => void openInNewTab()}
                        className="font-medium text-primary hover:underline"
                      >
                        Open in a new tab instead
                      </button>
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
