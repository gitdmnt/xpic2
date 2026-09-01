// バックグラウンド。役目は 2 つだけで、どちらも画面を開いていなくても動く必要がある。
//
//   1. 利用者の x.com のタブが投げている GraphQL リクエストを観測し、queryId と features を拾う。
//   2. ツールバーのアイコンから画面を開く。
//
// 1 がこの拡張機能の要点である。X は queryId を随時ローテーションさせるので、
// 表を同梱しても必ず古びる。本人のブラウザが「いま実際に使っている値」を横で見ていれば、
// 貼り付け作業なしに追従できる。
//
// 取得と操作そのものはここでは行わない。拡張機能のページ側で完結させている。
// service worker は数十秒で止められるため、無限スクロールのような長い作業を置く場所ではない。

import { ext, type WebRequestDetails } from './browser.ts';
import { fromUrl, mergeFlags, parseFeatures } from '../x/flags.ts';

/** GraphQL の POST は features を本文に載せる。GET はクエリ文字列なので fromUrl が拾う。 */
function featuresFromBody(details: WebRequestDetails): Record<string, boolean> | null {
  const raw = details.requestBody?.raw?.[0]?.bytes;
  if (!raw) return null;
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (typeof body !== 'object' || body === null) return null;
    const features = (body as { features?: unknown }).features;
    // 本文の features は既に JSON なので、文字列へ戻してから共通の検証に通す。
    return features === undefined ? null : parseFeatures(JSON.stringify(features));
  } catch {
    return null;
  }
}

function observe(details: WebRequestDetails): void {
  let url: URL;
  try {
    url = new URL(details.url);
  } catch {
    return;
  }

  const { patch, opName } = fromUrl(url);
  if (!opName) return;

  const fromBody = featuresFromBody(details);
  if (fromBody) patch.features = { ...patch.features, ...fromBody };

  // 変化が無ければ mergeFlags は書き込まない。x.com を眺めているあいだ毎秒呼ばれる経路なので、
  // ここで握り潰さないと storage への書き込みが際限なく増える。
  void mergeFlags(patch).catch(() => {
    // 権限が無い・storage が使えないなどはここでは何もできない。次の観測に任せる。
  });
}

ext().webRequest.onBeforeRequest.addListener(observe, { urls: ['https://x.com/i/api/graphql/*'] }, [
  'requestBody',
]);

// popup を持たないので、アイコンを押したらタブとして開く。
ext().action.onClicked.addListener(() => {
  void ext().tabs.create({ url: ext().runtime.getURL('index.html') });
});
