// 壁から投稿を外す仕掛け。外す理由（拾ったから掃く・押して非表示にする）は問わない。
// dismiss を呼ばれた投稿を薄くし、場所を空け、頃合いを見て畳むところだけを持つ。
//
// 外すのはポスト単位。1 投稿を複数のタイルに分けていても、まとめて外れる。
//
// 外れた跡は空けたまま残す。並びから抜いて詰めると masonry が組み直され、見ている位置がずれる
// うえに列の割り当てまで変わる。穴を畳むのは、上へ戻り始めたとき（下へ読み進めている最中に
// 詰めないため）と、壁を作り直すとき（読み直し・取得条件の変更）の 2 つ。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Tweet } from '../../shared/types.ts';

/** 薄くなってから外すまで。styles の duration-280 と対で、片方だけ変えると途中で消える。 */
const FADE = 280;

/**
 * - leaving 薄くなっている最中。まだ場所を占めているが、触れない。
 * - hole    写真は消えたが、場所は空けたまま。ここで詰めないので壁は動かない。
 * - closed  穴も畳んだ。並びから抜けるので、ここで初めて壁が組み直される。
 */
export type DismissPhase = 'leaving' | 'hole' | 'closed';

const NONE: ReadonlyMap<string, DismissPhase> = new Map();
const NO_IDS: ReadonlySet<string> = new Set();

export interface DismissState {
  /** 今の壁での段階。載っていないポストはそのまま残る。 */
  phase: ReadonlyMap<string, DismissPhase>;
  /** これまでに外したポスト id。壁を作り直したときは、これに載っているものを詰めて出さない。 */
  removed: ReadonlySet<string>;
  /** 外し始める合図。同じポストから二度来ても、始めるのは一度きり。 */
  dismiss(id: string): void;
  /** 穴を畳んでよくなった合図。今ある穴をまとめて並びから抜く。 */
  collapse(): void;
  /** 外した印を落として壁へ返す。押し間違いの戻し口で、畳んだ後のものも戻る。 */
  forget(ids: ReadonlySet<string>): void;
}

export function useDismiss(tweets: Tweet[]): DismissState {
  const [phase, setPhase] = useState(NONE);
  const [removed, setRemoved] = useState(NO_IDS);
  /** 外し始めたポストの、消えきりの予約。id が載っていること自体が「もう始めた」印を兼ねる。 */
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timers = timersRef.current;
    if (timers.has(id)) return;
    // 予約は消えきった後も残す。これが二度目を弾く印になる（済んだ予約を消しても害はない）。
    timers.set(
      id,
      setTimeout(() => {
        setPhase((prev) => new Map(prev).set(id, 'hole'));
        setRemoved((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      }, FADE),
    );
    setPhase((prev) => (prev.has(id) ? prev : new Map(prev).set(id, 'leaving')));
  }, []);

  // 穴をまとめて畳む。呼ぶ側（壁）が「今なら詰めてよい」と判断した瞬間に来る。
  const collapse = useCallback(() => {
    setPhase((prev) => {
      let next: Map<string, DismissPhase> | null = null;
      for (const [id, p] of prev) {
        if (p !== 'hole') continue;
        next ??= new Map(prev);
        next.set(id, 'closed');
      }
      // 畳む穴が無ければ同じものを返す。描き直しを増やさないため。
      return next ?? prev;
    });
  }, []);

  // 外した印を落とす。id の寿命は予約・段階・外し済みの 3 か所に分かれているので、まとめて落とす
  //（1 つでも残すと、戻したのに出てこないか、戻した直後にまた消えるかになる）。
  const forget = useCallback((ids: ReadonlySet<string>) => {
    if (ids.size === 0) return;
    const timers = timersRef.current;
    for (const id of ids) {
      const timer = timers.get(id);
      if (timer === undefined) continue;
      clearTimeout(timer);
      timers.delete(id);
    }
    setPhase((prev) => {
      let next: Map<string, DismissPhase> | null = null;
      for (const id of ids) {
        if (!prev.has(id)) continue;
        next ??= new Map(prev);
        next.delete(id);
      }
      return next ?? prev;
    });
    setRemoved((prev) => {
      let next: Set<string> | null = null;
      for (const id of ids) {
        if (!prev.has(id)) continue;
        next ??= new Set(prev);
        next.delete(id);
      }
      return next ?? prev;
    });
  }, []);

  // 壁を作り直すときに穴を畳む。読み直しも取得条件の変更も必ず空を経由するので、そこが境目になる
  //（続きの読み込みは前の分に足すだけなので空にならない）。外した id は removed へ移して残し、
  // 同じポストが返ってきても新しい壁には出さない。
  useEffect(() => {
    if (tweets.length > 0 || phase.size === 0) return;
    const timers = timersRef.current;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    setRemoved((prev) => {
      const next = new Set(prev);
      // 薄くなっている最中のものも外したものとして数える。壁ごと消えるので戻る先が無い。
      for (const id of phase.keys()) next.add(id);
      return next;
    });
    setPhase(NONE);
  }, [tweets.length, phase]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return { phase, removed, dismiss, collapse, forget };
}
