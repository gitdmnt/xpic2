/**
 * ライブラリの型 → アプリの型 への写し取りの回帰テスト。
 *
 * 実データは認証が要る上に日々変わるので、生成モデルの形を写した合成フィクスチャで
 * 「壊れると画面が壊れる」性質だけを固定する。
 *
 * フィクスチャはわざと部分的に作る。生成モデルの `FromJSONTyped` は実行時検証をしないので、
 * 型が必須と言っている項目でも実際には欠けて届く。それを再現するために
 * `TweetApiUtilsData` へは cast で渡す。
 */

import { describe, expect, it } from 'bun:test';
import type { TimelineApiUtilsResponse, TweetApiUtilsData } from 'twitter-openapi-typescript';
import { filterItems, mapTimeline, mapTweet } from '../src/server/map.ts';
import type { Tweet } from '../src/shared/types.ts';

type Json = Record<string, unknown>;

const asData = (v: unknown): TweetApiUtilsData => v as TweetApiUtilsData;
const asTimeline = (v: unknown): TimelineApiUtilsResponse<TweetApiUtilsData> =>
  v as TimelineApiUtilsResponse<TweetApiUtilsData>;

/** 実寸も sizes も揃った、通常の写真。 */
const photo = (key: string, w: number, h: number): Json => ({
  mediaKey: key,
  idStr: key,
  type: 'photo',
  mediaUrlHttps: `https://pbs.twimg.com/media/${key}.jpg`,
  extAltText: 'せつめい',
  originalInfo: { width: w, height: h },
  sizes: { large: { w, h, resize: 'fit' } },
});

const video = (key: string): Json => ({
  mediaKey: key,
  idStr: key,
  type: 'video',
  mediaUrlHttps: `https://pbs.twimg.com/media/${key}.jpg`,
  originalInfo: { width: 1280, height: 720 },
  videoInfo: {
    durationMillis: 30000,
    aspectRatio: [16, 9],
    variants: [
      { bitrate: 832000, contentType: 'video/mp4', url: 'https://video.twimg.com/lo.mp4' },
      { contentType: 'application/x-mpegURL', url: 'https://video.twimg.com/hls.m3u8' },
      { bitrate: 2176000, contentType: 'video/mp4', url: 'https://video.twimg.com/hi.mp4' },
    ],
  },
});

const user = (screenName: string, name = 'なまえ'): Json => ({
  restId: '9',
  isBlueVerified: true,
  core: { name, screenName },
  legacy: { profileImageUrlHttps: 'https://pbs.twimg.com/a_normal.jpg' },
});

interface TweetExtra {
  sensitive?: boolean;
  text?: string;
  noteText?: string;
  replyTo?: string;
  /** extendedEntities ではなく entities 側にだけメディアを置く。 */
  entitiesOnly?: boolean;
  /** 自分が既に掛けた操作（legacy の favorited / retweeted / bookmarked）。 */
  favorited?: boolean;
  retweeted?: boolean;
  bookmarked?: boolean;
}

const post = (id: string, screenName: string, media: Json[], extra: TweetExtra = {}): Json => ({
  tweet: {
    restId: id,
    core: { userResults: { result: user(screenName) } },
    views: { count: '12345' },
    ...(extra.noteText ? { noteTweet: { noteTweetResults: { result: { text: extra.noteText } } } } : {}),
    legacy: {
      idStr: id,
      fullText: extra.text ?? 'テスト投稿 https://t.co/abc',
      createdAt: 'Mon Sep 01 10:00:00 +0000 2025',
      lang: 'ja',
      replyCount: 1,
      retweetCount: 2,
      favoriteCount: 3456,
      bookmarkCount: 4,
      possiblySensitive: extra.sensitive ?? false,
      ...(extra.favorited === undefined ? {} : { favorited: extra.favorited }),
      ...(extra.retweeted === undefined ? {} : { retweeted: extra.retweeted }),
      ...(extra.bookmarked === undefined ? {} : { bookmarked: extra.bookmarked }),
      ...(extra.replyTo ? { inReplyToStatusIdStr: extra.replyTo } : {}),
      ...(extra.entitiesOnly ? { entities: { media } } : { extendedEntities: { media } }),
    },
  },
  user: user(screenName),
  replies: [],
});

