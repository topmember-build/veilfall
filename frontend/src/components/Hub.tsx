"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChainClient } from "@/lib/chainClient";
import { friendlyError } from "@/lib/chainClient";
import { GameSummary } from "@/lib/types";

const PHASE_TEXT: Record<string, string> = {
  Lobby: "Waiting for players",
  Night: "Night",
  NightReveal: "Dawn sealed",
  Day: "Day",
  DayReveal: "Verdict sealed",
  Ended: "Finished",
};

function Seals({ g }: { g: GameSummary }) {
  return (
    <span className="seals" aria-label={`${g.joined} of 5 seats taken`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={`seal ${g.players[i] ? "on" : ""} ${g.mySeat === i ? "me" : ""}`} />
      ))}
    </span>
  );
}

function Row({ g, onOpen, label }: { g: GameSummary; onOpen: (id: number) => void; label: string }) {
  const mine = g.mySeat >= 0;
  const out = mine && !g.alive[g.mySeat] && g.phase !== "Lobby";
  const phase = g.phase === "Night" || g.phase === "Day" ? `${PHASE_TEXT[g.phase]} ${g.round + 1}` : PHASE_TEXT[g.phase];
  return (
    <li className="grow">
      <div className="gmain">
        <b>Game #{g.id}</b>
        <span className="gsub">
          {phase}
          {g.phase === "Ended" ? `, ${g.winner} won` : ""}
          {mine ? `, you are seat ${g.mySeat + 1}` : ""}
          {out ? " (eliminated)" : ""}
        </span>
      </div>
      <Seals g={g} />
      {g.myTurn && <span className="turn">Your move</span>}
      <button className={`btn small ${g.myTurn ? "primary" : ""}`} onClick={() => onOpen(g.id)}>
        {label}
      </button>
    </li>
  );
}

export function Hub({
  client,
  busy,
  onOpen,
  onCreate,
  onSolo,
}: {
  client: ChainClient;
  busy: boolean;
  onOpen: (id: number) => void;
  onCreate: () => void;
  onSolo: () => void;
}) {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [idInput, setIdInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGames(await client.listGames(30));
      setErr("");
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const mine = (games ?? []).filter((g) => g.mySeat >= 0);
  const active = mine.filter((g) => g.phase !== "Ended");
  const done = mine.filter((g) => g.phase === "Ended");
  const open = (games ?? []).filter((g) => g.phase === "Lobby" && g.joined < 5 && g.mySeat < 0);
  const others = (games ?? []).filter((g) => g.mySeat < 0 && g.phase !== "Lobby" && g.phase !== "Ended");

  return (
    <section className="hub">
      <div className="hub-head">
        <div>
          <h2>Lobby</h2>
          <p className="hint" style={{ margin: 0 }}>
            Start a game, take a seat at an open table, or pick up one you are already in.
          </p>
        </div>
        <button className="btn small" onClick={load} disabled={loading} aria-label="Refresh the lists">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="quick">
        <button className="btn primary" disabled={busy} onClick={onSolo}>
          Play solo against 4 bots
        </button>
        <button className="btn" disabled={busy} onClick={onCreate}>
          Create a table
        </button>
        <form
          className="field join-by"
          onSubmit={(e) => {
            e.preventDefault();
            if (idInput) onOpen(Number(idInput));
          }}
        >
          <input
            inputMode="numeric"
            placeholder="Game number"
            aria-label="Game number"
            value={idInput}
            onChange={(e) => setIdInput(e.target.value.replace(/\D/g, ""))}
          />
          <button className="btn" disabled={!idInput}>
            Open
          </button>
        </form>
      </div>

      {err && (
        <div className="banner err" role="alert">
          <span>Could not load the games: {err}</span>
        </div>
      )}

      <div className="hub-grid">
        <div>
          <h3>Your games</h3>
          {games === null ? (
            <p className="empty">Looking for your games…</p>
          ) : active.length === 0 ? (
            <p className="empty">You are not in a game right now. Create a table, or take a seat at an open one.</p>
          ) : (
            <ul className="glist">
              {active.map((g) => (
                <Row key={g.id} g={g} onOpen={onOpen} label={g.myTurn ? "Play now" : "Resume"} />
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>Open tables</h3>
          {games === null ? (
            <p className="empty">Looking for open tables…</p>
          ) : open.length === 0 ? (
            <p className="empty">No open tables right now. Create one and share the link, or play solo.</p>
          ) : (
            <ul className="glist">
              {open.map((g) => (
                <Row key={g.id} g={g} onOpen={onOpen} label="Take a seat" />
              ))}
            </ul>
          )}
        </div>
      </div>

      {done.length > 0 && (
        <>
          <h3>Your finished games</h3>
          <ul className="glist">
            {done.map((g) => (
              <Row key={g.id} g={g} onOpen={onOpen} label="View" />
            ))}
          </ul>
        </>
      )}

      {others.length > 0 && (
        <>
          <h3>Games in progress you can watch</h3>
          <ul className="glist">
            {others.slice(0, 5).map((g) => (
              <Row key={g.id} g={g} onOpen={onOpen} label="Watch" />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
