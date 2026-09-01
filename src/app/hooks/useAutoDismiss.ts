// いいねかブックマークを付けた投稿を、スクロールで画面の外へ出たときに壁から外す。押した瞬間に
// 消すと押し間違いを戻す手が無く、残したままだと次に読み込んだぶんと混ざって、どこまで見たのかが
// 判らなくなる。見えているあいだは残し、見送ったものだけを外す。
//
// 外すのはポスト単位。1 投稿を複数のタイルに分けていても、まとめて外れる。
// 画面の外へ出たことを知っているのは位置を持つタイルだけなので、その合図は dismiss で戻ってくる。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Tweet } from '../../shared/types.ts';
import type { TweetActionState } from './useTweetActions.ts';

/** 薄くなってから外すまで。styles の duration-280 と対で、片方だけ変えると途中で消える。 */
const FADE = 280;

/**
 * - leaving 薄くなっている最中。まだ場所を占めているが、触れない。
 * - gone    壁から外れた。
 */
type DismissPhase = 'leaving' | 'gone';

const NONE: ReadonlyMap<string, DismissPhase> = new Map();
const NO_IDS: ReadonlySet<string> = new Set();

export interface AutoDismissState {
  /** 画面の外へ出たら外すポスト id。タイルはこれが立っているあいだだけ自分の位置を見張る。 */
  armed: ReadonlySet<string>;
  /** ポスト id → 段階。載っていないポストはそのまま残る。 */
  phase: ReadonlyMap<string, DismissPhase>;
  /** 画面の外へ出た合図。armed に載っているポストからしか来ない。 */
  dismiss(id: string): void;
}

/**
 * この画面で拾ったか。取得した時点で付いていた印は数えない（読み込んだ端から消えてしまう）。
 * 返事待ちも数えない。楽観更新の印は失敗すれば戻るので、待たずに数えると、
 * 画面の外へ出た後で失敗した投稿まで外したままになる。
 */
function picked(tweet: Tweet, state: TweetActionState): boolean {
  return (
    (state.viewer.liked && !tweet.viewer.liked && !state.pending.includes('like')) ||
    (state.viewer.bookmarked && !tweet.viewer.bookmarked && !state.pending.includes('bookmark'))
  );
}

/**
 * @param enabled 掃くかどうか。設定で切っているときのほか、ライトボックスを開いているあいだも
 *                偽を渡す（見ている最中に並びが詰まると、別の写真へすり替わってしまう）。
 */
export function useAutoDismiss(
  tweets: Tweet[],
  actions: Map<string, TweetActionState>,
  enabled: boolean,
): AutoDismissState {
  const [phase, setPhase] = useState(NONE);
  /** 外し始めたポストの、消えきりの予約。id が載っていること自体が「もう始めた」印を兼ねる。 */
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const armed = useMemo(() => {
    if (!enabled) return NO_IDS;
    const ids = new Set<string>();
    for (const tweet of tweets) {
      const state = actions.get(tweet.id);
      // 外れ始めたものは見張り直さない。薄くなっている最中はもう戻らない。
      if (state && picked(tweet, state) && !phase.has(tweet.id)) ids.add(tweet.id);
    }
    return ids;
  }, [tweets, actions, enabled, phase]);

  // 同じタイルから二度来ても、外し始めるのは一度きり（見張りは張り直されうる）。
  const dismiss = useCallback((id: string) => {
    const timers = timersRef.current;
    if (timers.has(id)) return;
    // 予約は消えきった後も残す。これが二度目を弾く印になる（済んだ予約を消しても害はない）。
    timers.set(
      id,
      setTimeout(() => {
        setPhase((prev) => new Map(prev).set(id, 'gone'));
      }, FADE),
    );
    setPhase((prev) => (prev.has(id) ? prev : new Map(prev).set(id, 'leaving')));
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return { armed, phase, dismiss };
}
