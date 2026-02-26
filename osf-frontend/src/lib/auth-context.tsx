"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { apiFetch } from "./api";
import { LS_TOKEN, LS_REFRESH_TOKEN } from "@/lib/constants";

interface User {
  id: string;
  email: string;
  name: string | null;
  tier: string;
  role: string;
  api_key_masked?: string;
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string, marketingConsent?: boolean) => Promise<{ message: string }>;
  logout: () => void;
  setTokensAndUser: (token: string, refreshToken: string, user: User) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function refreshAccessToken(): Promise<boolean> {
  try {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://osf-api.zeroguess.ai";
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    });
    if (!res.ok) return false;
    const data = await res.json();
    // Keep localStorage as fallback during migration
    if (data.token) localStorage.setItem(LS_TOKEN, data.token);
    if (data.refreshToken) localStorage.setItem(LS_REFRESH_TOKEN, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Try to fetch user — cookies will authenticate automatically
    // Also check localStorage for backwards compat
    const stored = localStorage.getItem(LS_TOKEN);

    apiFetch<{ user: User }>("/auth/me")
      .then(({ user }) => {
        setUser(user);
        if (stored) setToken(stored);
      })
      .catch(async () => {
        // Token might be expired — try refresh
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          const newToken = localStorage.getItem(LS_TOKEN);
          if (newToken) setToken(newToken);
          try {
            const { user } = await apiFetch<{ user: User }>("/auth/me");
            setUser(user);
          } catch {
            clearAuth();
          }
        } else {
          clearAuth();
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const clearAuth = useCallback(() => {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_REFRESH_TOKEN);
    setToken(null);
    setUser(null);
  }, []);

  const setTokensAndUser = useCallback((accessToken: string, refreshToken: string, userData: User) => {
    // Keep localStorage as fallback; primary auth is via httpOnly cookies
    localStorage.setItem(LS_TOKEN, accessToken);
    localStorage.setItem(LS_REFRESH_TOKEN, refreshToken);
    setToken(accessToken);
    setUser(userData);
  }, []);

  const login = async (email: string, password: string) => {
    const data = await apiFetch<{ token: string; refreshToken: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    // Backend sets httpOnly cookies; keep localStorage as fallback
    localStorage.setItem(LS_TOKEN, data.token);
    localStorage.setItem(LS_REFRESH_TOKEN, data.refreshToken);
    setToken(data.token);
    setUser(data.user);
  };

  const register = async (email: string, password: string, name?: string, marketingConsent?: boolean): Promise<{ message: string }> => {
    const data = await apiFetch<{ message: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name, marketingConsent }),
    });
    return data;
  };

  const logout = async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch { /* ignore */ }
    clearAuth();
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, setTokensAndUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
