/**
 * パーサの回帰テスト。
 *
 * 実データは認証が要る上に日々変わるので、X のレスポンス構造を写した合成フィクスチャで
 * 「壊れると画面が壊れる」性質だけを固定する。
 */

import { describe, expect, it } from 'bun:test';
import { extractTimeline, extractUserId, filterItems } from '../src/server/parse.ts';
import { parseCurl } from '../src/server/config.ts';
import type { Tweet } from '../src/shared/types.ts';

type Json = Record<string, unknown>;

const photo = (key: string, w: number, h: number): Json => ({
  media_key: key,
  id_str: key,
  type: 'photo',
  media_url_https: `https://pbs.twimg.com/media/${key}.jpg`,
  original_info: { width: w, height: h },
});

const video = (key: string): Json => ({
  media_key: key,
  id_str: key,
  type: 'video',
  media_url_https: `https://pbs.twimg.com/media/${key}.jpg`,
  original_info: { width: 1280, height: 720 },
  video_info: {
    duration_millis: 30000,
    aspect_ratio: [16, 9],
    variants: [
      { bitrate: 832000, content_type: 'video/mp4', url: 'https://video.twimg.com/lo.mp4' },
      { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/hls.m3u8' },
      { bitrate: 2176000, content_type: 'video/mp4', url: 'https://video.twimg.com/hi.mp4' },
    ],
  },
});

interface TweetExtra {
  sensitive?: boolean;
  /** 真なら「元ポストを内包した RT のラッパ」にする。 */
  retweet?: boolean;
}

const tweet = (id: string, screenName: string, media: Json[], extra: TweetExtra = {}): Json => ({
  __typename: 'Tweet',
  rest_id: id,
  core: {
    user_results: {
      result: {
        __typename: 'User',
        rest_id: '9',
        core: { name: 'なまえ', screen_name: screenName },
        avatar: { image_url: 'https://pbs.twimg.com/a_normal.jpg' },
        is_blue_verified: true,
        legacy: {},
      },
    },
  },
  views: { count: '12345' },
  legacy: {
    id_str: id,
    full_text: 'テスト投稿 https://t.co/abc',
    created_at: 'Mon Sep 01 10:00:00 +0000 2025',
    lang: 'ja',
    reply_count: 1,
    retweet_count: 2,
    favorite_count: 3456,
    bookmark_count: 4,
    possibly_sensitive: extra.sensitive ?? false,
    ...(extra.retweet ? { retweeted_status_result: { result: tweet(`${id}r`, 'orig', media) } } : {}),
    extended_entities: { media },
  },
});

/** UserMedia 相当のレスポンス。モジュール形式・可視性ラッパ・引用・カーソルを一通り含む。 */
const response: Json = {
  data: {
    user: {
      result: {
        __typename: 'User',
        rest_id: '44196397',
        timeline_v2: {
          timeline: {
            instructions: [
              { type: 'TimelineClearCache' },
              {
                type: 'TimelineAddEntries',
                entries: [
                  {
                    entryId: 'tweet-1',
                    content: {
                      entryType: 'TimelineTimelineItem',
                      itemContent: {
                        itemType: 'TimelineTweet',
                        tweet_results: {
                          result: tweet('1', 'alice', [photo('p1', 1200, 1600), photo('p2', 800, 800)]),
                        },
                      },
                    },
                  },
                  {
                    entryId: 'profile-grid-0',
                    content: {
                      entryType: 'TimelineTimelineModule',
                      items: [
                        {
                          item: {
                            itemContent: {
                              tweet_results: {
                                result: {
                                  __typename: 'TweetWithVisibilityResults',
                                  tweet: tweet('2', 'bob', [video('v1')], { sensitive: true }),
                                },
                              },
                            },
                          },
                        },
                        {
                          item: {
                            itemContent: {
                              tweet_results: {
                                result: tweet('3', 'carol', [photo('p3', 900, 1200)], { retweet: true }),
                              },
                            },
                          },
                        },
                      ],
                    },
                  },
                  {
                    entryId: 'tweet-4',
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            ...tweet('4', 'dave', [photo('p4', 1000, 500)]),
                            quoted_status_result: { result: tweet('99', 'quoted', [photo('pq', 10, 10)]) },
                          },
                        },
                      },
                    },
                  },
                  {
                    entryId: 'tweet-5-nomedia',
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            __typename: 'Tweet',
                            rest_id: '5',
                            core: { user_results: { result: { legacy: { screen_name: 'x', name: 'x' } } } },
                            legacy: { id_str: '5', full_text: '画像なし' },
                          },
                        },
                      },
                    },
                  },
                  { entryId: 'cursor-top-0', content: { entryType: 'TimelineTimelineCursor', cursorType: 'Top', value: 'TOPCUR' } },
                  { entryId: 'cursor-bottom-0', content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: 'BOTCUR' } },
                ],
              },
            ],
          },
        },
      },
    },
  },
};

const { items, cursor } = extractTimeline(response);
const byId = (id: string): Tweet | undefined => items.find((t) => t.id === id);

