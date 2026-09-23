import Browserbase from '@browserbasehq/sdk';
import { AppError } from './security';
import type { EspnLeagueOption } from './espn';

const SESSION_TIMEOUT_SECONDS = 600;
const ESPN_LOGIN_URL = 'https://fantasy.espn.com/';
const ESPN_LEAGUE_PAGES = [
  ESPN_LOGIN_URL,
  'https://fantasy.espn.com/football/',
  'https://fantasy.espn.com/football/my-teams',
  'https://fantasy.espn.com/football/leagues',
];
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CDP_TIMEOUT_MS = 15_000;

type JsonObject = Record<string, unknown>;

type CdpTarget = { targetId?: unknown; type?: unknown };
type CdpCookie = { name?: unknown; value?: unknown; domain?: unknown };

type CdpConnection = {
  send(method: string, params?: JsonObject, sessionId?: string): Promise<JsonObject>;
  close(): Promise<void>;
};

function config(): { client: Browserbase; projectId: string } {
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  const projectId = process.env.BROWSERBASE_PROJECT_ID?.trim();
  if (!apiKey || !projectId) throw new AppError('ESPN sign-in is not configured.', 503);
  return { client: new Browserbase({ apiKey, timeout: 15_000, maxRetries: 0 }), projectId };
}

function sessionId(value: string): string {
  if (!SESSION_ID.test(value)) throw new AppError('Invalid browser session.', 400);
  return value;
}

function safeBrowserError(error: unknown, fallback: string): AppError {
  return error instanceof AppError ? error : new AppError(fallback, 502);
}

function liveUrl(value: { debuggerFullscreenUrl?: string; debuggerUrl?: string; pages?: { debuggerFullscreenUrl?: string; debuggerUrl?: string }[] }): string {
  const url = value.debuggerFullscreenUrl || value.debuggerUrl || value.pages?.[0]?.debuggerFullscreenUrl || value.pages?.[0]?.debuggerUrl;
  if (!url) throw new AppError('Browser sign-in is unavailable.', 502);
  return `${url}${url.includes('?') ? '&' : '?'}navbar=false`;
}

function errorStatus(error: unknown): number | undefined {
  if (Browserbase.APIError && error instanceof Browserbase.APIError) return error.status;
  return error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status : undefined;
}

function cdpText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function cdpObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function cdpMessageText(value: unknown): Promise<string | null> {
  if (typeof value === 'string') return Promise.resolve(value);
  if (value instanceof ArrayBuffer) return Promise.resolve(new TextDecoder().decode(value));
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.text();
  return Promise.resolve(null);
}

function openCdp(url: string): Promise<CdpConnection> {
  if (!/^wss?:\/\//i.test(url)) throw new AppError('Browser sign-in is unavailable.', 502);
  const WebSocketConstructor = globalThis.WebSocket;
  if (typeof WebSocketConstructor !== 'function') throw new AppError('Browser sign-in is unavailable.', 502);
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    try {
      socket = new WebSocketConstructor(url);
    } catch {
      reject(new Error('CDP connection failed.'));
      return;
    }
    let nextId = 1;
    let connected = false;
    let closed = false;
    let settled = false;
    let connectionTimer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Map<number, { resolve: (result: JsonObject) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    const fail = (error: Error) => {
      for (const [id, request] of pending) {
        clearTimeout(request.timer);
        pending.delete(id);
        request.reject(error);
      }
      if (!settled) {
        settled = true;
        if (connectionTimer) clearTimeout(connectionTimer);
        reject(error);
      }
      closed = true;
      try { if (socket.readyState !== 3) socket.close(); } catch { /* already closing */ }
    };
    const close = (): Promise<void> => {
      if (closed || socket.readyState === 3) {
        closed = true;
        return Promise.resolve();
      }
      return new Promise((resolveClose) => {
        let done = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
          if (done) return;
          done = true;
          closed = true;
          if (timer) clearTimeout(timer);
          resolveClose();
        };
        timer = setTimeout(finish, CDP_TIMEOUT_MS);
        socket.addEventListener('close', () => {
          finish();
        });
        try { socket.close(); } catch { finish(); }
      });
    };
    const connection: CdpConnection = {
      send(method, params, sessionId) {
        if (closed || socket.readyState !== 1) return Promise.reject(new Error('CDP connection is closed.'));
        const id = nextId++;
        return new Promise((resolveResult, rejectResult) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            rejectResult(new Error('CDP command timed out.'));
          }, CDP_TIMEOUT_MS);
          pending.set(id, { resolve: resolveResult, reject: rejectResult, timer });
          try {
            socket.send(JSON.stringify({ id, method, ...(params ? { params } : {}), ...(sessionId ? { sessionId } : {}) }));
          } catch {
            clearTimeout(timer);
            pending.delete(id);
            rejectResult(new Error('CDP command failed.'));
          }
        });
      },
      close,
    };
    socket.addEventListener('open', () => {
      if (settled) return;
      connected = true;
      settled = true;
      if (connectionTimer) clearTimeout(connectionTimer);
      resolve(connection);
    });
    socket.addEventListener('message', (event) => {
      void cdpMessageText(event.data).then((raw) => {
        if (!raw) return;
        let message: JsonObject;
        try {
          const parsed = JSON.parse(raw);
          message = cdpObject(parsed) || {};
        } catch {
          fail(new Error('CDP response was invalid.'));
          return;
        }
        const responseId = typeof message.id === 'number' && Number.isInteger(message.id) ? message.id : null;
        if (responseId === null) return;
        const request = pending.get(responseId);
        if (!request) return;
        clearTimeout(request.timer);
        pending.delete(responseId);
        if (cdpObject(message.error)) request.reject(new Error('CDP command failed.'));
        else request.resolve(cdpObject(message.result) || {});
      }).catch(() => fail(new Error('CDP response was invalid.')));
    });
    socket.addEventListener('error', () => fail(new Error('CDP connection failed.')));
    socket.addEventListener('close', () => {
      closed = true;
      if (!connected) fail(new Error('CDP connection closed.'));
      else {
        for (const [id, request] of pending) {
          clearTimeout(request.timer);
          pending.delete(id);
          request.reject(new Error('CDP connection closed.'));
        }
      }
    });
    connectionTimer = setTimeout(() => fail(new Error('CDP connection timed out.')), CDP_TIMEOUT_MS);
  });
}

