/**
 * ライブラリは JSON を生成モデルへ通すが、`FromJSONTyped` は実行時検証をしない。型が
 * `width: number` でも X が値を落とせば `undefined` が流れてくる。masonry は画像の実寸から
 * 高さを確定するので、欠けると描画が崩れる。型を信用せず、検証してから積み替える。
 *
 * 生成モデルの型は依存に入れていない `twitter-openapi-typescript-generated` にあるので、
 * 直接 import せず `TweetApiUtilsData` から辿って取り出す。
 */

import type { TimelineApiUtilsResponse, TweetApiUtilsData } from 'twitter-openapi-typescript';
import type { Filters, Media, MediaType, Tweet, TweetViewerState } from '../shared/types.ts';

type XTweet = TweetApiUtilsData['tweet'];
type XUser = TweetApiUtilsData['user'];
type XLegacy = NonNullable<XTweet['legacy']>;

/** `extendedEntities.media`（MediaExtended）と `entities.media`（Media）。読む項目は共通。 */
type MediaEntry =
  | NonNullable<XLegacy['extendedEntities']>['media'][number]
  | NonNullable<NonNullable<XLegacy['entities']>['media']>[number];

/** 有限な数値だけを通す。X が値を落としたときは undefined にする。 */
function toFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 統計値は 0 が正当なので、取れなければ 0 に寄せる。 */
function toCount(value: unknown): number {
  return toFinite(value) ?? 0;
}

/** 寸法は 0 だと masonry が高さを出せないので、正の値だけを採用する。 */
function toSize(value: unknown): number | undefined {
  const n = toFinite(value);
  return n !== undefined && n > 0 ? n : undefined;
}

function toText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

const MEDIA_TYPES: readonly string[] = ['photo', 'video', 'animated_gif'];

/** Media.type は閉じた union。未知の種類は取り込まない（後段のフィルタでも落ちる）。 */
function toMediaType(value: unknown): MediaType | null {
  return typeof value === 'string' && MEDIA_TYPES.includes(value) ? (value as MediaType) : null;
}

/**
 * `originalInfo` → `sizes.large` → `videoInfo.aspectRatio` の順に落とす。
 * 幅と高さは必ず同じ出所から取る。混ぜると縦横比が狂い、masonry が確保する高さと
 * 実際の画像がずれてガタつく。
 */
function mediaSize(entry: MediaEntry): { width: number; height: number } {
  const ow = toSize(entry.originalInfo?.width);
  const oh = toSize(entry.originalInfo?.height);
  if (ow !== undefined && oh !== undefined) return { width: ow, height: oh };

  const lw = toSize(entry.sizes?.large?.w);
  const lh = toSize(entry.sizes?.large?.h);
  if (lw !== undefined && lh !== undefined) return { width: lw, height: lh };

  // 実寸が無くても比が分かれば積める。100 倍は「px 相当の大きさ」に見せるためだけの係数。
  const ratio: unknown = entry.videoInfo?.aspectRatio;
  if (Array.isArray(ratio) && ratio.length === 2) {
    const rw = toSize(ratio[0]);
    const rh = toSize(ratio[1]);
    if (rw !== undefined && rh !== undefined) return { width: rw * 100, height: rh * 100 };
  }

  return { width: 0, height: 0 };
}

/** mp4 の最高ビットレートを選ぶ。無ければ HLS。bitrate は省略されうるので 0 とみなす。 */
function bestVariant(videoInfo: MediaEntry['videoInfo']): string | null {
  const variants: unknown = videoInfo?.variants;
  if (!Array.isArray(variants)) return null;

  let best: { url: string; bitrate: number } | null = null;
  let hls: string | null = null;
  for (const v of variants) {
    if (typeof v !== 'object' || v === null) continue;
    const { url, contentType, bitrate } = v as { url?: unknown; contentType?: unknown; bitrate?: unknown };
    const href = toText(url);
    if (!href) continue;
    if (contentType === 'video/mp4') {
      const rate = toFinite(bitrate) ?? 0;
      if (!best || rate > best.bitrate) best = { url: href, bitrate: rate };
    } else if (contentType === 'application/x-mpegURL' && hls === null) {
      hls = href;
    }
  }
  return best ? best.url : hls;
}

function mapMedia(entry: MediaEntry): Media | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const url = toText(entry.mediaUrlHttps);
  if (!url) return null;
  const type = toMediaType(entry.type);
  if (!type) return null;

  const { width, height } = mediaSize(entry);
  const media: Media = {
    key: toText(entry.mediaKey) ?? toText(entry.idStr) ?? url,
    type,
    url,
    width,
    height,
    alt: toText(entry.extAltText) ?? null,
  };

  if (type === 'video' || type === 'animated_gif') {
    media.video = bestVariant(entry.videoInfo);
    media.durationMs = toFinite(entry.videoInfo?.durationMillis) ?? null;
  }
  return media;
}

function mediaList(value: unknown): Media[] {
  if (!Array.isArray(value)) return [];
  const out: Media[] = [];
  for (const entry of value) {
    const m = mapMedia(entry as MediaEntry);
    if (m) out.push(m);
  }
  return out;
}

