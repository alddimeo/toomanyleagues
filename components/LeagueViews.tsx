"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LeagueSnapshot, Player, Team } from "@/lib/types";
import { nflTeamLogoUrl } from "@/lib/nfl";
import { playerStatsWithDefaults } from "@/lib/player-stats";
import { PlayerDetailsButton, PlayerGameStatus } from "@/components/PlayerDetails";
import { ProjectionValue } from "@/components/ProjectionValue";
import { isBench } from "@/lib/projections";

export function leagueHref(league: Pick<LeagueSnapshot, "provider" | "id" | "season">) {
  return `/dashboard/leagues/${league.provider}/${encodeURIComponent(league.id)}?season=${league.season}`;
}

export function teamHref(league: Pick<LeagueSnapshot, "provider" | "id" | "season">, teamId: string) {
  return `/dashboard/teams/${league.provider}/${encodeURIComponent(league.id)}/${encodeURIComponent(teamId)}?season=${league.season}`;
}

export function formatPoints(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

function safeImageUrl(value: string | undefined, espnTeamLogo = false) {
  if (espnTeamLogo && value && /^\/api\/espn\/team-logo\/[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)) return value;
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
  const logo = safeImageUrl(team.logo, true);
  return logo
    ? <span className="team-logo-wrap"><img className="team-logo" src={logo} alt={`${team.name} logo`} loading="eager" decoding="async" onError={(event) => { event.currentTarget.hidden = true; const fallback = event.currentTarget.nextElementSibling; if (fallback instanceof HTMLElement) fallback.hidden = false; }} /><span className="team-avatar" hidden aria-hidden="true">{initials(team.name)}</span></span>
    : <span className="team-avatar" aria-hidden="true">{initials(team.name)}</span>;
}

function LeagueMark({ league }: { league: LeagueSnapshot }) {
  const logo = safeImageUrl(league.logo);
  const mark = league.provider === "espn" ? "E" : "Y!";
  return <span className={`league-provider provider-${league.provider}${logo ? " league-provider-logo" : ""}`}>
    {logo ? <><img className="league-logo" src={logo} alt={`${league.name} logo`} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.hidden = true; const fallback = event.currentTarget.nextElementSibling; if (fallback instanceof HTMLElement) fallback.hidden = false; }} /><span hidden aria-hidden="true">{mark}</span></> : mark}
  </span>;
}

export function LeagueBanner({ league }: { league: LeagueSnapshot }) {
  return <Link className="matchup-card-league" href={leagueHref(league)}>
    <LeagueMark league={league} />
    <span><strong>{league.name}</strong><small>{league.provider.toUpperCase()}</small></span>
    <span aria-hidden="true">→</span>
  </Link>;
}

function PlayerHeadshot({ player }: { player: Player }) {
  const image = safeImageUrl(player.headshot);
  return image
    ? <span className="player-headshot-wrap"><img className="player-headshot" src={image} alt={`${player.name} headshot`} loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; const fallback = event.currentTarget.nextElementSibling; if (fallback instanceof HTMLElement) fallback.hidden = false; }} /><span className="player-headshot-fallback" hidden aria-hidden="true">{initials(player.name)}</span></span>
    : <span className="player-headshot-fallback" aria-hidden="true">{initials(player.name)}</span>;
}

function NflTeamMark({ player }: { player: Player }) {
  const logo = nflTeamLogoUrl(player.nflTeam) || safeImageUrl(player.nflTeamLogo);
  if (logo) return <span className="player-team-mark" title={player.nflTeam || undefined}><img src={logo} alt={`${player.nflTeam || player.name} logo`} loading="eager" decoding="async" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; const fallback = event.currentTarget.nextElementSibling; if (fallback instanceof HTMLElement) fallback.hidden = false; }} /><span hidden aria-hidden="true">{player.nflTeam || player.position || "—"}</span></span>;
  return <span className="player-team-mark" title={player.nflTeam || undefined}>{player.nflTeam || player.position || "—"}</span>;
}

