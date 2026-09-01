// twitter-openapi-typescript のクライアント生成と、queryId の上書き。
//
// 方針は「既定値はライブラリ、queryId だけこちらで上書きできる」。
// ライブラリは placeholder.json（queryId と features の表）を実行時に取得するが、
// その中身は配信時点のスナップショットで、X のローテーションに遅れる。
// 設定画面に貼られた cURL から抽出した値で、必要な分だけ差し替える。

import { TwitterOpenApi, type TwitterOpenApiClient } from 'twitter-openapi-typescript';
import { loadConfig } from './config.ts';

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

interface Cached {
  key: string;
  client: TwitterOpenApiClient;
}

let cached: Cached | null = null;

/** 設定が変わったら作り直したいので、cookie と上書き内容をまとめて鍵にする。 */
function cacheKey(cookie: string, queryIds: Record<string, string>, features: Record<string, boolean>): string {
  return JSON.stringify([cookie, queryIds, features]);
}

/**
 * クライアントを取得する。
 * 生成は placeholder.json と pair.json の取得を伴うので、設定が同じあいだは使い回す。
 */
export async function getClient(): Promise<TwitterOpenApiClient> {
  const cfg = loadConfig();
  const cookie = cfg.cookie;
  if (!cookie) {
    throw new ApiError(401, 'X の認証情報が未設定です。', '設定画面で DevTools の cURL か cookie を登録してください。');
  }
  const jar = parseCookie(cookie);
  if (!jar.auth_token || !jar.ct0) {
    throw new ApiError(
      401,
      'cookie に auth_token と ct0 の両方が必要です。',
      `いま入っているのは ${Object.keys(jar).join(', ') || '(なし)'} です。`,
    );
  }

  const key = cacheKey(cookie, cfg.queryIds, cfg.features);
  if (cached && cached.key === key) return cached.client;

  const api = new TwitterOpenApi();
  // cookie を発行したブラウザと Sec-CH-UA-Platform が食い違うと X に弾かれる。
  // 既定は Linux Chrome なので、設定の User-Agent から推測して合わせる。
  const platform = detectPlatform(cfg.userAgent);
  if (platform) api.setAdditionalApiHeaders({ 'sec-ch-ua-platform': `"${platform}"` });

  let client: TwitterOpenApiClient;
  try {
    client = await api.getClientFromCookies({ auth_token: jar.auth_token, ct0: jar.ct0 });
  } catch (e) {
    throw new ApiError(
      502,
      `X クライアントの初期化に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      'placeholder.json / pair.json の取得か、x.com のトップページ解析で失敗しています。',
    );
  }

  applyOverrides(client, cfg.queryIds, cfg.features);
  cached = { key, client };
  return client;
}

export function resetClient(): void {
  cached = null;
}

export function parseCookie(cookie: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of cookie.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (name) out[name] = part.slice(i + 1).trim();
  }
  return out;
}

/** Sec-CH-UA-Platform に入れる値。判定できなければ既定のままにする。 */
function detectPlatform(userAgent: string): string | null {
  if (/Mac OS X|Macintosh/i.test(userAgent)) return 'macOS';
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/iPhone|iPad/i.test(userAgent)) return 'iOS';
  if (/Linux|X11/i.test(userAgent)) return 'Linux';
  return null;
}