describe('mapTweet — 寸法', () => {
  it('originalInfo の実寸をそのまま使う', () => {
    const t = mapTweet(asData(post('1', 'alice', [photo('p1', 1200, 1600), photo('p2', 800, 800)])));
    expect(t?.media.map((m) => [m.width, m.height])).toEqual([
      [1200, 1600],
      [800, 800],
    ]);
  });

  it('originalInfo が欠ければ sizes.large の w/h に落ちる', () => {
    const broken = { ...photo('p1', 1200, 1600), originalInfo: undefined };
    const t = mapTweet(asData(post('1', 'alice', [broken])));
    expect(t?.media[0]?.width).toBe(1200);
    expect(t?.media[0]?.height).toBe(1600);
  });

  it('originalInfo の片側だけが欠けたら sizes.large へ揃えて落ちる（比を崩さない）', () => {
    // width だけ生き残った originalInfo と、別寸法の sizes.large。
    // 混ぜると縦横比が狂うので、必ず同じ出所から両方を取ること。
    const broken = {
      ...photo('p1', 1200, 1600),
      originalInfo: { width: 1200 },
      sizes: { large: { w: 600, h: 800, resize: 'fit' } },
    };
    const t = mapTweet(asData(post('1', 'alice', [broken])));
    expect(t?.media[0]?.width).toBe(600);
    expect(t?.media[0]?.height).toBe(800);
  });

  it('実寸も sizes も無ければ videoInfo.aspectRatio で比を復元する', () => {
    const broken = { ...video('v1'), originalInfo: undefined, sizes: undefined };
    const t = mapTweet(asData(post('2', 'bob', [broken])));
    expect(t?.media[0]?.width).toBe(1600);
    expect(t?.media[0]?.height).toBe(900);
  });

  it('寸法が一切取れなくても例外を投げず 0 を返す', () => {
    const bare: Json = { mediaKey: 'x', type: 'photo', mediaUrlHttps: 'https://pbs.twimg.com/media/x.jpg' };
    const t = mapTweet(asData(post('3', 'carol', [bare])));
    expect(t?.media[0]).toMatchObject({ width: 0, height: 0, alt: null, key: 'x' });
  });

  it('0 や NaN は実寸として採用せず、次の候補へ落ちる', () => {
    const broken = {
      ...photo('p1', 1200, 1600),
      originalInfo: { width: 0, height: Number.NaN },
      sizes: { large: { w: 400, h: 500, resize: 'fit' } },
    };
    const t = mapTweet(asData(post('1', 'alice', [broken])));
    expect(t?.media[0]?.width).toBe(400);
    expect(t?.media[0]?.height).toBe(500);
  });
});

describe('mapTweet — メディアと本文', () => {
  it('メディアの無いポストは null になる', () => {
    const t = mapTweet(asData(post('5', 'dave', [])));
    expect(t).toBeNull();
  });

  it('extendedEntities が無ければ entities.media を使う', () => {
    const t = mapTweet(asData(post('6', 'erin', [photo('p6', 100, 200)], { entitiesOnly: true })));
    expect(t?.media).toHaveLength(1);
    expect(t?.media[0]?.key).toBe('p6');
  });

  it('URL や種類の無いメディアは捨てる', () => {
    const noUrl: Json = { mediaKey: 'a', type: 'photo' };
    const unknownType: Json = { mediaKey: 'b', type: 'sticker', mediaUrlHttps: 'https://pbs.twimg.com/b.jpg' };
    const t = mapTweet(asData(post('7', 'frank', [noUrl, unknownType, photo('ok', 10, 10)])));
    expect(t?.media.map((m) => m.key)).toEqual(['ok']);
  });

  it('動画は mp4 の最高ビットレートを選び、長さも写す', () => {
    const t = mapTweet(asData(post('2', 'bob', [video('v1')])));
    expect(t?.media[0]?.type).toBe('video');
    expect(t?.media[0]?.video).toBe('https://video.twimg.com/hi.mp4');
    expect(t?.media[0]?.durationMs).toBe(30000);
  });

  it('mp4 が無ければ HLS に落ちる。bitrate 欠落は 0 として扱う', () => {
    const hlsOnly = {
      ...video('v2'),
      videoInfo: {
        aspectRatio: [1, 1],
        variants: [{ contentType: 'application/x-mpegURL', url: 'https://video.twimg.com/only.m3u8' }],
      },
    };
    const noBitrate = {
      ...video('v3'),
      videoInfo: {
        aspectRatio: [1, 1],
        variants: [
          { contentType: 'video/mp4', url: 'https://video.twimg.com/a.mp4' },
          { bitrate: 10, contentType: 'video/mp4', url: 'https://video.twimg.com/b.mp4' },
        ],
      },
    };
    const t = mapTweet(asData(post('8', 'gina', [hlsOnly, noBitrate])));
    expect(t?.media[0]?.video).toBe('https://video.twimg.com/only.m3u8');
    expect(t?.media[0]?.durationMs).toBeNull();
    expect(t?.media[1]?.video).toBe('https://video.twimg.com/b.mp4');
  });

  it('末尾の t.co リンクを落とし、長文は noteTweet を優先する', () => {
    const plain = mapTweet(asData(post('1', 'alice', [photo('p', 1, 1)])));
    expect(plain?.text).toBe('テスト投稿');

    const note = mapTweet(
      asData(post('9', 'alice', [photo('p', 1, 1)], { text: '切れた本文… https://t.co/xyz', noteText: '全文です' })),
    );
    expect(note?.text).toBe('全文です');
  });
});

