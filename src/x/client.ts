// twitter-openapi-typescript のクライアント生成と、queryId の上書き。
//
// サーバ版との違いは認証の持ち方にある。cookie はこちらでは保管も送信もしない。
// 拡張機能のページから x.com へ投げたリクエストに、ブラウザが自分の cookie を載せる。
// こちらが用意するのは x-csrf-token だけで、これは HttpOnly でない ct0 から作る。
//
// 方針は「既定値はライブラリ、queryId だけこちらで上書きできる」。
// ライブラリは placeholder.json（queryId と features の表）を実行時に取得するが、
// その中身は配信時点のスナップショットで、X のローテーションに遅れる。
// background.ts が観測した値で、必要な分だけ差し替える。

import { TwitterOpenApi, type TwitterOpenApiClient } from 'twitter-openapi-typescript';
import { ext, REQUIRED_ORIGINS } from '../ext/browser.ts';
import { ApiError } from './error.ts';
import { loadFlags } from './flags.ts';

/**
 * ライブラリの fetch を差し替える。
 *
 * 既定の fetch は credentials が same-origin なので、chrome-extension:// のページから
 * x.com を叩いても cookie が載らない。載せるのは x.com 宛だけに絞る。
 * GitHub から取る placeholder.json などにまで cookie を送る理由が無いため。
 *
 * ライブラリはこのあと cookie ヘッダを自分で立てるが、Cookie は禁止ヘッダ名なので
 * ブラウザが落とす。落とされて正しい。ここで載せたいのはブラウザ自身が持つ本物である。
 */
TwitterOpenApi.fetchApi = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const toX = /^https:\/\/([a-z0-9-]+\.)*x\.com\//.test(url);
  return fetch(input, toX ? { ...init, credentials: 'include' } : init);
};

/**
 * flag の 1 エントリ。ライブラリの DefaultFlag は Record<string, any> で
 * 型が付いていないので、こちらで扱う分だけ形を宣言する。
 */
interface FlagEntry {
  '@path': string;
  '@method': string;
  queryId: string;
  variables?: Record<string, unknown>;
  features?: Record<string, unknown>;
  fieldToggles?: Record<string, unknown>;
}

function isFlagEntry(v: unknown): v is FlagEntry {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['@path'] === 'string' && typeof o.queryId === 'string';
}

/**
 * queryId を差し替える。
 *
 * flag は queryId と @path の両方に ID を持ち、リクエスト URL は前者、
 * x-client-transaction-id の署名は後者から作られる（api.js の initOverrides）。
 * 片方だけ直すと署名がパスと食い違うので、必ず両方を書き換える。
 */
export function applyOverrides(
  client: TwitterOpenApiClient,
  queryIds: Record<string, string>,
  features: Record<string, boolean>,
): { queryIds: string[]; features: string[] } {
  const appliedQueryIds: string[] = [];
  const appliedFeatures: string[] = [];

  for (const [op, queryId] of Object.entries(queryIds)) {
    const entry: unknown = client.flag[op];
    if (!isFlagEntry(entry)) continue;
    if (entry.queryId === queryId) continue;
    entry['@path'] = entry['@path'].replace(entry.queryId, queryId);
    entry.queryId = queryId;
    appliedQueryIds.push(op);
  }

  // features は全エンドポイントで共通の名前空間なので、存在するキーだけ上書きする。
  // 未知の名前を足すと X 側が 400 を返すことがあるため、新規追加はしない。
  for (const entry of Object.values(client.flag)) {
    if (!isFlagEntry(entry) || !entry.features) continue;
    for (const [name, value] of Object.entries(features)) {
      if (!(name in entry.features)) continue;
      if (entry.features[name] === value) continue;
      entry.features[name] = value;
      if (!appliedFeatures.includes(name)) appliedFeatures.push(name);
    }
  }

  return { queryIds: appliedQueryIds, features: appliedFeatures };
}

/** x.com の cookie を 1 つ読む。権限が無い・未ログインなら null。 */
async function cookieValue(name: string): Promise<string | null> {
  try {
    const c = await ext().cookies.get({ url: 'https://x.com', name });
    return c?.value ?? null;
  } catch {
    return null;
  }
}

export interface SessionStatus {
  /** x.com などへのホスト権限が下りているか。Firefox の MV3 では既定で保留される。 */
  granted: boolean;
  /** x.com にログインしているか（auth_token の有無で見る）。 */
  loggedIn: boolean;
}

export async function sessionStatus(): Promise<SessionStatus> {
  const granted = await ext().permissions.contains({ origins: REQUIRED_ORIGINS });
  if (!granted) return { granted: false, loggedIn: false };
  return { granted: true, loggedIn: (await cookieValue('auth_token')) !== null };
}

/** 権限をその場で要求する。Firefox はここを通さないと x.com へ届かない。 */
export function requestPermissions(): Promise<boolean> {
  return ext().permissions.request({ origins: REQUIRED_ORIGINS });
}

interface Cached {
  key: string;
  client: TwitterOpenApiClient;
}

let cached: Cached | null = null;

/** 上書きが変わったら作り直したいので、まとめて鍵にする。 */
function cacheKey(ct0: string, flags: unknown): string {
  return JSON.stringify([ct0, flags]);
}

/**
 * クライアントを取得する。
 * 生成は placeholder.json と pair.json の取得を伴うので、条件が同じあいだは使い回す。
 * 画面はタブとして開きっぱなしなので、この使い回しはそのまま効く。
 */
export async function getClient(): Promise<TwitterOpenApiClient> {
  const { granted, loggedIn } = await sessionStatus();
  if (!granted) {
    throw new ApiError(0, 'x.com への権限がありません。', '設定画面の「権限を許可」から許可してください。');
  }
  if (!loggedIn) {
    throw new ApiError(401, 'x.com にログインしていません。', 'x.com を開いてログインしてから読み込み直してください。');
  }

  const ct0 = await cookieValue('ct0');
  if (!ct0) {
    throw new ApiError(
      401,
      'x.com の ct0 cookie が読めませんでした。',
      'x.com を一度開くと発行されます。開いても出ない場合はログインし直してください。',
    );
  }

  const flags = await loadFlags();
  const key = cacheKey(ct0, flags);
  if (cached && cached.key === key) return cached.client;

  const api = new TwitterOpenApi();
  let client: TwitterOpenApiClient;
  try {
    // 渡すのは ct0 だけでよい。ライブラリはこれを x-csrf-token に写し、
    // 残りは cookie ヘッダへ書くが、そちらはブラウザに落とされて本物が使われる。
    client = await api.getClientFromCookies({ ct0 });
  } catch (e) {
    throw new ApiError(
      0,
      `X クライアントの初期化に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      'placeholder.json / pair.json の取得か、x.com のトップページ解析で失敗しています。',
    );
  }

  applyOverrides(client, flags.queryIds, flags.features);
  cached = { key, client };
  return client;
}
