"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ClipboardList, LoaderCircle, LogIn, ShieldCheck, UsersRound } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";

export function AccessScreen() {
  const auth = useAuth(); const router = useRouter(); const [mode, setMode] = useState<"viewer" | "commission" | null>(null); const [code, setCode] = useState(""); const [remember, setRemember] = useState(true); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const run = async (operation: () => Promise<void>) => { setBusy(true); setError(""); try { await operation(); router.push("/app/ao-vivo"); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível entrar."); } finally { setBusy(false); } };
  useEffect(() => { if (!auth.loading && auth.role) router.replace("/app/ao-vivo"); }, [auth.loading, auth.role, router]);
  return <main className="access-page">
    <section className="access-hero" aria-labelledby="access-title">
      <div className="brand-lockup"><Image src="/brand/logo.png" width={64} height={64} alt="" priority /><div><span>Baba</span><strong>Psyzon</strong></div></div>
      <div className="hero-copy"><span className="eyebrow">Seu futebol, organizado</span><h1 id="access-title">Todo mundo acompanha. Você controla.</h1><p>Times, partidas, tabela e ranking atualizados na hora em todos os celulares.</p></div>
      <div className="live-pill"><span /> Sincronização em tempo real</div>
    </section>
    <section className="access-panel" aria-label="Escolha seu acesso">
      <div className="panel-heading"><p className="eyebrow">Bem-vindo</p><h2>Como você quer entrar?</h2><p>Escolha uma opção para continuar.</p></div>
      <div className="access-options">
        <button className="access-option primary-option" onClick={() => run(auth.signInGoogle)} disabled={busy}><span className="option-icon"><ShieldCheck /></span><span><strong>Sou organizador</strong><small>Entrar com sua conta Google</small></span><LogIn className="option-arrow" /></button>
        <button className="access-option" onClick={() => setMode(mode === "viewer" ? null : "viewer")} aria-expanded={mode === "viewer"}><span className="option-icon"><UsersRound /></span><span><strong>Sou jogador</strong><small>Acompanhar com código de 4 dígitos</small></span><LogIn className="option-arrow" /></button>
        {mode === "viewer" && <form className="inline-access" onSubmit={(event) => { event.preventDefault(); run(() => auth.signInViewer(code, remember)); }}><label htmlFor="viewer-code">Código do baba</label><input id="viewer-code" className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={4} placeholder="0000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 4))} autoFocus /><label className="check-row"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Lembrar neste dispositivo</label><button className="button primary" disabled={busy || code.length !== 4}>{busy ? <LoaderCircle className="spin" /> : "Acompanhar agora"}</button></form>}
        <button className="text-button" onClick={() => setMode(mode === "commission" ? null : "commission")}>Acesso da comissão por e-mail</button>
        {mode === "commission" && <form className="inline-access" onSubmit={(event) => { event.preventDefault(); run(() => auth.signInCommission(email, password)); }}><label htmlFor="email">E-mail</label><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /><label htmlFor="password">Senha</label><input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /><button className="button primary" disabled={busy}>Entrar</button></form>}
        <Link className="access-option tactical-option" href="/mesa-tatica"><span className="option-icon"><ClipboardList /></span><span><strong>Mesa tática</strong><small>Monte jogadas sem precisar entrar</small></span><LogIn className="option-arrow" /></Link>
      </div>
      {error && <p className="message error" role="alert">{error}</p>}
      <p className="privacy-note">Seus dados são protegidos pelo acesso do organizador.</p>
    </section>
  </main>;
}
