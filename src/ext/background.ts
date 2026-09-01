// X は queryId を随時ローテーションさせるので、表を同梱しても必ず古びる。本人のブラウザが
// いま実際に使っている値を横で観測すれば、貼り付け作業なしに追従できる。
//
// 取得と操作そのものは画面側に置く。service worker は数十秒で止められるので、
// 無限スクロールのような長い作業をここへ置けない。

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
    // 既に JSON なので、共通の検証へ通すために文字列へ戻す。
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
    // 権限が無い・storage が使えないなどはここでは手が無い。次の観測に任せる。
  });
}

ext().webRequest.onBeforeRequest.addListener(observe, { urls: ['https://x.com/i/api/graphql/*'] }, [
  'requestBody',
]);

// popup を持たないので、アイコンを押したらタブとして開く。
ext().action.onClicked.addListener(() => {
  void ext().tabs.create({ url: ext().runtime.getURL('index.html') });
});
