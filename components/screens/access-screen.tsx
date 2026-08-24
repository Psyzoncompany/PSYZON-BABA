"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, LoaderCircle, LockKeyhole, LogIn, ShieldCheck, UsersRound, X } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";

type AccessMode = "organizer" | "viewer" | null;

export function AccessScreen() {
  const auth = useAuth();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<AccessMode>(null);
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (!auth.loading && auth.role) router.replace("/app/ao-vivo"); }, [auth.loading, auth.role, router]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (mode && dialog && !dialog.open) dialog.showModal();
    if (!mode && dialog?.open) dialog.close();
  }, [mode]);

  const close = () => { if (!busy) { setMode(null); setError(""); } };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await operation(); window.sessionStorage.setItem("psyzon-restore-last", "1"); router.push("/app/ao-vivo"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível entrar."); }
    finally { setBusy(false); }
  };

  return <main className="access-page">
    <section className="access-hero" aria-labelledby="access-title">
      <div className="brand-lockup"><Image src="/brand/logo.png" width={64} height={64} alt="" priority /><div><span>Baba</span><strong>Psyzon</strong></div></div>
      <div className="hero-copy"><span className="eyebrow">Seu futebol, organizado</span><h1 id="access-title">Todo mundo acompanha. Você controla.</h1><p>Times, partidas, tabela, pagamentos e ranking atualizados em todos os celulares.</p></div>
      <div className="live-pill"><span /> Sincronização em tempo real</div>
    </section>
    <section className="access-panel" aria-label="Escolha seu acesso">
      <div className="panel-heading"><p className="eyebrow">Bem-vindo</p><h2>Como você quer entrar?</h2><p>Cada acesso mostra somente o que a pessoa pode usar.</p></div>
      <div className="access-options">
        <button className="access-option primary-option" onClick={() => setMode("organizer")}><span className="option-icon"><ShieldCheck /></span><span><strong>Entrar como organizador</strong><small>Google ou credenciais da comissão</small></span><ArrowRight className="option-arrow" /></button>
        <button className="access-option" onClick={() => setMode("viewer")}><span className="option-icon"><UsersRound /></span><span><strong>Entrar como jogador</strong><small>Acompanhar com código de 4 dígitos</small></span><ArrowRight className="option-arrow" /></button>
        <Link className="access-option tactical-option" href="/mesa-tatica"><span className="option-icon"><Image src="/brand/logo.png" width={30} height={30} alt="" /></span><span><strong>Mesa Tática</strong><small>Abrir a prancheta sem entrar</small></span><ArrowRight className="option-arrow" /></Link>
      </div>
      <p className="privacy-note"><LockKeyhole /> Sessões protegidas e contas isoladas. Jogadores nunca recebem permissão de escrita.</p>
    </section>

    <dialog ref={dialogRef} className="access-dialog" onCancel={(event) => { event.preventDefault(); close(); }} onClose={() => setMode(null)}>
      <button className="dialog-close" aria-label="Fechar" onClick={close} disabled={busy}><X /></button>
      {mode === "viewer" ? <>
        <div className="dialog-icon"><UsersRound /></div><p className="eyebrow">Acesso de leitura</p><h2>Entrar como jogador</h2><p>Use o código fornecido pelo organizador deste baba.</p>
        <form onSubmit={(event) => { event.preventDefault(); void run(() => auth.signInViewer(code, remember)); }}>
          <label htmlFor="viewer-code">Código de 4 dígitos</label>
          <input id="viewer-code" className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={4} placeholder="0000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 4))} autoFocus />
          <label className="check-row"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Lembrar neste dispositivo</label>
          <button className="button primary full" disabled={busy || code.length !== 4}>{busy ? <LoaderCircle className="spin" /> : <LogIn />} Acompanhar agora</button>
        </form>
      </> : mode === "organizer" ? <>
        <div className="dialog-icon"><ShieldCheck /></div><p className="eyebrow">Acesso administrativo</p><h2>Entrar como organizador</h2><p>Use sua conta Google ou o acesso criado para a comissão.</p>
        <button className="button primary full google-button" onClick={() => void run(auth.signInGoogle)} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <ShieldCheck />} Continuar com Google</button>
        <div className="dialog-divider"><span>ou comissão</span></div>
        <form onSubmit={(event) => { event.preventDefault(); void run(() => auth.signInEmail(email, password)); }}>
          <label htmlFor="commission-email">E-mail</label><input id="commission-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="commission-password">Senha</label><input id="commission-password" type="password" autoComplete="current-password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} />
          <button className="button secondary full" disabled={busy || !email || password.length < 12}><LogIn /> Entrar como comissão</button>
        </form>
      </> : null}
      {error && <p className="message error" role="alert">{error}</p>}
    </dialog>
  </main>;
}
