import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('connector reads only the selected provider cookies from the app page', async () => {
  let listener: (message: unknown, sender: unknown, reply: (value: unknown) => void) => void = () => {};
  const names: string[] = [];
  const opened: string[] = [];
  const chrome = {
    runtime: { onMessage: { addListener(value: typeof listener) { listener = value; } } },
    cookies: { async get(input: { name: string }) { names.push(input.name); return { value: `${input.name}-value` }; } },
    tabs: { async create(input: { url: string }) { opened.push(input.url); } },
  };
  runInNewContext(readFileSync('extension/background.js', 'utf8'), { chrome, URL, Set, Object, Promise });
  const ask = (sender: string, provider: string) => new Promise<unknown>((resolve) => {
    listener({ type: 'tml-connect', provider, openLogin: true }, { url: sender }, resolve);
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await ask('https://toomanyleagues.alddimeo.workers.dev/dashboard', 'espn'))), {
    status: 'ready', credentials: { espn_s2: 'espn_s2-value', SWID: 'SWID-value' },
  });
  assert.deepEqual(names, ['espn_s2', 'SWID']);
  assert.deepEqual(opened, []);
  assert.deepEqual(JSON.parse(JSON.stringify(await ask('https://toomanyleagues.alddimeo.workers.dev/dashboard', 'yahoo'))), {
    status: 'ready', credentials: { Y: 'Y-value', T: 'T-value' },
  });
  assert.deepEqual(names, ['espn_s2', 'SWID', 'Y', 'T']);
  assert.equal(listener({ type: 'tml-connect', provider: 'espn' }, { url: 'https://evil.example/' }, () => {}), undefined);
});

test('connector sends credentials to the authenticated API without posting them to the page', async () => {
  const posted: unknown[] = [];
  let listener: (event: unknown) => Promise<void> = async () => {};
  let request: { url: string; body: string } | undefined;
  const window = {
    addEventListener(_name: string, value: typeof listener) { listener = value; },
    postMessage(value: unknown) { posted.push(value); },
  };
  const chrome = { runtime: { async sendMessage() { return { status: 'ready', credentials: { Y: 'secret-y', T: 'secret-t' } }; } } };
  const fetch = async (url: string, options: { body: string }) => {
    request = { url, body: options.body };
    return { ok: true, async json() { return { ok: true, leagues: [] }; } };
  };
  runInNewContext(readFileSync('extension/content.js', 'utf8'), { window, chrome, fetch, location: { origin: 'https://toomanyleagues.alddimeo.workers.dev' } });
  await listener({ source: window, origin: 'https://toomanyleagues.alddimeo.workers.dev', data: { source: 'too-many-leagues-app', id: 'request-1', action: 'connect', provider: 'yahoo' } });
  assert.equal(request?.url, '/api/yahoo/extension');
  assert.deepEqual(JSON.parse(request?.body || '{}'), { Y: 'secret-y', T: 'secret-t' });
  assert.ok(!JSON.stringify(posted).includes('secret-y'));
  assert.ok(posted.some((value) => (value as { status?: string }).status === 'connected'));
});
