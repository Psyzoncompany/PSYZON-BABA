import type { Metadata } from "next";
import { TacticalBoard } from "@/components/screens/tactical-board";

export const metadata: Metadata = { title: "Mesa Tática", description: "Prancheta touch para desenhar e compartilhar jogadas." };
export default function TacticalPage() { return <TacticalBoard />; }