describe('mapTweet — リポストと引用', () => {
  const retweet = (): Json => ({
    ...post('rt', 'carol', [photo('ignored', 1, 1)], { text: 'RT @orig: なにか https://t.co/zzz' }),
    retweeted: post('orig', 'origauthor', [photo('real', 900, 1200)], { text: '元の本文' }),
  });

  it('リポストは元ポストが実体になり、retweetedBy にリポストした人が入る', () => {
    const t = mapTweet(asData(retweet()));
    expect(t?.id).toBe('orig');
    expect(t?.user.screenName).toBe('origauthor');
    expect(t?.url).toBe('https://x.com/origauthor/status/orig');
    expect(t?.text).toBe('元の本文');
    expect(t?.media.map((m) => m.key)).toEqual(['real']);
    expect(t?.isRetweet).toBe(true);
    expect(t?.retweetedBy).toEqual({ name: 'なまえ', screenName: 'carol' });
  });

  it('元ポストにメディアが無ければ、ラッパ側の画像を使わず null にする', () => {
    const rt: Json = { ...post('rt', 'carol', [photo('wrapper', 1, 1)]), retweeted: post('orig', 'o', []) };
    expect(mapTweet(asData(rt))).toBeNull();
  });

  it('引用は辿らない（引用元の画像を混ぜない）', () => {
    const quoting: Json = {
      ...post('q1', 'dave', [photo('own', 500, 500)]),
      quoted: post('q99', 'quoted', [photo('other', 10, 10)]),
    };
    const t = mapTweet(asData(quoting));
    expect(t?.id).toBe('q1');
    expect(t?.media.map((m) => m.key)).toEqual(['own']);
  });

  it('自分にメディアが無いポストは、引用元に画像があっても null', () => {
    const quoting: Json = { ...post('q2', 'dave', []), quoted: post('q99', 'quoted', [photo('other', 10, 10)]) };
    expect(mapTweet(asData(quoting))).toBeNull();
  });
});

describe('mapTweet — 付随情報', () => {
  const t = mapTweet(asData(post('1', 'alice', [photo('p1', 1200, 1600)], { sensitive: true, replyTo: '999' })));

  it('URL・日時・統計・アバターを写し取る', () => {
    expect(t?.url).toBe('https://x.com/alice/status/1');
    expect(t?.createdAt).toBe('2025-09-01T10:00:00.000Z');
    expect(t?.lang).toBe('ja');
    expect(t?.stats).toEqual({ replies: 1, retweets: 2, likes: 3456, views: 12345, bookmarks: 4 });
    expect(t?.user.avatar).toBe('https://pbs.twimg.com/a_x96.jpg');
    expect(t?.user.verified).toBe(true);
    expect(t?.sensitive).toBe(true);
    expect(t?.isReply).toBe(true);
    expect(t?.media[0]?.alt).toBe('せつめい');
  });

  it('統計や日時が欠けても既定値へ寄せる', () => {
    const bare: Json = {
      tweet: {
        restId: '77',
        legacy: { extendedEntities: { media: [photo('p', 10, 10)] }, createdAt: 'こわれた日付' },
      },
      user: {},
      replies: [],
    };
    const b = mapTweet(asData(bare));
    expect(b?.id).toBe('77');
    expect(b?.createdAt).toBeNull();
    expect(b?.stats).toEqual({ replies: 0, retweets: 0, likes: 0, views: 0, bookmarks: 0 });
    expect(b?.user).toEqual({ name: 'i', screenName: 'i', avatar: '', verified: false });
  });
});

