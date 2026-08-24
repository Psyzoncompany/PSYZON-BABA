"use client";

import { ListOrdered, Target } from "lucide-react";
import { useBaba } from "@/components/providers/baba-provider";
import { buildManualRanking, buildRanking, previewTable, sortRanking, teamPoints } from "@/lib/domain/competition";
import { EmptyState, ScreenHeading } from "@/components/ui/screen";

export function TableScreen() {
  const baba = useBaba();
  const game = baba.games.find((item) => item.id === baba.activeBaba?.currentGameId) || null;
  const manual = baba.activeBaba?.matchMode === "manual";
  const sorted = previewTable(baba.teams, game);
  const names = new Map(baba.players.map((player) => [player.id, player.name]));
  const types = new Map(baba.players.map((player) => [player.id, player.type]));
  const ranking = manual ? buildManualRanking(baba.manualResults, baba.teams, names, types) : buildRanking(baba.games, baba.teams, names, types);
  const topScorers = sortRanking(ranking, "goals").slice(0, 4);
  return <><ScreenHeading eyebrow="Classificação" title="Tabela do baba" description={game && game.status !== "finished" ? "Prévia ao vivo: pontos temporários só serão persistidos ao finalizar o jogo." : manual ? "Modo manual: pontos e gols vêm dos totais salvos. Saldo não se aplica." : "Vitória vale 3 pontos. Empate vale 1."} />{!baba.teams.length ? <EmptyState icon={<ListOrdered />} title="A tabela está vazia" text="Os times aparecem aqui depois do sorteio." /> : <><section className={`table-card ${manual ? "manual-table" : ""}`}><div className="responsive-table" role="table" aria-label="Classificação"><div className="table-row table-head" role="row"><span>#</span><span>Time</span><span>PTS</span><span>J</span><span>V</span><span>E</span><span>D</span><span>GP</span>{!manual && <span>SG</span>}</div>{sorted.map((team, index) => { const inGame = game && [game.teamAId, game.teamBId].includes(team.id) && game.status !== "finished"; const played = team.stats.wins + team.stats.draws + team.stats.losses; return <div className={`table-row ${index === 0 ? "leader" : ""} ${inGame ? "in-game" : ""}`} role="row" key={team.id}><span>{index + 1}</span><span><i style={{ background: team.color }} /><strong>{team.name}</strong>{inGame && <small>Ao vivo</small>}</span><strong>{teamPoints(team)}</strong><span>{played}</span><span>{team.stats.wins}</span><span>{team.stats.draws}</span><span>{team.stats.losses}</span><span>{team.stats.goalsFor}</span>{!manual && <span>{team.stats.goalsFor - team.stats.goalsAgainst}</span>}</div>; })}</div></section>{topScorers.length > 0 && <section className="card top-scorers"><div className="card-title-row"><div><h2>Top 4 artilheiros</h2><p>Somente gols com autor identificado</p></div><Target /></div><div>{topScorers.map((row, index) => <span key={row.playerId}><b>{index + 1}</b><strong>{row.name}</strong><em>{row.goals} gols</em></span>)}</div></section>}</>}</>;
}
