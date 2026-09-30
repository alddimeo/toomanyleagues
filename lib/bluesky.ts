export type BlueskySource = { actor: string; label: string; unofficial?: boolean };
export type BlueskyMedia = { type: 'image'; url: string; alt: string } | { type: 'video'; playlist: string; thumbnail?: string };
export type BlueskyPost = BlueskySource & { id: string; text: string; createdAt: string; url: string; displayName: string; avatar?: string; media: BlueskyMedia[] };

const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const safeUrl = (value: unknown, hosts: string[]) => {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && hosts.includes(url.hostname) ? url.href : undefined;
  } catch { return undefined; }
};

export function parseBlueskyFeed(value: unknown, source: BlueskySource): BlueskyPost[] {
  const feed = object(value)?.feed;
  if (!Array.isArray(feed)) return [];
  return feed.flatMap((entry): BlueskyPost[] => {
    const post = object(object(entry)?.post);
    const author = object(post?.author);
    const record = object(post?.record);
    const uri = typeof post?.uri === 'string' ? post.uri : '';
    const id = uri.split('/').at(-1) ?? '';
    const text = typeof record?.text === 'string' ? record.text.trim() : '';
    const createdAt = typeof record?.createdAt === 'string' && Number.isFinite(Date.parse(record.createdAt)) ? record.createdAt : '';
    if (author?.handle !== source.actor || !id || !text || !createdAt) return [];
    const embed = object(post?.embed);
    const mediaView = object(embed?.media) ?? embed;
    const images = Array.isArray(mediaView?.images) ? mediaView.images.flatMap((value): BlueskyMedia[] => {
      const image = object(value), url = safeUrl(image?.thumb, ['cdn.bsky.app']);
      return url ? [{ type: 'image', url, alt: typeof image?.alt === 'string' ? image.alt.slice(0, 1000) : '' }] : [];
    }) : [];
    const playlist = String(mediaView?.$type ?? '').includes('video') ? safeUrl(mediaView?.playlist, ['video.bsky.app']) : undefined;
    const media: BlueskyMedia[] = playlist ? [...images, { type: 'video', playlist, thumbnail: safeUrl(mediaView?.thumbnail, ['video.bsky.app']) }] : images;
    return [{ ...source, id, text: text.slice(0, 500), createdAt, url: `https://bsky.app/profile/${source.actor}/post/${id}`, displayName: typeof author.displayName === 'string' && author.displayName.trim() ? author.displayName.trim().slice(0, 100) : source.label, avatar: safeUrl(author.avatar, ['cdn.bsky.app']), media }];
  });
}
