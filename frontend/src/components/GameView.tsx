"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlyError } from "@/lib/chainClient";
import { GameClient, GameState, HistoryItem, NOBODY, RoleName } from "@/lib/types";
import { Table } from "./Table";
import { RoleCard } from "./RoleCard";
import { Actions } from "./Actions";
import { Timeline } from "./Timeline";
import { Ledger } from "./Ledger";

export function GameView({
  client,
  id,
  onExit,
  exitLabel,
  onRules,
}: {
  client: GameClient;
  id: number;
  onExit: () => void;
  exitLabel: string;
  onRules: () => void;
}) {
  const [state, setState] = useState<GameState | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [role, setRole] = useState<RoleName | null>(null);
  const [verified, setVerified] = useState<RoleName[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const historyKey = useRef("");

  useEffect(() => {
    client.setStatusListener(setStatus);
  }, [client]);

  const refresh = useCallback(async () => {
    try {
      const s = await client.getState(id);
      setState(s);
      setLoadError("");
      const key = `${s.phase}|${s.round}|${s.alive.join()}|${s.lastDeadSeat}`;
      if (key !== historyKey.current) {
        historyKey.current = key;
        setHistory(await client.getHistory(id));
      }
    } catch (e) {
      setLoadError(friendlyError(e));
    }
  }, [client, id]);

  // Poll the game; fast in the simulation, gentle on the real network.
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, client.mode === "mock" ? 700 : 4000);
    return () => clearInterval(t);
  }, [client, refresh]);

  // If this browser already unlocked the role earlier, show it without asking again.
  useEffect(() => {
    if (!role && state && state.mySeat >= 0 && state.phase !== "Lobby") {
      const cached = client.peekMyRole(id);
      if (cached) setRole(cached);
    }
  }, [client, id, role, state]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError("");
      try {
        await fn();
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setBusy(false);
        setStatus("");
        refresh();
      }
    },
    [refresh],
  );

  // Roles everyone may see: the dead (revealed on death) and, after verification, everyone.
  const known = useMemo<(RoleName | null)[]>(() => {
    if (verified) return verified;
    const k: (RoleName | null)[] = Array(5).fill(null);
    for (const h of history) if (h.kind === "died" && h.seat !== undefined && h.seat !== NOBODY) k[h.seat] = h.role ?? null;
    return k;
  }, [history, verified]);

  // The whole page turns with the game: day is a pale veil, everything else is night.
  const theme = state?.phase === "Day" || state?.phase === "DayReveal" ? "day" : "night";
  const prevTheme = useRef<string | null>(null);
  const [sweep, setSweep] = useState(0);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (prevTheme.current && prevTheme.current !== theme) setSweep((n) => n + 1);
    prevTheme.current = theme;
  }, [theme]);
  useEffect(() => () => { document.documentElement.dataset.theme = "night"; }, []);

  const myTurn =
    !!state &&
    state.mySeat >= 0 &&
    state.alive[state.mySeat] &&
    (state.phase === "Night" || state.phase === "Day") &&
    !state.hasActed[state.mySeat];
  useEffect(() => {
    const base = "Veilfall";
    document.title = myTurn ? "(!) Your move · Veilfall" : base;
    return () => {
      document.title = base;
    };
  }, [myTurn]);

  const [copied, setCopied] = useState(false);
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?game=${id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked */
    }
  };

  if (!state) {
    return (
      <div className="card pad" role="status">
        {loadError ? (
          <>
            <h2>Could not open game #{id}</h2>
            <p className="hint">{loadError}</p>
            <button className="btn" onClick={onExit}>
              {exitLabel}
            </button>
          </>
        ) : (
          <p className="hint" style={{ margin: 0 }}>
            Opening game #{id}…
          </p>
        )}
      </div>
    );
  }

  const joined = state.mySeat >= 0;
  const phaseClass = state.phase === "Night" ? "night" : state.phase === "Day" ? "day" : state.phase === "Ended" ? "end" : "";
  const phaseLabel: Record<string, string> = {
    Lobby: "Lobby",
    Night: `Night ${state.round + 1}`,
    NightReveal: "Dawn is sealed",
    Day: `Day ${state.round + 1}`,
    DayReveal: "Verdict sealed",
    Ended: "Game over",
  };

  return (
    <div>
      {sweep > 0 && <div key={sweep} className="curtain" aria-hidden="true" />}
      <button className="backlink" onClick={onExit}>
        ← {exitLabel}
      </button>
      <div className="statusbar">
        <span className={`phase-pill ${phaseClass}`}>{phaseLabel[state.phase]}</span>
        <span className="pill mono">Game #{id}</span>
        {myTurn && <span className="turn">Your move</span>}
        {client.mode === "chain" && (
          <button className="pill" onClick={copyInvite}>
            {copied ? "Link copied" : "Copy invite link"}
          </button>
        )}
        <button className="pill" onClick={onRules}>
          Rules
        </button>
        {client.lastTxUrl && (
          <a className="pill" href={client.lastTxUrl} target="_blank" rel="noreferrer">
            Last transaction ↗
          </a>
        )}
      </div>

      {(busy || status) && (
        <div className="banner busy" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>{status || "Working…"}</span>
        </div>
      )}
      {error && (
        <div className="banner err" role="alert">
          <span>{error}</span>
        </div>
      )}
      {loadError && (
        <div className="banner err" role="alert">
          <span>Having trouble reaching the network: {loadError}. Retrying…</span>
        </div>
      )}

      <div className="game">
        <div className="stack">
          <section className="card pad" aria-label="Table">
            <Table state={state} known={known} />
          </section>
          <Actions
            state={state}
            role={role}
            busy={busy}
            verified={verified}
            onJoin={() => run(() => client.join(id))}
            onNight={(seat) => run(() => client.submitNight(id, seat))}
            onVote={(seat) => run(() => client.submitVote(id, seat))}
            onReveal={() => run(() => client.reveal(id))}
            onForce={() => run(() => client.forceResolve(id))}
            onVerify={() => run(async () => setVerified(await client.verifyRoles(id)))}
            onAgain={onExit}
          />
        </div>
        <div className="stack">
          {state.phase !== "Lobby" && (
            <RoleCard
              role={role}
              spectator={!joined}
              busy={busy}
              canReveal={joined}
              onReveal={() => run(async () => setRole(await client.getMyRole(id)))}
            />
          )}
          <Timeline history={history} />
          <Ledger />
        </div>
      </div>
    </div>
  );
}
