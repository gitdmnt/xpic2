// ライブラリが投げた例外を、画面にそのまま出せる ApiError へ写す。
//
// 取得（x-api.ts）と操作（x-post.ts）で同じ言い回しを使いたいのでここに切り出してある。
// 「どのエンドポイントで」「どの queryId で」失敗したかを名指しできることが要件で、
// それが無いと利用者はどのリクエストを Copy as cURL すればよいか分からない。

import type { TwitterOpenApiClient } from 'twitter-openapi-typescript';
import { ApiError } from './x-client.ts';

/**
 * fetch の Response らしきもの。
 *
 * ライブラリは ResponseError(response を持つ)を投げるが、それが常とは限らない。
 * FetchError のように cause に包む形も、GraphQL エラーを素の Error にした形もある。
 * instanceof は realm やバンドルの二重化で簡単に外れるので、形だけを見る。
 */
interface ResponseLike {
  status: number;
  headers: HeadersLike | null;
}

interface HeadersLike {
  get(name: string): string | null | undefined;
}

function isHeadersLike(v: unknown): v is HeadersLike {
  return typeof v === 'object' && v !== null && typeof (v as { get?: unknown }).get === 'function';
}

function isHttpStatus(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 100 && v < 600;
}

/**
 * unknown から HTTP ステータスを取り出す。
 * 例外そのもの → response → cause → error の順に浅く掘り、見つからなければ null。
 * 深さを 3 で打ち切るのは循環参照で回り続けないため。
 */
function digResponse(value: unknown, depth = 0): ResponseLike | null {
  if (depth > 3 || typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;

  const status = isHttpStatus(o.status) ? o.status : isHttpStatus(o.statusCode) ? o.statusCode : null;
  if (status !== null) {
    return { status, headers: isHeadersLike(o.headers) ? o.headers : null };
  }

  for (const key of ['response', 'cause', 'error']) {
    const found = digResponse(o[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
}

/** x-rate-limit-reset(エポック秒)から待ち秒数を出す。取れなければ null。 */
function retryAfterSeconds(res: ResponseLike | null): number | null {
  const raw = res?.headers?.get('x-rate-limit-reset');
  const reset = Number(raw ?? 0);
  if (!Number.isFinite(reset) || reset <= 0) return null;
  return Math.max(0, reset - Math.floor(Date.now() / 1000));
}

/**
 * ライブラリの例外を ApiError へ写す。
 * ここが移植で最も価値のある部分なので、旧実装の日本語の案内をそのまま引き継いでいる。
 *
 * @param endpoint 失敗した GraphQL オペレーション名。404 の案内で名指しする。
 * @param queryId  そのとき使っていた queryId。手元の値と DevTools の値を突き合わせられるように出す。
 */
export function toApiError(e: unknown, endpoint: string, queryId: string | null): ApiError {
  // getClient() が投げる認証未設定などの案内は、すでに整形済みなのでそのまま通す。
  if (e instanceof ApiError) return e;

  const res = digResponse(e);
  const message = messageOf(e);

  if (res?.status === 401 || res?.status === 403) {
    return new ApiError(
      res.status,
      'X に認証を拒否されました。',
      'cookie(auth_token / ct0)が失効している可能性があります。設定を貼り直してください。',
    );
  }

  if (res?.status === 404) {
    return new ApiError(
      404,
      queryId
        ? `${endpoint} の queryId (${queryId}) が古くなっています。`
        : `${endpoint} の queryId が古くなっています。`,
      `x.com の DevTools で ${endpoint} のリクエストを Copy as cURL して設定画面に貼ると更新できます。`,
    );
  }

  if (res?.status === 429) {
    const sec = retryAfterSeconds(res);
    return new ApiError(
      429,
      'レート制限に達しました。',
      sec === null ? '少し待って再試行してください。' : `約 ${sec} 秒後に再試行してください。`,
    );
  }

  // ステータスが取り出せた場合と、そうでない場合。どちらも 502 に寄せて元のメッセージを添える。
  if (res) {
    return new ApiError(502, `X が ${endpoint} で HTTP ${res.status} を返しました。`, message.slice(0, 300) || null);
  }
  return new ApiError(
    502,
    `${endpoint} の呼び出しに失敗しました: ${message.slice(0, 300)}`,
    'X への接続か、応答の解釈で失敗しています。cookie の失効や queryId / features のずれが疑われます。',
  );
}

/** いま使っている queryId を flag から読む。ライブラリの flag は any なので形を確かめてから触る。 */
export function queryIdOf(client: TwitterOpenApiClient, endpoint: string): string | null {
  const entry: unknown = client.flag[endpoint];
  if (typeof entry !== 'object' || entry === null) return null;
  const queryId = (entry as { queryId?: unknown }).queryId;
  return typeof queryId === 'string' ? queryId : null;
}
