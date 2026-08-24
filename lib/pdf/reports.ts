import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from "pdf-lib";
import type { Player, RankingRow, Team } from "@/lib/domain/types";
import { getTeamTheme } from "@/lib/domain/team-theme";
import { calculateStars } from "@/lib/domain/stars";

const A4: [number, number] = [595.28, 841.89];
const colors = { navy: rgb(0.045, 0.13, 0.25), blue: rgb(0.09, 0.41, 0.86), muted: rgb(0.38, 0.45, 0.54), line: rgb(0.86, 0.89, 0.93), soft: rgb(0.96, 0.98, 1), white: rgb(1, 1, 1), gold: rgb(0.93, 0.68, 0.12) };

interface ReportContext { doc: PDFDocument; regular: PDFFont; bold: PDFFont; pages: PDFPage[] }

function safe(value: unknown): string {
  return String(value ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, 160);
}

function text(page: PDFPage, value: unknown, x: number, y: number, font: PDFFont, size = 9, color = colors.navy) {
  page.drawText(safe(value), { x, y, font, size, color, maxWidth: A4[0] - x - 40 });
}

async function context(): Promise<ReportContext> {
  const doc = await PDFDocument.create();
  doc.setCreator("Baba Psyzon"); doc.setProducer("Baba Psyzon Next.js"); doc.setCreationDate(new Date());
  return { doc, regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), pages: [] };
}

async function header(ctx: ReportContext, title: string, subtitle: string): Promise<{ page: PDFPage; y: number }> {
  const page = ctx.doc.addPage(A4); ctx.pages.push(page); const height = page.getHeight();
  page.drawRectangle({ x: 0, y: height - 104, width: page.getWidth(), height: 104, color: colors.navy });
  try {
    const logo = await readFile(path.join(process.cwd(), "public", "brand", "logo.png"));
    const image = await ctx.doc.embedPng(logo); page.drawImage(image, { x: 38, y: height - 82, width: 48, height: 48 });
  } catch { page.drawCircle({ x: 62, y: height - 58, size: 24, color: colors.blue }); }
  text(page, "BABA PSYZON", 100, height - 43, ctx.bold, 10, rgb(0.48, 0.72, 1));
  text(page, title, 100, height - 67, ctx.bold, 19, colors.white);
  text(page, subtitle, 100, height - 86, ctx.regular, 8, rgb(0.74, 0.82, 0.91));
  return { page, y: height - 135 };
}

function svgPolygon(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ") + " Z";
}

function leftHalf(points: Array<{ x: number; y: number }>, centerX: number) {
  const result: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]; const previous = points[(index + points.length - 1) % points.length];
    const currentInside = current.x <= centerX; const previousInside = previous.x <= centerX;
    if (currentInside !== previousInside) {
      const ratio = (centerX - previous.x) / (current.x - previous.x);
      result.push({ x: centerX, y: previous.y + (current.y - previous.y) * ratio });
    }
    if (currentInside) result.push(current);
  }
  return result;
}

function star(page: PDFPage, centerX: number, centerY: number, radius: number, fill: 0 | 0.5 | 1) {
  const points = Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 5; const distance = index % 2 ? radius * 0.45 : radius;
    return { x: centerX + Math.cos(angle) * distance, y: centerY + Math.sin(angle) * distance };
  });
  const pathData = svgPolygon(points);
  page.drawSvgPath(pathData, { color: fill === 1 ? colors.gold : colors.line, borderColor: fill === 1 ? colors.gold : colors.muted, borderWidth: 0.5 });
  if (fill === 0.5) page.drawSvgPath(svgPolygon(leftHalf(points, centerX)), { color: colors.gold });
}

function finish(ctx: ReportContext) {
  const generated = new Date().toLocaleString("pt-BR", { timeZone: "America/Bahia" });
  ctx.pages.forEach((page, index) => {
    text(page, `Gerado em ${generated}`, 40, 24, ctx.regular, 7, colors.muted);
    text(page, `Página ${index + 1} de ${ctx.pages.length}`, page.getWidth() - 105, 24, ctx.regular, 7, colors.muted);
  });
  return ctx.doc.save();
}

