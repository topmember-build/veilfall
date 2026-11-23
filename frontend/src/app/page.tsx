"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChainClient, friendlyError } from "@/lib/chainClient";
import { MockClient } from "@/lib/mockClient";
import { SoloBots } from "@/lib/bots";
import { CONTRACT_ADDRESS, EXPLORER } from "@/lib/config";
import { shortAddr } from "@/lib/format";
import { GameClient } from "@/lib/types";
import { GameView } from "@/components/GameView";
import { Hub } from "@/components/Hub";
import { RulesModal } from "@/components/RulesModal";
import { discoverWallets, WalletOption } from "@/lib/wallets";

const gameFromUrl = (): number | null => {
  const g = Number(new URLSearchParams(window.location.search).get("game"));
  return Number.isInteger(g) && g > 0 ? g : null;
};

export default function Home() {
  const [client, setClient] = useState<GameClient | null>(null);
  const [gameId, setGameId] = useState<number | null>(null);
  const [invite, setInvite] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [rules, setRules] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [solo, setSolo] = useState(false);
  const [botNote, setBotNote] = useState("");
  const [picker, setPicker] = useState<{ wallets: WalletOption[]; resolve: (p: unknown) => void; reject: (e: Error) => void } | null>(null);
  const [seating, setSeating] = useState(false);
  const [seatError, setSeatError] = useState("");
  const [soloId, setSoloId] = useState<number | null>(null);
  const lantern = useRef<HTMLDivElement>(null);
  const botsRef = useRef<SoloBots | null>(null);
  const lastPointer = useRef(0);

  // The title is only lit where the pointer moves, like a lantern in the dark.
  const aim = (x: number, y: number) => {
    const el = lantern.current;
    if (!el) return;
    lastPointer.current = Date.now();
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${x - r.left}px`);
    el.style.setProperty("--my", `${y - r.top}px`);
  };

  // With no pointer (phones, or an idle mouse) the lantern drifts across the title on its own.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const loop = (t: number) => {
      const el = lantern.current;
      if (el && Date.now() - lastPointer.current > 2500) {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${r.width * (0.36 + 0.3 * Math.sin(t / 2600))}px`);
        el.style.setProperty("--my", `${r.height * (0.5 + 0.3 * Math.sin(t / 1900 + 1))}px`);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // An invite link looks like  /?game=7 . The browser's Back button walks through games and the lobby.
  useEffect(() => {
    setInvite(gameFromUrl());
    const onPop = () => setGameId(gameFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const open = useCallback((id: number | null) => {
    setGameId(id);
    window.history.pushState(null, "", id ? `?game=${id}` : window.location.pathname);
    window.scrollTo({ top: 0 });
  }, []);

  const disconnect = useCallback(() => {
    botsRef.current?.stop();
    botsRef.current = null;
    setClient(null);
    setGameId(null);
    setInvite(null);
    setSolo(false);
    setMenu(false);
    window.history.pushState(null, "", window.location.pathname);
  }, []);

  // Leaving a game goes back to the lobby; leaving the offline demo goes home.
  const leave = useCallback(() => {
    if (client?.mode === "chain") open(null);
    else disconnect();
  }, [client, open, disconnect]);

  const start = async (c: GameClient, createNow: boolean) => {
    setBusy(true);
    setError("");
    c.setStatusListener(setStatus);
    try {
      await c.connect();
      setClient(c);
      if (createNow) open(await c.createGame());
      else if (invite) open(invite);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const guarded = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  // Opens a game and, if its opponents are our solo bots, plays their moves from this browser.
  useEffect(() => {
    if (!client || client.mode !== "chain" || gameId === null) return;
    const bots = botsRef.current ?? new SoloBots(client as ChainClient, setBotNote);
    botsRef.current = bots;
    let cancelled = false;
    bots
      .attach(gameId)
      .then((isSolo) => !cancelled && setSolo(isSolo))
      .catch(() => {});
    return () => {
      cancelled = true;
      bots.stop();
      setSolo(false);
      setBotNote("");
    };
  }, [client, gameId]);

  // Seats the four opponents (safe to repeat) and then starts them playing.
  const seatBots = async (id: number) => {
    const bots = botsRef.current;
    if (!bots) return;
    setSoloId(id);
    setSeating(true);
    setSeatError("");
    try {
      await bots.joinAll(id);
      setSolo(await bots.attach(id));
    } catch (e) {
      setSeatError(friendlyError(e));
    } finally {
      setSeating(false);
    }
  };

  // Finds the wallets in this browser; asks which one to use when there is more than one.
  const chooseWallet = async (): Promise<unknown> => {
    const wallets = await discoverWallets();
    if (wallets.length === 0) {
      throw new Error(
        "No wallet found. Install MetaMask or OKX Wallet, make sure it is enabled for this site (and for private windows if you use one), then refresh.",
      );
    }
    if (wallets.length === 1) return wallets[0].provider;
    return new Promise((resolve, reject) => setPicker({ wallets, resolve, reject }));
  };

  const connectChain = async () => {
    setBusy(true);
    setError("");
    try {
      await start(new ChainClient(await chooseWallet()), false);
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  };

  const startSolo = async () => {
    const existing = client?.mode === "chain" ? (client as ChainClient) : null;
    setBusy(true);
    setError("");
    try {
      const chain: ChainClient = existing ?? new ChainClient(await chooseWallet());
      chain.setStatusListener(setStatus);
      if (!existing) {
        await chain.connect();
        setClient(chain);
      }
      const bots = new SoloBots(chain, (m) => {
        setStatus(m);
        setBotNote(m);
      });
      botsRef.current = bots;
      await bots.ensureFunded();
      const id = await chain.createGame();
      // Open the table straight away; the opponents sit down in the background.
      open(id);
      void seatBots(id);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(client?.address ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard can be blocked; nothing else to do */
    }
  };

  const isMock = client?.mode === "mock";
  const inLobby = client?.mode === "chain" && gameId === null;

  return (
    <main className="wrap">
      <header className="topbar">
        <button className="brand" onClick={() => (client?.mode === "chain" ? open(null) : client ? leave() : undefined)} aria-label="Veilfall home">
          <span className="mark">Veilfall</span>
          <span className="sub">mafia with no host</span>
        </button>
        <nav className="nav" aria-label="Main">
          {client?.mode === "chain" && (
            <button className={`navlink ${inLobby ? "on" : ""}`} onClick={() => open(null)}>
              Lobby
            </button>
          )}
          <button className="navlink" onClick={() => setRules(true)}>
            How to play
          </button>
          {isMock && (
            <>
              <span className="pill sim">
                <span className="dot" aria-hidden="true" />
                Simulation, not on-chain
              </span>
              <button className="navlink" onClick={disconnect}>
                Exit demo
              </button>
            </>
          )}
          {client?.mode === "chain" && (
            <div className="menuwrap">
              <button className="pill" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                <span className="dot" aria-hidden="true" />
                Sepolia, {shortAddr(client.address ?? "")}
              </button>
              {menu && (
                <div className="menu card" role="menu" onMouseLeave={() => setMenu(false)}>
                  <button role="menuitem" onClick={copyAddress}>
                    {copied ? "Copied" : "Copy my address"}
                  </button>
                  <a role="menuitem" href={`${EXPLORER}/address/${client.address}`} target="_blank" rel="noreferrer">
                    View my wallet on Etherscan
                  </a>
                  <a role="menuitem" href={`${EXPLORER}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">
                    View the game contract
                  </a>
                  <button role="menuitem" onClick={disconnect}>
                    Disconnect and go home
                  </button>
                </div>
              )}
            </div>
          )}
        </nav>
      </header>

      {error && (
        <div className="banner err" role="alert">
          <span>{error}</span>
          <button className="btn small ghost" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}
      {busy && status && (
        <div className="banner busy" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>{status}</span>
        </div>
      )}

      {!client && (
        <>
          <section className="hero" onPointerMove={(e) => aim(e.clientX, e.clientY)}>
            <div className="orbit" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} className="orb" style={{ ["--i" as string]: n - 1 }}>
                  <span className="avatar">{n}</span>
                </span>
              ))}
              <span className="orbit-core">?</span>
            </div>
            <div className="lantern" ref={lantern}>
              <h1>Veilfall</h1>
              <h1 className="lit" aria-hidden="true">
                Veilfall
              </h1>
            </div>
            <p className="lead">Mafia needs a host who knows every role. Here the host is a contract that can&apos;t peek.</p>
            <p className="lead" style={{ fontSize: 17, color: "var(--muted)" }}>
              Roles, night moves and votes stay encrypted on-chain with Zama. Only the outcome ever comes to light.
            </p>
            {invite && <p className="note">You&apos;ve been invited to game #{invite}. Connect to take your seat.</p>}
            <div className="cta-row">
              <button className="btn primary" disabled={busy} onClick={startSolo}>
                Play solo against 4 bots
              </button>
              <button className="btn" disabled={busy} onClick={connectChain}>
                {invite ? `Join game #${invite}` : "Open the lobby"}
              </button>
              <button className="btn ghost" disabled={busy} onClick={() => start(new MockClient(), true)}>
                Try the simulated demo
              </button>
            </div>
            <p className="note">
              Both real modes need a browser wallet (MetaMask, OKX Wallet or similar) with a little Sepolia ETH. Solo mode asks for one transfer to fund your
              opponents. The demo needs nothing and is not on-chain.
            </p>
          </section>

          <section className="how" aria-label="How it works">
            <div className="step">
              <h3>Seal</h3>
              <p>Five players sit down. The contract deals secret roles with encrypted randomness. Not even it knows who is who.</p>
            </div>
            <div className="step">
              <h3>Act in the dark</h3>
              <p>Every night, everyone acts, even harmless Villagers. The contract applies only the Killer&apos;s and Doctor&apos;s moves.</p>
            </div>
            <div className="step">
              <h3>Reveal</h3>
              <p>Only the outcome comes to light. When the game ends, anyone can verify every role was dealt fairly.</p>
            </div>
          </section>
        </>
      )}

      {inLobby && (
        <Hub client={client as ChainClient} busy={busy} onOpen={open} onCreate={() => guarded(async () => open(await (client as ChainClient).createGame()))} onSolo={startSolo} />
      )}

      {(seating || seatError) && gameId !== null && gameId === soloId && (
        <div className={`banner ${seatError ? "err" : ""}`} role="status">
          {seating && <span className="spinner" aria-hidden="true" />}
          <span>
            {seating
              ? `Seating your opponents. This can take up to a minute. ${botNote}`
              : `The opponents could not all sit down: ${seatError}`}
          </span>
          {!seating && (
            <button className="btn small" onClick={() => seatBots(gameId)}>
              Try again
            </button>
          )}
        </div>
      )}

      {solo && (
        <div className="banner" role="status">
          <span>
            Solo table: your four opponents are real wallets playing on Sepolia from this browser. Keep this tab open.
            {botNote ? ` ${botNote}` : ""}
          </span>
        </div>
      )}

      {client && gameId !== null && (
        <GameView
          key={`${client.mode}-${gameId}`}
          client={client}
          id={gameId}
          onExit={leave}
          exitLabel={client.mode === "chain" ? "Back to the lobby" : "Back to home"}
          onRules={() => setRules(true)}
        />
      )}

      <RulesModal open={rules} onClose={() => setRules(false)} />

      {picker && (
        <div
          className="modal-back"
          onClick={() => {
            picker.reject(new Error("Wallet selection cancelled."));
            setPicker(null);
          }}
        >
          <div className="modal card" role="dialog" aria-modal="true" aria-label="Choose a wallet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Choose a wallet</h2>
              <button
                className="btn small"
                onClick={() => {
                  picker.reject(new Error("Wallet selection cancelled."));
                  setPicker(null);
                }}
              >
                Cancel
              </button>
            </div>
            <p className="hint">More than one wallet is installed in this browser. Pick the one that holds your Sepolia ETH.</p>
            <ul className="glist">
              {picker.wallets.map((w) => (
                <li key={w.id} className="grow">
                  {w.icon ? <img className="wicon" src={w.icon} alt="" /> : <span className="wicon" aria-hidden="true" />}
                  <div className="gmain">
                    <b>{w.name}</b>
                  </div>
                  <button
                    className="btn small primary"
                    onClick={() => {
                      picker.resolve(w.provider);
                      setPicker(null);
                    }}
                  >
                    Connect
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <footer className="footer">
        Built on the{" "}
        <a href="https://www.zama.org" target="_blank" rel="noreferrer">
          Zama Protocol
        </a>{" "}
        (fully homomorphic encryption) ·{" "}
        <a href={`${EXPLORER}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">
          Contract on Sepolia ↗
        </a>
      </footer>
    </main>
  );
}
