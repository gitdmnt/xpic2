// 画面から取得層（src/x）を呼ぶための薄い層。
//
// サーバ版ではここに HTTP のラッパが入っていたが、拡張機能では同じバンドルの中なので直接呼ぶ。
// 残っているのは 2 つだけで、どちらも画面側の都合である。
//   1. 表示設定（Options）から取得条件（Filters）への読み替え。
//   2. 読み直しに追い越された取得の扱い。

import type { ActionRequest, Options, Source, TimelineResponse } from '../../shared/types.ts';
import { actOnTweet } from '../../x/actions.ts';
import { requestPermissions, sessionStatus } from '../../x/client.ts';
import { ApiError } from '../../x/error.ts';
import { clearFlags, loadFlags, mergeFlags, parseCurl } from '../../x/flags.ts';
import { fetchMediaTimeline } from '../../x/timeline.ts';

export { ApiError, requestPermissions };

/**
 * タイムラインを 1 回分取得する。
 *
 * signal で止められるのは「結果を受け取るかどうか」だけである。
 * ライブラリに AbortSignal を渡す口が無いので、飛んだリクエストそのものは最後まで走る。
 * 取得元を切り替えた直後に古い応答が画面へ混ざらないようにするのが目的なので、これで足りる。
 */
export async function fetchTimeline(p: {
  source: Source;
  query: string;
  cursor: string | null;
  opts: Options;
  signal?: AbortSignal;
}): Promise<TimelineResponse> {
  if (p.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const res = await fetchMediaTimeline({
    source: p.source,
    query: p.query,
    cursor: p.cursor,
    filters: {
      photos: p.opts.photos,
      videos: p.opts.videos,
      gifs: p.opts.gifs,
      retweets: p.opts.retweets,
      replies: true,
    },
  });
  if (p.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return res;
}

/** いいね・リポスト・ブックマークの実行と取り消し。成功したときだけ返る。 */
export function sendAction(body: ActionRequest): Promise<void> {
  return actOnTweet(body.id, body.action, body.on);
}

/** 設定画面が出す状況。認証情報そのものは扱わないので、ここにも現れない。 */
export interface ExtStatus {
  /** x.com などへのホスト権限が下りているか。 */
  granted: boolean;
  /** x.com にログインしているか。 */
  loggedIn: boolean;
  /** 観測と貼り付けで溜まった queryId の上書き。既定値の全量ではない。 */
  queryIds: Record<string, string>;
  /** 同じく features の上書きの件数。 */
  featureCount: number;
}

/** 読み込みを始めてよいか。権限とログインの両方が要る。 */
export function isReady(s: ExtStatus): boolean {
  return s.granted && s.loggedIn;
}

export async function extStatus(): Promise<ExtStatus> {
  const [session, flags] = await Promise.all([sessionStatus(), loadFlags()]);
  return {
    granted: session.granted,
    loggedIn: session.loggedIn,
    queryIds: flags.queryIds,
    featureCount: Object.keys(flags.features).length,
  };
}

/**
 * cURL から queryId の上書きを取り込む。
 * 観測（background.ts）が届かないときの控えなので、取れなければその旨を返して何も保存しない。
 */
export async function applyCurl(text: string): Promise<string> {
  const { patch, opName } = parseCurl(text);
  if (!opName) {
    throw new ApiError(0, 'この cURL から queryId を読み取れませんでした。', 'i/api/graphql/… のリクエストを貼ってください。');
  }
  const changed = await mergeFlags(patch);
  return changed.length ? `${opName} の queryId を更新しました。` : `${opName} は既に同じ値でした。`;
}

/** 上書きを全部捨てて、ライブラリの既定値だけで動く状態に戻す。 */
export function clearOverrides(): Promise<void> {
  return clearFlags();
}