describe('extractTimeline', () => {
  it('Bottom のカーソルを返す（Top を掴まない）', () => {
    expect(cursor).toBe('BOTCUR');
  });

  it('メディア付きのポストだけを拾う', () => {
    expect(items.map((t) => t.id)).toEqual(['1', '2', '3r', '4']);
  });

  it('画像の無いポストを除外する', () => {
    expect(byId('5')).toBeUndefined();
  });

  it('引用ツイートを混入させない', () => {
    expect(byId('99')).toBeUndefined();
  });

  it('リポストは元ポスト 1 件になり、作者も元ポストの作者になる', () => {
    // ラッパ側の id '3' は現れず、中身の '3r' が 1 件だけ残る
    expect(items.filter((t) => t.id === '3r')).toHaveLength(1);
    expect(byId('3')).toBeUndefined();
    const rt = byId('3r');
    expect(rt?.user.screenName).toBe('orig');
    expect(rt?.isRetweet).toBe(true);
    expect(rt?.retweetedBy).toEqual({ name: 'なまえ', screenName: 'carol' });
  });

  it('動画は mp4 の最高ビットレートを選ぶ', () => {
    const media = byId('2')?.media[0];
    expect(media?.type).toBe('video');
    expect(media?.video).toBe('https://video.twimg.com/hi.mp4');
    expect(media?.durationMs).toBe(30000);
  });

  it('本文末尾の t.co リンクを取り除く', () => {
    expect(byId('1')?.text).toBe('テスト投稿');
  });

  it('実寸・統計・アバター・センシティブを写し取る', () => {
    const first = byId('1');
    expect(first?.media.map((m) => [m.width, m.height])).toEqual([
      [1200, 1600],
      [800, 800],
    ]);
    expect(first?.stats).toEqual({ replies: 1, retweets: 2, likes: 3456, views: 12345, bookmarks: 4 });
    expect(first?.user.avatar).toBe('https://pbs.twimg.com/a_x96.jpg');
    expect(first?.url).toBe('https://x.com/alice/status/1');
    expect(first?.createdAt).toBe('2025-09-01T10:00:00.000Z');
    expect(byId('2')?.sensitive).toBe(true);
    expect(byId('1')?.sensitive).toBe(false);
  });

  it('includeQuoted を立てたときだけ引用を拾う', () => {
    const quoted = extractTimeline(response, { includeQuoted: true });
    expect(quoted.items.some((t) => t.id === '99')).toBe(true);
  });

  it('空・壊れた入力でも落ちない', () => {
    expect(extractTimeline(null)).toEqual({ items: [], cursor: null });
    expect(extractTimeline({ data: { user: { result: {} } } })).toEqual({ items: [], cursor: null });
  });
});

describe('extractUserId', () => {
  it('data.user.result.rest_id を返す', () => {
    expect(extractUserId(response)).toBe('44196397');
  });

  it('決め打ちの場所に無ければ走査して探す', () => {
    const nested = { x: { y: { result: { __typename: 'User', rest_id: '777' } } } };
    expect(extractUserId(nested)).toBe('777');
    expect(extractUserId({})).toBeNull();
  });
});

describe('filterItems', () => {
  it('retweets: false でリポストを落とす', () => {
    const out = filterItems(items, { retweets: false });
    expect(out.map((t) => t.id)).toEqual(['1', '2', '4']);
  });

  it('videos: false で動画だけのポストが消える', () => {
    const out = filterItems(items, { videos: false, gifs: false });
    expect(out.map((t) => t.id)).toEqual(['1', '3r', '4']);
  });

  it('既定では何も落とさず、元の配列を書き換えない', () => {
    expect(filterItems(items)).toHaveLength(items.length);
    expect(items[0]?.media).toHaveLength(2);
  });
});

describe('parseCurl', () => {
  const curl = `curl 'https://x.com/i/api/graphql/QID123/UserMedia?variables=%7B%22userId%22%3A%2244196397%22%7D&features=%7B%22foo_enabled%22%3Atrue%2C%22bar%22%3Afalse%7D' \\
  -H 'authorization: Bearer TESTTOKEN' \\
  -H 'x-twitter-client-language: ja' \\
  -H 'x-client-transaction-id: SHOULDNOTPERSIST' \\
  -H 'cookie: guest_id=v1%3A1; auth_token=AAA; ct0=BBB' \\
  -H 'user-agent: Mozilla/5.0 (Test)'`;

  const parsed = parseCurl(curl);

  it('cookie / bearer / user-agent を取り出す', () => {
    expect(parsed.patch.cookie).toBe('guest_id=v1%3A1; auth_token=AAA; ct0=BBB');
    expect(parsed.patch.bearer).toBe('Bearer TESTTOKEN');
    expect(parsed.patch.userAgent).toBe('Mozilla/5.0 (Test)');
  });

  it('URL から queryId と features を取り出す', () => {
    expect(parsed.opName).toBe('UserMedia');
    expect(parsed.patch.queryIds).toEqual({ UserMedia: 'QID123' });
    expect(parsed.patch.features).toEqual({ foo_enabled: true, bar: false });
  });

  it('x-client-transaction-id は保存しない', () => {
    // リクエスト毎に変わる値なので、保存すると次のリクエストで弾かれる
    expect(parsed.patch.extraHeaders).toEqual({ 'x-twitter-client-language': 'ja' });
    expect(JSON.stringify(parsed.patch)).not.toContain('SHOULDNOTPERSIST');
  });
});
