import { GameState, RoleName } from "@/lib/types";
import { shortAddr } from "@/lib/format";

/** Five seats around a table. `known[i]` is a role everyone may see (the dead, or everyone after the game). */
export function Table({ state, known }: { state: GameState; known: (RoleName | null)[] }) {
  const ended = state.phase === "Ended";
  const sealed = state.phase === "NightReveal" || state.phase === "DayReveal";

  let glyph = "·";
  let big = "Waiting";
  let small = `${state.joined} of 5 seated`;
  if (state.phase === "Night") {
    glyph = "☾";
    big = `Night ${state.round + 1}`;
    small = "Everyone acts in secret";
  }
  if (state.phase === "Day") {
    glyph = "☀";
    big = `Day ${state.round + 1}`;
    small = "Everyone votes in secret";
  }
  if (sealed) {
    glyph = "✦";
    big = "Sealed";
    small = "Result awaits the reveal";
  }
  if (ended) {
    glyph = "★";
    big = "Game over";
    small = "Roles can be verified";
  }

  const voting = state.phase === "Night" || state.phase === "Day";

  return (
    <div className="table" role="group" aria-label="The table: five seats">
      <div className="center">
        <div className="glyph" aria-hidden="true">
          {glyph}
        </div>
        <div className="big">{big}</div>
        <div className="small">{small}</div>
      </div>
      {Array.from({ length: 5 }, (_, i) => {
        const angle = ((-90 + i * 72) * Math.PI) / 180;
        const left = 50 + 38 * Math.cos(angle);
        const top = 50 + 38 * Math.sin(angle);
        const addr = state.players[i];
        const empty = !addr;
        const me = state.mySeat === i;
        const dead = !empty && !state.alive[i];
        const role = known[i];
        const cls = ["seat", empty ? "empty" : "", me ? "me" : "", dead ? "dead" : ""].join(" ");
        return (
          <div key={i} className={cls} style={{ left: `${left}%`, top: `${top}%` }}>
            <div style={{ animationDelay: `${-i * 0.9}s` }} className={`avatar ${voting && !empty && state.alive[i] && state.hasActed[i] ? "locked" : ""}`} aria-hidden="true">
              {i + 1}
              {voting && !empty && state.alive[i] && state.hasActed[i] && (
                <span className="acted" title="Has locked in">
                  ✓
                </span>
              )}
            </div>
            <div className="label">
              <b>{empty ? "Open seat" : me ? "You" : `Seat ${i + 1}`}</b>
              {!empty && !me && <div className="mono">{shortAddr(addr)}</div>}
              {role ? (
                <span className={`badge ${role}`}>{role}</span>
              ) : dead ? (
                <span className="badge sealed">Fallen</span>
              ) : !empty && state.phase !== "Lobby" ? (
                <span className="badge sealed">Hidden</span>
              ) : null}
            </div>
            <span className="sr">
              Seat {i + 1}: {empty ? "open" : dead ? "eliminated" : "alive"}
              {me ? ", you" : ""}
              {role ? `, ${role}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
