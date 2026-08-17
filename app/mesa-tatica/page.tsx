import type { Metadata } from "next";
import { TacticalBoard } from "@/components/screens/tactical-board";
export const metadata: Metadata = { title: "Mesa tática" };
export default function TacticalPage() { return <TacticalBoard />; }
