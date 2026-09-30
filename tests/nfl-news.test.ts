import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeTankPlayerNews, parseRotowirePlayerNews, parseTankPlayerNews } from '../lib/nfl-news';

test('matches a player and safely parses the public RotoWire NFL feed', () => {
  const xml = `<rss><channel><item><guid>nfl1</guid><title>A.J. Brown: Back at practice</title><link>https://www.rotowire.com//football/player/aj-brown-1</link><description>Brown practiced &amp; expects to play.\n\nVisit RotoWire.com for more analysis on this update.</description><pubDate>Tue, 29 Sep 2026 1:38:00 PM PDT</pubDate></item><item><title>Other Player: Update</title></item></channel></rss>`;
  assert.deepEqual(parseRotowirePlayerNews(xml, 'AJ Brown'), [{
    id: 'nfl1',
    headline: 'Back at practice',
    blurb: 'Brown practiced & expects to play.',
    publishedAt: '2026-09-29T20:38:00.000Z',
    url: 'https://www.rotowire.com//football/player/aj-brown-1',
    source: 'RotoWire',
  }]);
});

test('matches and normalizes Tank01 player news', () => {
  assert.deepEqual(parseTankPlayerNews({ body: [{
    title: 'A.J. Brown: Brown practiced in full &amp; is expected to play.',
    link: 'https://x.com/Reporter/status/2105072248533258467?s=20',
  }, { title: 'Other Player: Not relevant', link: 'https://example.com/other' }] }, 'AJ Brown'), [{
    id: 'https://x.com/Reporter/status/2105072248533258467?s=20', headline: 'Latest update', blurb: 'Brown practiced in full & is expected to play.',
    publishedAt: new Date(Number((2105072248533258467n >> 22n) + 1_288_834_974_657n)).toISOString(), url: 'https://x.com/Reporter/status/2105072248533258467?s=20', source: 'Tank01',
  }]);
});

test('keeps the latest saved item when a player falls out of the refreshed Tank01 feed', () => {
  const saved = parseTankPlayerNews({ body: [{ title: 'Josh Allen: Older saved update', link: 'https://example.com/allen' }] }, 'Josh Allen', Date.parse('2026-09-28T12:00:00Z'))[0];
  const merged = mergeTankPlayerNews({ joshallen: saved }, { body: [{ title: 'A.J. Brown: New update', link: 'https://example.com/brown' }] }, Date.parse('2026-09-30T12:00:00Z'));
  assert.equal(merged.joshallen.blurb, 'Older saved update');
  assert.equal(merged.ajbrown.blurb, 'New update');
});
