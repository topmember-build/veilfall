export function Ledger() {
  return (
    <details className="card pad ledger">
      <summary>What stays secret?</summary>
      <p className="hint" style={{ marginTop: 10 }}>
        Veilfall would be impossible on a normal blockchain, where every value is public. Here the contract computes on
        encrypted data (Zama FHE) and never sees the secrets.
      </p>
      <div className="cols">
        <div className="enc">
          <h3>Encrypted, even from the contract</h3>
          <ul>
            <li>Every player&apos;s role until the game ends</li>
            <li>The Killer&apos;s target and the Doctor&apos;s save</li>
            <li>Which actions were real and which were decoys</li>
            <li>Every individual vote</li>
          </ul>
        </div>
        <div className="pub">
          <h3>Public</h3>
          <ul>
            <li>Who is seated, and who is alive</li>
            <li>Who has locked in this phase</li>
            <li>Who died, and the role they held</li>
            <li>The winner, then every role, verifiable by anyone</li>
          </ul>
        </div>
      </div>
    </details>
  );
}
