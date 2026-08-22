"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/axios";
import type { Admin } from "@/lib/types";

interface AuthContextValue {
  admin: Admin | null;
  isLoading: boolean;
  login: (accessToken: string, refreshToken: string, admin: Admin) => void;
  logout: () => Promise<void>;
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

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Server-side logout only writes an audit row. If it fails, still clear
      // the client — leaving the admin signed in would be the worse outcome.
    }
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    setAdmin(null);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ admin, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
};
