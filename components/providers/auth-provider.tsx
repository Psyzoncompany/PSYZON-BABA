"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  GoogleAuthProvider,
  onIdTokenChanged,
  setPersistence,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase/client";

type Role = "organizer" | "viewer" | null;

interface AuthValue {
  loading: boolean;
  user: User | null;
  accountId: string | null;
  role: Role;
  signInGoogle: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signInViewer: (code: string, remember: boolean) => Promise<void>;
  organizerToken: () => Promise<string>;
  logout: () => Promise<void>;
}

interface ViewerResponse {
  accountId?: string;
  customToken?: string;
  error?: string;
}

const AuthContext = createContext<AuthValue | null>(null);

function deviceId(remember: boolean): string {
  const storage = remember ? window.localStorage : window.sessionStorage;
  const key = "psyzon-viewer-device";
  const current = storage.getItem(key);
  if (current) return current;
  const created = crypto.randomUUID().replaceAll("-", "");
  storage.setItem(key, created);
  return created;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);
  const restoring = useRef(false);

  const resolveIdentity = useCallback(async (next: User | null) => {
    if (!next) {
      setUser(null);
      setAccountId(null);
      setRole(null);
      return;
    }
    const token = await next.getIdTokenResult();
    const viewerAccountId = typeof token.claims.accountId === "string" ? token.claims.accountId : null;
    const isViewer = token.claims.role === "viewer" && Boolean(viewerAccountId);
    setUser(next);
    setAccountId(isViewer ? viewerAccountId : next.uid);
    setRole(isViewer ? "viewer" : "organizer");
  }, []);

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      if (restoring.current) return;
      restoring.current = true;
      try {
        await auth.authStateReady();
        if (auth.currentUser) {
          await resolveIdentity(auth.currentUser);
          return;
        }
        const response = await fetch("/api/access", { cache: "no-store" });
        const data = await response.json().catch(() => ({})) as ViewerResponse;
        if (response.ok && data.customToken) {
          await setPersistence(auth, browserSessionPersistence);
          const credential = await signInWithCustomToken(auth, data.customToken);
          await resolveIdentity(credential.user);
        }
      } catch (cause) {
        console.error("[auth] Não foi possível restaurar a sessão", cause);
      } finally {
        restoring.current = false;
        if (!cancelled) setLoading(false);
      }
    };

    void restore();
    const unsubscribe = onIdTokenChanged(auth, (next) => {
      if (restoring.current) return;
      void resolveIdentity(next).finally(() => { if (!cancelled) setLoading(false); });
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [resolveIdentity]);

  const signInViewer = useCallback(async (code: string, remember: boolean) => {
    const response = await fetch("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, remember, deviceId: deviceId(remember) }),
    });
    const data = await response.json().catch(() => ({})) as ViewerResponse;
    if (!response.ok || !data.customToken) throw new Error(data.error || "Não foi possível entrar.");
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    const credential = await signInWithCustomToken(auth, data.customToken);
    await resolveIdentity(credential.user);
  }, [resolveIdentity]);

  const signInGoogle = useCallback(async () => {
    await fetch("/api/access", { method: "DELETE" });
    if (auth.currentUser) await signOut(auth);
    await setPersistence(auth, browserLocalPersistence);
    const credential = await signInWithPopup(auth, new GoogleAuthProvider());
    await resolveIdentity(credential.user);
  }, [resolveIdentity]);

  const signInEmail = useCallback(async (email: string, password: string) => {
    await fetch("/api/access", { method: "DELETE" });
    if (auth.currentUser) await signOut(auth);
    await setPersistence(auth, browserLocalPersistence);
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    await resolveIdentity(credential.user);
  }, [resolveIdentity]);

  const organizerToken = useCallback(async () => {
    if (!auth.currentUser || role !== "organizer") throw new Error("Entre novamente como organizador.");
    return auth.currentUser.getIdToken();
  }, [role]);

  const logout = useCallback(async () => {
    await fetch("/api/access", { method: "DELETE" }).catch(() => undefined);
    await signOut(auth).catch(() => undefined);
    setUser(null);
    setAccountId(null);
    setRole(null);
  }, []);

  const value = useMemo<AuthValue>(() => ({
    loading,
    user,
    accountId,
    role,
    signInGoogle,
    signInEmail,
    signInViewer,
    organizerToken,
    logout,
  }), [loading, user, accountId, role, signInGoogle, signInEmail, signInViewer, organizerToken, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth precisa de AuthProvider");
  return value;
}
