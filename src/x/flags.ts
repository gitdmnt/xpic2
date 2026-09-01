// 既定値の表は持たない。持つのは、placeholder.json の既定値が X のローテーションに遅れたときに
// 塞ぐための上書きだけで、空なら既定値がそのまま効く。重ねるのは client.ts の applyOverrides。
//
// 供給元は background.ts の観測。parseCurl は、その観測が届かないときの控え。

import { ext } from '../ext/browser.ts';

const KEY = 'flags';

export interface Flags {
  queryIds: Record<string, string>;
  features: Record<string, boolean>;
}

export interface ParsedCurl {
  patch: Partial<Flags>;
  opName: string | null;
}

const EMPTY: Flags = { queryIds: {}, features: {} };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 型が合わない値は捨てる。storage は前のバージョンが書いた形が残りうる。 */
function sanitize(value: unknown): Flags {
  if (!isRecord(value)) return { ...EMPTY };
  const queryIds: Record<string, string> = {};
  const features: Record<string, boolean> = {};
  if (isRecord(value.queryIds)) {
    for (const [k, v] of Object.entries(value.queryIds)) if (typeof v === 'string' && v) queryIds[k] = v;
  }
  if (isRecord(value.features)) {
    for (const [k, v] of Object.entries(value.features)) if (typeof v === 'boolean') features[k] = v;
  }
  return { queryIds, features };
}

export async function loadFlags(): Promise<Flags> {
  const stored = await ext().storage.local.get(KEY);
  return sanitize(stored[KEY]);
}

/**
 * 変化が無ければ書き込まない。background.ts は x.com のリクエストごとに呼ぶので、
 * 毎回書くと storage への書き込みが際限なく増える。
 *
 * @returns 実際に書き換わった queryId のオペレーション名。
 */
export async function mergeFlags(patch: Partial<Flags>): Promise<string[]> {
  const current = await loadFlags();
  const changed: string[] = [];

  const queryIds = { ...current.queryIds };
  for (const [op, id] of Object.entries(patch.queryIds ?? {})) {
    if (queryIds[op] === id) continue;
    queryIds[op] = id;
    changed.push(op);
  }

  const features = { ...current.features };
  let featuresChanged = false;
  for (const [name, on] of Object.entries(patch.features ?? {})) {
    if (features[name] === on) continue;
    features[name] = on;
    featuresChanged = true;
  }

  if (!changed.length && !featuresChanged) return [];
  await ext().storage.local.set({ [KEY]: { queryIds, features } satisfies Flags });
  return changed;
}

/** 上書きを全部捨てて、ライブラリの既定値だけで動く状態へ戻す。 */
export async function clearFlags(): Promise<void> {
  await ext().storage.local.remove(KEY);
}

/** シェルのクォート除け(\' \" \$ \` \\)を戻す。 */
function unescapeShell(s: string): string {
  return s.replace(/\\(['"$`\\])/g, '$1');
}

/**
 * DevTools の「Copy as cURL」文字列から queryId と features を抽出する。
 * cookie と bearer は読み取らない。認証はブラウザのセッションに任せているので、
 * 貼り付けた文字列から認証情報を取り込む理由がない。
 */
export function parseCurl(text: string): ParsedCurl {
  const urlMatch = /(?:'|")(https?:\/\/[^'"]+)(?:'|")/.exec(text) ?? /\b(https?:\/\/\S+)/.exec(text);
  if (!urlMatch?.[1]) return { patch: {}, opName: null };

  try {
    return fromUrl(new URL(unescapeShell(urlMatch[1])));
  } catch {
    return { patch: {}, opName: null };
  }
}

/**
 * GraphQL のリクエスト URL から queryId とオペレーション名、GET なら features を取り出す。
 * cURL の解析と background.ts の観測で同じ規則を使うため、ここを唯一の実装にする。
 */
export function fromUrl(u: URL): ParsedCurl {
  // /i/api/graphql/<queryId>/<OpName> という並びから両方を取る。
  const seg = u.pathname.split('/').filter(Boolean);
  const gi = seg.indexOf('graphql');
  const queryId = seg[gi + 1];
  const opName = seg[gi + 2];
  if (gi < 0 || !queryId || !opName) return { patch: {}, opName: null };

  const patch: Partial<Flags> = { queryIds: { [opName]: queryId } };
  const features = parseFeatures(u.searchParams.get('features'));
  if (features) patch.features = features;
  return { patch, opName };
}

/** features は X が送っている真偽値の辞書。既定値のうち同名のものだけが差し替わる。 */
export function parseFeatures(raw: string | null | undefined): Record<string, boolean> | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(parsed)) if (typeof v === 'boolean') out[k] = v;
  return Object.keys(out).length ? out : null;
}
