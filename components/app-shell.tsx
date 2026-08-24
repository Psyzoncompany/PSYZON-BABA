"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { AlertTriangle, BarChart3, CircleDollarSign, CircleUserRound, ListOrdered, MoreHorizontal, Radio, Settings2, ShieldCheck, UsersRound, Wifi, WifiOff } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useBaba } from "@/components/providers/baba-provider";

const nav = [
  { href: "/app/ao-vivo", label: "Ao vivo", icon: Radio }, { href: "/app/times", label: "Times", icon: UsersRound },
  { href: "/app/tabela", label: "Tabela", icon: ListOrdered }, { href: "/app/ranking", label: "Ranking", icon: BarChart3 },
  { href: "/app/mais", label: "Mais", icon: MoreHorizontal },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter(); const auth = useAuth(); const { syncStatus, syncError, retryConnection, activeBaba } = useBaba();
  useEffect(() => { if (!auth.loading && !auth.role) router.replace("/"); }, [auth.loading, auth.role, router]);
  useEffect(() => {
    if (!auth.accountId || !auth.role) return;
    const allowed = ["/app/ao-vivo", "/app/times", "/app/tabela", "/app/ranking", "/app/historico", "/app/mais"];
    if (auth.role === "organizer") allowed.push("/app/pagamentos");
    const key = `psyzon:last-area:${auth.accountId}`;
    if (window.sessionStorage.getItem("psyzon-restore-last") === "1") {
      window.sessionStorage.removeItem("psyzon-restore-last");
      const saved = window.localStorage.getItem(key);
      if (saved && allowed.includes(saved) && saved !== pathname) { router.replace(saved); return; }
    }
    if (allowed.includes(pathname)) window.localStorage.setItem(key, pathname);
  }, [auth.accountId, auth.role, pathname, router]);
  if (auth.loading) return <div className="center-state"><div className="skeleton-logo" /><p>Restaurando seu acesso…</p></div>;
  if (!auth.role) return <div className="center-state"><p>Voltando para o acesso…</p></div>;
  const syncLabel = { connecting: "Conectando", saving: "Salvando", online: "Online", offline: "Offline", pending: "Pendente" }[syncStatus];
  return <div className="app-frame">
    <aside className="sidebar">
      <Link href="/app/ao-vivo" className="sidebar-brand"><Image src="/brand/logo.png" width={42} height={42} alt="Baba Psyzon" /><span><small>Baba</small>Psyzon</span></Link>
      <nav aria-label="Navegação principal">{nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={pathname === href ? "active" : ""}><Icon /><span>{label}</span></Link>)}</nav>
      {auth.role === "organizer" && <Link href="/organizador" className={`organizer-link ${pathname === "/organizador" ? "active" : ""}`}><ShieldCheck /><span>Organizador</span></Link>}
      {auth.role === "organizer" && <Link href="/app/pagamentos" className={`sidebar-utility ${pathname === "/app/pagamentos" ? "active" : ""}`}><CircleDollarSign /><span>Pagamentos</span></Link>}
      <Link href="/aparencia" className="sidebar-utility"><Settings2 /><span>Aparência</span></Link>
      <div className="sidebar-user"><CircleUserRound /><div><strong>{auth.user?.displayName || (auth.role === "viewer" ? "Jogador" : "Comissão")}</strong><small>{auth.role === "viewer" ? "Somente leitura" : "Organizador"}</small></div></div>
    </aside>
    <div className="app-main">
      <header className="topbar"><Link href="/app/ao-vivo" className="mobile-brand"><Image src="/brand/logo.png" width={36} height={36} alt="" /><strong>Baba Psyzon</strong></Link><div className={`sync-chip ${syncStatus}`}>{syncStatus === "offline" ? <WifiOff /> : <Wifi />}<span>{syncLabel}</span></div>{activeBaba && <span className="event-date">{new Date(`${activeBaba.dateKey}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</span>}</header>
      {syncError && <div className="sync-error" role="alert"><AlertTriangle /><span>{syncError}</span><button onClick={retryConnection}>Tentar novamente</button></div>}
      <main className="content">{children}</main>
      <nav className="bottom-nav" aria-label="Navegação principal">{nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={pathname === href ? "active" : ""}><Icon /><span>{label}</span></Link>)}</nav>
    </div>
  </div>;
}
