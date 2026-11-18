import { HistoryItem } from "@/lib/types";
import { describeHistory } from "@/lib/format";

export function Timeline({ history }: { history: HistoryItem[] }) {
  const lines = describeHistory(history);
  return (
    <section className="card pad" aria-label="What has happened">
      <h2>The story so far</h2>
      {lines.length === 0 ? (
        <p className="empty">Nothing has happened yet. Every result appears here once it is revealed.</p>
      ) : (
        <ol className="timeline">
          {lines.map((l, i) => (
            <li key={i}>
              <span className="ico" aria-hidden="true">
                {l.icon}
              </span>
              <span>
                <span className="when">{l.when}</span>
                {l.text}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
