import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBlueskyFeed } from '../lib/bluesky';

test('parses safe authored Bluesky posts and ignores reposts or malformed records', () => {
  const source = { actor: 'espn.com', label: 'ESPN' };
  const post = (handle: string, id: string, text: unknown, createdAt: unknown, embed?: unknown) => ({ post: { uri: `at://did/app.bsky.feed.post/${id}`, author: { handle, displayName: 'ESPN', avatar: 'https://cdn.bsky.app/avatar.jpg' }, record: { text, createdAt }, embed } });
  assert.deepEqual(parseBlueskyFeed({ feed: [post('espn.com', 'one', ' NFL update ', '2026-09-29T17:00:00Z', { $type: 'app.bsky.embed.images#view', images: [{ thumb: 'https://cdn.bsky.app/photo.jpg', alt: 'Touchdown' }] }), post('other.test', 'two', 'Repost', '2026-09-29T17:01:00Z'), post('espn.com', 'three', '', 'bad')] }, source), [{ ...source, id: 'one', text: 'NFL update', createdAt: '2026-09-29T17:00:00Z', url: 'https://bsky.app/profile/espn.com/post/one', displayName: 'ESPN', avatar: 'https://cdn.bsky.app/avatar.jpg', media: [{ type: 'image', url: 'https://cdn.bsky.app/photo.jpg', alt: 'Touchdown' }] }]);
});

test('parses Bluesky video and record-with-media views while rejecting foreign media hosts', () => {
  const source = { actor: 'espn.com', label: 'ESPN' };
  const feed = { feed: [{ post: { uri: 'at://did/app.bsky.feed.post/video', author: { handle: 'espn.com' }, record: { text: 'Highlights', createdAt: '2026-09-29T17:00:00Z' }, embed: { $type: 'app.bsky.embed.recordWithMedia#view', media: { $type: 'app.bsky.embed.video#view', playlist: 'https://video.bsky.app/watch/playlist.m3u8', thumbnail: 'https://evil.test/tracker.jpg' } } } }] };
  assert.deepEqual(parseBlueskyFeed(feed, source)[0]?.media, [{ type: 'video', playlist: 'https://video.bsky.app/watch/playlist.m3u8', thumbnail: undefined }]);
});
