import { HistoryItem, RoleName } from "./types";

export const shortAddr = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export const ROLE_GLYPH: Record<RoleName, string> = { Villager: "V", Killer: "K", Doctor: "D" };

export const ROLE_BLURB: Record<RoleName, string> = {
  Villager:
    "You know nothing, and so does the chain. Hunt the Killer. Each night you must still lock in a target: yours is a decoy, but nobody can tell.",
  Killer: "Each night, choose a victim. The contract applies only your choice, and nobody can tell it was yours.",
  Doctor: "Each night, protect one seat. If it matches the Killer's target, nobody dies.",
};

export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface TimelineLine {
  icon: string;
  when: string;
  text: string;
}

/** Turns raw contract events into readable lines (Night 1, Day 1, Night 2, ...). */
export function describeHistory(items: HistoryItem[]): TimelineLine[] {
  let nights = 0;
  let days = 0;
  const lines: TimelineLine[] = [];
  for (const it of items) {
    if (it.kind === "ended") {
      lines.push({
        icon: "★",
        when: "Game over",
        text: it.winner === "Villagers" ? "The Villagers found the Killer and win." : "The Killer survives and wins.",
      });
      continue;
    }
    const when = it.byVote ? `Day ${++days}` : `Night ${++nights}`;
    if (it.kind === "nobody") {
      lines.push({
        icon: it.byVote ? "≈" : "✦",
        when,
        text: it.byVote ? "The vote was tied. Nobody was eliminated." : "Nobody died. (Saved, or the Killer held back.)",
      });
    } else {
      lines.push({
        icon: it.byVote ? "⚖" : "☠",
        when,
        text: `Seat ${(it.seat ?? 0) + 1} was ${it.byVote ? "voted out" : "killed"}. They were the ${it.role}.`,
      });
    }
  }
  return lines;
}
