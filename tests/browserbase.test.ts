import test from 'node:test';
import assert from 'node:assert/strict';
import Browserbase from '@browserbasehq/sdk';
import { startEspnBrowser, finishEspnBrowser, stopEspnBrowser } from '../lib/browserbase';

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readonly url: string;
  readyState = 0;
  private readonly listeners = new Map<string, ((event: { data?: string }) => void)[]>();
  static closed = 0;
  static methods: string[] = [];
  static failOpen = false;
  static navigationError = false;

  constructor(url: string) {
    this.url = url;
    queueMicrotask(() => {
      if (FakeWebSocket.failOpen) { this.emit('error', {}); return; }
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open', {});
    });
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }

  send(raw: string): void {
    const request = JSON.parse(raw) as { id: number; method: string };
    FakeWebSocket.methods.push(request.method);
    const result = request.method === 'Target.getTargets'
      ? { targetInfos: [{ targetId: 'page-target', type: 'page' }] }
      : request.method === 'Target.attachToTarget'
        ? { sessionId: 'page-session' }
        : request.method === 'Page.navigate' && FakeWebSocket.navigationError
          ? { errorText: 'net::ERR_FAILED' }
        : request.method === 'Network.getAllCookies'
          ? { cookies: [{ name: 'SWID', value: 'test', domain: '.espn.com' }] }
          : {};
    queueMicrotask(() => this.emit('message', { data: JSON.stringify({ id: request.id, result }) }));
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    FakeWebSocket.closed += 1;
    queueMicrotask(() => this.emit('close', {}));
  }

  private emit(type: string, event: { data?: string }): void {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

test('hosted login uses native CDP, disables recording, and cleans up incomplete sign-in', async (t) => {
  const oldKey = process.env.BROWSERBASE_API_KEY;
  const oldProject = process.env.BROWSERBASE_PROJECT_ID;
  const oldWebSocket = globalThis.WebSocket;
  process.env.BROWSERBASE_API_KEY = 'test-key';
  process.env.BROWSERBASE_PROJECT_ID = 'test-project';
  FakeWebSocket.closed = 0;
  FakeWebSocket.methods = [];
  FakeWebSocket.failOpen = false;
  FakeWebSocket.navigationError = false;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  t.after(() => {
    if (oldKey === undefined) delete process.env.BROWSERBASE_API_KEY;
    else process.env.BROWSERBASE_API_KEY = oldKey;
    if (oldProject === undefined) delete process.env.BROWSERBASE_PROJECT_ID;
    else process.env.BROWSERBASE_PROJECT_ID = oldProject;
    globalThis.WebSocket = oldWebSocket;
  });
  let created: Record<string, unknown> = {};
  const releases: unknown[] = [];
  let completed = false;
  const info = () => ({
    id: 'test-session', connectUrl: 'wss://example.test', status: completed ? 'COMPLETED' : 'RUNNING',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  });
  t.mock.method(Browserbase.Sessions.prototype, 'create', (async (params: Record<string, unknown>) => {
    created = params;
    return info();
  }) as never);
  t.mock.method(Browserbase.Sessions.prototype, 'retrieve', (async () => info()) as never);
  t.mock.method(Browserbase.Sessions.prototype, 'debug', (async () => ({
    debuggerFullscreenUrl: 'https://www.browserbase.com/live/test',
  })) as never);
  t.mock.method(Browserbase.Sessions.prototype, 'update', (async (_id: string, params: Record<string, unknown>) => {
    releases.push(params.status);
    return info();
  }) as never);

  const started = await startEspnBrowser();
  assert.equal(started.sessionId, 'test-session');
  assert.equal(created.api_timeout, 600);
  assert.deepEqual(created.browserSettings, { logSession: false, recordSession: false, solveCaptchas: false });
  assert.deepEqual(FakeWebSocket.methods, ['Target.getTargets', 'Target.attachToTarget', 'Page.navigate']);
  await assert.rejects(() => finishEspnBrowser(started.sessionId), /incomplete/);
  assert.deepEqual(FakeWebSocket.methods.slice(-4), ['Target.getTargets', 'Target.attachToTarget', 'Network.enable', 'Network.getAllCookies']);
  assert.equal(FakeWebSocket.closed, 2);
  assert.deepEqual(releases, ['REQUEST_RELEASE']);
  completed = true;
  await stopEspnBrowser('test-session');
  assert.equal(releases.length, 1);

  FakeWebSocket.failOpen = true;
  await assert.rejects(() => startEspnBrowser(), /Could not start/);
  assert.equal(FakeWebSocket.closed, 3);
  FakeWebSocket.failOpen = false;
  FakeWebSocket.navigationError = true;
  await assert.rejects(() => startEspnBrowser(), /Could not start/);
  assert.equal(FakeWebSocket.closed, 4);
  assert.equal(releases.length, 3);
});
