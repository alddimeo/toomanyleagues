export function ProjectionValue({ value, baseline, teamTotal = false, held = false }: { value?: number; baseline?: number; teamTotal?: boolean; held?: boolean }) {
  const visible = held && baseline !== undefined ? baseline : value;
  const current = typeof visible === 'number' && Number.isFinite(visible) ? visible : null;
  const pregame = typeof baseline === 'number' && Number.isFinite(baseline) ? baseline : null;
  const change = current !== null && pregame !== null ? Math.round((current - pregame) * 100) / 100 : null;
  const adjusted = current?.toFixed(2) ?? '—';
  return <span className="projection-value" title={held ? "Pregame projection until kickoff" : teamTotal ? "Pregame and adjusted team projections" : "Projected fantasy points"}>
    <span>{teamTotal && current !== null && pregame !== null ? pregame.toFixed(2) : adjusted}</span>
    {change !== null && change !== 0 ? <span className={change > 0 ? 'projection-up' : 'projection-down'}
      aria-label={teamTotal ? `Adjusted projected total ${adjusted}, ${change > 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(2)} from pregame` : `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change).toFixed(2)} from pregame projection`}>
      {change > 0 ? '▲' : '▼'} {teamTotal ? adjusted : Math.abs(change).toFixed(2)}
    </span> : null}
  </span>;
}
