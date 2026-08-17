"use client";

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { CircleDollarSign, Plus, Target, Trash2 } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { db } from "@/lib/firebase/client";
import { EmptyState, ScreenHeading, StatCard } from "@/components/ui/screen";

interface PurchaseGoal { id: string; name: string; description: string; priority: "alta" | "media" | "baixa"; targetCents: number; raisedCents: number; deleted?: boolean; updatedAtMs: number }
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function GoalsScreen() {
  const { accountId, role } = useAuth(); const [goals, setGoals] = useState<PurchaseGoal[]>([]); const [open, setOpen] = useState(false); const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [target, setTarget] = useState(""); const [priority, setPriority] = useState<PurchaseGoal["priority"]>("media"); const [error, setError] = useState("");
  useEffect(() => {
    if (!accountId) return;
    return onSnapshot(collection(db, "baba_accounts", accountId, "purchase_goals"), (snapshot) => {
      const order = { alta: 0, media: 1, baixa: 2 } as const;
      setGoals(snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() } as PurchaseGoal))
        .filter((item) => !item.deleted)
        .sort((a, b) => order[a.priority] - order[b.priority] || b.updatedAtMs - a.updatedAtMs));
    });
  }, [accountId]);
  const save = async (event: React.FormEvent) => { event.preventDefault(); if (!accountId || role !== "organizer") return; const targetCents = Math.round(Number(target.replace(",", ".")) * 100); if (!name.trim() || targetCents <= 0) { setError("Informe um nome e um valor maior que zero."); return; } const id = crypto.randomUUID(); await setDoc(doc(db, "baba_accounts", accountId, "purchase_goals", id), { id, name: name.trim(), description: description.trim(), priority, targetCents, raisedCents: 0, schemaVersion: 3, createdAtMs: Date.now(), updatedAtMs: Date.now() }); setName(""); setDescription(""); setTarget(""); setOpen(false); };
  const raised = goals.reduce((sum, goal) => sum + goal.raisedCents, 0); const targetTotal = goals.reduce((sum, goal) => sum + goal.targetCents, 0);
  return <><ScreenHeading eyebrow="Planejamento" title="Metas de compra" description="Acompanhe o que o baba precisa comprar e quanto já foi arrecadado." action={role === "organizer" ? <button className="button primary" onClick={() => setOpen(true)}><Plus /> Nova meta</button> : undefined} /><div className="stat-grid"><StatCard label="Total em metas" value={money(targetTotal)} /><StatCard label="Arrecadado" value={money(raised)} /><StatCard label="Falta" value={money(Math.max(0, targetTotal - raised))} /></div>
    {open && <form className="card form-card" onSubmit={save}><h2>Nova meta</h2><label>Nome<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Bolas novas" maxLength={80} /></label><label>Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} /></label><div className="form-row"><label>Valor alvo (R$)<input inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value.replace(/[^\d,.]/g, ""))} placeholder="350,00" /></label><label>Prioridade<select value={priority} onChange={(event) => setPriority(event.target.value as PurchaseGoal["priority"])}><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option></select></label></div>{error && <p className="message error">{error}</p>}<div className="form-actions"><button type="button" className="button secondary" onClick={() => setOpen(false)}>Cancelar</button><button className="button primary">Salvar meta</button></div></form>}
    {!goals.length ? <EmptyState icon={<Target />} title="Nenhuma meta criada" text="Crie a primeira meta para planejar equipamentos e melhorias." /> : <div className="goal-grid">{goals.map((goal) => { const percent = Math.min(100, Math.round((goal.raisedCents / goal.targetCents) * 100)); return <article className="goal-card" key={goal.id}><header><span className={`priority ${goal.priority}`}>{goal.priority}</span>{role === "organizer" && <button className="icon-button danger" aria-label={`Excluir ${goal.name}`} onClick={() => accountId && updateDoc(doc(db, "baba_accounts", accountId, "purchase_goals", goal.id), { deleted: true, updatedAtMs: Date.now() })}><Trash2 /></button>}</header><div className="goal-icon"><Target /></div><h2>{goal.name}</h2><p>{goal.description || "Meta do Baba Psyzon"}</p><div className="progress"><span style={{ width: `${percent}%` }} /></div><div className="goal-numbers"><strong>{money(goal.raisedCents)}</strong><span>de {money(goal.targetCents)} · {percent}%</span></div>{role === "organizer" && <button className="button secondary full" onClick={async () => { const value = window.prompt("Novo valor arrecadado em reais", String(goal.raisedCents / 100).replace(".", ",")); if (value && accountId) await updateDoc(doc(db, "baba_accounts", accountId, "purchase_goals", goal.id), { raisedCents: Math.max(0, Math.round(Number(value.replace(",", ".")) * 100)), updatedAtMs: Date.now() }); }}><CircleDollarSign /> Atualizar arrecadação</button>}</article>; })}</div>}
  </>;
}
