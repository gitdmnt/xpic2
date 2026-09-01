// config.json の読み書きと、DevTools の cURL からの設定抽出。
// 認証情報を扱う唯一の場所なので、値そのものを外へ出す口は configStatus に作らない。
//
// queryId と features の既定値は twitter-openapi-typescript が実行時に取得する
// placeholder.json が持つ。このファイルが抱えるのは、その既定値に対する「上書き指定」だけで、
// 何も指定されていなければ空のまま——つまりライブラリの既定値がそのまま効く。
// 上書きを重ねるのは src/server/x-client.ts の applyOverrides。

import fs from 'node:fs';
import path from 'node:path';

import type { ConfigStatus } from '../shared/types';

// このファイルは src/server にあるので、プロジェクトルートは 2 つ上。
const ROOT = path.join(import.meta.dir, '..', '..');
const FILE = path.join(ROOT, 'config.json');

/** x.com のウェブクライアントが使う公開 bearer トークン(固定値)。 */
export const DEFAULT_BEARER =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

export const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// queryId / features の既定値の表はここには置かない。
// ライブラリが placeholder.json として配信元から取ってくるものが唯一の既定値で、
// 表を二重に持つと「どちらが効いているのか」が分からなくなるため。
// こちらが持つのは、その既定値が古びたときに塞ぐための上書き指定だけ。

/**
 * 実行時に参照する設定。マージ後なので、どのフィールドも必ず存在する。
 * ただし queryIds / features は「ライブラリの既定値に対する上書き」なので、
 * 存在するのは辞書そのものだけで、中身は空が既定。
 */
export interface AppConfig {
  cookie: string;
  bearer: string;
  userAgent: string;
  extraHeaders: Record<string, string>;
  /** 上書きしたいエンドポイントだけを持つ。空なら placeholder.json の値がそのまま効く。 */
  queryIds: Record<string, string>;
  /** 上書きしたい features だけを持つ。空なら placeholder.json の値がそのまま効く。 */
  features: Record<string, boolean>;
}

/** config.json に実際に書かれている内容。未指定の項目は書かないので全て省略可能。 */
export type StoredConfig = Partial<AppConfig>;

/** saveConfig / parseCurl が受け渡す差分。 */
export type ConfigPatch = Partial<AppConfig>;

export interface ParsedCurl {
  patch: ConfigPatch;
  opName: string | null;
  url: string | null;
}

const EMPTY: AppConfig = {
  cookie: '',
  bearer: DEFAULT_BEARER,
  userAgent: DEFAULT_UA,
  extraHeaders: {},
  queryIds: {},
  features: {},
};

/** マージ結果は変わらないので、プロセス内で使い回す。saveConfig が破棄する。 */
let cache: AppConfig | null = null;

/** ファイルが無い・壊れている場合は未設定として扱い、起動を止めない。 */
function readStored(): StoredConfig {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (parsed && typeof parsed === 'object') return parsed as StoredConfig;
  } catch {
    /* 未設定なら空のまま */
  }
  return {};
}

export function loadConfig(): AppConfig {
  if (cache) return cache;
  const saved = readStored();
  cache = {
    ...EMPTY,
    ...saved,
    extraHeaders: { ...EMPTY.extraHeaders, ...saved.extraHeaders },
    // 重ねる既定値は無い。保存されている分がそのまま上書き指定になる。
    queryIds: { ...saved.queryIds },
    features: { ...saved.features },
  };
  return cache;
}

/** 空になった辞書は保存しない。queryIds / features なら「上書き無し」に戻ることを意味する。 */
const DICT_KEYS = ['extraHeaders', 'queryIds', 'features'] as const;

/**
 * 差分を config.json へ書き戻す。
 *
 * 保存で cookie や上書き指定が変わると x-client.ts のクライアントは作り直しが要るが、
 * ここから resetClient() は呼ばない。x-client.ts が config.ts を import しているので、
 * 逆向きに import すると循環する。呼ぶのは保存の呼び出し元（server.ts）の責任にする。
 */
export function saveConfig(patch: ConfigPatch): AppConfig {
  const saved = readStored();
  const next: StoredConfig = {
    ...saved,
    ...patch,
    extraHeaders: { ...saved.extraHeaders, ...patch.extraHeaders },
    queryIds: { ...saved.queryIds, ...patch.queryIds },
    features: { ...saved.features, ...patch.features },
  };
  for (const k of DICT_KEYS) {
    const dict = next[k];
    if (dict && Object.keys(dict).length === 0) delete next[k];
  }
  // cookie を含むので他ユーザから読めないようにする。
  // mode は新規作成時にしか効かないため、既存ファイル向けに chmod も掛ける。
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.chmodSync(FILE, 0o600);
  cache = null;
  return loadConfig();
}

