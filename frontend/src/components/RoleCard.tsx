import { RoleName } from "@/lib/types";
import { ROLE_BLURB, ROLE_GLYPH } from "@/lib/format";

export function RoleCard({
  role,
  canReveal,
  busy,
  onReveal,
  spectator,
}: {
  role: RoleName | null;
  canReveal: boolean;
  busy: boolean;
  onReveal: () => void;
  spectator: boolean;
}) {
  return (
    <section className="card rolecard" aria-label="Your role">
      <div className={`face ${role ?? ""}`} aria-hidden="true">
        {role ? ROLE_GLYPH[role] : "?"}
      </div>
      {role ? (
        <>
          <h2>You are the {role}</h2>
          <p>{ROLE_BLURB[role]}</p>
        </>
      ) : spectator ? (
        <>
          <h2>Spectating</h2>
          <p>You are not seated at this table. You can watch, and verify the deal when the game ends.</p>
        </>
      ) : (
        <>
          <h2>Your role is sealed</h2>
          <p>
            It is dealt by encrypted on-chain randomness. Only you can unlock it, with a free signature from your wallet.
          </p>
          <div style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={onReveal} disabled={!canReveal || busy}>
              Reveal my role
            </button>
          </div>
        </>
      )}
    </section>
  );
}
