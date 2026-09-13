import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { seal,unseal,checkOrigin,leagueInput,sameSecret,body,verifyOAuthState } from '../lib/security';

test('credentials are authenticated and bound to their user and provider',()=>{
  process.env.CREDENTIAL_ENCRYPTION_KEY=randomBytes(32).toString('base64');
  const value={accessToken:'secret-token'}, encrypted=seal(value,'alice:yahoo');
  assert.deepEqual(unseal(encrypted,'alice:yahoo'),value);
  assert.ok(!encrypted.includes('secret-token'));
  assert.throws(()=>unseal(encrypted,'bob:yahoo'));
  assert.throws(()=>unseal(encrypted,'alice:espn'));
  const damaged=Buffer.from(encrypted,'base64'); damaged[30]^=1;
  assert.throws(()=>unseal(damaged.toString('base64'),'alice:yahoo'));
});
test('OAuth return requires matching browser and account nonces before expiry',()=>{
  const pending={nonce:'a'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString()};
  verifyOAuthState(pending.nonce,pending.nonce,pending);
  assert.throws(()=>verifyOAuthState('forged',pending.nonce,pending));
  assert.throws(()=>verifyOAuthState(pending.nonce,'another-browser',pending));
  assert.throws(()=>verifyOAuthState(pending.nonce,pending.nonce,{...pending,expiresAt:new Date(0).toISOString()}));
  assert.throws(()=>verifyOAuthState(pending.nonce,pending.nonce));
});
test('mutation origin and league inputs reject cross-site requests and URLs',async()=>{
  process.env.APP_URL='http://localhost:3000';
  checkOrigin(new Request('http://localhost:3000/api/refresh',{headers:{origin:'http://localhost:3000'}}));
  assert.throws(()=>checkOrigin(new Request('http://localhost:3000/api/refresh',{headers:{origin:'https://evil.example'}})));
  assert.throws(()=>checkOrigin(new Request('http://localhost:3000/api/refresh')));
  assert.deepEqual(leagueInput({provider:'espn',leagueId:'123',season:2026}),{provider:'espn',id:'123',season:2026});
  assert.deepEqual(leagueInput({provider:'yahoo',leagueId:'nfl.l.123',season:2026}),{provider:'yahoo',id:'nfl.l.123',season:2026});
  assert.throws(()=>leagueInput({provider:'espn',leagueId:'https://evil.example',season:2026}));
  assert.throws(()=>leagueInput({provider:'yahoo',leagueId:'461.l.1/players',season:2026}));
  assert.throws(()=>leagueInput({provider:'espn',leagueId:'123',season:1}));
  assert.equal(sameSecret('abc','abcd'),false);
  await assert.rejects(()=>body(new Request('http://localhost',{method:'POST',body:'[]'})));
  await assert.rejects(()=>body(new Request('http://localhost',{method:'POST',body:JSON.stringify({value:'x'.repeat(5000)})})),/too large/);
});
