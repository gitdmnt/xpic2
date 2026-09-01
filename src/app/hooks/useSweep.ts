// いいねかブックマークを付けた投稿を掃く合図。「いつ外すか」だけを決め、「どう外すか」は
// useDismiss が持つ。ここが出す armed を壁が見張り、画面の外へ出たところで dismiss へ渡る。
//
// 押した瞬間に消すと押し間違いを戻す手が無く、残したままだと次に読み込んだぶんと混ざって、
// どこまで見たのかが判らなくなる。見えているあいだは残し、見送ったものだけを外す。

import { useMemo } from 'react';
import type { Tweet } from '../../shared/types.ts';
import type { DismissPhase } from './useDismiss.ts';
import type { TweetActionState } from './useTweetActions.ts';

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * いいねかブックマークが付いているか。取得時点で付いていた印も数える。
 * 返事待ちは数えない。楽観更新の印は失敗すれば戻るので、待たずに数えると、
 * 画面の外へ出た後で失敗した投稿まで外したままになる。
 */
function marked(state: TweetActionState): boolean {
  return (
    (state.viewer.liked && !state.pending.includes('like')) ||
    (state.viewer.bookmarked && !state.pending.includes('bookmark'))
  );
}

/**
 * @param enabled 掃くかどうか。設定で切っているときのほか、ライトボックスを開いているあいだも
 *                偽を渡す（見ている最中に並びが詰まると、別の写真へすり替わってしまう）。
 * @param phase   外れ始めたものを見張り直さないために見る。薄くなっている最中はもう戻らない。
 * @returns armed 画面の外へ出たら外すポスト id。壁はこれが立っているあいだだけ位置を見張る。
 */
export function useSweep(
  tweets: Tweet[],
  actions: Map<string, TweetActionState>,
  enabled: boolean,
  phase: ReadonlyMap<string, DismissPhase>,
): { armed: ReadonlySet<string> } {
  const armed = useMemo(() => {
    if (!enabled) return NO_IDS;
    const ids = new Set<string>();
    for (const tweet of tweets) {
      const state = actions.get(tweet.id);
      if (state && marked(state) && !phase.has(tweet.id)) ids.add(tweet.id);
    }
    return ids;
  }, [tweets, actions, enabled, phase]);

  return { armed };
}
