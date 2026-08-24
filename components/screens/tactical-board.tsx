"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CirclePlay, Download, FileUp, Plus, Redo2, RotateCcw, Save, Trash2, Undo2 } from "lucide-react";
import { z } from "zod";

type MarkerKind = "player" | "ball";
type Side = "blue" | "red";
interface Marker { id: string; kind: MarkerKind; side: Side; label: string; x: number; y: number }
interface Frame { id: string; name: string; markers: Marker[] }

const markerSchema = z.object({
  id: z.string().max(80), kind: z.enum(["player", "ball"]), side: z.enum(["blue", "red"]),
  label: z.string().max(20), x: z.number().min(0).max(100), y: z.number().min(0).max(100),
});
const boardSchema = z.object({ schemaVersion: z.literal(1), frames: z.array(z.object({ id: z.string(), name: z.string().max(60), markers: z.array(markerSchema).max(40) })).max(50) });

const initialMarkers: Marker[] = [{ id: "ball", kind: "ball", side: "blue", label: "Bola", x: 50, y: 50 }];
const cloneMarkers = (markers: Marker[]) => markers.map((marker) => ({ ...marker }));

export function TacticalBoard() {
  const courtRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [side, setSide] = useState<Side>("blue");
  const [markers, setMarkers] = useState<Marker[]>(initialMarkers);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [history, setHistory] = useState<Marker[][]>([initialMarkers]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem("psyzon-tactical-board-v1");
    if (!saved) return;
    const parsed = boardSchema.safeParse(JSON.parse(saved));
    if (!parsed.success) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrames(parsed.data.frames);
    if (parsed.data.frames[0]) setMarkers(cloneMarkers(parsed.data.frames[0].markers));
  }, []);

  useEffect(() => {
    window.localStorage.setItem("psyzon-tactical-board-v1", JSON.stringify({ schemaVersion: 1, frames }));
  }, [frames]);

  const pushHistory = (next: Marker[]) => {
    const nextHistory = [...history.slice(0, historyIndex + 1), cloneMarkers(next)].slice(-40);
    setMarkers(next); setHistory(nextHistory); setHistoryIndex(nextHistory.length - 1);
  };

  const addPlayer = () => {
    const count = markers.filter((marker) => marker.kind === "player" && marker.side === side).length + 1;
    pushHistory([...markers, { id: crypto.randomUUID(), kind: "player", side, label: String(count), x: side === "blue" ? 28 : 72, y: 20 + ((count * 12) % 65) }]);
  };

  const moveMarker = (id: string, clientX: number, clientY: number) => {
    const court = courtRef.current?.getBoundingClientRect(); if (!court) return;
    const x = Math.max(2, Math.min(98, ((clientX - court.left) / court.width) * 100));
    const y = Math.max(4, Math.min(96, ((clientY - court.top) / court.height) * 100));
    setMarkers((current) => current.map((marker) => marker.id === id ? { ...marker, x, y } : marker));
  };

  const endMove = () => pushHistory(markers);
  const saveFrame = () => {
    const frame: Frame = { id: crypto.randomUUID(), name: `Jogada ${frames.length + 1}`, markers: cloneMarkers(markers) };
    setFrames((current) => [...current, frame]); setMessage("Jogada salva neste dispositivo.");
  };

  const play = async () => {
    if (!frames.length || playing) return;
    setPlaying(true);
    for (const frame of frames) {
      setMarkers(cloneMarkers(frame.markers));
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    setPlaying(false);
  };

  const payload = useMemo(() => JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), frames }, null, 2), [frames]);
  const exportBoard = () => {
    const href = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = href; anchor.download = "mesa-tatica-psyzon.json"; anchor.click(); URL.revokeObjectURL(href);
  };

  const importBoard = async (file?: File) => {
    if (!file || file.size > 2_000_000) { setMessage("Escolha um JSON válido de até 2 MB."); return; }
    try {
      const parsed = boardSchema.parse(JSON.parse(await file.text()));
      setFrames(parsed.frames); if (parsed.frames[0]) pushHistory(cloneMarkers(parsed.frames[0].markers)); setMessage(`${parsed.frames.length} jogadas importadas.`);
    } catch { setMessage("O arquivo não é uma jogada válida da Mesa Tática."); }
  };

  return <main className="tactical-page">
    <header className="tactical-toolbar"><Link className="icon-button" href="/" aria-label="Voltar"><ArrowLeft /></Link><div><strong>Mesa Tática</strong><small>{frames.length} jogadas salvas</small></div><button className="icon-button" onClick={() => { setMarkers(initialMarkers); setFrames([]); setHistory([initialMarkers]); setHistoryIndex(0); }} aria-label="Limpar tudo"><Trash2 /></button></header>
    <div className="tactical-layout">
      <aside className="tool-panel" aria-label="Ferramentas da prancheta">
        <div className="team-toggle"><button className={side === "blue" ? "active blue" : ""} onClick={() => setSide("blue")}>Azul</button><button className={side === "red" ? "active red" : ""} onClick={() => setSide("red")}>Vermelho</button></div>
        <button onClick={addPlayer}><Plus /><span>Jogador</span></button>
        <button disabled={historyIndex <= 0} onClick={() => { const index = historyIndex - 1; setHistoryIndex(index); setMarkers(cloneMarkers(history[index])); }}><Undo2 /><span>Desfazer</span></button>
        <button disabled={historyIndex >= history.length - 1} onClick={() => { const index = historyIndex + 1; setHistoryIndex(index); setMarkers(cloneMarkers(history[index])); }}><Redo2 /><span>Refazer</span></button>
        <button onClick={saveFrame}><Save /><span>Salvar</span></button>
        <button disabled={!frames.length || playing} onClick={() => void play()}><CirclePlay /><span>Animar</span></button>
        <button disabled={!frames.length} onClick={exportBoard}><Download /><span>Exportar</span></button>
        <button onClick={() => fileRef.current?.click()}><FileUp /><span>Importar</span></button>
        <input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={(event) => void importBoard(event.target.files?.[0])} />
      </aside>
      <section className="court-wrap">
        <div ref={courtRef} className="futsal-court" aria-label="Quadra tática">
          <span className="court-center" /><span className="court-circle" /><span className="area left" /><span className="area right" />
          {markers.map((marker) => <button key={marker.id} className={`marker ${marker.kind} ${marker.side}`} style={{ left: `${marker.x}%`, top: `${marker.y}%` }} aria-label={`${marker.kind === "ball" ? "Bola" : `Jogador ${marker.label}`}. Arraste para mover.`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveMarker(marker.id, event.clientX, event.clientY); }} onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); endMove(); }} onDoubleClick={() => marker.kind === "player" && pushHistory(markers.filter((item) => item.id !== marker.id))}>{marker.kind === "ball" ? <RotateCcw /> : marker.label}{marker.kind === "player" && <small>{marker.side === "blue" ? "Azul" : "Vermelho"}</small>}</button>)}
        </div>
        <p className="court-tip">Arraste jogadores e bola. Toque duas vezes em um jogador para remover.</p>
        {message && <p className="message" aria-live="polite">{message}</p>}
      </section>
    </div>
  </main>;
}