async function attachPage(connection: CdpConnection): Promise<string> {
  const targetResult = await connection.send('Target.getTargets');
  const targets = Array.isArray(targetResult.targetInfos) ? targetResult.targetInfos as CdpTarget[] : [];
  let targetId = cdpText(targets.find((target) => target.type === 'page')?.targetId);
  if (!targetId) {
    const created = await connection.send('Target.createTarget', { url: 'about:blank' });
    targetId = cdpText(created.targetId);
  }
  if (!targetId) throw new Error('CDP page target was unavailable.');
  const attached = await connection.send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = cdpText(attached.sessionId);
  if (!sessionId) throw new Error('CDP page session was unavailable.');
  return sessionId;
}

async function release(client: Browserbase, id: string, projectId: string): Promise<void> {
  try {
    await client.sessions.update(id, { status: 'REQUEST_RELEASE', projectId });
  } catch (error) {
    if (errorStatus(error) === 404 || errorStatus(error) === 409) return;
    throw error;
  }
}

export async function startEspnBrowser(): Promise<{ sessionId: string; liveUrl: string; expiresAt: string }> {
  const { client, projectId } = config();
  let created: Awaited<ReturnType<Browserbase['sessions']['create']>> | undefined;
  let connection: CdpConnection | undefined;
  try {
    created = await client.sessions.create({
      projectId,
      keepAlive: true,
      api_timeout: SESSION_TIMEOUT_SECONDS,
      browserSettings: { logSession: false, recordSession: false, solveCaptchas: false, viewport: { width: 1024, height: 576 } },
    });
    const id = sessionId(created.id);
    if (!created.connectUrl) throw new AppError('Browser sign-in is unavailable.', 502);
    connection = await openCdp(created.connectUrl);
    const pageSessionId = await attachPage(connection);
    const navigation = await connection.send('Page.navigate', { url: ESPN_LOGIN_URL }, pageSessionId);
    if (typeof navigation.errorText === 'string' && navigation.errorText) throw new Error('CDP navigation failed.');
    const debug = await client.sessions.debug(id, { expiresIn: SESSION_TIMEOUT_SECONDS });
    const url = liveUrl(debug);
    await connection.close();
    connection = undefined;
    return {
      sessionId: id,
      liveUrl: url,
      expiresAt: created.expiresAt || new Date(Date.now() + SESSION_TIMEOUT_SECONDS * 1000).toISOString(),
    };
  } catch (error) {
    try { await connection?.close(); } catch { /* cleanup below still runs */ }
    if (created?.id) {
      try { await release(client, created.id, projectId); } catch { /* best effort after an upstream failure */ }
    }
    throw safeBrowserError(error, 'Could not start ESPN sign-in.');
  }
}

function espnDomain(domain: string): boolean {
  const value = domain.toLowerCase().replace(/^\./, '');
  return value === 'espn.com' || value.endsWith('.espn.com');
}

function cookieValue(cookies: CdpCookie[], name: string): string | null {
  const cookie = cookies.find((item) => item.name === name && typeof item.domain === 'string' && espnDomain(item.domain)
    && typeof item.value === 'string' && item.value && !/[\u0000-\u001f\u007f;]/.test(item.value));
  return typeof cookie?.value === 'string' ? cookie.value : null;
}

function cleanLeagueName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
}

