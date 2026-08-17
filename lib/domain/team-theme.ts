export const TEAM_THEMES = [
  { order: 1, club: "Flamengo", color: "#E12A3F", crest: "/team-crests/flamengo.jpg" },
  { order: 2, club: "Palmeiras", color: "#078B56", crest: "/team-crests/palmeiras.webp" },
  { order: 3, club: "Vasco", color: "#B8A46F", crest: "/team-crests/vasco.png" },
  { order: 4, club: "Corinthians", color: "#111827", crest: "/team-crests/corinthians.png" },
  { order: 5, club: "Azul", color: "#2563A8", crest: "/team-crests/azul.png" },
] as const;

export function getTeamTheme(order: number) {
  const safeIndex = Math.max(0, Math.trunc(order || 1) - 1) % TEAM_THEMES.length;
  return TEAM_THEMES[safeIndex];
}
