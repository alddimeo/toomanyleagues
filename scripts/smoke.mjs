import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Start npm run dev first. Use a system browser; no extra browser download is needed.
const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {channel:'msedge'})});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const base = process.env.SMOKE_URL || 'http://localhost:3000';
const errors=[];
page.on('pageerror', error=>errors.push(error.message));
const fixture={user:{email:'tester@example.com'},connections:[{provider:'espn',status:'connected'},{provider:'yahoo',status:'connected'}],configured:{espn:true,yahoo:true},leagues:[{
  id:'123',provider:'espn',name:'Test Sunday League',season:2026,week:1,fetchedAt:new Date().toISOString(),
  teams:[{id:'1',name:'Test Home',points:101.25,players:[{id:'p1',name:'Test Quarterback',position:'QB',slot:'QB',points:24.5,stats:{'Passing yards':250}}]},{id:'2',name:'Test Away',points:99.5,players:[]}],matchups:[{home:'1',away:'2'}],
}]};
fixture.leagues.push({...fixture.leagues[0],name:'Test Prior Season',season:2025});
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
  await page.route('**/api/dashboard',route=>route.fulfill({json:fixture}));
  await page.route('**/api/refresh',route=>{refreshCalls++; fixture.connections[0].status='reconnect'; return route.fulfill({status:409,json:{error:'ESPN authorization expired. Reconnect that account.'}});});
  await page.goto(`${base}/dashboard`);
  await page.getByRole('heading',{name:'Test Sunday League',exact:true}).waitFor();
  await page.getByRole('tab',{name:/Test Prior Season/}).click();
  await page.getByRole('heading',{name:'Test Prior Season',exact:true}).waitFor();
  await page.getByRole('tab',{name:/Test Sunday League/}).click();
  await page.getByRole('heading',{name:'Test Sunday League',exact:true}).waitFor();
  await page.getByRole('tab',{name:'Rosters',exact:true}).click();
  await page.locator('summary').filter({hasText:'Test Home'}).click();
  assert.equal(await page.getByText('Test Quarterback',{exact:true}).count(),1);
  await page.screenshot({path:'test-results/dashboard.png',fullPage:true});
  await page.getByRole('button',{name:'Live mode',exact:true}).click();
  await page.getByRole('alert').filter({hasText:/authorization expired/}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Live mode',exact:true}).getAttribute('aria-pressed'),'false');
  assert.equal(refreshCalls,1);
  assert.ok(page.url().includes('/dashboard'),'provider expiry must not log the dashboard user out');
  await page.route('**/api/espn/start',route=>route.fulfill({json:{liveUrl:`${base}/test-browser`,expiresAt:new Date(Date.now()+600000).toISOString()}}));
  await page.route('**/test-browser',route=>route.fulfill({contentType:'text/html',body:'<p>Hosted browser test fixture</p>'}));
  await page.route('**/api/espn/complete',route=>route.fulfill({status:400,json:{error:'ESPN sign-in is incomplete.'}}));
  await page.getByRole('button',{name:/Reconnect ESPN/}).click();
  await page.locator('iframe[title="Hosted ESPN sign-in"]').waitFor();
  await page.getByRole('button',{name:/finished signing in/}).click();
  await page.getByRole('alert').filter({hasText:/Open a new ESPN/}).waitFor();
  assert.equal(await page.locator('iframe').count(),0,'failed completion must discard the closed remote browser');
  assert.deepEqual(errors,[]);
  console.log('UI smoke passed: homepage, email/social sign-in, account/recovery forms, roster display, expired-provider live pause. Screenshots: test-results/.');
} catch (error) {
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/failure.png',fullPage:true});
  console.error('Browser errors:',errors);
  throw error;
} finally { await browser.close(); }
