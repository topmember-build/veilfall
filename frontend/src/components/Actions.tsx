"use client";

import { useEffect, useState } from "react";
import { GameState, RoleName } from "@/lib/types";
import { mmss, shortAddr } from "@/lib/format";

interface Props {
  state: GameState;
  role: RoleName | null;
  busy: boolean;
  verified: RoleName[] | null;
  onJoin: () => void;
  onNight: (seat: number) => void;
  onVote: (seat: number) => void;
  onReveal: () => void;
  onForce: () => void;
  onVerify: () => void;
  onAgain: () => void;
}

function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function SeatPicker({
  state,
  value,
  onChange,
  label,
}: {
  state: GameState;
  value: number | null;
  onChange: (n: number) => void;
  label: string;
}) {
  return (
    <div className="seatpicks" role="group" aria-label={label}>
      {Array.from({ length: 5 }, (_, i) => {
        const empty = !state.players[i];
        const dead = !empty && !state.alive[i];
        return (
          <button
            key={i}
            className="seatpick"
            aria-pressed={value === i}
            disabled={empty || dead}
            onClick={() => onChange(i)}
          >
            <span className="num">{i + 1}</span>
            <span className="who">{state.mySeat === i ? "you" : dead ? "fallen" : shortAddr(state.players[i]).slice(0, 6)}</span>
          </button>
        );
      })}
    </div>
  );
}

const NIGHT_PROMPT: Record<RoleName | "unknown", { title: string; text: string; cta: string }> = {
  unknown: {
    title: "Night: lock in a target",
    text: "Every living player must act every night, whatever their role, so nobody can tell who matters. Reveal your role to see what your move does.",
    cta: "Lock in",
  },
  Killer: {
    title: "Night: choose your victim",
    text: "You are the Killer. The contract applies only your choice, and nobody can tell it was yours.",
    cta: "Lock in the kill",
  },
  Doctor: {
    title: "Night: choose who to protect",
    text: "You are the Doctor. If you pick the Killer's target, nobody dies tonight.",
    cta: "Lock in the save",
  },
  Villager: {
    title: "Night: pick anyone",
    text: "You are a Villager, so your pick is a decoy and changes nothing. But you must still act, so nobody can tell you are harmless.",
    cta: "Lock in",
  },
};

export function Actions(p: Props) {
  const { state } = p;
  const now = useNow();
  const [target, setTarget] = useState<number | null>(null);

  // A new phase means a fresh choice.
  useEffect(() => setTarget(null), [state.phase, state.round]);

  const joined = state.mySeat >= 0;
  const iAmAlive = joined && state.alive[state.mySeat];
  const iActed = joined && state.hasActed[state.mySeat];
  const aliveCount = state.alive.filter((a, i) => a && state.players[i]).length;
  const remaining = state.deadline - now;
  const canForce = (state.phase === "Night" || state.phase === "Day") && remaining <= 0;

  // ------------------------------------------------------------- Lobby
  if (state.phase === "Lobby") {
    const link = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}?game=${state.id}` : "";
    return (
      <section className="card pad">
        <h2>Waiting for players</h2>
        <p className="hint">
          {state.joined} of 5 seats are taken. The game starts, and roles are dealt, the moment the fifth player joins.
        </p>
        {!joined ? (
          <button className="btn primary" onClick={p.onJoin} disabled={p.busy}>
            Take a seat
          </button>
        ) : (
          <>
            <p className="hint" style={{ marginBottom: 8 }}>
              You are seated. Share this link with your friends:
            </p>
            <div className="field">
              <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
              <button className="btn" onClick={() => navigator.clipboard?.writeText(link)}>
                Copy
              </button>
            </div>
          </>
        )}
      </section>
    );
  }

  // ------------------------------------------------------------- Ended
  if (state.phase === "Ended") {
    return (
      <section className={`card winner ${state.winner}`}>
        <h2>{state.winner === "Villagers" ? "The Villagers win" : "The Killer wins"}</h2>
        <p className="hint" style={{ margin: "6px auto 16px", maxWidth: "44ch" }}>
          Now the veil lifts. Anyone can ask Zama&apos;s network to decrypt every role and check that the deal was fair.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="btn primary" onClick={p.onVerify} disabled={p.busy || !!p.verified}>
            {p.verified ? "All roles verified" : "Verify every role"}
          </button>
          <button className="btn" onClick={p.onAgain}>
            Back to the lobby
          </button>
        </div>
      </section>
    );
  }

  // ---------------------------------------------------- Sealed results
  if (state.phase === "NightReveal" || state.phase === "DayReveal") {
    const night = state.phase === "NightReveal";
    return (
      <section className="card pad">
        <h2>{night ? "The night is over" : "The votes are in"}</h2>
        <p className="hint">
          The contract has worked out {night ? "who died tonight" : "the vote"} without ever seeing a single secret. The result is sealed
          until someone asks Zama&apos;s network to reveal it. Anyone can do this.
        </p>
        <button className="btn primary" onClick={p.onReveal} disabled={p.busy}>
          Reveal the result
        </button>
      </section>
    );
  }

  // -------------------------------------------------- Night / Day action
  const night = state.phase === "Night";
  const prompt = NIGHT_PROMPT[p.role ?? "unknown"];

  let body: React.ReactNode;
  if (!joined) {
    body = <p className="hint">You are watching this table. Seated players are locking in their moves.</p>;
  } else if (!iAmAlive) {
    body = <p className="hint">You have been eliminated. Stay and watch how it ends.</p>;
  } else if (iActed) {
    body = (
      <p className="hint">
        <b>Locked in.</b> {state.acted} of {aliveCount} players have acted. Nobody, not even the contract, can see what you chose.
      </p>
    );
  } else {
    const verb = night ? prompt.cta : "Cast my vote";
    body = (
      <>
        <p className="hint" style={{ marginBottom: 0 }}>
          {night
            ? prompt.text
            : "Vote for who to eliminate. Votes are encrypted and counted by the contract; only the result is revealed. A tie eliminates nobody."}
        </p>
        <SeatPicker state={state} value={target} onChange={setTarget} label={night ? "Night target" : "Vote"} />
        <button
          className="btn primary"
          disabled={p.busy || target === null}
          onClick={() => target !== null && (night ? p.onNight(target) : p.onVote(target))}
        >
          {verb}
        </button>
      </>
    );
  }

  return (
    <section className="card pad">
      <h2>{night ? prompt.title : "Day: vote someone out"}</h2>
      {body}
      <p className="countdown" style={{ margin: "14px 0 0" }}>
        {state.acted} of {aliveCount} locked in
        {canForce ? "" : ` · if someone stalls, anyone can resolve this phase in ${mmss(remaining)}`}
      </p>
      {canForce && (
        <div style={{ marginTop: 10 }}>
          <button className="btn small danger" onClick={p.onForce} disabled={p.busy}>
            Resolve without the stalled players
          </button>
        </div>
      )}
    </section>
  );
}
