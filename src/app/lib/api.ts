// サーバの HTTP API を叩く薄いラッパ。
// 呼び出し側（hooks / components）が Response や JSON の形を意識しなくて済むよう、
// 失敗は必ず ApiClientError に正規化して throw する。

import type {
  ActionRequest,
  ActionResponse,
  ApiErrorBody,
  ConfigPatchRequest,
  ConfigSaveResponse,
  ConfigStatus,
  Options,
  Source,
  TimelineResponse,
} from '../../shared/types.ts';

/**
 * API 呼び出しの失敗。
 * status は HTTP ステータス（ネットワーク到達不能は 0）。401 を見て設定モーダルを開くなど、
 * 呼び出し側の分岐に使えるよう握り潰さず保持する。
 */
export class ApiClientError extends Error {
  status: number;
  hint: string | null;

  constructor(message: string, status: number, hint: string | null = null) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.hint = hint;
  }
}

/** fetch の中断は「失敗」ではなく呼び出し側の意図なので、ApiClientError に包まず素通しする。 */
function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

/** サーバのエラーボディ { error, hint } を、形が崩れていても壊れないように読む。 */
function readErrorBody(body: unknown, status: number): ApiErrorBody {
  if (typeof body === 'object' && body !== null) {
    const o = body as Record<string, unknown>;
    return {
      error: typeof o.error === 'string' ? o.error : `HTTP ${status}`,
      hint: typeof o.hint === 'string' ? o.hint : null,
    };
  }
  // JSON ですらない応答（プロキシの HTML エラーページなど）はステータスだけを伝える。
  return { error: `HTTP ${status}`, hint: null };
}

/** 全エンドポイント共通の呼び出し。JSON を返すか ApiClientError を投げるかのどちらかに揃える。 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (e) {
    if (isAbort(e)) throw e;
    // サーバが落ちている場合は status が存在しないので 0 を割り当てる。
    throw new ApiClientError('サーバに接続できませんでした。', 0, 'bun start でサーバが動いているか確認してください。');
  }

  // res.json() は本文が JSON でないと例外になるため、テキストを取ってから自前で解釈する。
  const text = await res.text();
  let body: unknown = null;
  let parsed = false;
  try {
    body = JSON.parse(text);
    parsed = true;
  } catch {
    /* JSON でない応答は下の分岐でステータスだけを使う。 */
  }

  if (!res.ok) {
    const { error, hint } = readErrorBody(parsed ? body : null, res.status);
    throw new ApiClientError(error, res.status, hint);
  }
  if (!parsed) throw new ApiClientError('サーバの応答を解釈できませんでした。', res.status, null);
  return body as T;
}

/**
 * タイムラインを 1 ページ分取得する。
 * cursor が null なら先頭から。signal を渡すと、取得元の切り替えなどで前の要求を捨てられる。
 */
export function fetchTimeline(p: {
  source: Source;
  query: string;
  cursor: string | null;
  opts: Options;
  signal?: AbortSignal;
}): Promise<TimelineResponse> {
  // サーバは真偽値を '1' / '0' で受け取る（未指定は既定値扱いになるので必ず明示する）。
  const q = new URLSearchParams({
    source: p.source,
    q: p.query,
    photos: p.opts.photos ? '1' : '0',
    videos: p.opts.videos ? '1' : '0',
    gifs: p.opts.gifs ? '1' : '0',
    retweets: p.opts.retweets ? '1' : '0',
  });
  // 空のカーソルを送るとサーバ側で「先頭から」と区別できなくなるので、ある時だけ付ける。
  if (p.cursor) q.set('cursor', p.cursor);

  return request<TimelineResponse>(`/api/timeline?${q}`, p.signal ? { signal: p.signal } : undefined);
}

/**
 * いいね・リポスト・ブックマークの実行と取り消し。
 * 成功したときだけ返る（失敗は ApiClientError）ので、呼び出し側は真偽で分岐しなくてよい。
 */
export function sendAction(body: ActionRequest): Promise<ActionResponse> {
  return request<ActionResponse>('/api/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 現在の認証設定の状況。認証情報の値そのものはサーバから返らない。 */
export function fetchConfigStatus(): Promise<ConfigStatus> {
  return request<ConfigStatus>('/api/config');
}

/** cURL または cookie を保存する。保存後の状況が返るので、再取得せずそのまま表示できる。 */
export function saveConfig(body: ConfigPatchRequest): Promise<ConfigSaveResponse> {
  return request<ConfigSaveResponse>('/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