export function parseEspnLeagueLinks(value: unknown, fallbackSeason: number): EspnLeagueOption[] {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return []; }
  }
  const page = cdpObject(parsed);
  const options = new Map<string, EspnLeagueOption>();
  const add = (hrefValue: unknown, nameValue: unknown) => {
    const href = typeof hrefValue === 'string' ? hrefValue : '';
    const match = href.match(/(?:[?&#]|^)(?:leagueId|leagueID)=(\d{1,12})/i)
      || href.match(/(?:leagueId|leagueID)\s*["']?\s*[:=]\s*["']?(\d{1,12})/i);
    if (!match) return;
    const seasonMatch = href.match(/(?:[?&#]|^)(?:seasonId|season)=(\d{4})/i);
    const season = seasonMatch ? Number(seasonMatch[1]) : fallbackSeason;
    if (!Number.isInteger(season) || season < 2018 || season > new Date().getFullYear() + 1) return;
    const id = match[1];
    const name = cleanLeagueName(nameValue);
    const existing = options.get(`${id}:${season}`);
    if (!existing || (existing.name.startsWith('ESPN League ') && name)) {
      options.set(`${id}:${season}`, { id, name: name || existing?.name || `ESPN League ${id}`, season });
    }
  };
  const links = Array.isArray(page?.links) ? page.links : [];
  for (const link of links) {
    const item = cdpObject(link);
    if (item) add(item.href, item.name);
  }
  if (!options.size) {
    const raw = typeof page?.raw === 'string' ? page.raw : '';
    for (const match of raw.matchAll(/(?:leagueId|leagueID)\s*["']?\s*[:=]\s*["']?(\d{1,12})/gi)) add(`?leagueId=${match[1]}`, '');
  }
  add(page?.href, page?.title);
  return [...options.values()].slice(0, 10);
}

const LEAGUE_PAGE_SCRIPT = `JSON.stringify((() => {
  const links = [...document.querySelectorAll('a[href], [data-league-id]')].map((element) => ({
    href: element.getAttribute('href') || (element.getAttribute('data-league-id') ? '?leagueId=' + element.getAttribute('data-league-id') : ''),
    name: (element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
  }));
  const raw = (document.documentElement && document.documentElement.outerHTML || '').slice(0, 250000);
  return { href: location.href, title: document.title, links, raw };
})())`;

function evaluatedText(value: JsonObject): string | null {
  return cdpText(cdpObject(value.result)?.value);
}

async function discoverEspnLeagues(connection: CdpConnection, pageSessionId: string, season: number): Promise<EspnLeagueOption[]> {
  for (const url of ESPN_LEAGUE_PAGES) {
    try {
      if (url !== ESPN_LOGIN_URL) {
        const navigation = await connection.send('Page.navigate', { url }, pageSessionId);
        if (typeof navigation.errorText === 'string' && navigation.errorText) continue;
      }
      const evaluated = await connection.send('Runtime.evaluate', {
        expression: `new Promise((resolve) => setTimeout(() => resolve(${LEAGUE_PAGE_SCRIPT}), 1200))`,
        awaitPromise: true,
        returnByValue: true,
      }, pageSessionId);
      const found = parseEspnLeagueLinks(evaluatedText(evaluated), season);
      if (found.length) return found;
    } catch {
      // Discovery is best effort; the authenticated cookies remain useful for manual fallback.
    }
  }
  return [];
}

export async function finishEspnBrowser(session: string): Promise<{ espn_s2: string; SWID: string; leagues: EspnLeagueOption[] }> {
  const id = sessionId(session);
  const { client, projectId } = config();
  let connection: CdpConnection | undefined;
  let result: { espn_s2: string; SWID: string; leagues: EspnLeagueOption[] } | undefined;
  let failure: unknown;
  try {
    const saved = await client.sessions.retrieve(id);
    if (!saved.connectUrl) throw new AppError('Browser sign-in expired. Start again.', 409);
    connection = await openCdp(saved.connectUrl);
    const pageSessionId = await attachPage(connection);
    await connection.send('Network.enable', {}, pageSessionId);
    const cookieResult = await connection.send('Network.getAllCookies', {}, pageSessionId);
    const cookies = Array.isArray(cookieResult.cookies) ? cookieResult.cookies as CdpCookie[] : [];
    const espnS2 = cookieValue(cookies, 'espn_s2');
    const swid = cookieValue(cookies, 'SWID');
    if (!espnS2 || !swid) throw new AppError('ESPN sign-in is incomplete. Sign in and try again.', 400);
    result = { espn_s2: espnS2, SWID: swid, leagues: await discoverEspnLeagues(connection, pageSessionId, new Date().getFullYear()) };
  } catch (error) {
    failure = safeBrowserError(error, 'Could not read ESPN sign-in.');
  }
  try { await connection?.close(); } catch (error) { if (!failure) failure = safeBrowserError(error, 'Could not close ESPN sign-in.'); }
  try { await release(client, id, projectId); } catch (error) { if (!failure) failure = safeBrowserError(error, 'Could not stop ESPN sign-in.'); }
  if (failure) throw failure;
  return result as { espn_s2: string; SWID: string; leagues: EspnLeagueOption[] };
}

export async function stopEspnBrowser(session: string): Promise<void> {
  const id = sessionId(session);
  const { client, projectId } = config();
  try {
    const current = await client.sessions.retrieve(id);
    if (current.status === 'COMPLETED' || current.status === 'TIMED_OUT') return;
    await release(client, id, projectId);
  } catch (error) {
    if (errorStatus(error) === 404 || errorStatus(error) === 409) return;
    throw safeBrowserError(error, 'Could not stop ESPN sign-in.');
  }
}
