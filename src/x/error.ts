// どのエンドポイントで、どの queryId で失敗したかを名指しできることが要件になる。
// それが無いと、利用者はどのリクエストを見に行けばよいか分からない。

import type { TwitterOpenApiClient } from 'twitter-openapi-typescript';

/**
 * status は X が返した HTTP ステータス（届かなかったときは 0）。
 * 401 なら再ログインへ、404 なら queryId の更新へ、と画面側が分岐するために持つ。
 */
export class ApiError extends Error {
  readonly status: number;
  readonly hint: string | null;

  constructor(status: number, message: string, hint: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.hint = hint;
  }
}

/**
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
 *
 * @param endpoint 失敗した GraphQL オペレーション名。404 の案内で名指しする。
 * @param queryId  そのとき使っていた queryId。手元の値と DevTools の値を突き合わせられるように出す。
 */
export function toApiError(e: unknown, endpoint: string, queryId: string | null): ApiError {
  // getClient() が投げる未ログインなどの案内は、すでに整形済みなのでそのまま通す。
  if (e instanceof ApiError) return e;

  const res = digResponse(e);
  const message = messageOf(e);

  if (res?.status === 401 || res?.status === 403) {
    return new ApiError(
      res.status,
      'X に認証を拒否されました。',
      'x.com のセッションが切れている可能性があります。x.com を開き直してログインし直してください。',
    );
  }

  if (res?.status === 404) {
    return new ApiError(
      404,
      queryId
        ? `${endpoint} の queryId (${queryId}) が古くなっています。`
        : `${endpoint} の queryId が古くなっています。`,
      `x.com のタブで ${endpoint} を発生させる操作を一度行うと、新しい値を拾って自動で塞ぎます。`,
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

  if (res) {
    return new ApiError(502, `X が ${endpoint} で HTTP ${res.status} を返しました。`, message.slice(0, 300) || null);
  }
  return new ApiError(
    0,
    `${endpoint} の呼び出しに失敗しました: ${message.slice(0, 300)}`,
    'x.com への接続か、応答の解釈で失敗しています。拡張機能に x.com への権限があるか確認してください。',
  );
}

/** いま使っている queryId を flag から読む。ライブラリの flag は any なので形を確かめてから触る。 */
export function queryIdOf(client: TwitterOpenApiClient, endpoint: string): string | null {
  const entry: unknown = client.flag[endpoint];
  if (typeof entry !== 'object' || entry === null) return null;
  const queryId = (entry as { queryId?: unknown }).queryId;
  return typeof queryId === 'string' ? queryId : null;
}
