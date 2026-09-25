import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

const sampleLeagues = [
  { provider: "ESPN", name: "Sunday League", detail: "WEEK 08", home: "THE STAT CREW", homeScore: "118.40", away: "FOURTH & LONG", awayScore: "102.90", tone: "cyan" },
  { provider: "YAHOO", name: "Office Dynasty", detail: "WEEK 08", home: "WAIVER WIRE", homeScore: "96.70", away: "SUNDAY SCARIES", awayScore: "94.10", tone: "green" },
];

export default function HomePage() {
  return (
    <main className="site-shell home-shell">
      <nav className="top-nav page-width" aria-label="Main navigation">
        <Link href="/" className="brand-link"><Wordmark /></Link>
        <div className="nav-links">
          <span className="nav-build">PRIVATE BUILD // 01</span>
          <a href="#how-it-works">How it works</a>
          <Link href="/login" className="button button-small button-dark">Open dashboard <span aria-hidden="true">↗</span></Link>
        </div>
      </nav>

      <section className="hero page-width" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" /> Fantasy control room · private prototype</p>
          <h1 id="hero-title">All your leagues.<br /><span>One game feed.</span></h1>
          <p className="hero-lede">Scores, matchups, and roster points from the places you play, lined up like a proper Sunday scoreboard.</p>
          <div className="hero-actions">
            <Link href="/login" className="button button-primary">Sign in to start <span aria-hidden="true">↗</span></Link>
            <a href="#sample" className="text-link">View sample broadcast <span aria-hidden="true">↓</span></a>
          </div>
          <p className="hero-note">Connect ESPN or Yahoo, then import a league by ID. This prototype only shows your connected snapshots.</p>
          <div className="hero-specs" aria-label="Prototype capabilities"><span><b>02</b> PROVIDERS</span><span><b>10</b> LEAGUE CAP</span><span><b>30s</b> LIVE REFRESH</span></div>
        </div>

        <div className="hero-broadcast" aria-label="Illustrative sample fantasy scoreboard" role="img">
          <div className="broadcast-scanline" />
          <div className="broadcast-header"><span><b className="signal-dot" /> SAMPLE BROADCAST</span><span>ARCHIVE VIEW // WEEK 08</span></div>
          <div className="broadcast-grid">
            <aside className="broadcast-rail"><span className="rail-title">LEAGUES</span><span className="rail-league active"><b>01</b><small>ESPN</small><strong>Sunday<br />League</strong></span><span className="rail-league"><b>02</b><small>YAHOO</small><strong>Office<br />Dynasty</strong></span><span className="rail-league muted"><b>03</b><small>—</small><strong>Keeper<br />Club</strong></span><span className="rail-mark">TML<br /><b>CONTROL</b></span></aside>
            <div className="broadcast-scoreboard">
              <div className="scoreboard-kicker"><span>ESPN // SAMPLE SNAPSHOT</span><span className="scoreboard-status">FINAL SAMPLE</span></div>
              <div className="broadcast-title"><div><strong>Sunday League</strong><small>Fantasy Football · 2025 season · Week 08</small></div><span className="broadcast-clock">12:00<br /><em>ET</em></span></div>
              <div className="broadcast-matchup"><div className="broadcast-team"><span className="team-token cyan-token">S</span><div><small>HOME</small><strong>THE STAT CREW</strong></div><b>118.40</b></div><div className="broadcast-vs">FINAL <span>—</span></div><div className="broadcast-team away"><span className="team-token red-token">F</span><div><small>AWAY</small><strong>FOURTH &amp; LONG</strong></div><b>102.90</b></div></div>
              <div className="field-graphic" aria-hidden="true"><i>10</i><i>20</i><i>30</i><i>40</i><i>50</i><i>40</i><i>30</i><i>20</i><i>10</i><span className="field-ball">●</span></div>
              <div className="broadcast-foot"><span>ROSTER STATUS <b>24 / 24</b></span><span>LAST SAMPLE UPDATE <b>14:32:08</b></span></div>
            </div>
          </div>
          <div className="broadcast-footer"><span>ILLUSTRATIVE UI · NO LIVE DATA</span><span>TOO MANY LEAGUES / SCOREBOARD 001</span></div>
        </div>
      </section>

      <section className="ticker-band" aria-label="Product details">
        <div className="ticker page-width"><span><b>01</b> ESPN + YAHOO SOURCES</span><span><b>02</b> SNAPSHOTS YOU CAN READ</span><span><b>03</b> PRIVATE BY DEFAULT</span><span className="ticker-right">// READ THE WEEK</span></div>
      </section>

      <section className="feature-section page-width" id="how-it-works" aria-labelledby="feature-title">
        <div className="section-intro"><div><p className="eyebrow">THE SHORT VERSION</p><h2 id="feature-title">The fantasy<br /><span>control room.</span></h2></div><p className="section-side-note">A narrow, useful view for the weeks when every tab starts looking the same.</p></div>
        <div className="feature-grid">
          <article className="feature-card feature-card-lime"><span className="feature-number">01 // CONNECT</span><h3>Bring in the sources.</h3><p>Connect a provider account, then pick the leagues that belong on your board.</p><div className="feature-readout"><b>ESPN</b><b>YAHOO</b><span>READY</span></div></article>
          <article className="feature-card feature-card-cream"><span className="feature-number">02 // READ</span><h3>See the score feed.</h3><p>Matchup pairs, team totals, players, and stat lines share the same frame.</p><div className="feature-bars"><i /><i /><i /><i /></div></article>
          <article className="feature-card feature-card-navy"><span className="feature-number">03 // REFRESH</span><h3>Stay current on game day.</h3><p>Scores update automatically while NFL games are live. Refresh manually between games.</p><div className="feature-live"><b /> LIVE GAMES / TAB VISIBLE</div></article>
        </div>
      </section>

      <section className="sample-section page-width" id="sample" aria-labelledby="sample-title">
        <div className="sample-heading"><div><p className="eyebrow">A SAMPLE BROADCAST</p><h2 id="sample-title">Less hunting.<br /><span>More football.</span></h2></div><p>Everything below is illustrative sample data. Your dashboard starts empty and fills only after you connect and import a league.</p></div>
        <div className="sample-console" aria-label="Sample multi-league scoreboard">
          <div className="console-bar"><span><b className="signal-dot" /> SAMPLE DATA / MULTI-LEAGUE BOARD</span><span>STATIC UI PREVIEW</span></div>
          <div className="console-head"><div><small>WEEK 08 / SUNDAY</small><h3>Scoreboard feed</h3></div><span className="console-filter">ALL LEAGUES <b>⌄</b></span></div>
          <div className="console-table"><div className="console-table-head"><span>SOURCE / LEAGUE</span><span>MATCHUP</span><span>HOME</span><span>AWAY</span><span>STATE</span></div>{sampleLeagues.map((league) => <div className="console-row" key={league.name}><div className="console-league"><span className={`source-chip ${league.tone}`}>{league.provider.slice(0, 1)}</span><span><b>{league.name}</b><small>{league.provider} · {league.detail}</small></span></div><div className="console-matchup"><b>{league.home}</b><span>vs</span><b>{league.away}</b></div><strong className="console-score">{league.homeScore}</strong><strong className="console-score dim-score">{league.awayScore}</strong><span className="console-state">SAMPLE SNAPSHOT</span></div>)}</div>
          <div className="console-field"><div className="mini-field"><i /><i /><i /><i /><i /><b>50</b></div><div><small>FIELD VIEW / ILLUSTRATION</small><p>One board for the leagues you choose to watch.</p></div><span className="console-stamp">NOT<br />LIVE</span></div>
        </div>
      </section>

      <footer className="site-footer page-width"><Wordmark /><span>Private prototype · Built for league people</span><Link href="/login" className="footer-link">Open the dashboard <span aria-hidden="true">↗</span></Link></footer>
    </main>
  );
}
