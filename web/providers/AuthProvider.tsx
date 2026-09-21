"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/axios";
import type { Admin } from "@/lib/types";

/*
 * Where a root admin's own session waits while they are being somebody else.
 *
 * Kept under different keys rather than in memory: a reload during
 * impersonation would otherwise strand them in the borrowed session with no
 * way back to their own but signing in again.
 */
const OWN_ACCESS = "ownAccessToken";
const OWN_REFRESH = "ownRefreshToken";
const IMPERSONATION_ENDS = "impersonationEndsAt";

interface AuthContextValue {
  admin: Admin | null;
  isLoading: boolean;
  login: (accessToken: string, refreshToken: string, admin: Admin) => void;
  logout: () => Promise<void>;
  /** Borrow somebody's session. The caller has already asked the server for it. */
  startImpersonation: (token: string, expiresInSeconds: number) => void;
  /** Give it back. */
  stopImpersonation: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // Re-validate the stored token against the server on every mount. A token
  // that looks fine locally may belong to an admin who has since been
  // deactivated, and this app is a key to three production systems.
  useEffect(() => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;

    if (!token) {
      setIsLoading(false);
      return;
    }

    api
      .get("/auth/me")
      .then(({ data }) => setAdmin(data.data))
      .catch(() => {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(
    (accessToken: string, refreshToken: string, nextAdmin: Admin) => {
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
      setAdmin(nextAdmin);
    },
    []
  );

  /**
   * Put your own session aside and wear theirs.
   *
   * The refresh token is removed rather than kept. It belongs to the root
   * admin, and leaving it in place would let the browser quietly renew *their*
   * session the moment the borrowed one expired — ending the impersonation
   * without saying so, in the middle of whatever was being looked at. An
   * impersonation should run out, not turn back into you unannounced.
   */
  const startImpersonation = useCallback((token: string, expiresInSeconds: number) => {
    const own = localStorage.getItem("accessToken");
    const ownRefresh = localStorage.getItem("refreshToken");
    if (own) localStorage.setItem(OWN_ACCESS, own);
    if (ownRefresh) localStorage.setItem(OWN_REFRESH, ownRefresh);

    localStorage.setItem("accessToken", token);
    localStorage.removeItem("refreshToken");
    localStorage.setItem(IMPERSONATION_ENDS, String(Date.now() + expiresInSeconds * 1000));

    // Straight to the dashboard, because that is the question being asked:
    // what does this person see when they sign in.
    window.location.assign("/dashboard");
  }, []);

  const stopImpersonation = useCallback(() => {
    const own = localStorage.getItem(OWN_ACCESS);
    const ownRefresh = localStorage.getItem(OWN_REFRESH);

    if (own) localStorage.setItem("accessToken", own);
    else localStorage.removeItem("accessToken");
    if (ownRefresh) localStorage.setItem("refreshToken", ownRefresh);

    localStorage.removeItem(OWN_ACCESS);
    localStorage.removeItem(OWN_REFRESH);
    localStorage.removeItem(IMPERSONATION_ENDS);

    // A full reload rather than a state change: every query on the screen was
    // answered for the other person, and refetching them one at a time would
    // show a half-restored page.
    window.location.assign(own ? "/users" : "/login");
  }, []);

  /*
   * Hand the session back when it runs out, rather than letting the next
   * request fail as though something had broken.
   */
  useEffect(() => {
    if (!admin?.impersonatedBy) return;
    const endsAt = Number(localStorage.getItem(IMPERSONATION_ENDS) ?? 0);
    const left = endsAt - Date.now();
    if (!endsAt) return;
    if (left <= 0) { stopImpersonation(); return; }
    const t = setTimeout(stopImpersonation, left);
    return () => clearTimeout(t);
  }, [admin?.impersonatedBy, stopImpersonation]);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Server-side logout only writes an audit row. If it fails, still clear
      // the client — leaving the admin signed in would be the worse outcome.
    }
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    // Signing out drops the borrowed session and the real one together.
    // Leaving the root admin's tokens behind would mean the next visit
    // silently resumed a session they thought they had ended.
    localStorage.removeItem(OWN_ACCESS);
    localStorage.removeItem(OWN_REFRESH);
    localStorage.removeItem(IMPERSONATION_ENDS);
    setAdmin(null);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider
      value={{ admin, isLoading, login, logout, startImpersonation, stopImpersonation }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
};