describe('mapTweet — 自分が掛けた操作', () => {
  it('legacy の favorited / retweeted / bookmarked を写す', () => {
    const t = mapTweet(
      asData(post('1', 'alice', [photo('p', 1, 1)], { favorited: true, retweeted: false, bookmarked: true })),
    );
    expect(t?.viewer).toEqual({ liked: true, retweeted: false, bookmarked: true });
  });

  it('項目ごと欠けていれば「まだ掛けていない」に寄せる', () => {
    const t = mapTweet(asData(post('1', 'alice', [photo('p', 1, 1)])));
    expect(t?.viewer).toEqual({ liked: false, retweeted: false, bookmarked: false });
  });

  it('リポストでは元ポスト側の状態を採る（ラッパ側ではない）', () => {
    // 操作は元ポストに掛かるので、ラッパが何と言っていても中身を信じる。
    const rt: Json = {
      ...post('rt', 'carol', [photo('wrapper', 1, 1)], { favorited: true, bookmarked: true }),
      retweeted: post('orig', 'origauthor', [photo('real', 9, 12)], { favorited: false, retweeted: true }),
    };
    const t = mapTweet(asData(rt));
    expect(t?.id).toBe('orig');
    expect(t?.viewer).toEqual({ liked: false, retweeted: true, bookmarked: false });
  });
});

describe('mapTimeline', () => {
  const res = asTimeline({
    data: [
      post('1', 'alice', [photo('p1', 1200, 1600)]),
      post('2', 'bob', [video('v1')]),
      { ...post('rt', 'carol', [photo('x', 1, 1)]), retweeted: post('3r', 'orig', [photo('p3', 900, 1200)]) },
      post('5', 'dave', []),
      post('1', 'alice', [photo('p1', 1200, 1600)]),
    ],
    cursor: { top: { value: 'TOPCUR' }, bottom: { value: 'BOTCUR' } },
  });

  it('Bottom のカーソルを返す（Top を掴まない）', () => {
    expect(mapTimeline(res).cursor).toBe('BOTCUR');
  });

  it('メディア付きだけを、重複なく、RT は元ポストとして返す', () => {
    expect(mapTimeline(res).items.map((t) => t.id)).toEqual(['1', '2', '3r']);
  });

  it('カーソルが無ければ null', () => {
    expect(mapTimeline(asTimeline({ data: [], cursor: {} })).cursor).toBeNull();
    expect(mapTimeline(asTimeline({ data: [], cursor: { bottom: { value: '' } } })).cursor).toBeNull();
  });

  it('1 件が壊れていてもページ全体を落とさない', () => {
    const exploding = {
      get tweet(): never {
        throw new Error('boom');
      },
      user: {},
      replies: [],
    };
    const out = mapTimeline(asTimeline({ data: [exploding, post('1', 'alice', [photo('p1', 10, 10)])], cursor: {} }));
    expect(out.items.map((t) => t.id)).toEqual(['1']);
  });

  it('空・壊れた入力でも例外を投げない', () => {
    expect(mapTimeline(asTimeline(undefined))).toEqual({ items: [], cursor: null });
    expect(mapTimeline(asTimeline({}))).toEqual({ items: [], cursor: null });
    expect(mapTimeline(asTimeline({ data: 'こわれている', cursor: null }))).toEqual({ items: [], cursor: null });
    expect(mapTweet(asData(undefined))).toBeNull();
    expect(mapTweet(asData({}))).toBeNull();
    expect(mapTweet(asData({ tweet: {} }))).toBeNull();
  });
});

describe('filterItems', () => {
  const items: Tweet[] = mapTimeline(
    asTimeline({
      data: [
        post('1', 'alice', [photo('p1', 1200, 1600), video('v0')]),
        post('2', 'bob', [video('v1')]),
        { ...post('rt', 'carol', [photo('x', 1, 1)]), retweeted: post('3r', 'orig', [photo('p3', 900, 1200)]) },
        post('4', 'dave', [photo('p4', 10, 10)], { replyTo: '1' }),
      ],
      cursor: {},
    }),
  ).items;

  it('retweets: false でリポストを落とす', () => {
    expect(filterItems(items, { retweets: false }).map((t) => t.id)).toEqual(['1', '2', '4']);
  });

  it('replies: false でリプライを落とす', () => {
    expect(filterItems(items, { replies: false }).map((t) => t.id)).toEqual(['1', '2', '3r']);
  });

  it('videos: false で動画だけのポストが消え、混在ポストからは動画だけ抜ける', () => {
    const out = filterItems(items, { videos: false, gifs: false });
    expect(out.map((t) => t.id)).toEqual(['1', '3r', '4']);
    expect(out[0]?.media.map((m) => m.key)).toEqual(['p1']);
  });

  it('既定では何も落とさず、元の配列を書き換えない', () => {
    expect(filterItems(items)).toHaveLength(items.length);
    expect(items[0]?.media).toHaveLength(2);
  });
});
