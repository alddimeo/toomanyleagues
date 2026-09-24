export function ProjectionValue({ value, baseline }: { value?: number; baseline?: number }) {
  const valid = typeof value === 'number' && Number.isFinite(value);
  const change = valid && typeof baseline === 'number' && Number.isFinite(baseline)
    ? Math.round((value - baseline) * 100) / 100 : null;
  return <span className="projection-value" title="Projected fantasy points">
    <span>{valid ? value.toFixed(2) : '—'}</span>
    {change !== null && change !== 0 ? <span className={change > 0 ? 'projection-up' : 'projection-down'}
      aria-label={`${change > 0 ? 'Up' : 'Down'} ${Math.abs(change).toFixed(2)} from pregame projection`}>
      {change > 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}
    </span> : null}
  </span>;
}
