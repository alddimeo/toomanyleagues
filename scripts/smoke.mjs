import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Start npm run dev first. Use installed Chrome; no extra browser download is needed.
const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {channel:'chrome'})});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const base = process.env.SMOKE_URL || 'http://localhost:3000';
const errors=[];
page.on('pageerror', error=>errors.push(error.message));
const fixture={user:{email:'tester@example.com'},connections:[{provider:'espn',status:'connected'},{provider:'yahoo',status:'connected'}],configured:{espn:true,yahoo:true},leagues:[{
  id:'123',provider:'espn',name:'Test Sunday League',logo:'https://cdn.example/league.png',season:2026,week:1,fetchedAt:new Date().toISOString(),
  teams:[
    {id:'1',name:'Test Home',isUserTeam:true,logo:'/api/espn/team-logo/123e4567-e89b-12d3-a456-426614174000',points:101.25,projection:112.5,pregameProjection:105,players:[
      {id:'p1',name:'Test Quarterback',position:'QB',slot:'QB',nflTeam:'KC',points:24.5,projection:28.5,pregameProjection:25,stats:{'Passing yards':250}},
      {id:'pwr1',name:'Home Receiver',position:'WR',slot:'WR',points:10.2,projection:16.09,pregameProjection:16.09},
      {id:'pwr1b',name:'Home Receiver Two',position:'WR',slot:'WR',points:8.2},
      {id:'pk1',name:'Home Kicker',position:'K',slot:'K',points:7.1},
      {id:'prb1',name:'Home Runner',position:'RB',slot:'RB',points:14.3},
      {id:'pdef1',name:'Home Defense',position:'D/ST',slot:'D/ST',points:8.4},
      {id:'pte1',name:'Home Tight End',position:'TE',slot:'TE',points:9.5},
      {id:'pflex1',name:'Home Flex',position:'RB',slot:'FLEX',points:12.6},
      {id:'pbench1',name:'Home Bench',position:'RB',slot:'BE',points:5.0},
    ]},
    {id:'2',name:'Test Away',points:99.5,projection:101,pregameProjection:107,players:[
      {id:'p2',name:'Opponent Runner',position:'RB',slot:'RB',nflTeam:'DAL',points:18.25,stats:{'Rushing yards':98}},
      {id:'pk2',name:'Away Kicker',position:'K',slot:'K',points:7.3},
      {id:'pflex2',name:'Away Flex',position:'TE',slot:'FLEX',points:11.7},
      {id:'pdef2',name:'Away Defense',position:'D/ST',slot:'D/ST',points:8.2},
      {id:'pte2',name:'Away Tight End',position:'TE',slot:'TE',points:6.9},
      {id:'pwr2',name:'Away Receiver',position:'WR',slot:'WR',points:13.4},
      {id:'pwr2b',name:'Away Receiver Two',position:'WR',slot:'WR',points:6.4},
      {id:'pqb2',name:'Away Quarterback',position:'QB',slot:'QB',points:22.1},
      {id:'pbench2',name:'Away Bench',position:'WR',slot:'BN',points:5.1},
    ]},
  ],matchups:[{home:'1',away:'2',homeWinProbability:61}],
}]};
fixture.leagues.push({...fixture.leagues[0],name:'Test Prior Season',season:2025});
fixture.leagues.push({...fixture.leagues[0],id:'461.l.123',provider:'yahoo',name:'Test Yahoo League',logo:undefined,teams:fixture.leagues[0].teams.map(team=>({...team,logo:undefined}))});
fixture.leagues.push({...fixture.leagues[2],id:'461.l.456',name:'Another Test Yahoo League'});
fixture.leagues[3].teams=fixture.leagues[3].teams.map(team=>({...team,players:team.players.filter(player=>['QB','BE','BN'].includes(player.slot))}));
try {
  await page.goto(base);
  await page.getByRole('heading',{name:/All your leagues/}).waitFor();
  const rejected=await page.request.post(`${base}/api/refresh`,{headers:{origin:'https://other.example'}});
  assert.equal(rejected.status(),403,'cross-site mutation must be rejected before authentication');
  const privateData=await page.request.get(`${base}/api/dashboard`);
  assert.ok([401,503].includes(privateData.status()),'anonymous visitor must not receive dashboard data');
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/home.png',fullPage:true});
  await page.goto(`${base}/login`);
  assert.equal(await page.getByRole('link',{name:/Continue with Google/}).count(),1);
  assert.equal(await page.getByRole('link',{name:/Continue with Apple/}).count(),1);
  await page.getByLabel('Email address').fill('tester@example.com');
  await page.locator('#email-password').fill('test-password');
  const authCrossSite=await page.request.post(`${base}/auth/email`,{headers:{origin:'https://other.example'},data:{action:'signin',email:'tester@example.com',password:'test-password'}});
  assert.equal(authCrossSite.status(),403,'email authentication must reject cross-site posts');
  await page.route('**/auth/email',route=>route.fulfill({status:401,json:{error:'Incorrect email or password.'}}));
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Incorrect email or password.'}).waitFor();
  await page.getByRole('tab',{name:'Create account',exact:true}).click();
  assert.equal(await page.getByLabel('Confirm password').count(),1);
  await page.getByRole('tab',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Forgot password?',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Email reset link',exact:true}).count(),1);
  await page.getByRole('button',{name:'Back to sign in',exact:true}).click();
  await page.screenshot({path:'test-results/login.png',fullPage:true});
  let refreshCalls=0;
  await page.route('**/league.png',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" fill="#25c4e8"/><text x="9" y="20" fill="black">L</text></svg>'}));
  await page.route('**/api/espn/team-logo/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42"><rect width="42" height="42" fill="#25c4e8"/></svg>'}));
  await page.route('**/api/dashboard',route=>route.fulfill({json:fixture}));
  await page.route('**/api/refresh',route=>{refreshCalls++; return route.fulfill({status:409,json:{error:'ESPN authorization expired. Reconnect that account.'}});});
  await page.route('**/api/nfl/scoreboard?*',route=>route.fulfill({json:{games:[{homeTeam:'KC',awayTeam:'DAL',homeScore:0,awayScore:0,date:'2026-09-13T17:00:00Z',state:'scheduled',period:0,clock:null}]}}));
  const nflNames={KC:'Kansas City Chiefs',DAL:'Dallas Cowboys',PHI:'Philadelphia Eagles',NYG:'New York Giants',BUF:'Buffalo Bills',MIA:'Miami Dolphins'};
  const nflEvent=(id,away,home,state)=>({id,date:'2026-09-20T17:00:00Z',competitions:[{competitors:[{homeAway:'away',score:'17',team:{abbreviation:away,displayName:nflNames[away]}},{homeAway:'home',score:'10',team:{abbreviation:home,displayName:nflNames[home]}}],status:{type:{state},period:3,displayClock:'8:24'}}]});
  await page.route('**/site/v2/sports/football/nfl/scoreboard',route=>route.fulfill({json:{events:[nflEvent('401772512','BUF','MIA','post'),nflEvent('401772510','KC','DAL','in'),nflEvent('401772511','PHI','NYG','pre'),...Array.from({length:13},(_,index)=>nflEvent(String(401772520+index),'PHI','NYG','pre'))]}}));
  await page.route('**/site/v2/sports/football/nfl/summary?*',route=>route.fulfill({json:{drives:{previous:[{plays:[{id:'play-1',text:'T.Quarterback pass to receiver',wallclock:'2026-09-20T17:01:00Z',period:{number:3},clock:{displayValue:'8:24'}}]}]}}}));
  await page.goto(`${base}/dashboard`);
  await page.getByText('Test Sunday League',{exact:true}).first().waitFor();
  await page.getByText('Test Prior Season',{exact:true}).first().waitFor();
  await page.getByText('Test Yahoo League',{exact:true}).first().waitFor();
  assert.equal(await page.locator('.league-logo:visible').count(),2,'league logos should render');
  assert.ok(await page.locator('.personal-score-logo .team-logo[src^="/api/espn/team-logo/"]:visible').count()>0,'relative ESPN fantasy team logo proxy should render');
  await page.waitForFunction(()=>{const logo=document.querySelector('.personal-score-logo .team-logo[src^="/api/espn/team-logo/"]');return logo?.complete && logo.naturalWidth>0;});
  assert.ok(await page.getByText('Test Quarterback',{exact:true}).count()>0);
  assert.ok(await page.getByText('Opponent Runner',{exact:true}).count()>0,'opponent lineup should be visible');
  assert.ok(await page.getByText('99.50',{exact:true}).count()>0,'opponent score should be visible');
  assert.match(await page.locator('.personal-score-center').first().innerText(),/101\.25\s*VS\s*99\.50/,'scores should meet in the middle');
  const firstCard=page.locator('.dashboard-matchup-card').first();
  assert.match(await firstCard.locator('.team-projection-strip').innerText(),/112\.50/);
  assert.equal(await page.getByText('Proj',{exact:true}).count(),0,'projection values should not repeat a label');
  const unchanged=firstCard.locator('.lineup-position-row').filter({has:page.getByRole('button',{name:'Home Receiver',exact:true})}).locator('.projection-value').first();
  assert.equal((await unchanged.innerText()).trim(),'16.09','an unchanged projection should show only its value');
  assert.equal(await firstCard.locator('.projection-up').count()>0,true,'rising projections should be marked green');
  assert.equal(await firstCard.locator('.projection-down').count()>0,true,'falling projections should be marked red');
  assert.match(await firstCard.locator('.matchup-win-chance').innerText(),/61%/);
  const lineupLabels=await firstCard.locator('.lineup-position-label').allTextContents();
  assert.deepEqual(lineupLabels,['QB','WR','WR','RB','TE','FLEX','DEF','K'],'each starter slot should show its normalized position');
  const playerOrder=await firstCard.locator('.lineup-position-row').evaluateAll(rows=>rows.flatMap(row=>Array.from(row.children[0]?.querySelectorAll('.player-name-button')??[]).map(player=>player.textContent?.trim())));
  assert.deepEqual(playerOrder,['Test Quarterback','Home Receiver','Home Receiver Two','Home Runner','Home Tight End','Home Flex','Home Defense','Home Kicker'],'players should follow the shared position order');
  const opponentRow=firstCard.locator('.lineup-position-row').filter({has:page.getByRole('button',{name:'Opponent Runner'})});
  const opponentOrder=await opponentRow.evaluate(row=>Object.fromEntries(['b','.player-team-mark','.player-name-button'].map(selector=>[selector,row.querySelector(`.lineup-player.is-away ${selector}`)?.getBoundingClientRect().left??Infinity])));
  assert.ok(opponentOrder.b<opponentOrder['.player-name-button']&&opponentOrder['.player-name-button']<opponentOrder['.player-team-mark'],'opponent NFL logo should sit right of the player name');
  assert.equal(await firstCard.locator('.lineup-player-copy > small:not(.player-game-status)').count(),0,'lineup positions should be shown in the center column');
  const lineupPositions=await firstCard.locator('.matchup-lineups-head .lineup-side-label').evaluateAll(labels=>labels.map(label=>({x:Math.round(label.getBoundingClientRect().x),y:Math.round(label.getBoundingClientRect().y)})));
  assert.equal(lineupPositions[0].y,lineupPositions[1].y,'lineup headings should start on the same row');
  assert.ok(lineupPositions[0].x<lineupPositions[1].x,'lineup headings should be on opposite sides');
  assert.equal(await page.getByText('Test Home',{exact:true}).count(),4,'team names should appear only once per card');
  const benchPanels=firstCard.locator('.lineup-bench');
  assert.equal(await benchPanels.count(),2,'both teams should show a bench disclosure');
  await benchPanels.nth(0).locator('summary').click();
  await page.waitForFunction(()=>{const card=document.querySelector('.dashboard-matchup-card'),panels=card?.querySelectorAll('.lineup-bench');return panels?.length===2&&Array.from(panels).every(panel=>panel.open);});
  assert.deepEqual(await benchPanels.evaluateAll(panels=>panels.map(panel=>panel.open)),[true,true],'opening one bench should open both teams');
  await benchPanels.nth(1).locator('summary').click();
  await page.waitForFunction(()=>{const card=document.querySelector('.dashboard-matchup-card'),panels=card?.querySelectorAll('.lineup-bench');return panels?.length===2&&Array.from(panels).every(panel=>!panel.open);});
  assert.deepEqual(await benchPanels.evaluateAll(panels=>panels.map(panel=>panel.open)),[false,false],'closing one bench should close both teams');
  const scrollGrid=page.locator('#dashboard-league-cards');
  assert.equal(await scrollGrid.evaluate(grid=>Array.from(grid.children).filter(card=>card.getBoundingClientRect().right<=grid.getBoundingClientRect().right+1).length),3,'default view should fit three cards');
  assert.equal(await page.locator('.matchup-scroll-arrow').count(),0,'matchup arrows should be absent');
  const topScroll=page.locator('.matchup-top-scroll');
  const cardStep=await scrollGrid.evaluate(grid=>{const first=grid.firstElementChild,next=first?.nextElementSibling;return first&&next?next.getBoundingClientRect().left-first.getBoundingClientRect().left:first?.getBoundingClientRect().width??0;});
  await scrollGrid.evaluate((grid,step)=>{grid.scrollLeft=step;},cardStep);
  await page.waitForFunction(step=>{const grid=document.querySelector('#dashboard-league-cards');return !!grid&&Math.abs(grid.scrollLeft-step)<2;},cardStep);
  await page.waitForFunction(()=>{const grid=document.querySelector('#dashboard-league-cards'),top=document.querySelector('.matchup-top-scroll');return !!grid&&!!top&&Math.abs(top.scrollLeft-grid.scrollLeft)<2;});
  await topScroll.evaluate(element=>{element.scrollLeft=0;});
  await page.waitForFunction(()=>{const grid=document.querySelector('#dashboard-league-cards');return !!grid&&grid.scrollLeft<1;});
  const regularCardWidth=await firstCard.evaluate(card=>card.getBoundingClientRect().width);
  await page.screenshot({path:'test-results/dashboard-regular.png',fullPage:true});
  const closedNflButton=await page.getByRole('button',{name:'Open NFL scores'}).boundingBox();
  const toolbar=await page.locator('.dashboard-topbar').boundingBox();
  const heading=await page.getByRole('heading',{name:'Matchups'}).boundingBox();
  assert.ok(closedNflButton.y>=toolbar.y+toolbar.height&&Math.abs(closedNflButton.y-heading.y)<15,'closed NFL control should sit below the toolbar beside Matchups');
  assert.ok(closedNflButton.height>closedNflButton.width*2,'NFL control should be vertically rectangular');
  assert.equal(await page.locator('.nfl-vertical-field').count(),0,'NFL control should have no football graphic');
  await page.getByRole('button',{name:'Open NFL scores'}).click();
  await page.locator('.nfl-game').first().waitFor();
  const openNflButton=await page.locator('.nfl-drawer-head .nfl-vertical-button').boundingBox();
  const liveScoresHeading=await page.getByRole('heading',{name:'Live scores'}).boundingBox();
  assert.ok(openNflButton.x>liveScoresHeading.x+liveScoresHeading.width&&openNflButton.height>openNflButton.width*2,'open NFL control should sit to the right of Live scores');
  assert.equal(await page.locator('.nfl-game').count(),16,'NFL drawer should show every game');
  assert.equal((await page.locator('.nfl-game').last().locator('.nfl-game-status').textContent())?.trim(),'Final','finished games should move to the bottom');
  assert.equal(await page.getByText('Both across leagues').count(),1,'legend should explain blue highlights');
  assert.equal(await page.locator('.nfl-game-team img').count(),32,'every team should have a logo');
  assert.equal(await page.getByText('Kansas City Chiefs').count(),1,'full NFL team names should be visible');
  const nflPositions=await page.locator('.nfl-game').evaluateAll(games=>games.slice(0,2).map(game=>({x:game.getBoundingClientRect().x,y:game.getBoundingClientRect().y})));
  assert.equal(nflPositions[0].y,nflPositions[1].y,'games should appear two across');
  assert.ok(nflPositions[0].x<nflPositions[1].x,'games should read left to right');
  assert.ok(await page.locator('.nfl-drawer-games').evaluate(games=>games.scrollHeight>games.clientHeight),'a full slate should scroll inside the panel');
  assert.match(await page.locator('.nfl-drawer-games').evaluate(games=>getComputedStyle(games).scrollbarColor),/255, 138, 61/,'NFL game scrollbar should use the orange accent');
  assert.ok(await page.locator('.nfl-drawer').evaluate(drawer=>drawer.getBoundingClientRect().right<document.querySelector('.dashboard-matchups').getBoundingClientRect().left),'NFL drawer should sit to the left of matchups');
  assert.ok(await page.locator('.nfl-drawer').evaluate(drawer=>Math.abs(drawer.getBoundingClientRect().bottom-innerHeight)<2),'NFL drawer should span to the bottom of the screen');
  const panelBefore=await page.locator('.nfl-drawer').evaluate(drawer=>drawer.getBoundingClientRect().width);
  const grip=await page.getByRole('separator',{name:'Resize NFL scores'}).boundingBox();
  await page.mouse.move(grip.x+grip.width/2,grip.y+120);
  await page.mouse.down();
  await page.mouse.move(grip.x+grip.width/2+80,grip.y+120,{steps:5});
  await page.mouse.up();
  const panelAfter=await page.locator('.nfl-drawer').evaluate(drawer=>drawer.getBoundingClientRect().width);
  assert.ok(panelAfter>=panelBefore+70,'dragging the divider should widen NFL scores');
  const farGrip=await page.getByRole('separator',{name:'Resize NFL scores'}).boundingBox();
  await page.mouse.move(farGrip.x+farGrip.width/2,farGrip.y+120);
  await page.mouse.down();
  await page.mouse.move(740,farGrip.y+120,{steps:5});
  await page.mouse.up();
  assert.ok(await page.locator('.nfl-drawer').evaluate(drawer=>drawer.getBoundingClientRect().width)>700,'divider should drag substantially beyond the old width limit');
  assert.equal(await page.locator('.dashboard-matchup-grid.is-compact').count(),1,'opening NFL scores should compact leagues');
  assert.equal(await scrollGrid.evaluate(grid=>Array.from(grid.children).filter(card=>card.getBoundingClientRect().right<=grid.getBoundingClientRect().right+1).length),3,'three compact leagues should fit beside NFL scores');
  await page.getByRole('button',{name:'Compact View On'}).click();
  assert.equal(await page.locator('.dashboard-matchup-grid.is-compact').count(),0,'compact view can be turned off while NFL scores are open');
  await page.getByRole('button',{name:'Compact View Off'}).click();
  assert.equal(await page.locator('.dashboard-matchup-grid.is-compact').count(),1,'compact view can be turned back on while NFL scores are open');
  await page.locator('.nfl-game-button').first().click();
  await page.getByText('T.Quarterback pass to receiver').waitFor();
  assert.equal(await page.locator('.nfl-play-you').count(),1,'your starter should highlight a recent play');
  assert.equal(await page.locator('.nfl-opponent').filter({hasText:'Opponent Runner'}).count(),1,'opponent starter should use a different color');
  await page.screenshot({path:'test-results/dashboard-nfl.png',fullPage:true});
  await page.getByRole('button',{name:'Close NFL scores'}).click();
  assert.equal(await page.locator('.dashboard-matchup-grid.is-compact').count(),0,'closing NFL scores should restore regular leagues');
  const compactToggle=page.getByRole('button',{name:'Compact View Off'});
  await compactToggle.click();
  const compactToggleOn=page.getByRole('button',{name:'Compact View On'});
  assert.equal(await compactToggleOn.getAttribute('aria-pressed'),'true','compact view toggle should expose its pressed state');
  await page.getByRole('button',{name:'Open NFL scores'}).click();
  await page.getByRole('button',{name:'Compact View On'}).click();
  assert.equal(await page.locator('.dashboard-matchup-grid.is-compact').count(),0,'a prior compact choice can still be toggled off while NFL scores are open');
  await page.getByRole('button',{name:'Close NFL scores'}).click();
  assert.equal(await page.locator('.dashboard-matchup-grid.is-compact').count(),1,'closing NFL scores should preserve a prior compact choice');
  assert.ok(await firstCard.evaluate(card=>card.getBoundingClientRect().width)<regularCardWidth,'compact view should fit more cards horizontally');
  assert.equal(await firstCard.locator('.player-headshot-wrap:visible,.player-headshot-fallback:visible,.player-team-mark:visible,.personal-score-logo:visible').count(),0,'compact view should hide team logos and player headshots');
  assert.ok(parseFloat(await firstCard.locator('.lineup-player-copy .player-game-status').first().evaluate(status=>getComputedStyle(status).fontSize))>8,'lineup game time should use the freed space');
  await page.locator('.player-game-status').filter({hasText:/Sep 13.*(?:AM|PM)/}).first().waitFor();
  const cardHeights=await page.locator('.dashboard-matchup-card').evaluateAll(cards=>cards.map(card=>Math.round(card.getBoundingClientRect().height)));
  assert.equal(new Set(cardHeights).size,1,'matchup cards should match the tallest card');
  const benchTops=await page.locator('.dashboard-matchup-card').evaluateAll(cards=>cards.map(card=>Math.round(card.querySelector('.lineup-bench-grid')?.getBoundingClientRect().top??0)));
  assert.equal(new Set(benchTops).size,1,'bench sections should align even when leagues have different numbers of starters');
  assert.equal(await page.getByRole('button',{name:/Refresh|Live mode/}).count(),0,'live updates should run without controls');
  assert.equal(await page.getByText('Add a league manually').count(),0);
  await page.getByRole('button',{name:'Test Quarterback'}).first().click();
  const playerDialog=page.getByRole('dialog',{name:'Test Quarterback'});
  await playerDialog.waitFor();
  await playerDialog.getByText('Passing yards').waitFor();
  await playerDialog.locator('.player-game-status').filter({hasText:/Sep 13.*(?:AM|PM)/}).waitFor();
  await page.screenshot({path:'test-results/player-modal.png'});
  await playerDialog.getByRole('button',{name:'Close player details'}).click();
  await page.getByRole('alert').filter({hasText:/authorization expired/}).waitFor();
  assert.equal(refreshCalls,1,'live refresh should begin automatically');
  await page.screenshot({path:'test-results/dashboard.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Open NFL scores'}).click();
  assert.equal(await page.locator('.nfl-game').count(),16,'mobile drawer should retain every game');
  assert.ok(await page.locator('.nfl-drawer').evaluate(drawer=>drawer.scrollWidth<=drawer.clientWidth),'mobile score panel should fit the screen');
  await page.screenshot({path:'test-results/dashboard-nfl-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Close NFL scores'}).click();
  const mobileCards=await page.locator('.dashboard-matchup-card').evaluateAll(cards=>cards.map(card=>({width:card.clientWidth,scrollWidth:card.scrollWidth})));
  assert.ok(mobileCards.every(card=>card.scrollWidth<=card.width),'matchup cards should fit a phone screen');
  await page.screenshot({path:'test-results/dashboard-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('link',{name:'Settings'}).click();
  await page.getByRole('heading',{name:'Connections'}).waitFor();
  await page.getByRole('link',{name:'Help'}).click();
  await page.getByText('Why is there no colored change for my league?').waitFor();
  await page.getByRole('link',{name:'Settings'}).click();
  await page.route('**/api/espn/discover',route=>route.fulfill({json:{availableLeagues:[{id:'123',name:'Test Sunday League',season:2026}]}}));
  await page.locator('.connection-espn').getByRole('button',{name:'Discover leagues'}).click();
  await page.getByRole('dialog',{name:'Choose leagues to add'}).waitFor();
  assert.equal(await page.getByText('ESPN LEAGUES').count(),1);
  await page.getByRole('button',{name:'Skip ESPN league selection'}).click();
  let yahooImport;
  await page.route('**/api/yahoo/discover',route=>route.fulfill({json:{leagues:[{id:'461.l.123',name:'Yahoo First League',season:2026},{id:'461.l.456',name:'Yahoo Second League',season:2026}]}}));
  await page.route('**/api/yahoo/import',route=>{yahooImport=route.request().postDataJSON(); return route.fulfill({json:{imported:1,failed:[]}});});
  await page.locator('.connection-yahoo').getByRole('button',{name:'Discover leagues'}).click();
  const yahooPicker=page.getByRole('dialog',{name:'Choose leagues to add'});
  await yahooPicker.waitFor();
  assert.equal(await yahooPicker.getByRole('checkbox').count(),2);
  await yahooPicker.getByRole('checkbox').nth(1).uncheck();
  await yahooPicker.getByRole('button',{name:'Add 1 selected'}).click();
  await yahooPicker.waitFor({state:'hidden'});
  assert.deepEqual(yahooImport,{leagues:[{id:'461.l.123',name:'Yahoo First League',season:2026}]});
  assert.ok(page.url().includes('/dashboard/settings'),'connections belong on settings');
  fixture.connections[0].status='reconnect';
  await page.reload();
  await page.getByRole('button',{name:/Reconnect ESPN/}).click();
  await page.getByRole('dialog',{name:'Connect ESPN'}).getByText(/Install the Too Many Leagues Chrome connector/).waitFor();
  await page.getByRole('button',{name:'Close connection instructions'}).click();
  fixture.connections[1].status='reconnect';
  await page.addInitScript(() => {
    window.__connectorAvailableForSmoke=false;
    window.addEventListener('message',event=>{
      if(event.data?.source!=='too-many-leagues-app') return;
      if(event.data.action==='ping') {
        window.postMessage({source:'too-many-leagues-connector',id:null,status:'available'},location.origin);
        window.__connectorAvailableForSmoke=true;
        return;
      }
      if(event.data.action!=='connect') return;
      const league=event.data.provider==='yahoo' ? {id:'461.l.123',name:'Yahoo First League',season:2026} : {id:'123',name:'Test Sunday League',season:2026};
      window.postMessage({source:'too-many-leagues-connector',id:event.data.id,status:'connected',result:{leagues:[league]}},location.origin);
    });
  });
  await page.reload();
  await page.waitForFunction(()=>window.__connectorAvailableForSmoke===true);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.getByRole('button',{name:/Reconnect ESPN/}).click();
  const espnPicker=page.getByRole('dialog',{name:'Choose leagues to add'});
  await espnPicker.waitFor();
  await espnPicker.getByRole('button',{name:'Skip ESPN league selection'}).click();
  await page.getByRole('button',{name:/Reconnect Yahoo/}).click();
  await page.getByRole('dialog',{name:'Choose leagues to add'}).waitFor();
  assert.equal(await page.getByText('YAHOO LEAGUES').count(),1);
  assert.deepEqual(errors,[]);
  console.log('UI smoke passed: homepage, sign-in, both lineups and scores, player modal, automatic live refresh, settings, and connector flow. Screenshots: test-results/.');
} catch (error) {
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/failure.png',fullPage:true});
  console.error('Browser errors:',errors);
  throw error;
} finally { await browser.close(); }
