// 取得は twitter-openapi-typescript に任せ、このファイルは
// 「どのエンドポイントを叩くか」「何ページ進むか」「失敗をどう案内するか」だけを持つ。
//
// 自前の GraphQL 呼び出し(旧実装)は廃止した。queryId と features の既定値は
// ライブラリが実行時に取得する placeholder.json が供給し、設定画面に貼られた cURL の分だけを
// src/server/x-client.ts の applyOverrides が上書きする。
// したがってここには URL も features もヘッダも出てこない。

import type { TimelineApiUtilsResponse, TweetApiUtilsData } from 'twitter-openapi-typescript';

import type { Filters, Source, TimelineResponse, Tweet } from '../shared/types.ts';
import { filterItems, mapTimeline } from './map.ts';
import { ApiError, getClient } from './x-client.ts';
// 例外の日本語化は操作(x-post.ts)と共有するので x-error.ts に置いてある。
import { queryIdOf, toApiError } from './x-error.ts';

// server.ts は x-api.ts から ApiError を受け取る契約なので、実体は x-client.ts のまま再 export する。
// 同じクラスを共有していないと server.ts の instanceof が外れる。
export { ApiError } from './x-client.ts';

/**
 * ソースと GraphQL オペレーション名の対応。
 *
 * この名前は 404 の案内で名指しするために要る。オペレーション名はリクエスト URL の末尾に
 * そのまま現れるので、ユーザーは DevTools の絞り込みにこの文字列をそのまま打ち込める。
 * 名前を出さずに「queryId が古い」とだけ言っても、どのリクエストを Copy as cURL すればよいか分からない。
 */
const ENDPOINT: Record<Source, string> = {
  user: 'UserMedia',
  search: 'SearchTimeline',
  bookmarks: 'Bookmarks',
  foryou: 'HomeTimeline',
  following: 'HomeLatestTimeline',
};

const USER_LOOKUP = 'UserByScreenName';

/** 1 リクエストあたりの要求件数。X 側の上限に近い値で、これ以上増やしても返ってこない。 */
const PAGE = 40;

// ---------------------------------------------------------------------------
// ユーザー ID の解決
// ---------------------------------------------------------------------------

// screenName → restId。同じ画面で何度もページを送るので、1 プロセス内では引き直さない。
const userIdCache = new Map<string, string>();

export async function resolveUserId(screenName: string): Promise<string> {
  const key = screenName.toLowerCase().replace(/^@/, '').trim();
  if (!key) throw new ApiError(400, 'ユーザー名を指定してください。');

  const cached = userIdCache.get(key);
  if (cached) return cached;

  const client = await getClient();
  let id: string | undefined;
  try {
    const res = await client.getUserApi().getUserByScreenName({ screenName: key });
    id = res.data.user?.restId;
  } catch (e) {
    throw toApiError(e, USER_LOOKUP, queryIdOf(client, USER_LOOKUP));
  }

  // 型は restId: string だが、生成モデルは実行時検証をしないので欠けることがある。
  if (!id) {
    throw new ApiError(404, `@${key} が見つかりませんでした。`, '綴り違いか、凍結・非公開のアカウントかもしれません。');
  }
  userIdCache.set(key, id);
  return id;
}

// ---------------------------------------------------------------------------
// 1 ページの取得
// ---------------------------------------------------------------------------

async function fetchPage(
  source: Source,
  query: string,
  cursor: string | null,
): Promise<TimelineApiUtilsResponse<TweetApiUtilsData>> {
  const endpoint = ENDPOINT[source];
  if (!endpoint) throw new ApiError(400, `未知のソース: ${String(source)}`);

  // 空文字のカーソルを渡すと X が先頭に戻らないので、未指定は undefined にする。
  const c = cursor || undefined;

  // userId の解決はそれ自体が別エンドポイント(UserByScreenName)なので、
  // 取得本体の try の外に出して、404 のときに名指しする相手を取り違えないようにする。
  const userId = source === 'user' ? await resolveUserId(query) : '';

  const client = await getClient();
  const api = client.getTweetApi();
  try {
    switch (source) {
      case 'user': {
        const res = await api.getUserMedia({ userId, cursor: c, count: PAGE });
        return res.data;
      }
      case 'search': {
        if (!query.trim()) throw new ApiError(400, '検索語を指定してください。');
        // product: 'Media' は型の列挙に無いが X は受け付ける。画像付きだけを返してくれるので取りこぼしが減る。
        const res = await api.getSearchTimeline({ rawQuery: query, product: 'Media', cursor: c, count: PAGE });
        return res.data;
      }
      case 'bookmarks': {
        const res = await api.getBookmarks({ cursor: c, count: PAGE });
        return res.data;
      }
      // おすすめとフォロー中は別のオペレーションで、ライブラリでも別メソッドになっている。
      // 引数は同じで、X 側での並べ替え(アルゴリズム順 / 時系列順)だけが違う。
      case 'foryou': {
        const res = await api.getHomeTimeline({ cursor: c, count: PAGE });
        return res.data;
      }
      case 'following': {
        const res = await api.getHomeLatestTimeline({ cursor: c, count: PAGE });
        return res.data;
      }
    }
  } catch (e) {
    throw toApiError(e, endpoint, queryIdOf(client, endpoint));
  }
}

// ---------------------------------------------------------------------------
// タイムラインの収集
// ---------------------------------------------------------------------------

export interface FetchMediaTimelineParams {
  source: Source;
  query: string;
  cursor: string | null;
  filters: Filters;
  minItems?: number;
  maxRequests?: number;
}

/**
 * 画像付きのポストだけを集める。
 * おすすめ / フォロー中 / ブックマークは非メディア投稿で埋まるので、
 * 一定件数に届くまで最大 maxRequests 回だけカーソルを進める。
 */
export async function fetchMediaTimeline({
  source,
  query,
  cursor,
  filters,
  minItems = 12,
  maxRequests = 3,
}: FetchMediaTimelineParams): Promise<TimelineResponse> {
  const items: Tweet[] = [];
  const seen = new Set<string>();
  let next: string | null = cursor || null;
  let requests = 0;
  let raw = 0;

  while (requests < maxRequests) {
    const page = await fetchPage(source, query, next);
    requests++;

    const { items: found, cursor: bottom } = mapTimeline(page);
    raw += found.length;
    for (const it of filterItems(found, filters)) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      items.push(it);
    }

    // 空ページ・カーソル据え置きはタイムラインの終端とみなす。
    // 旧実装はメディア付きの件数で空を判定していたが、ライブラリはページ全体の件数を持つので
    // 「メディアが 1 件も無いページ」で打ち切らずに済む。
    if (!bottom || bottom === next || page.data.length === 0) {
      return { items, cursor: null, requests, raw };
    }
    next = bottom;
    if (items.length >= minItems) break;
  }
  return { items, cursor: next, requests, raw };
}
