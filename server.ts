// Bun.serve のエントリ。Node 版 server.js の API 契約はそのままに、Bun のフルスタックモードへ載せ替える。
// HTML を import して routes に渡すと main.tsx / styles.css は Bun が自動でバンドルするので、
// 静的ファイルを自前で読んで配信するコードはこのファイルには存在しない。

import { basename } from 'node:path';
import index from './src/app/index.html';
import { configStatus, loadConfig, parseCurl, saveConfig } from './src/server/config.ts';
import { ApiError, fetchMediaTimeline } from './src/server/x-api.ts';
import { resetClient } from './src/server/x-client.ts';
import { actOnTweet } from './src/server/x-post.ts';
import type {
  ActionRequest,
  ActionResponse,
  ApiErrorBody,
  ConfigPatchRequest,
  ConfigSaveResponse,
  Filters,
  Source,
  TweetAction,
} from './src/shared/types.ts';

const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? '127.0.0.1';
/** 本番以外は Bun の HMR とエラー表示を有効にする。 */
const DEVELOPMENT = process.env.NODE_ENV !== 'production';

/** as const と satisfies の併用で、Source が増えたときに追従漏れをコンパイル時に気づける。 */
const SOURCES = ['user', 'search', 'bookmarks', 'foryou', 'following'] as const satisfies readonly Source[];

/** 同上。TweetAction が増えたら、この表を直すまでコンパイルが通らない。 */
const ACTIONS = ['like', 'retweet', 'bookmark'] as const satisfies readonly TweetAction[];

/** saveConfig の引数型から導出し、config.ts 側の定義変更に自動追従させる。 */
type ConfigPatch = Parameters<typeof saveConfig>[0];

type Handler = (req: Request) => Response | Promise<Response>;

function isSource(value: string): value is Source {
  return (SOURCES as readonly string[]).includes(value);
}

function isAction(value: string): value is TweetAction {
  return (ACTIONS as readonly string[]).includes(value);
}

function json(status: number, body: unknown): Response {
  // 認証状況もタイムラインも毎回変わるため、ブラウザにキャッシュさせない。
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function fail(status: number, error: string, hint: string | null = null): Response {
  return json(status, { error, hint } satisfies ApiErrorBody);
}

/** ApiError の status をそのまま HTTP ステータスにする。想定外の例外だけログに残して 500 にする。 */
function guarded(handler: Handler): Handler {
  return async (req) => {
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof ApiError) return fail(err.status, err.message, err.hint);
      console.error(err);
      return fail(500, err instanceof Error ? err.message : String(err));
    }
  };
}

const configGet = guarded(() => json(200, configStatus()));

const configPost = guarded(async (req) => {
  const text = await req.text();
  let payload: ConfigPatchRequest;
  try {
    payload = JSON.parse(text || '{}') as ConfigPatchRequest;
  } catch {
    throw new ApiError(400, 'リクエストの JSON を解釈できませんでした。');
  }

  let patch: ConfigPatch = {};
  let note: string | null = null;

  if (payload.curl) {
    const parsed = parseCurl(payload.curl);
    // cookie も queryId も取れない cURL は貼り間違いなので、保存せずに教える。
    if (!parsed.patch.cookie && !Object.keys(parsed.patch.queryIds ?? {}).length) {
      return fail(400, 'cURL から cookie も queryId も読み取れませんでした。');
    }
    patch = parsed.patch;
    note = parsed.opName ? `${parsed.opName} の queryId と features を更新しました。` : 'cookie を更新しました。';
  }
  if (payload.cookie) patch.cookie = String(payload.cookie).trim();
  if (payload.bearer) patch.bearer = String(payload.bearer).trim();
  // 明示指定の queryIds は cURL 由来のものへ上書きで重ねる。
  if (payload.queryIds && typeof payload.queryIds === 'object') {
    patch.queryIds = { ...patch.queryIds, ...payload.queryIds };
  }
  if (!Object.keys(patch).length) return fail(400, '保存する内容がありません。');

  saveConfig(patch);
  // config.ts は循環 import を避けるため自分では呼べない。保存の呼び出し元がここで受け持つ。
  // cookie と上書き指定は x-client 側のキャッシュ鍵に入っているので放っておいても作り直されるが、
  // User-Agent はクライアント生成時にしか読まれないため、明示的に捨てないと古いまま残る。
  resetClient();
  return json(200, { ok: true, note, status: configStatus() } satisfies ConfigSaveResponse);
});

