// Firefox は `browser`、Chrome は `chrome` を生やす。MV3 ではどちらも promise を返すので、
// 掴んだ方をそのまま await できる。
//
// 型は使う分だけをここで宣言する。@types/chrome を足すと Firefox 側の差が消えて、
// 両方で動く範囲がコードから読み取れなくなる。

interface Cookie {
  value: string;
}

interface StorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

/** webRequest の観測に使う分だけ。ブロッキングは Chrome MV3 に無いので触らない。 */
export interface WebRequestDetails {
  url: string;
  method: string;
  requestBody?: { raw?: Array<{ bytes?: ArrayBuffer }> } | null;
}

export interface BrowserApi {
  storage: { local: StorageArea };
  cookies: { get(details: { url: string; name: string }): Promise<Cookie | null> };
  downloads: { download(options: { url: string; filename?: string }): Promise<number> };
  permissions: {
    contains(p: { origins: string[] }): Promise<boolean>;
    request(p: { origins: string[] }): Promise<boolean>;
  };
  runtime: { getURL(path: string): string; readonly lastError?: { message?: string } };
  tabs: { create(p: { url: string }): Promise<unknown> };
  action: { onClicked: { addListener(fn: () => void): void } };
  webRequest: {
    onBeforeRequest: {
      addListener(
        fn: (details: WebRequestDetails) => void,
        filter: { urls: string[] },
        extra?: string[],
      ): void;
    };
  };
}

declare global {
  var browser: BrowserApi | undefined;
  var chrome: BrowserApi | undefined;
}

/**
 * 定数ではなく関数なのは、読み込んだ時点で解決すると拡張の外（テストなど）では
 * import しただけで落ちるため。テストは globalThis.chrome に差し替えを置けばよい。
 */
export function ext(): BrowserApi {
  const api = globalThis.browser ?? globalThis.chrome;
  if (!api) throw new Error('拡張 API が見つかりません。拡張機能として読み込まれていない可能性があります。');
  return api;
}

/** x.com へ届く必要のある権限。Firefox の MV3 では既定で保留されるので、画面から要求できるようにする。 */
export const REQUIRED_ORIGINS = [
  'https://x.com/*',
  'https://api.x.com/*',
  'https://raw.githubusercontent.com/*',
];
