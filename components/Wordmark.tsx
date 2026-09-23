type WordmarkProps = { compact?: boolean };

export function Wordmark({ compact = false }: WordmarkProps) {
  return (
    <span className={`wordmark${compact ? " wordmark-compact" : ""}`} aria-label="Too Many Leagues">
      <span className="wordmark-mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" role="presentation">
          <path className="football-mark-shell" d="M10.2 32.1C5.9 25.5 8.9 14.8 17 8.7 25.1 2.6 35.4 3.2 39 8.7c3.7 5.5-.2 15-8.3 21.1-8 6-16 6.1-20.5 2.3Z" />
          <path className="football-mark-seam" d="M14.1 33.2c6.3-2.1 12.4-8.6 17.1-18.3" />
          <path className="football-mark-laces" d="m21.1 17.1 6.2 4.1m-8.8.1 6.2 4.1m-8.8.2 6.2 4.1" />
          <path className="football-mark-route" d="M5 39h13l-4-4m4 4-4 4" />
        </svg>
      </span>
      <span className="wordmark-text">
        <strong>TOO MANY</strong>
        <em>LEAGUES</em>
      </span>
    </span>
  );
}
