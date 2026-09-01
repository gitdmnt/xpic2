/**
 * GraphQL レスポンスの正規化。
 *
 * X のタイムライン JSON は instructions / entries / itemContent と入れ子が深く、
 * エンドポイントごとに形も違う。構造を決め打ちすると壊れやすいので、
 * ここでは JSON 全体を歩いて __typename === 'Tweet' のノードとカーソルを拾う。
 *
 * 入力は X から来る未知の JSON なので unknown を起点にし、
 * 型ガードで必要な形だけを取り出す。any は使わない。
 */

import type { Filters, Media, MediaType, Tweet } from '../shared/types.ts';

const SKIP_KEYS_BASE = new Set(['card', 'birdwatch_pivot', 'unmention_info', 'edit_control']);

/** 壊れた JSON で無限に潜らないための保険。実データはこの半分にも届かない。 */
const MAX_DEPTH = 40;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 途中のキーが欠けていても undefined を返すだけの安全なプロパティ辿り。 */
function dig(node: unknown, ...keys: string[]): unknown {
  let cur: unknown = node;
  for (const key of keys) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

const MEDIA_TYPES: readonly string[] = ['photo', 'video', 'animated_gif'];

/** Media.type は閉じた union なので、未知の種類は取り込まない（後段のフィルタでも落ちる）。 */
function asMediaType(value: unknown): MediaType | null {
  return typeof value === 'string' && MEDIA_TYPES.includes(value) ? (value as MediaType) : null;
}

interface WalkOptions {
  includeQuoted: boolean;
}

function walk(node: unknown, visit: (node: JsonRecord) => void, opts: WalkOptions, depth = 0): void {
  if (node === null || typeof node !== 'object' || depth > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    for (const v of node) walk(v, visit, opts, depth + 1);
    return;
  }
  const obj = node as JsonRecord;
  visit(obj);
  for (const [k, v] of Object.entries(obj)) {
    if (SKIP_KEYS_BASE.has(k)) continue;
    // リツイートは normalizeTweet が中身へ潜るので、ここで再訪すると二重になる
    if (k === 'retweeted_status_result') continue;
    if (!opts.includeQuoted && k === 'quoted_status_result') continue;
    walk(v, visit, opts, depth + 1);
  }
}

/** mp4 の最高ビットレートを選ぶ。無ければ HLS。同点なら先に現れたものを残す。 */
function bestVariant(variants: unknown): string | null {
  const list = asArray(variants) ?? [];
  let best: { url: string; bitrate: number } | null = null;
  let hls: string | null = null;
  for (const v of list) {
    if (!isRecord(v)) continue;
    const url = asString(v.url);
    if (!url) continue;
    const contentType = asString(v.content_type);
    if (contentType === 'video/mp4') {
      const bitrate = asNumber(v.bitrate) ?? 0;
      if (!best || bitrate > best.bitrate) best = { url, bitrate };
    } else if (contentType === 'application/x-mpegURL' && hls === null) {
      hls = url;
    }
  }
  return best ? best.url : hls;
}

function normalizeMedia(raw: unknown): Media | null {
  if (!isRecord(raw)) return null;
  // url を持たないメディアは表示できないので捨てる
  const url = asString(raw.media_url_https);
  if (!url) return null;
  const type = asMediaType(raw.type);
  if (!type) return null;

  const width = asNumber(dig(raw, 'original_info', 'width')) ?? asNumber(dig(raw, 'sizes', 'large', 'w')) ?? 0;
  const height = asNumber(dig(raw, 'original_info', 'height')) ?? asNumber(dig(raw, 'sizes', 'large', 'h')) ?? 0;

  const media: Media = {
    key: asString(raw.media_key) ?? asString(raw.id_str) ?? url,
    type,
    url,
    width,
    height,
    alt: asString(raw.ext_alt_text) ?? null,
  };

  if (type === 'video' || type === 'animated_gif') {
    media.video = bestVariant(dig(raw, 'video_info', 'variants'));
    media.durationMs = asNumber(dig(raw, 'video_info', 'duration_millis')) ?? null;
    const ratio = asArray(dig(raw, 'video_info', 'aspect_ratio'));
    // 実寸が取れないときだけ縦横比で代用する。masonry は比だけ分かれば積める。
    if (ratio && ratio.length === 2 && (!width || !height)) {
      media.width = (asNumber(ratio[0]) ?? 0) * 100;
      media.height = (asNumber(ratio[1]) ?? 0) * 100;
    }
  }
  return media;
}

/** legacy を持つ実体ノードまで剥がす。可視性ラッパと墓標をここで吸収する。 */
function tweetLegacy(result: unknown): JsonRecord | null {
  if (!isRecord(result)) return null;
  if (result.__typename === 'TweetWithVisibilityResults') return tweetLegacy(result.tweet);
  if (result.__typename === 'TweetTombstone') return null;
  return isRecord(result.legacy) ? result : null;
}

function normalizeTweet(result: unknown, retweetedBy: Tweet['retweetedBy'] = null): Tweet | null {
  const t = tweetLegacy(result);
  if (!t) return null;
  const legacy = t.legacy;
  if (!isRecord(legacy)) return null;

  // リツイートは元ポストを実体として扱う。外側は作者も本文も RT のラッパでしかない。
  const inner = dig(legacy, 'retweeted_status_result', 'result');
  if (inner) {
    const u = dig(t, 'core', 'user_results', 'result');
    return normalizeTweet(inner, {
      name: asString(dig(u, 'core', 'name')) ?? asString(dig(u, 'legacy', 'name')) ?? '',
      screenName: asString(dig(u, 'core', 'screen_name')) ?? asString(dig(u, 'legacy', 'screen_name')) ?? '',
    });
  }

  const user = dig(t, 'core', 'user_results', 'result');
  const screenName =
    asString(dig(user, 'core', 'screen_name')) ?? asString(dig(user, 'legacy', 'screen_name')) ?? 'i';
  const name = asString(dig(user, 'core', 'name')) ?? asString(dig(user, 'legacy', 'name')) ?? screenName;

  const mediaRaw =
    asArray(dig(legacy, 'extended_entities', 'media')) ?? asArray(dig(legacy, 'entities', 'media')) ?? [];
  const media = mediaRaw.map(normalizeMedia).filter((m): m is Media => m !== null);
  // 画像も動画も無いポストはこのアプリの対象外
  if (!media.length) return null;

  // 長文ポストは full_text が途中で切れるので note_tweet を優先する
  const noteText = asString(dig(t, 'note_tweet', 'note_tweet_results', 'result', 'text'));
  const rawText = noteText ?? asString(legacy.full_text) ?? '';
  // 末尾の t.co はメディア自身への短縮リンクで、本文としては意味がない
  const text = rawText.replace(/https:\/\/t\.co\/\w+\s*$/, '').trim();

  const id = asString(legacy.id_str) ?? asString(t.rest_id) ?? '';
  const createdAt = asString(legacy.created_at);
  const avatarRaw =
    asString(dig(user, 'avatar', 'image_url')) ?? asString(dig(user, 'legacy', 'profile_image_url_https')) ?? '';

  return {
    id,
    url: `https://x.com/${screenName}/status/${id}`,
    text,
    lang: asString(legacy.lang),
    createdAt: createdAt ? new Date(createdAt).toISOString() : null,
    sensitive: Boolean(legacy.possibly_sensitive),
    isRetweet: Boolean(retweetedBy),
    retweetedBy,
    isReply: Boolean(legacy.in_reply_to_status_id_str),
    user: {
      name,
      screenName,
      // _normal は 48px と小さすぎるので、同じ CDN の 96px 版へ差し替える
      avatar: avatarRaw.replace('_normal.', '_x96.'),
      verified: Boolean(dig(user, 'is_blue_verified') || dig(user, 'legacy', 'verified')),
    },
    stats: {
      replies: asNumber(legacy.reply_count) ?? 0,
      retweets: asNumber(legacy.retweet_count) ?? 0,
      likes: asNumber(legacy.favorite_count) ?? 0,
      // views.count は文字列で来る
      views: Number(dig(t, 'views', 'count') ?? 0) || 0,
      bookmarks: asNumber(legacy.bookmark_count) ?? 0,
    },
    // 自分が既に掛けた操作。欠けていれば「まだ掛けていない」に寄せる。
    viewer: {
      liked: Boolean(legacy.favorited),
      retweeted: Boolean(legacy.retweeted),
      bookmarked: Boolean(legacy.bookmarked),
    },
    media,
  };
}

export interface ExtractTimelineOptions {
  /** 真なら quoted_status_result の中のポストも拾う。既定は拾わない。 */
  includeQuoted?: boolean;
}

export function extractTimeline(
  json: unknown,
  { includeQuoted = false }: ExtractTimelineOptions = {}
): { items: Tweet[]; cursor: string | null } {
  const items: Tweet[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let fallbackCursor: string | null = null;

  walk(
    json,
    (node) => {
      const tn = node.__typename;
      if (tn === 'Tweet' || tn === 'TweetWithVisibilityResults') {
        const t = normalizeTweet(node);
        if (t && !seen.has(t.id)) {
          seen.add(t.id);
          items.push(t);
        }
        return;
      }
      // カーソルの入れ物はエンドポイントごとに違うので、形ではなく中身で判定する
      if (typeof node.cursorType === 'string' && typeof node.value === 'string') {
        if (node.cursorType === 'Bottom') cursor = node.value;
        else if (!fallbackCursor && node.cursorType !== 'Top') fallbackCursor = node.value;
      }
    },
    { includeQuoted }
  );

  return { items, cursor: cursor ?? fallbackCursor };
}

export function extractUserId(json: unknown): string | null {
  const direct = asString(dig(json, 'data', 'user', 'result', 'rest_id'));
  if (direct) return direct;

  let found: string | null = null;
  walk(
    json,
    (node) => {
      if (found) return;
      const restId = asString(node.rest_id);
      // rest_id は Tweet も持つので、User だと分かる手掛かりを添えて絞る
      if (restId && (node.__typename === 'User' || asString(dig(node, 'legacy', 'screen_name')))) found = restId;
    },
    { includeQuoted: true }
  );
  return found;
}

/** 画像/動画の種類とリツイート可否でふるいにかける。 */
export function filterItems(items: Tweet[], filters: Partial<Filters> = {}): Tweet[] {
  const { photos = true, videos = true, gifs = true, retweets = true, replies = true } = filters;
  const allow = new Set<MediaType>();
  if (photos) allow.add('photo');
  if (videos) allow.add('video');
  if (gifs) allow.add('animated_gif');

  const out: Tweet[] = [];
  for (const it of items) {
    if (!retweets && it.isRetweet) continue;
    if (!replies && it.isReply) continue;
    const media = it.media.filter((m) => allow.has(m.type));
    // 種類を絞った結果メディアが空になったポストは出さない
    if (!media.length) continue;
    out.push({ ...it, media });
  }
  return out;
}
