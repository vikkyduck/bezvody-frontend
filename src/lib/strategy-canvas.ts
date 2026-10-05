/** Read the source agent's factor tables; unknown scores are never filled with zero. */
export function parseStrategyCanvas(markdown: string): {
  factors: Array<{ factor: string; scores: Record<string, number> }>;
  players: string[];
} {
  const factors: Array<{ factor: string; scores: Record<string, number> }> = [];
  const players = new Set<string>();
  let current: (typeof factors)[number] | undefined;
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^#{2,4}\s+Фактор\s+\d+\s*[:.—-]\s*(.+)/i);
    if (heading) {
      current = { factor: heading[1]!.replace(/\*\*/g, "").trim(), scores: {} };
      factors.push(current);
      continue;
    }
    if (/^#{1,3}\s/.test(line) && !heading) current = undefined;
    if (!current || !line.trim().startsWith("|")) continue;
    const cells = line
      .trim()
      .split("|")
      .slice(1, -1)
      .map((s) => s.replace(/\*\*/g, "").trim());
    if (!cells[0] || !/^[0-5](?:[.,]\d+)?$/.test(cells[1] ?? "")) continue;
    const score = Number(cells[1]!.replace(",", "."));
    if (score > 5) continue;
    current.scores[cells[0]] = score;
    players.add(cells[0]);
  }
  return { factors: factors.filter((f) => Object.keys(f.scores).length), players: [...players] };
}
