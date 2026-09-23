import Link from "next/link";
import type { LeagueSnapshot, Player, Team } from "@/lib/types";

export function leagueHref(league: Pick<LeagueSnapshot, "provider" | "id" | "season">) {
  return `/dashboard/leagues/${league.provider}/${encodeURIComponent(league.id)}?season=${league.season}`;
}

export function teamHref(league: Pick<LeagueSnapshot, "provider" | "id" | "season">, teamId: string) {
  return `/dashboard/teams/${league.provider}/${encodeURIComponent(league.id)}/${encodeURIComponent(teamId)}?season=${league.season}`;
}

export function formatPoints(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

function safeImageUrl(value: string | undefined) {
  if (!value || !/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

function initials(value: string) {
  return value.trim().split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

export function TeamLogo({ team }: { team: Team }) {
  const logo = safeImageUrl(team.logo);
  return logo
    ? <span className="team-logo-wrap"><img className="team-logo" src={logo} alt={`${team.name} logo`} loading="eager" decoding="async" onError={(event) => { event.currentTarget.hidden = true; const fallback = event.currentTarget.nextElementSibling; if (fallback instanceof HTMLElement) fallback.hidden = false; }} /><span className="team-avatar" hidden aria-hidden="true">{initials(team.name)}</span></span>
    : <span className="team-avatar" aria-hidden="true">{initials(team.name)}</span>;
}

function PlayerHeadshot({ player }: { player: Player }) {
  const image = safeImageUrl(player.headshot);
  return image
    ? <span className="player-headshot-wrap"><img className="player-headshot" src={image} alt={`${player.name} headshot`} loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; const fallback = event.currentTarget.nextElementSibling; if (fallback instanceof HTMLElement) fallback.hidden = false; }} /><span className="player-headshot-fallback" hidden aria-hidden="true">{initials(player.name)}</span></span>
    : <span className="player-headshot-fallback" aria-hidden="true">{initials(player.name)}</span>;
}

function NflTeamMark({ player }: { player: Player }) {
  const logo = safeImageUrl(player.nflTeamLogo);
  if (logo) return <span className="player-team-mark" title={player.nflTeam || undefined}><img src={logo} alt={`${player.nflTeam || player.name} logo`} loading="eager" decoding="async" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; const fallback = event.currentTarget.nextElementSibling; if (fallback instanceof HTMLElement) fallback.hidden = false; }} /><span hidden aria-hidden="true">{player.nflTeam || player.position || "—"}</span></span>;
  return <span className="player-team-mark" title={player.nflTeam || undefined}>{player.nflTeam || player.position || "—"}</span>;
}

function TeamScore({ league, team, fallback }: { league: LeagueSnapshot; team: Team | undefined; fallback: string }) {
  const content = <div className="team-score"><span className="team-score-logo">{team ? <TeamLogo team={team} /> : <span className="team-avatar">{initials(fallback)}</span>}</span><span><strong>{team?.name ?? fallback}</strong><small>{team?.players?.length ?? 0} rostered players</small></span><b>{formatPoints(team?.points)}</b></div>;
  return team ? <Link className="team-score-link" href={teamHref(league, team.id)}>{content}</Link> : content;
}

function ScoreTeam({ team, fallback, isUser = false }: { team: Team | undefined; fallback: string; isUser?: boolean }) {
  return <div className={`personal-score-team${isUser ? " is-user" : ""}`}><span className="personal-score-logo">{team ? <TeamLogo team={team} /> : <span className="team-avatar">{initials(fallback)}</span>}</span><span><small>{isUser ? "YOUR TEAM" : "OPPONENT"}</small><strong>{team?.name ?? fallback}</strong></span><b>{formatPoints(team?.points)}</b></div>;
}

function isBench(player: Player) {
  return /^(BE|BN|BENCH|IR)$/i.test(player.slot.trim());
}

function LineupPlayer({ player }: { player: Player }) {
  return <div className="lineup-player"><PlayerHeadshot player={player} /><span className="lineup-player-copy"><strong>{player.name}</strong><small>{player.slot || "START"} · {player.position || "—"}</small></span><NflTeamMark player={player} /><b>{formatPoints(player.points)}</b></div>;
}

function TeamLineup({ league, team }: { league: LeagueSnapshot; team: Team }) {
  const players = team.players ?? [];
  const starters = players.filter((player) => !isBench(player));
  const bench = players.filter(isBench);
  const visible = starters.length ? starters : players;
  const hiddenBench = starters.length ? bench : [];
  return <section className="lineup-panel" aria-label={`${team.name} lineup`}>
    <div className="lineup-panel-head"><Link className="lineup-team-link" href={teamHref(league, team.id)}><TeamLogo team={team} /><span><small>LINEUP</small><strong>{team.name}</strong><em>{players.length} rostered players</em></span></Link><b>{formatPoints(team.points)}</b></div>
    {visible.length ? <div className="lineup-players">{visible.map((player) => <LineupPlayer key={player.id} player={player} />)}</div> : <p className="lineup-empty">No players in this snapshot.</p>}
    {hiddenBench.length ? <details className="lineup-bench"><summary>Bench <span>{hiddenBench.length} players</span></summary><div className="lineup-players">{hiddenBench.map((player) => <LineupPlayer key={player.id} player={player} />)}</div></details> : null}
  </section>;
}