function ScoreTeam({ league, team, fallback, label, away = false, link = true }: { league: LeagueSnapshot; team: Team | undefined; fallback: string; label?: string; away?: boolean; link?: boolean }) {
  return <div className={`personal-score-team${away ? " is-away" : ""}`}><span className="personal-score-logo">{team ? <TeamLogo team={team} /> : <span className="team-avatar">{initials(fallback)}</span>}</span><span>{label ? <small>{label}</small> : null}<strong>{team ? link ? <Link href={teamHref(league, team.id)}>{team.name}</Link> : team.name : fallback}</strong></span></div>;
}

function Scoreboard({ league, home, away, homeLabel, awayLabel, homeWinProbability, linkTeams = true }: { league: LeagueSnapshot; home: Team | undefined; away: Team | undefined; homeLabel?: string; awayLabel?: string; homeWinProbability?: number; linkTeams?: boolean }) {
  return <><div className="personal-scoreboard">
    <ScoreTeam league={league} team={home} fallback="Home team" label={homeLabel} link={linkTeams} />
    <div className="personal-score-center"><b>{formatPoints(home?.points)}</b><span>{away ? "VS" : "BYE"}</span><b>{away ? formatPoints(away.points) : "—"}</b></div>
    <ScoreTeam league={league} team={away} fallback="Bye week" label={awayLabel} away link={linkTeams} />
  </div><div className="team-projection-strip"><ProjectionValue value={home?.projection} baseline={home?.pregameProjection} teamTotal />
    {away ? <ProjectionValue value={away.projection} baseline={away.pregameProjection} teamTotal /> : <span />}</div>
    {away && typeof homeWinProbability === 'number' ? <div className="matchup-win-chance" aria-label={`Win chance: ${home?.name ?? 'Home'} ${homeWinProbability.toFixed(0)} percent, ${away.name} ${(100 - homeWinProbability).toFixed(0)} percent`}>
      <strong>{homeWinProbability.toFixed(0)}%</strong><span className="win-chance-bar"><i style={{ width: `${homeWinProbability}%` }} /></span><strong>{(100 - homeWinProbability).toFixed(0)}%</strong>
    </div> : null}</>;
}

type PositionGroup = "QB" | "WR" | "RB" | "TE" | "FLEX" | "Defense" | "Kicker" | "Other";
const POSITION_GROUPS: { key: PositionGroup; label: string }[] = [
  { key: "QB", label: "QB" },
  { key: "WR", label: "WR" },
  { key: "RB", label: "RB" },
  { key: "TE", label: "TE" },
  { key: "FLEX", label: "FLEX" },
  { key: "Defense", label: "DEF" },
  { key: "Kicker", label: "K" },
  { key: "Other", label: "Other" },
];
const FLEX_SLOTS = new Set(["WR/TE", "TE/WR", "RB/WR", "WR/RB", "RB/TE", "TE/RB", "W/R", "W/T", "W/R/T", "R/W", "R/T", "R/W/T", "UTIL"]);

function positionGroup(player: Player): PositionGroup {
  const normalize = (value: string) => value.trim().toUpperCase().replace(/[\s._-]+/g, "");
  const position = normalize(player.position);
  const slot = isBench(player) ? "" : normalize(player.slot);
  if (slot.includes("FLEX") || slot === "OP" || FLEX_SLOTS.has(slot) || FLEX_SLOTS.has(position)) return "FLEX";
  if (["D/ST", "DST", "DEF", "DEFENSE", "DP", "DT", "DE", "LB", "DL", "CB", "S", "DB"].includes(position) ||
    ["D/ST", "DST", "DEF", "DEFENSE", "DP", "DT", "DE", "LB", "DL", "CB", "S", "DB"].includes(slot)) return "Defense";
  if (["QB", "TQB"].includes(position) || ["QB", "TQB"].includes(slot)) return "QB";
  if (position === "WR" || slot === "WR") return "WR";
  if (position === "RB" || slot === "RB") return "RB";
  if (position === "TE" || slot === "TE") return "TE";
  if (["K", "P", "PK"].includes(position) || ["K", "P", "PK"].includes(slot)) return "Kicker";
  return "Other";
}