/**
 * 認証情報そのものは返さず、設定状況だけを返す。
 * queryIds と featureCount が数えるのは上書き指定であって、実際に使われる値の全量ではない。
 * どちらも空なら「ライブラリの既定値だけで動いている」ことを意味する。
 */
export function configStatus(): ConfigStatus {
  const cfg = loadConfig();
  const cookieKeys = [...cfg.cookie.matchAll(/(^|;\s*)([^=;\s]+)=/g)].map((m) => m[2] ?? '');
  return {
    configured: Boolean(
      cfg.cookie && /(^|;\s*)auth_token=/.test(cfg.cookie) && /(^|;\s*)ct0=/.test(cfg.cookie),
    ),
    cookieKeys,
    cookieLength: cfg.cookie.length,
    bearerCustom: cfg.bearer !== DEFAULT_BEARER,
    queryIds: cfg.queryIds,
    featureCount: Object.keys(cfg.features).length,
    extraHeaderKeys: Object.keys(cfg.extraHeaders),
    file: FILE,
  };
}

/** シェルのクォート除け(\' \" \$ \` \\)を戻す。 */
function unescapeShell(s: string): string {
  return s.replace(/\\(['"$`\\])/g, '$1');
}

/**
 * DevTools の「Copy as cURL」文字列から cookie / bearer / queryId / features を抽出する。
 *
 * ここで取れた queryId / features はそのまま上書き指定になる。
 * ライブラリの placeholder.json が X のローテーションに遅れて 404 が出るようになったとき、
 * 貼った本人のブラウザが実際に使っている値で、そのエンドポイントだけを塞ぐための入口。
 */
export function parseCurl(text: string): ParsedCurl {
  const headers: Record<string, string> = {};
  const queryIds: Record<string, string> = {};
  let features: Record<string, boolean> | null = null;
  let opName: string | null = null;
  let url: string | null = null;

  const headerRe = /(?:-H|--header)\s+(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  for (const m of text.matchAll(headerRe)) {
    const raw = unescapeShell(m[1] ?? m[2] ?? '');
    const i = raw.indexOf(':');
    if (i < 0) continue;
    headers[raw.slice(0, i).trim().toLowerCase()] = raw.slice(i + 1).trim();
  }
  const cookieFlag = /(?:-b|--cookie)\s+(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/.exec(text);
  if (cookieFlag) headers.cookie = unescapeShell(cookieFlag[1] ?? cookieFlag[2] ?? '');

  const urlMatch = /(?:'|")(https?:\/\/[^'"]+)(?:'|")/.exec(text) ?? /\b(https?:\/\/\S+)/.exec(text);
  if (urlMatch) {
    url = urlMatch[1] ?? null;
    try {
      const u = new URL(url ?? '');
      // /i/api/graphql/<queryId>/<OpName> という並びから両方を取る。
      const seg = u.pathname.split('/').filter(Boolean);
      const gi = seg.indexOf('graphql');
      if (gi >= 0 && seg.length >= gi + 3) {
        const op = seg[gi + 2] as string;
        opName = op;
        queryIds[op] = seg[gi + 1] as string;
      }
      const f = u.searchParams.get('features');
      if (f) {
        const parsed: unknown = JSON.parse(f);
        // 中身は X が送っている真偽値の辞書。既定値のうち同名のものだけが差し替わる。
        if (parsed && typeof parsed === 'object') features = parsed as Record<string, boolean>;
      }
    } catch {
      /* URL が壊れていても他は活かす */
    }
  }

  const patch: ConfigPatch = {};
  if (headers.cookie) patch.cookie = headers.cookie;
  if (headers.authorization) patch.bearer = headers.authorization;
  if (headers['user-agent']) patch.userAgent = headers['user-agent'];
  if (Object.keys(queryIds).length) patch.queryIds = queryIds;
  if (features) patch.features = features;

  const extra: Record<string, string> = {};
  for (const k of ['x-client-transaction-id', 'x-twitter-client-language', 'x-client-uuid']) {
    // transaction-id はリクエスト毎に変わるので取り込まない
    const v = headers[k];
    if (k !== 'x-client-transaction-id' && v) extra[k] = v;
  }
  if (Object.keys(extra).length) patch.extraHeaders = extra;

  return { patch, opName, url };
}
