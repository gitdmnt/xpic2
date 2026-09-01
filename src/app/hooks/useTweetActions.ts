// いいね・リポスト・ブックマークの状態管理。
//
// タイムラインの Tweet は「取得した時点の状態」しか持たないので、押した結果はこの外側で覚える。
// 送信の返事を待ってから見た目を変えると反応が鈍いので、先に変えて（楽観更新）、
// 失敗したときだけ押す前へ戻す。数値も同じだけ増減させて、見た目と数の食い違いを防ぐ。

import { useCallback, useMemo, useRef, useState } from 'react';
import type { Tweet, TweetAction, TweetStats, TweetViewerState } from '../../shared/types.ts';
import { sendAction } from '../lib/x.ts';

/** 操作 → 自分の状態を表す項目。ボタン側もこの対応を使う。 */
export const VIEWER_FIELD: Record<TweetAction, keyof TweetViewerState> = {
  like: 'liked',
  retweet: 'retweeted',
  bookmark: 'bookmarked',
};

/** 操作 → 増減する統計の項目。 */
export const STAT_FIELD: Record<TweetAction, keyof TweetStats> = {
  like: 'likes',
  retweet: 'retweets',
  bookmark: 'bookmarks',
};

/** 走査と、画面に並べるボタンの順序。 */
export const ACTION_ORDER: readonly TweetAction[] = ['like', 'retweet', 'bookmark'];

const LABEL: Record<TweetAction, string> = {
  like: 'いいね',
  retweet: 'リポスト',
  bookmark: 'ブックマーク',
};

/** 1 ポスト分の表示用の状態。タイルにもライトボックスにもこれを渡す。 */
export interface TweetActionState {
  viewer: TweetViewerState;
  /** 楽観更新を反映した統計。取得時の値との差だけを足し引きする。 */
  stats: TweetStats;
  /** 送信中の操作。3 つは X 側でも別々のエンドポイントなので、同時に走らせて構わない。 */
  pending: readonly TweetAction[];
}

export interface TweetActionsState {
  /** ポスト id → 表示用の状態。まだ何も押していないポストも必ず入っている。 */
  actions: Map<string, TweetActionState>;
  toggle(tweet: Tweet, action: TweetAction): void;
  /** 直近の失敗。表示したら dismissError で消す。 */
  error: string | null;
  dismissError(): void;
}

/** 押した結果として覚えておく分。取得時の値は Tweet 側にあるので、ここには持たない。 */
interface Override {
  viewer: TweetViewerState;
  pending: readonly TweetAction[];
}

/** 取得時からの差だけを統計へ反映する。二度押して元に戻れば、数も元へ戻る。 */
function withDelta(tweet: Tweet, viewer: TweetViewerState): TweetStats {
  const stats = { ...tweet.stats };
  for (const action of ACTION_ORDER) {
    const before = tweet.viewer[VIEWER_FIELD[action]];
    const after = viewer[VIEWER_FIELD[action]];
    if (before === after) continue;
    const field = STAT_FIELD[action];
    // 取得時に 0 と報告された値から引くと負になりうるので、下限を 0 で止める。
    stats[field] = Math.max(0, stats[field] + (after ? 1 : -1));
  }
  return stats;
}

function failureMessage(e: unknown, action: TweetAction, on: boolean): string {
  const what = on ? LABEL[action] : `${LABEL[action]}の取り消し`;
  const why = e instanceof Error ? e.message : String(e);
  return `${what}に失敗しました: ${why}`;
}

/** 状態が同じかを見る。Tile は memo なので、同じあいだは同じオブジェクトを渡し続けたい。 */
interface Cached {
  tweet: Tweet;
  override: Override | undefined;
  state: TweetActionState;
}

export function useTweetActions(tweets: Tweet[]): TweetActionsState {
  // 押した結果は ref を正とし、state は描画用の写しとして持つ。
  // 更新関数の中で送信すると StrictMode の二重呼び出しで二重送信になるため、
  // 「今の値を読む」を state 更新から切り離しておく必要がある。
  const overridesRef = useRef<Record<string, Override>>({});
  const [overrides, setOverrides] = useState(overridesRef.current);
  const [error, setError] = useState<string | null>(null);

  const commit = useCallback((next: Record<string, Override>) => {
    overridesRef.current = next;
    setOverrides(next);
  }, []);

  const cacheRef = useRef(new Map<string, Cached>());
  const actions = useMemo(() => {
    const next = new Map<string, Cached>();
    const out = new Map<string, TweetActionState>();
    for (const tweet of tweets) {
      if (out.has(tweet.id)) continue;
      const override = overrides[tweet.id];
      const prev = cacheRef.current.get(tweet.id);
      // 入力（Tweet と押した結果）が同一なら出力も同一。同じオブジェクトを使い回して再描画を避ける。
      if (prev && prev.tweet === tweet && prev.override === override) {
        next.set(tweet.id, prev);
        out.set(tweet.id, prev.state);
        continue;
      }
      const viewer = override?.viewer ?? tweet.viewer;
      const state: TweetActionState = {
        viewer,
        stats: withDelta(tweet, viewer),
        pending: override?.pending ?? [],
      };
      next.set(tweet.id, { tweet, override, state });
      out.set(tweet.id, state);
    }
    cacheRef.current = next;
    return out;
  }, [tweets, overrides]);

  /**
   * 送信が終わった 1 つの操作だけを確定させる。
   * 状態全体ではなく該当の項目だけを書き換えるのは、別の操作が同時に走っていても
   * その楽観更新を巻き戻さないため。
   *
   * @param value 成功なら押した後の値、失敗なら押す前の値。
   */
  const settle = useCallback(
    (id: string, action: TweetAction, value: boolean) => {
      const current = overridesRef.current[id];
      if (!current) return;
      commit({
        ...overridesRef.current,
        [id]: {
          viewer: { ...current.viewer, [VIEWER_FIELD[action]]: value },
          pending: current.pending.filter((p) => p !== action),
        },
      });
    },
    [commit],
  );

  const toggle = useCallback(
    (tweet: Tweet, action: TweetAction) => {
      const current = overridesRef.current[tweet.id];
      const pending = current?.pending ?? [];
      // 弾くのは同じ操作の返事待ちだけ。連打で on/off が入れ違うのを防ぐ。
      // 別の操作は独立したエンドポイントなので、重ねて掛けても順序の問題は起きない。
      if (pending.includes(action)) return;

      const before = current?.viewer ?? tweet.viewer;
      const on = !before[VIEWER_FIELD[action]];
      commit({
        ...overridesRef.current,
        [tweet.id]: {
          viewer: { ...before, [VIEWER_FIELD[action]]: on },
          pending: [...pending, action],
        },
      });

      sendAction({ id: tweet.id, action, on })
        .then(() => settle(tweet.id, action, on))
        .catch((e: unknown) => {
          settle(tweet.id, action, !on);
          setError(failureMessage(e, action, on));
        });
    },
    [commit, settle],
  );

  const dismissError = useCallback(() => setError(null), []);

  return { actions, toggle, error, dismissError };
}
