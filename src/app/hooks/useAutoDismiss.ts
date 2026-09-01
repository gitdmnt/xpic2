// いいねかブックマークを付けた投稿を、少し置いてから壁から外す。押した瞬間に消すと押し間違いを
// 戻す手が無く、残したままだと次に読み込んだぶんと混ざって、どこまで見たのかが判らなくなる。
//
// 外すのはポスト単位。1 投稿を複数のタイルに分けていても、まとめて外れる。

import { useEffect, useRef, useState } from 'react';
import type { Tweet } from '../../shared/types.ts';
import type { TweetActionState } from './useTweetActions.ts';

/** 薄くなってから外すまで。styles の duration-280 と対で、片方だけ変えると途中で消える。 */
const FADE = 280;

/**
 * - leaving 薄くなっている最中。まだ場所を占めているが、触れない。
 * - gone    壁から外れた。
 */
export type DismissPhase = 'leaving' | 'gone';

const NONE: ReadonlyMap<string, DismissPhase> = new Map();

/**
 * この画面で拾ったか。取得した時点で付いていた印は数えない（読み込んだ端から消えてしまう）。
 * 返事待ちも数えない。楽観更新の印は失敗すれば戻るので、待たずに数えると、
 * 猶予が過ぎた後で失敗した投稿まで外したままになる。
 */
function picked(tweet: Tweet, state: TweetActionState): boolean {
  return (
    (state.viewer.liked && !tweet.viewer.liked && !state.pending.includes('like')) ||
    (state.viewer.bookmarked && !tweet.viewer.bookmarked && !state.pending.includes('bookmark'))
  );
}

/**
 * @param delay 押してから薄くなり始めるまでのミリ秒。0 以下のあいだは待ち時間を進めない。
 *              設定で切っているときのほか、ライトボックスを開いているあいだも 0 を渡す
 *              （見ている最中に並びが詰まると、別の写真へすり替わってしまう）。
 * @returns ポスト id → 段階。載っていないポストはそのまま残る。
 */
export function useAutoDismiss(
  tweets: Tweet[],
  actions: Map<string, TweetActionState>,
  delay: number,
): ReadonlyMap<string, DismissPhase> {
  const [phase, setPhase] = useState(NONE);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = timersRef.current;

    const marked = new Set<string>();
    if (delay > 0) {
      for (const tweet of tweets) {
        const state = actions.get(tweet.id);
        if (state && picked(tweet, state)) marked.add(tweet.id);
      }
    }

    // 予約を落とせるのは待っているあいだだけ。薄くなり始めたものは最後まで消す
    // （途中で止めると、透明なまま場所だけ占めて残る）。
    for (const [id, timer] of timers) {
      if (phase.has(id) || marked.has(id)) continue;
      clearTimeout(timer);
      timers.delete(id);
    }

    for (const id of marked) {
      if (timers.has(id) || phase.has(id)) continue;
      timers.set(
        id,
        setTimeout(() => {
          setPhase((prev) => new Map(prev).set(id, 'leaving'));
          timers.set(
            id,
            setTimeout(() => {
              timers.delete(id);
              setPhase((prev) => new Map(prev).set(id, 'gone'));
            }, FADE),
          );
        }, delay),
      );
    }
  }, [tweets, actions, delay, phase]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return phase;
}