/** created_at は "Mon Sep 01 10:00:00 +0000 2025" 形式。壊れていれば null（toISOString は例外を投げる）。 */
function toIsoDate(value: unknown): string | null {
  const raw = toText(value);
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function mapUser(user: XUser | undefined): Tweet['user'] {
  const screenName = toText(user?.core?.screenName) ?? toText(user?.legacy?.screenName) ?? 'i';
  const avatar = toText(user?.legacy?.profileImageUrlHttps) ?? toText(user?.avatar?.imageUrl) ?? '';
  return {
    name: toText(user?.core?.name) ?? toText(user?.legacy?.name) ?? screenName,
    screenName,
    // _normal は 48px と小さすぎるので、同じ CDN の 96px 版へ差し替える
    avatar: avatar.replace('_normal.', '_x96.'),
    verified: Boolean(user?.isBlueVerified || user?.legacy?.verified),
  };
}

/** 未ログインでも項目ごと落ちてくるので、undefined は「掛けていない」として扱ってよい。 */
function mapViewer(legacy: XLegacy | undefined): TweetViewerState {
  return {
    liked: Boolean(legacy?.favorited),
    retweeted: Boolean(legacy?.retweeted),
    bookmarked: Boolean(legacy?.bookmarked),
  };
}

/** リポストと引用を辿らずに 1 件を写す。ラッパ剥がしは `mapTweet` の責務。 */
function mapCore(data: TweetApiUtilsData): Tweet | null {
  const tweet: XTweet | undefined = data.tweet;
  if (!tweet) return null;
  const legacy: XLegacy | undefined = tweet.legacy;

  // extendedEntities が本命。entities.media は 1 枚目しか入らないことがあるので予備。
  const extended = mediaList(legacy?.extendedEntities?.media);
  const media = extended.length ? extended : mediaList(legacy?.entities?.media);
  if (!media.length) return null;

  const id = toText(legacy?.idStr) ?? toText(tweet.restId);
  if (!id) return null;

  const user = mapUser(data.user);
  // 長文ポストは fullText が途中で切れるので noteTweet を優先する
  const rawText = toText(tweet.noteTweet?.noteTweetResults?.result?.text) ?? toText(legacy?.fullText) ?? '';
  // 末尾の t.co はメディア自身への短縮リンクで、本文としては意味がない
  const text = rawText.replace(/https:\/\/t\.co\/\w+\s*$/, '').trim();

  return {
    id,
    url: `https://x.com/${user.screenName}/status/${id}`,
    text,
    lang: toText(legacy?.lang),
    createdAt: toIsoDate(legacy?.createdAt),
    sensitive: Boolean(legacy?.possiblySensitive),
    isRetweet: false,
    retweetedBy: null,
    isReply: Boolean(toText(legacy?.inReplyToStatusIdStr)),
    user,
    stats: {
      replies: toCount(legacy?.replyCount),
      retweets: toCount(legacy?.retweetCount),
      likes: toCount(legacy?.favoriteCount),
      // views.count は文字列で来る
      views: Number(tweet.views?.count ?? 0) || 0,
      bookmarks: toCount(legacy?.bookmarkCount),
    },
    viewer: mapViewer(legacy),
    media,
  };
}

/**
 * `promotedMetadata` が載るのは広告だけなので、本文や作者から推し量らずにこれで弾く。
 *
 * リポストは元ポストを実体にする。外側は作者も本文も "RT @..." のラッパでしかないので、
 * `retweeted` の中身を採用し、リポストした人だけを `retweetedBy` に残す。
 * 引用（`quoted`）は辿らない。引用元の画像が本人の投稿として混ざるのを避ける。
 */
export function mapTweet(data: TweetApiUtilsData): Tweet | null {
  if (typeof data !== 'object' || data === null) return null;
  if (data.promotedMetadata) return null;

  const retweeted = data.retweeted;
  if (retweeted) {
    // 内側の RT は辿らない（RT の RT は X 側に存在しない。無限再帰の芽も断つ）
    const inner = mapCore(retweeted);
    if (!inner) return null;
    const by = mapUser(data.user);
    return { ...inner, isRetweet: true, retweetedBy: { name: by.name, screenName: by.screenName } };
  }

  return mapCore(data);
}

/** 1 件の変換失敗でページ全体を落とさないよう、個別に try で握る。 */
export function mapTimeline(
  res: TimelineApiUtilsResponse<TweetApiUtilsData>,
): { items: Tweet[]; cursor: string | null } {
  const items: Tweet[] = [];
  const seen = new Set<string>();

  const list: unknown = res?.data;
  if (Array.isArray(list)) {
    for (const data of list) {
      try {
        const t = mapTweet(data as TweetApiUtilsData);
        if (!t || seen.has(t.id)) continue;
        seen.add(t.id);
        items.push(t);
      } catch {
        // 想定外の形は 1 件だけ捨てる。ページごと失うより取れた分を返す方がよい。
      }
    }
  }

  return { items, cursor: toText(res?.cursor?.bottom?.value) ?? null };
}

/** 画像/動画の種類とリポスト・リプライ可否でふるいにかける。 */
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
