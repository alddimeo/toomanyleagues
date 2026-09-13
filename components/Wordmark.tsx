type WordmarkProps = { compact?: boolean };

export function Wordmark({ compact = false }: WordmarkProps) {
  return (
    <span className={`wordmark${compact ? " wordmark-compact" : ""}`} aria-label="Too Many Leagues">
      <span className="wordmark-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="wordmark-text">
        <strong>TOO MANY</strong>
        <em>LEAGUES</em>
      </span>
    </span>
  );
}
