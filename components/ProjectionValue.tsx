import type { NflGame } from "@/lib/nfl";
import { projectionPresentation } from "@/lib/projections";

export function ProjectionValue({ value, baseline, teamTotal = false, state }: { value?: number; baseline?: number; teamTotal?: boolean; state?: NflGame['state'] | 'bye' }) {
  const projection = projectionPresentation(value, baseline, state);
  const direction = projection.direction;
  return <span className={`projection-value ${teamTotal ? 'team-projection' : 'player-projection'}${direction > 0 ? ' projection-up' : direction < 0 ? ' projection-down' : ''}`}
    title={state === 'live' ? `Current ${teamTotal ? 'team ' : ''}projected fantasy points` : `Pregame ${teamTotal ? 'team ' : ''}projected fantasy points`}
    aria-label={direction ? `${direction > 0 ? 'Up' : 'Down'} from pregame projection: ${projection.value?.toFixed(2)}` : undefined}>
    {direction ? <span aria-hidden="true">{direction > 0 ? '▲' : '▼'}</span> : null}{projection.value?.toFixed(2) ?? '—'}
  </span>;
}
