"use client";

import Link from "next/link";
import { ArrowLeft, Check, Moon, Palette, RotateCcw, Sun, SunMoon } from "lucide-react";
import { useEffect, useState } from "react";
import { ScreenHeading } from "@/components/ui/screen";

type Theme = "system" | "light" | "dark"; type Density = "compact" | "normal" | "comfortable"; type Radius = "small" | "medium" | "large";
function apply(theme: Theme, density: Density, radius: Radius, reduced: boolean) { const root = document.documentElement; root.dataset.theme = theme; root.dataset.density = density; root.dataset.radius = radius; root.dataset.motion = reduced ? "reduced" : "full"; }

export function AppearanceScreen() { const [theme, setTheme] = useState<Theme>("system"); const [density, setDensity] = useState<Density>("normal"); const [radius, setRadius] = useState<Radius>("medium"); const [reduced, setReduced] = useState(false);
  // Preferences are device-local and can only be restored after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem("psyzon-appearance") || "{}"); const t = saved.theme || "system", d = saved.density || "normal", r = saved.radius || "medium", m = Boolean(saved.reduced); setTheme(t); setDensity(d); setRadius(r); setReduced(m); apply(t, d, r, m); } catch { apply("system", "normal", "medium", false); } }, []);
  const save = (nextTheme = theme, nextDensity = density, nextRadius = radius, nextReduced = reduced) => { apply(nextTheme, nextDensity, nextRadius, nextReduced); localStorage.setItem("psyzon-appearance", JSON.stringify({ theme: nextTheme, density: nextDensity, radius: nextRadius, reduced: nextReduced })); };
  return <main className="standalone-page"><div className="standalone-toolbar"><Link href="/app/mais" className="icon-button" aria-label="Voltar"><ArrowLeft /></Link><strong>Baba Psyzon</strong></div><div className="standalone-content"><ScreenHeading eyebrow="Preferências" title="Aparência" description="Deixe o aplicativo confortável para você. As escolhas ficam salvas neste aparelho." />
    <section className="settings-section"><div><Palette /><span><h2>Tema</h2><p>Acompanhe o sistema ou escolha seu modo.</p></span></div><div className="choice-grid three">{([{ id: "system", label: "Sistema", icon: SunMoon }, { id: "light", label: "Claro", icon: Sun }, { id: "dark", label: "Escuro", icon: Moon }] as const).map(({ id, label, icon: Icon }) => <button key={id} className={theme === id ? "selected" : ""} onClick={() => { setTheme(id); save(id); }}><Icon /><strong>{label}</strong>{theme === id && <Check />}</button>)}</div></section>
    <section className="settings-section"><div><span><h2>Densidade</h2><p>Controle o espaço entre elementos.</p></span></div><div className="segmented large">{(["compact", "normal", "comfortable"] as Density[]).map((item) => <button key={item} className={density === item ? "active" : ""} onClick={() => { setDensity(item); save(theme, item); }}>{item === "compact" ? "Compacta" : item === "normal" ? "Normal" : "Confortável"}</button>)}</div></section>
    <section className="settings-section"><div><span><h2>Cantos</h2><p>Escolha o formato dos cards e botões.</p></span></div><div className="choice-grid three radius-choice">{(["small", "medium", "large"] as Radius[]).map((item) => <button key={item} className={radius === item ? "selected" : ""} onClick={() => { setRadius(item); save(theme, density, item); }}><span className={`radius-demo ${item}`} /><strong>{item === "small" ? "Pequeno" : item === "medium" ? "Médio" : "Grande"}</strong>{radius === item && <Check />}</button>)}</div></section>
    <section className="settings-section toggle-setting"><div><span><h2>Reduzir animações</h2><p>Ideal para quem prefere menos movimento.</p></span></div><button role="switch" aria-checked={reduced} className={`switch ${reduced ? "on" : ""}`} onClick={() => { setReduced(!reduced); save(theme, density, radius, !reduced); }}><span /></button></section>
    <button className="button secondary" onClick={() => { setTheme("system"); setDensity("normal"); setRadius("medium"); setReduced(false); save("system", "normal", "medium", false); }}><RotateCcw /> Restaurar padrão</button></div></main>;
}