function positionGroups(players: Player[]) {
  const grouped: Record<PositionGroup, Player[]> = {
    QB: [], WR: [], RB: [], TE: [], FLEX: [], Defense: [], Kicker: [], Other: [],
  };
  for (const player of players) grouped[positionGroup(player)].push(player);
  return POSITION_GROUPS.flatMap(({ key, label }) => grouped[key].length ? [{ key, label, players: grouped[key] }] : []);
}

function LineupPlayer({ player, league, away = false }: { player: Player; league: LeagueSnapshot; away?: boolean }) {
  return <div className={`lineup-player${away ? " is-away" : ""}`}><span className="lineup-player-copy"><span className="lineup-player-name"><PlayerDetailsButton player={player} season={league.season} week={league.week} /><NflTeamMark player={player} /></span><PlayerGameStatus player={player} season={league.season} week={league.week} /></span><span className="lineup-player-scores"><b>{formatPoints(player.points)}</b><ProjectionValue value={player.projection} baseline={player.pregameProjection} held={player.projectionHeld} /></span></div>;
}

function MatchupLineups({ league, userTeam, opponent, neutral = false }: { league: LeagueSnapshot; userTeam: Team | undefined; opponent: Team | undefined; neutral?: boolean }) {
  const homePlayers = userTeam?.players ?? [];
  const homeStarters = homePlayers.filter((player) => !isBench(player));
  const homeGroups = positionGroups(homeStarters.length ? homeStarters : homePlayers);
  const homeBench = homeStarters.length ? homePlayers.filter(isBench) : [];
  const awayPlayers = opponent?.players ?? [];
  const awayStarters = awayPlayers.filter((player) => !isBench(player));
  const awayGroups = positionGroups(awayStarters.length ? awayStarters : awayPlayers);
  const awayBench = awayStarters.length ? awayPlayers.filter(isBench) : [];
  const groups = POSITION_GROUPS.flatMap(({ key, label }) => {
    const home = homeGroups.find((group) => group.key === key);
    const away = awayGroups.find((group) => group.key === key);
    return home || away ? [{ key, label, home, away }] : [];
  });

  return <div className="matchup-lineups" aria-label="Starting lineups">
    {neutral ? <div className="matchup-lineups-head">
      <div className="lineup-side-label">HOME LINEUP</div>
      <div aria-hidden="true" />
      <div className="lineup-side-label">{opponent ? "AWAY LINEUP" : ""}</div>
    </div> : null}
    {!homeGroups.length || (opponent && !awayGroups.length) ? <div className="lineup-position-empty">
      {homeGroups.length ? <div /> : <p>No players in this snapshot.</p>}
      <div aria-hidden="true" />
      {opponent && !awayGroups.length ? <p>No players in this snapshot.</p> : <div />}
    </div> : null}
    {groups.flatMap(({ key, label, home, away }) => Array.from({ length: Math.max(home?.players.length ?? 0, away?.players.length ?? 0) }, (_, index) => <div className="lineup-position-row" key={`${key}-${index}`}>
      <div className="lineup-position-cell">{home?.players[index] ? <LineupPlayer player={home.players[index]} league={league} /> : null}</div>
      <div className="lineup-position-label">{label}</div>
      <div className="lineup-position-cell">{away?.players[index] ? <LineupPlayer player={away.players[index]} league={league} away /> : null}</div>
    </div>))}
    {(homeBench.length || awayBench.length) ? <details className="lineup-bench">
      <summary>Bench</summary>
      <div className="lineup-bench-grid">
        <div className="lineup-players" role="group" aria-label={neutral ? "Home bench" : "Your bench"}>{positionGroups(homeBench).flatMap((group) => group.players).map((player) => <LineupPlayer key={player.id} player={player} league={league} />)}</div>
        <div aria-hidden="true" />
        {opponent ? <div className="lineup-players" role="group" aria-label={neutral ? "Away bench" : "Opponent bench"}>{positionGroups(awayBench).flatMap((group) => group.players).map((player) => <LineupPlayer key={player.id} player={player} league={league} away />)}</div> : null}
      </div>
    </details> : null}
  </div>;
}