const timelineGet = guarded(async (req) => {
  const q = new URL(req.url).searchParams;
  // クライアントは真偽値を '1' / '0' で送る。未指定なら既定値を採る。
  const bool = (key: string, dflt: boolean): boolean =>
    q.has(key) ? q.get(key) === '1' || q.get(key) === 'true' : dflt;

  const source = q.get('source') ?? 'user';
  // 未知のソースは x-api 側でも 400 になるが、Source へ絞り込むため入口で同じ文言で弾く。
  if (!isSource(source)) throw new ApiError(400, `未知のソース: ${source}`);

  const result = await fetchMediaTimeline({
    source,
    query: (q.get('q') ?? '').trim(),
    cursor: q.get('cursor') ?? null,
    // 1 リクエストで X を叩きすぎないよう上限を固定し、数値にならない指定は既定値へ落とす。
    minItems: Math.min(60, Number(q.get('min') ?? 12) || 12),
    maxRequests: Math.min(5, Number(q.get('max') ?? 3) || 3),
    filters: {
      photos: bool('photos', true),
      videos: bool('videos', true),
      gifs: bool('gifs', true),
      retweets: bool('retweets', true),
      replies: bool('replies', true),
    } satisfies Filters,
  });
  return json(200, result);
});

/**
 * いいね・リポスト・ブックマークの実行と取り消し。
 * 取り消しは押し間違いの影響が大きいので、on は真偽値でしか受けない
 * （欠けた JSON を「取り消し」と解釈すると、意図しない解除が起きる）。
 */
const actionPost = guarded(async (req) => {
  const text = await req.text();
  let payload: ActionRequest;
  try {
    payload = JSON.parse(text || '{}') as ActionRequest;
  } catch {
    throw new ApiError(400, 'リクエストの JSON を解釈できませんでした。');
  }

  const id = String(payload.id ?? '').trim();
  const action = String(payload.action ?? '');
  if (!isAction(action)) throw new ApiError(400, `未知の操作: ${action}`);
  if (typeof payload.on !== 'boolean') throw new ApiError(400, 'on には真偽値が必要です。');

  await actOnTweet(id, action, payload.on);
  return json(200, { ok: true, id, action, on: payload.on } satisfies ActionResponse);
});

/** 画像の保存とリファラ制限の回避用。任意の URL を中継すると踏み台になるので twimg.com の https だけ通す。 */
const mediaGet = guarded(async (req) => {
  const q = new URL(req.url).searchParams;
  const target = q.get('url') ?? '';
  const download = q.get('dl') === '1';

  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return fail(400, 'URL が不正です。');
  }
  if (u.protocol !== 'https:' || !/(^|\.)twimg\.com$/.test(u.hostname)) {
    return fail(400, 'twimg.com のみ中継できます。');
  }

  const upstream = await fetch(u, {
    headers: { referer: 'https://x.com/', 'user-agent': loadConfig().userAgent },
  });
  if (!upstream.ok || !upstream.body) {
    // 204 など本文を持てないステータスをそのまま返すと Response が例外を投げるため 502 に寄せる。
    return json(upstream.status >= 400 ? upstream.status : 502, {
      error: `取得に失敗しました (HTTP ${upstream.status})`,
      hint: null,
    } satisfies ApiErrorBody);
  }

  const format = u.searchParams.get('format');
  const name = basename(u.pathname) + (format ? `.${format}` : '');
  // Bun は upstream の ReadableStream をそのまま渡せるので、全体をメモリに載せずに中継できる。
  return new Response(upstream.body, {
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'public, max-age=86400',
      ...(download ? { 'content-disposition': `attachment; filename="${name}"` } : {}),
    },
  });
});

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  development: DEVELOPMENT,
  // body を受けるのは設定保存だけなので、上限を小さく固定する。
  maxRequestBodySize: 2 * 1024 * 1024,
  routes: {
    '/': index,
    '/api/config': { GET: configGet, POST: configPost },
    '/api/timeline': { GET: timelineGet },
    '/api/action': { POST: actionPost },
    '/api/media': { GET: mediaGet },
  },
  fetch(req) {
    // routes に無い API パスは Node 版と同じ 404 JSON を返す。
    const { pathname } = new URL(req.url);
    if (pathname.startsWith('/api/')) return fail(404, 'not found');
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
});

const status = configStatus();
console.log(`xpic2  ->  http://${server.hostname}:${server.port}`);
console.log(status.configured ? '認証情報: 設定済み' : '認証情報: 未設定 (画面右上の「設定」から登録してください)');
