"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { auth } from "@/lib/firebase/client";

type Role = "organizer" | "viewer" | null;
interface AuthValue {
  loading: boolean; user: User | null; accountId: string | null; role: Role;
  signInGoogle: () => Promise<void>;
  signInViewer: (code: string, remember: boolean) => Promise<void>; logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [viewerAccountId, setViewerAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let authReady = false;
    let sessionReady = false;
    const finish = () => { if (authReady && sessionReady) setLoading(false); };
    const unsubscribe = onAuthStateChanged(auth, (next) => { setUser(next); authReady = true; finish(); });
    fetch("/api/access", { cache: "no-store" }).then(async (response) => {
      if (response.ok) setViewerAccountId((await response.json()).accountId || null);
    }).finally(() => { sessionReady = true; finish(); });
    return unsubscribe;
  }, []);

  const signInViewer = useCallback(async (code: string, remember: boolean) => {
    const response = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, remember }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível entrar.");
    setViewerAccountId(data.accountId);
  }, []);

  const logout = useCallback(async () => {
    await Promise.allSettled([signOut(auth), fetch("/api/access", { method: "DELETE" })]);
    setViewerAccountId(null);
  }, []);

  const value = useMemo<AuthValue>(() => ({
    loading, user, accountId: user?.uid || viewerAccountId, role: user ? "organizer" : viewerAccountId ? "viewer" : null,
    signInGoogle: async () => { await signInWithPopup(auth, new GoogleAuthProvider()); },
    signInViewer, logout,
  }), [loading, user, viewerAccountId, signInViewer, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth precisa de AuthProvider");
  return value;
}