function PersonalMatchupCard({ league, matchup, userTeam, opponent }: { league: LeagueSnapshot; matchup: LeagueSnapshot['matchups'][number]; userTeam: Team; opponent: Team | undefined }) {
  return <article className="matchup-card dashboard-matchup-card lineup-card">
    <LeagueBanner league={league} />
    <Scoreboard league={league} home={userTeam} away={opponent} homeWinProbability={matchup.homeWinProbability === undefined ? undefined : matchup.home === userTeam.id ? matchup.homeWinProbability : 100 - matchup.homeWinProbability} />
    <MatchupLineups league={league} userTeam={userTeam} opponent={opponent} />
    <div className="matchup-card-foot"><span>{userTeam.players?.length ?? 0} user players</span><span>{opponent ? (opponent.players?.length ?? 0) + " opponent players" : "No opponent"}</span></div>
  </article>;
}
function MatchupCard({ league, matchup, personalOnly, open, onToggle }: { league: LeagueSnapshot; matchup: LeagueSnapshot["matchups"][number]; personalOnly: boolean; open: boolean; onToggle: () => void }) {
  const teamById = new Map(league.teams.map((team) => [team.id, team]));
  const home = teamById.get(matchup.home);
  const away = matchup.away ? teamById.get(matchup.away) : undefined;
  const userTeam = personalOnly ? league.teams.find((team) => team.isUserTeam) : undefined;
  if (userTeam) {
    const opponentId = matchup.home === userTeam.id ? matchup.away : matchup.home;
    return <PersonalMatchupCard league={league} matchup={matchup} userTeam={userTeam} opponent={opponentId ? teamById.get(opponentId) : undefined} />;
  }
  return <article className={`matchup-card dashboard-matchup-card${open ? " is-selected" : ""}`}>
    <button className="league-matchup-toggle" type="button" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} players for ${home?.name ?? "Home team"} ${away ? `versus ${away.name}` : "bye"}`} onClick={onToggle}>
      <span className="matchup-card-top"><span>{open ? "HIDE PLAYERS −" : "SHOW PLAYERS +"}</span></span>
      <Scoreboard league={league} home={home} away={away} homeLabel="HOME" awayLabel="AWAY" homeWinProbability={matchup.homeWinProbability} linkTeams={false} />
    </button>
    {open ? <MatchupLineups league={league} userTeam={home} opponent={away} neutral /> : null}
  </article>;
}

export function MatchupGrid({ leagues, personalOnly = false, initialMatchup, layout = "rail" }: { leagues: LeagueSnapshot[]; personalOnly?: boolean; initialMatchup?: string; layout?: "rail" | "grid" }) {
  const [openMatchup, setOpenMatchup] = useState<string | null>(initialMatchup ?? null);
  useEffect(() => { setOpenMatchup(initialMatchup ?? null); }, [initialMatchup]);
  const cards = leagues.flatMap((league) => {
    const userTeam = personalOnly ? league.teams.find((team) => team.isUserTeam) : undefined;
    const matchups = personalOnly && userTeam ? league.matchups.filter((matchup) => matchup.home === userTeam.id || matchup.away === userTeam.id) : personalOnly ? [] : league.matchups ?? [];
    return matchups.map((matchup, index) => ({ league, matchup, index }));
  });
  const gridRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const topTrackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = gridRef.current;
    const top = topScrollRef.current;
    const track = topTrackRef.current;
    if (!grid || !top || !track) return;
    let lastFromGrid = grid.scrollLeft;
    const syncSize = () => {
      track.style.width = `${grid.scrollWidth}px`;
      top.hidden = grid.scrollWidth <= grid.clientWidth + 1;
      lastFromGrid = grid.scrollLeft;
      top.scrollLeft = lastFromGrid;
    };
    const onGridScroll = () => { lastFromGrid = grid.scrollLeft; top.scrollLeft = lastFromGrid; };
    const onTopScroll = () => { if (Math.abs(top.scrollLeft - lastFromGrid) > 1) grid.scrollLeft = top.scrollLeft; };
    syncSize();
    grid.addEventListener("scroll", onGridScroll, { passive: true });
    top.addEventListener("scroll", onTopScroll, { passive: true });
    const resizeObserver = new ResizeObserver(syncSize);
    resizeObserver.observe(grid);
    return () => {
      grid.removeEventListener("scroll", onGridScroll);
      top.removeEventListener("scroll", onTopScroll);
      resizeObserver.disconnect();
    };
  }, [cards.length]);

  if (!cards.length) return <div className="empty-inline"><span>◌</span><div><strong>{personalOnly ? "No personal matchup snapshots yet" : "No league matchups yet"}</strong><p>{personalOnly ? "Connect or import leagues in Settings to load your current matchup." : "Connect a source in Settings to add leagues and see this week’s scores."}</p><Link className="text-link" href="/dashboard/settings">Open Settings</Link></div></div>;

  const orderedCards = openMatchup && layout === "grid" ? [...cards].sort((a, b) => Number(b.matchup.home === openMatchup) - Number(a.matchup.home === openMatchup)) : cards;
  const matchupCards = orderedCards.map(({ league, matchup, index }) => <MatchupCard key={[league.provider, league.id, league.season, matchup.home, matchup.away ?? "bye", index].join("-")} league={league} matchup={matchup} personalOnly={personalOnly} open={!personalOnly && openMatchup === matchup.home} onToggle={() => setOpenMatchup((current) => current === matchup.home ? null : matchup.home)} />);
  if (layout === "grid") return <div id="league-matchup-grid" className={`matchup-grid league-matchup-grid${openMatchup ? " has-open-matchup" : ""}`} aria-label="League matchups">
    {openMatchup ? <><div className="league-matchup-expanded">{matchupCards[0]}</div>{matchupCards.length > 1 ? <div className="league-matchup-compact">{matchupCards.slice(1)}</div> : null}</> : matchupCards}
  </div>;

  return <div className="matchup-rail">
    <div ref={topScrollRef} className="matchup-top-scroll" role="region" aria-label="Top league scrollbar" tabIndex={0}><div ref={topTrackRef} className="matchup-top-scroll-track" /></div>
    <div ref={gridRef} id="dashboard-league-cards" className="matchup-grid dashboard-matchup-grid" role="region" aria-label="League matchups; scroll horizontally for more" tabIndex={0}>
      {matchupCards}
    </div>
  </div>;
}
export function TeamRoster({ league, team }: { league: LeagueSnapshot; team: Team }) {
  return <div className="roster-view"><div className="view-intro"><p>ROSTER SNAPSHOT</p><span>{team.players?.length ?? 0} players</span></div>{team.players?.length ? <div className="roster-card"><div className="roster-table-wrap"><table className="roster-table"><thead><tr><th scope="col">Player</th><th scope="col">Slot</th><th scope="col">Points</th><th scope="col">Stats</th></tr></thead><tbody>{team.players.map((player) => <PlayerRow key={player.id} player={player} league={league} />)}</tbody></table></div></div> : <div className="empty-inline"><span>◌</span><div><strong>No roster data in this snapshot</strong><p>The provider has not returned this team's roster yet.</p></div></div>}</div>;
}

function PlayerRow({ player, league }: { player: Player; league: LeagueSnapshot }) {
  const stats = Object.entries(playerStatsWithDefaults(player));
  return <tr><td><span className="roster-player"><PlayerHeadshot player={player} /><span><PlayerDetailsButton player={player} season={league.season} week={league.week} /><PlayerGameStatus player={player} season={league.season} week={league.week} /></span></span></td><td>{player.slot || "—"}</td><td className="player-points"><span className="player-score">{formatPoints(player.points)}</span><ProjectionValue value={player.projection} baseline={player.pregameProjection} held={player.projectionHeld} /></td><td>{stats.length ? <details className="player-stats"><summary>View</summary><dl>{stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl></details> : <span className="muted-dash">—</span>}</td></tr>;
}
