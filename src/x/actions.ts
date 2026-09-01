// ライブラリのユーティリティ(PostApiUtils)ではなく生成 API を直接叩く。PostApiUtils は
// ブックマークの作成・削除を持たず、生成 API へ initOverrides を渡さないので
// x-client-transaction-id も付かない。署名だけ client.initOverrides から借りる。
// cookie・csrf・bearer は Configuration のミドルウェアが見るので、ここには出てこない。

import type { TwitterOpenApiClient } from 'twitter-openapi-typescript';

import type { TweetAction } from '../shared/types.ts';
import { getClient } from './client.ts';
import { ApiError, queryIdOf, toApiError } from './error.ts';

/** 生成 API の型。package.json の依存に無い生成パッケージを import せずに済むよう client から辿る。 */
type PostApi = ReturnType<TwitterOpenApiClient['getPostApi']>['api'];
type InitOverride = ReturnType<TwitterOpenApiClient['initOverrides']>;

/** 生成 API の Raw 版はどれも生の Response を添えて返す。errors を読むのに使う。 */
interface RawResult {
  raw: Response;
}

interface Operation {
  /** GraphQL のオペレーション名。queryId を引くのと、失敗時に名指しするのに使う。 */
  name: string;
  send(api: PostApi, queryId: string, tweetId: string, init: InitOverride): Promise<RawResult>;
}

/**
 * variables は生成モデルの camelCase で書く。スネークケースへの読み替えは
 * 生成側の ToJSON が行うので、ここで tweet_id と書いてはいけない。
 * dark_request は x.com のクライアントが常に false を送っているので、それに倣う。
 */
const OPERATIONS: Record<TweetAction, { on: Operation; off: Operation }> = {
  like: {
    on: {
      name: 'FavoriteTweet',
      send: (api, queryId, tweetId, init) =>
        api.postFavoriteTweetRaw(
          { pathQueryId: queryId, postFavoriteTweetRequest: { queryId, variables: { tweetId } } },
          init,
        ),
    },
    off: {
      name: 'UnfavoriteTweet',
      send: (api, queryId, tweetId, init) =>
        api.postUnfavoriteTweetRaw(
          {
            pathQueryId: queryId,
            postUnfavoriteTweetRequest: { queryId, variables: { tweetId, darkRequest: false } },
          },
          init,
        ),
    },
  },
  retweet: {
    on: {
      name: 'CreateRetweet',
      send: (api, queryId, tweetId, init) =>
        api.postCreateRetweetRaw(
          {
            pathQueryId: queryId,
            postCreateRetweetRequest: { queryId, variables: { tweetId, darkRequest: false } },
          },
          init,
        ),
    },
    off: {
      name: 'DeleteRetweet',
      // 取り消しは自分のリポストではなく「元ポストの id」で指す。
      // 画面が持っている id はリポストを剥がした元ポストのものなので、そのまま渡せる。
      send: (api, queryId, tweetId, init) =>
        api.postDeleteRetweetRaw(
          {
            pathQueryId: queryId,
            postDeleteRetweetRequest: { queryId, variables: { sourceTweetId: tweetId, darkRequest: false } },
          },
          init,
        ),
    },
  },
  bookmark: {
    on: {
      name: 'CreateBookmark',
      send: (api, queryId, tweetId, init) =>
        api.postCreateBookmarkRaw(
          { pathQueryId: queryId, postCreateBookmarkRequest: { queryId, variables: { tweetId } } },
          init,
        ),
    },
    off: {
      name: 'DeleteBookmark',
      send: (api, queryId, tweetId, init) =>
        api.postDeleteBookmarkRaw(
          { pathQueryId: queryId, postDeleteBookmarkRequest: { queryId, variables: { tweetId } } },
          init,
        ),
    },
  },
};

/** 上書き指定の案内とテストで使う。 */
export const ACTION_ENDPOINTS: readonly string[] = Object.values(OPERATIONS).flatMap((pair) => [
  pair.on.name,
  pair.off.name,
]);

/** 要求した結果と現実が既に一致しているので、失敗として見せる意味がない。 */
const ALREADY_DONE = new Set([
  139, // Already favorited
  327, // Already retweeted
]);

/**
 * GraphQL の更新系は失敗しても HTTP 200 で返り、理由は本文の errors にしか載らない。
 * ここを読まないと「押したのに何も起きていない」が黙って成功に見える。
 */
async function ensureAccepted(raw: Response, endpoint: string): Promise<void> {
  let body: unknown;
  try {
    body = await raw.json();
  } catch {
    // 本文が読めないだけならステータスは通っている。成功として扱う。
    return;
  }
  const errors: unknown = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return;

  const first = (errors[0] ?? {}) as { message?: unknown; code?: unknown };
  const code = typeof first.code === 'number' ? first.code : null;
  if (code !== null && ALREADY_DONE.has(code)) return;

  const message = typeof first.message === 'string' ? first.message : '理由は返ってきませんでした。';
  throw new ApiError(502, `X が ${endpoint} を拒否しました。`, message.slice(0, 300));
}

/** @param on 真なら実行、偽なら取り消し。 */
export async function actOnTweet(id: string, action: TweetAction, on: boolean): Promise<void> {
  // id は URL のパスではなく本文に載るが、数字以外を通す理由が無いので入口で弾く。
  if (!/^\d+$/.test(id)) throw new ApiError(400, 'ポストの id が不正です。');

  const op = OPERATIONS[action][on ? 'on' : 'off'];
  const client = await getClient();
  const queryId = queryIdOf(client, op.name);
  if (!queryId) {
    throw new ApiError(
      502,
      `${op.name} の queryId が分かりません。`,
      'ライブラリが取得する placeholder.json にこのオペレーションが載っていません。',
    );
  }

  let raw: Response;
  try {
    ({ raw } = await op.send(client.getPostApi().api, queryId, id, client.initOverrides(client.flag[op.name])));
  } catch (e) {
    throw toApiError(e, op.name, queryId);
  }
  await ensureAccepted(raw, op.name);
}
