"use client";

import { useEffect, useRef } from "react";

export function RulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="rules-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="rules-title">How to play Veilfall</h2>
          <button ref={closeRef} className="btn small" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="hint">
          Five players, no host. A smart contract runs the game and never sees a secret. Find the Killer before the Killer
          finds you.
        </p>
        <div className="rules">
          <div>
            <h3>Roles</h3>
            <ul>
              <li>
                <b>Killer</b> (1): kills one player each night. Wins when only two players are left.
              </li>
              <li>
                <b>Doctor</b> (1): protects one player each night. If it is the Killer&apos;s target, nobody dies.
              </li>
              <li>
                <b>Villagers</b> (3): no power, but they win by voting the Killer out.
              </li>
            </ul>
          </div>
          <div>
            <h3>Each round</h3>
            <ol>
              <li>
                <b>Night.</b> Every living player locks in a target, even Villagers (their pick is a decoy). That way nobody
                can tell who matters.
              </li>
              <li>
                <b>Reveal.</b> The result is sealed. Anyone can press Reveal; it takes about half a minute on Sepolia. Whoever
                died is shown with their role.
              </li>
              <li>
                <b>Day.</b> Everyone votes someone out. Votes are secret and a tie eliminates nobody.
              </li>
              <li>
                <b>Reveal again,</b> then the next night begins.
              </li>
            </ol>
          </div>
          <div>
            <h3>Good to know</h3>
            <ul>
              <li>Your role is private. Press Reveal my role and sign a free message to read it.</li>
              <li>Keep the tab open on your turn. The page shows Your move in the tab title.</li>
              <li>If someone goes quiet, anyone can resolve the phase after 10 minutes.</li>
              <li>When the game ends, anyone can verify that every role was dealt fairly.</li>
              <li>Invite friends with the game link. You need five wallets on Sepolia, or play solo against bots.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
