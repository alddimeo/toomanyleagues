import { getCloudflareContext } from '@opennextjs/cloudflare';

type NewsCache = {
  get<T>(key: string, type: 'json'): Promise<T | null>;
  put(key: string, value: string): Promise<void>;
};
declare global { interface CloudflareEnv { NFL_NEWS_CACHE?: NewsCache } }

export type NflPlayerNews = { id: string; headline: string; blurb: string; publishedAt: string; url: string; source: 'Tank01' | 'RotoWire' };

const TANK_URL = 'https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com/getNFLNews?fantasyNews=true&recentNews=true&maxItems=100';
const TANK_CACHE_KEY = 'tank01:nfl-news:v2';
const FRESH_MS = 60 * 60_000;
type TankCache = { fetchedAt: number; players: Record<string, NflPlayerNews> };
type TankArticle = NflPlayerNews & { player: string };
let memoryCache: TankCache | null = null;
let tankRequest: Promise<TankCache> | null = null;

const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const array = (value: unknown) => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : '';

function firstText(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) { const found = text(value[key]); if (found) return found; }
  return '';
}

function safeDate(value: unknown) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^\d{10,13}$/.test(value) ? Number(value) : NaN;
  const date = new Date(Number.isFinite(numeric) ? numeric * (numeric < 1e12 ? 1000 : 1) : String(value ?? ''));
  return Number.isFinite(date.valueOf()) ? date.toISOString() : '';
}

function postDate(url: string) {
  const id = url.match(/\/status\/(\d+)/)?.[1];
  if (!id) return '';
  try { return new Date(Number((BigInt(id) >> 22n) + 1_288_834_974_657n)).toISOString(); }
  catch { return ''; }
}

function plainText(value: string) {
  return decodeXml(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
}

function decodeXml(value: string) {
  return value.trim().replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/gi, (_, entity: string) => {
    if (entity[0] === '#') return String.fromCodePoint(Number.parseInt(entity.slice(entity[1]?.toLowerCase() === 'x' ? 2 : 1), entity[1]?.toLowerCase() === 'x' ? 16 : 10));
    return ({ amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' } as Record<string, string>)[entity.toLowerCase()];
  });
}

function field(item: string, name: string) {
  return decodeXml(item.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '');
}

const playerKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export function parseRotowirePlayerNews(xml: string, playerName: string): NflPlayerNews[] {
  const wanted = playerKey(playerName);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].flatMap(([, item]) => {
    const title = field(item, 'title');
    const separator = title.indexOf(':');
    if (separator < 1 || playerKey(title.slice(0, separator)) !== wanted) return [];
    const url = field(item, 'link');
    const publishedAt = new Date(field(item, 'pubDate'));
    if (!/^https:\/\/www\.rotowire\.com\/+(?:football\/player\/)/i.test(url) || !Number.isFinite(publishedAt.valueOf())) return [];
    return [{
      id: field(item, 'guid') || url,
      headline: title.slice(separator + 1).trim(),
      blurb: field(item, 'description').replace(/\s*Visit RotoWire\.com for more analysis on this update\.\s*$/i, '').trim(),
      publishedAt: publishedAt.toISOString(),
      url,
      source: 'RotoWire' as const,
    }];
  }).filter((item) => item.blurb).slice(0, 3);
}

function parseTankNews(value: unknown, observedAt = Date.now()): TankArticle[] {
  const root = object(value);
  return array(root?.body ?? value).flatMap((entry): TankArticle[] => {
    const article = object(entry);
    if (!article) return [];
    const title = plainText(firstText(article, 'title', 'headline', 'newsTitle'));
    const separator = title.indexOf(':');
    const player = plainText(firstText(article, 'playerName', 'player', 'athleteName')) || (separator > 0 ? title.slice(0, separator).trim() : '');
    const description = plainText(firstText(article, 'description', 'summary', 'content', 'news', 'body'));
    const blurb = description || (separator > 0 ? title.slice(separator + 1).trim() : '');
    const url = firstText(article, 'link', 'url', 'articleUrl');
    const publishedAt = safeDate(article.publishedAt ?? article.published ?? article.pubDate ?? article.date ?? article.createdAt ?? article.epoch) || postDate(url) || new Date(observedAt).toISOString();
    if (!player || !blurb || !/^https:\/\//i.test(url)) return [];
    return [{ player, id: firstText(article, 'id', 'newsID', 'articleID') || url, headline: description ? title : 'Latest update', blurb, publishedAt, url, source: 'Tank01' }];
  });
}

export function parseTankPlayerNews(value: unknown, playerName: string, observedAt = Date.now()): NflPlayerNews[] {
  const wanted = playerKey(playerName);
  return parseTankNews(value, observedAt).filter((item) => playerKey(item.player) === wanted)
    .map(({ player: _player, ...item }) => item)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 3);
}

export function mergeTankPlayerNews(current: Record<string, NflPlayerNews>, value: unknown, observedAt = Date.now()) {
  const players = { ...current };
  for (const { player, ...news } of parseTankNews(value, observedAt)) {
    const key = playerKey(player), saved = players[key];
    if (!key || saved?.id === news.id) continue;
    if (!saved || Date.parse(news.publishedAt) > Date.parse(saved.publishedAt)) players[key] = news;
  }
  return players;
}

async function tankCache(): Promise<NewsCache | undefined> {
  try { return (await getCloudflareContext({ async: true })).env.NFL_NEWS_CACHE; }
  catch { return undefined; }
}

async function fetchTankNews(): Promise<TankCache> {
  const key = process.env.TANK01_API_KEY;
  const cache = await tankCache();
  const stored = memoryCache ?? await cache?.get<TankCache>(TANK_CACHE_KEY, 'json') ?? null;
  const now = Date.now();
  if (stored && now - stored.fetchedAt < FRESH_MS) return stored;
  if (!key) {
    if (stored) return stored;
    throw new Error('Tank01 is not configured.');
  }
  if (tankRequest) return tankRequest;
  tankRequest = (async () => {
    try {
      const response = await fetch(TANK_URL, { headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': new URL(TANK_URL).hostname }, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('Tank01 news is unavailable.');
      const length = Number(response.headers.get('Content-Length'));
      if (Number.isFinite(length) && length > 2_000_000) throw new Error('Invalid Tank01 news response.');
      const raw = await response.text();
      if (raw.length > 2_000_000) throw new Error('Invalid Tank01 news response.');
      const result = { fetchedAt: now, players: mergeTankPlayerNews(stored?.players ?? {}, JSON.parse(raw), now) } satisfies TankCache;
      memoryCache = result;
      await cache?.put(TANK_CACHE_KEY, JSON.stringify(result));
      return result;
    } catch (error) {
      if (stored) return stored;
      throw error;
    } finally { tankRequest = null; }
  })();
  return tankRequest;
}

export async function fetchNflPlayerNews(playerName: string): Promise<NflPlayerNews[]> {
  try {
    const tank = (await fetchTankNews()).players[playerKey(playerName)];
    if (tank) return [tank];
  } catch { /* RotoWire's public feed is the no-key/outage fallback. */ }
  return fetchRotowirePlayerNews(playerName);
}

export async function fetchRotowirePlayerNews(playerName: string): Promise<NflPlayerNews[]> {
  const response = await fetch('https://www.rotowire.com/rss/news.php?sport=NFL', {
    next: { revalidate: 600 },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Player news is unavailable.');
  const length = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > 1_000_000) throw new Error('Invalid player news response.');
  const xml = await response.text();
  if (xml.length > 1_000_000) throw new Error('Invalid player news response.');
  return parseRotowirePlayerNews(xml, playerName);
}
