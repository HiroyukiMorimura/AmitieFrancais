// src/providers/AuthProvider.tsx
import React, { useEffect, useMemo, useState } from "react";
import { AuthContext, type AuthUser } from "./auth-context";

const AUTH_KEY = "lingua_auth_user";

function getOrCreateUidForEmail(email: string): string {
  const key = `lingua_uid:${email.toLowerCase()}`;
  let uid = localStorage.getItem(key);
  if (!uid) {
    uid = crypto.randomUUID();
    localStorage.setItem(key, uid);
  }
  return uid;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<AuthUser> & { email: string };
      const id = parsed.id ?? getOrCreateUidForEmail(parsed.email);
      setUser({ id, email: parsed.email, name: parsed.name });
    } catch (err) {
      // キャッシュが壊れている等。サイレントに破棄して復旧
      localStorage.removeItem(AUTH_KEY);
      if (import.meta.env.DEV) {
        console.warn("[Auth] Failed to parse cached user:", err);
      }
    }
  }, []);

  const login = async (email: string, _password: string) => {
    void _password; // ← 未使用引数を明示的に使用扱いに
    const id = getOrCreateUidForEmail(email);
    const next = { id, email };
    setUser(next);
    localStorage.setItem(AUTH_KEY, JSON.stringify(next));
  };

  const signup = async (email: string, _password: string) => {
    void _password; // ← 同上
    const id = getOrCreateUidForEmail(email);
    const next = { id, email };
    setUser(next);
    localStorage.setItem(AUTH_KEY, JSON.stringify(next));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(AUTH_KEY);
  };

  const value = useMemo(() => ({ user, login, signup, logout }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