function PersonalMatchupCard({ league, index, userTeam, opponent }: { league: LeagueSnapshot; index: number; userTeam: Team; opponent: Team | undefined }) {
  return <article className="matchup-card dashboard-matchup-card lineup-card">
    <Link className="matchup-card-league" href={leagueHref(league)}>
      <span className={`league-provider provider-${league.provider}`}>{league.provider === "espn" ? "E" : "Y!"}</span>
      <span><strong>{league.name}</strong><small>{league.provider.toUpperCase()} · WEEK {league.week || "—"}</small></span>
      <span aria-hidden="true">→</span>
    </Link>
    <div className="matchup-card-top"><span>WEEK {league.week || "—"} · MATCHUP {index + 1}</span><span className="matchup-live-mark"><i /> {opponent ? "CURRENT" : "BYE"}</span></div>
    <div className="personal-scoreboard"><ScoreTeam team={userTeam} fallback="Your team" isUser /><span className="personal-score-vs">{opponent ? "VS" : "BYE"}</span><ScoreTeam team={opponent} fallback="Bye week" /></div>
    <TeamLineup league={league} team={userTeam} />
    <div className="matchup-card-foot"><span>{userTeam.players?.length ?? 0} players visible</span><span>{opponent ? `${opponent.name} · ${formatPoints(opponent.points)}` : "No opponent"}</span></div>
  </article>;
}

function MatchupCard({ league, matchup, index, personalOnly }: { league: LeagueSnapshot; matchup: LeagueSnapshot["matchups"][number]; index: number; personalOnly: boolean }) {
  const teamById = new Map(league.teams.map((team) => [team.id, team]));
  const home = teamById.get(matchup.home);
  const away = matchup.away ? teamById.get(matchup.away) : undefined;
  const userTeam = personalOnly ? league.teams.find((team) => team.isUserTeam) : undefined;
  if (userTeam) {
    const opponentId = matchup.home === userTeam.id ? matchup.away : matchup.home;
    return <PersonalMatchupCard league={league} index={index} userTeam={userTeam} opponent={opponentId ? teamById.get(opponentId) : undefined} />;
  }
  return <article className="matchup-card dashboard-matchup-card">
    <Link className="matchup-card-league" href={leagueHref(league)}>
      <span className={`league-provider provider-${league.provider}`}>{league.provider === "espn" ? "E" : "Y!"}</span>
      <span><strong>{league.name}</strong><small>{league.provider.toUpperCase()} · WEEK {league.week || "—"}</small></span>
      <span aria-hidden="true">→</span>
    </Link>
    <div className="matchup-card-top"><span>MATCHUP {index + 1}</span><span>{away ? "SCORE SNAPSHOT" : "BYE"}</span></div>
    <TeamScore league={league} team={home} fallback={matchup.home} />
    <div className="versus"><span>VS</span></div>
    {away ? <TeamScore league={league} team={away} fallback={matchup.away ?? "Away team"} /> : <div className="bye-team"><span className="bye-mark">—</span><div><strong>Bye week</strong><small>No opponent listed</small></div></div>}
    <div className="matchup-card-foot"><span>{home?.players?.length ?? 0} players</span><span>{away?.players?.length ?? 0} players</span></div>
  </article>;
}

export function MatchupGrid({ leagues, personalOnly = false }: { leagues: LeagueSnapshot[]; personalOnly?: boolean }) {
  const cards = leagues.flatMap((league) => {
    const userTeam = personalOnly ? league.teams.find((team) => team.isUserTeam) : undefined;
    const matchups = personalOnly && userTeam ? league.matchups.filter((matchup) => matchup.home === userTeam.id || matchup.away === userTeam.id) : personalOnly ? [] : league.matchups ?? [];
    return matchups.map((matchup, index) => ({ league, matchup, index }));
  });
  if (!cards.length) return <div className="empty-inline"><span>◌</span><div><strong>{personalOnly ? "No personal matchup snapshots yet" : "No league matchups yet"}</strong><p>{personalOnly ? "Refresh your connected leagues to load your current matchup." : "Connect a source to add leagues and see this week’s scores."}</p><Link className="text-link" href="/dashboard/connections">Open connections</Link></div></div>;
  return <div className="matchup-rail"><div className="matchup-scroll-cue" aria-hidden="true"><span>HORIZONTAL SCROLL</span><strong>SWIPE OR DRAG FOR MORE LEAGUES</strong><b>→</b></div><div className="matchup-grid dashboard-matchup-grid" role="region" aria-label="League matchups; scroll horizontally for more" tabIndex={0}>{cards.map(({ league, matchup, index }) => <MatchupCard key={`${league.provider}-${league.id}-${matchup.home}-${matchup.away ?? "bye"}-${index}`} league={league} matchup={matchup} index={index} personalOnly={personalOnly} />)}</div></div>;
}

export function TeamRoster({ team }: { team: Team }) {
  return <div className="roster-view"><div className="view-intro"><p>ROSTER SNAPSHOT</p><span>{team.players?.length ?? 0} players</span></div>{team.players?.length ? <div className="roster-card"><div className="roster-table-wrap"><table className="roster-table"><thead><tr><th scope="col">Player</th><th scope="col">Slot</th><th scope="col">Points</th><th scope="col">Stats</th></tr></thead><tbody>{team.players.map((player) => <PlayerRow key={player.id} player={player} />)}</tbody></table></div></div> : <div className="empty-inline"><span>◌</span><div><strong>No roster data in this snapshot</strong><p>Refresh the league after the provider returns the team roster.</p></div></div>}</div>;
}

function PlayerRow({ player }: { player: Player }) {
  const stats = Object.entries(player.stats ?? {});
  return <tr><td><span className="roster-player"><PlayerHeadshot player={player} /><span><strong>{player.name}</strong><small>{player.position}</small></span></span></td><td>{player.slot || "—"}</td><td className="player-points">{formatPoints(player.points)}</td><td>{stats.length ? <details className="player-stats"><summary>View</summary><dl>{stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl></details> : <span className="muted-dash">—</span>}</td></tr>;
}