export async function createRankingPdf(options: { title: string; period: string; criterion: string; rows: RankingRow[]; completedBabas: number }) {
  const ctx = await context(); let { page, y } = await header(ctx, options.title, `${options.period} · Ordenação: ${options.criterion}`);
  const columns = [40, 66, 255, 326, 374, 422, 470, 526];
  const drawHead = () => { page.drawRectangle({ x: 36, y: y - 5, width: 523, height: 25, color: colors.soft }); ["#", "Jogador", "Estrelas", "Gols", "Vit.", "Der.", "Títulos", "Aprov."].forEach((label, index) => text(page, label, columns[index], y + 4, ctx.bold, 7, colors.muted)); y -= 24; };
  drawHead();
  for (let index = 0; index < options.rows.length; index += 1) {
    const row = options.rows[index];
    if (y < 62) { ({ page, y } = await header(ctx, options.title, `${options.period} · Continuação`)); drawHead(); }
    const rating = calculateStars(row, options.rows, options.completedBabas);
    if (index % 2 === 1) page.drawRectangle({ x: 36, y: y - 11, width: 523, height: 27, color: colors.soft });
    text(page, index + 1, columns[0], y, ctx.bold, 8); text(page, row.name, columns[1], y, ctx.bold, 8);
    for (let value = 0; value < 5; value += 1) star(page, columns[2] + value * 11, y + 3, 4.3, rating.displayStars >= value + 1 ? 1 : rating.displayStars >= value + 0.5 ? 0.5 : 0);
    text(page, row.goals, columns[3], y, ctx.regular, 8); text(page, row.wins, columns[4], y, ctx.regular, 8); text(page, row.losses, columns[5], y, ctx.regular, 8); text(page, row.titles || 0, columns[6], y, ctx.regular, 8); text(page, `${row.efficiency}%`, columns[7], y, ctx.regular, 8); y -= 27;
  }
  return finish(ctx);
}

export async function createManualSheetPdf(options: { dateLabel: string; teams: Team[]; players: Player[] }) {
  const ctx = await context(); const playerById = new Map(options.players.map((player) => [player.id, player]));
  let { page, y } = await header(ctx, "Ficha manual do baba", `${options.dateLabel} · Preencha no papel e informe os totais no aplicativo`);
  for (const team of options.teams) {
    const requiredHeight = 82 + Math.max(1, team.playerIds.length) * 17;
    if (y - requiredHeight < 52) ({ page, y } = await header(ctx, "Ficha manual do baba", `${options.dateLabel} · Continuação`));
    const theme = getTeamTheme(team.order); page.drawRectangle({ x: 36, y: y - 26, width: 523, height: 28, color: colors.soft }); page.drawRectangle({ x: 36, y: y - 26, width: 5, height: 28, color: colors.blue });
    text(page, `${team.name} · ${theme.club}`, 50, y - 16, ctx.bold, 11); text(page, "V ____   E ____   D ____   PTS ____", 345, y - 16, ctx.bold, 8); y -= 42;
    text(page, "Jogador", 50, y, ctx.bold, 7, colors.muted); text(page, "Gols", 460, y, ctx.bold, 7, colors.muted); y -= 14;
    for (const playerId of team.playerIds) { const player = playerById.get(playerId); text(page, `${player?.name || "Jogador"}${player?.type === "goleiro" ? " (GOL)" : ""}`, 50, y, ctx.regular, 9); page.drawLine({ start: { x: 455, y: y - 2 }, end: { x: 535, y: y - 2 }, thickness: 0.7, color: colors.line }); y -= 17; }
    if (!team.playerIds.length) { text(page, "Elenco a preencher", 50, y, ctx.regular, 9, colors.muted); y -= 18; }
    text(page, "Observações:", 50, y - 2, ctx.bold, 7, colors.muted); page.drawLine({ start: { x: 115, y: y - 3 }, end: { x: 535, y: y - 3 }, thickness: 0.7, color: colors.line }); y -= 28;
  }
  return finish(ctx);
}

export async function createPaymentsPdf(options: { monthLabel: string; dueDateLabel: string; rows: { name: string; type: string; status: "paid" | "pending" | "novato" | "desativado"; amountCents: number }[] }) {
  const ctx = await context(); let { page, y } = await header(ctx, "Pagamentos mensais", `${options.monthLabel} · Vencimento ${options.dueDateLabel}`);
  const groups = [
    { key: "paid", label: "Pagos" }, { key: "pending", label: "Pendentes" }, { key: "novato", label: "Novatos · isentos" }, { key: "desativado", label: "Desativados" },
  ] as const;
  for (const group of groups) {
    const rows = options.rows.filter((row) => row.status === group.key);
    if (y < 100) ({ page, y } = await header(ctx, "Pagamentos mensais", `${options.monthLabel} · Continuação`));
    page.drawRectangle({ x: 36, y: y - 20, width: 523, height: 24, color: colors.soft }); text(page, `${group.label} (${rows.length})`, 48, y - 11, ctx.bold, 9); y -= 34;
    if (!rows.length) { text(page, "Nenhum jogador nesta seção.", 48, y, ctx.regular, 8, colors.muted); y -= 22; continue; }
    for (const row of rows) {
      if (y < 58) ({ page, y } = await header(ctx, "Pagamentos mensais", `${options.monthLabel} · Continuação`));
      text(page, row.name, 48, y, ctx.bold, 8); text(page, row.type, 285, y, ctx.regular, 8, colors.muted); text(page, (row.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), 455, y, ctx.regular, 8); page.drawLine({ start: { x: 48, y: y - 7 }, end: { x: 547, y: y - 7 }, thickness: 0.45, color: colors.line }); y -= 22;
    }
    y -= 8;
  }
  return finish(ctx);
}
