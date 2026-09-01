// いいね・リポスト・ブックマークの 3 ボタン。タイルとライトボックスで同じものを使う。
//
// 操作の対象はポストであって画像ではない。1 投稿を複数のタイルに分けて表示していても、
// どのタイルから押しても同じポストに掛かり、表示も同時に変わる
//（useTweetActions がポストの id 単位で状態を持つため）。

import type { MouseEvent } from 'react';
import type { Tweet, TweetAction } from '../../shared/types.ts';
import type { TweetActionState } from '../hooks/useTweetActions.ts';
import { ACTION_ORDER, STAT_FIELD, VIEWER_FIELD } from '../hooks/useTweetActions.ts';
import { compact } from '../lib/format.ts';

export interface ActionBarProps {
  tweet: Tweet;
  /** 未取得なら Tweet の値をそのまま使う（まだ何も押していない状態）。 */
  state: TweetActionState | undefined;
  onAction(tweet: Tweet, action: TweetAction): void;
  /** 数値を添えるか。タイルの上は狭いので添えない。 */
  showCounts?: boolean;
  className?: string;
}

/** ボタンの説明。押した状態なら取り消しの言い回しになる。 */
const LABEL: Record<TweetAction, { on: string; off: string }> = {
  like: { on: 'いいねを取り消す', off: 'いいね' },
  retweet: { on: 'リポストを取り消す', off: 'リポスト' },
  bookmark: { on: 'ブックマークから外す', off: 'ブックマークに追加' },
};

/**
 * アイコン。塗り分けで on/off を示すので、色に頼らずに状態が読める。
 * リポストだけは閉じた面を持たないため、色と太さだけで示す。
 */
function ActionIcon({ action, on }: { action: TweetAction; on: boolean }) {
  const common = {
    viewBox: '0 0 24 24',
    'aria-hidden': true,
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const;

  if (action === 'retweet') {
    return (
      <svg {...common} fill="none">
        <path d="M4 8h12a3 3 0 0 1 3 3v3" />
        <path d="m16 11 3 3 3-3" />
        <path d="M20 16H8a3 3 0 0 1-3-3v-3" />
        <path d="m2 13 3-3 3 3" />
      </svg>
    );
  }
  const d =
    action === 'like'
      ? 'M12 20.3 4.6 13a4.6 4.6 0 1 1 6.5-6.5l.9.9.9-.9A4.6 4.6 0 1 1 19.4 13z'
      : 'M6 3h12a1 1 0 0 1 1 1v17l-7-5-7 5V4a1 1 0 0 1 1-1z';
  return (
    <svg {...common} fill={on ? 'currentColor' : 'none'}>
      <path d={d} />
    </svg>
  );
}

export function ActionBar({ tweet, state, onAction, showCounts = false, className }: ActionBarProps) {
  const viewer = state?.viewer ?? tweet.viewer;
  const stats = state?.stats ?? tweet.stats;
  const pending = state?.pending ?? [];
  // どれか 1 つでも掛かっていれば、タイルではホバーしていなくても見えるようにする。
  const active = viewer.liked || viewer.retweeted || viewer.bookmarked;

  return (
    <div
      className={['actions', className, active ? 'active' : ''].filter(Boolean).join(' ')}
      // タイルの上に重ねるので、押しても拡大表示が開かないよう伝播を止める。
      onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
    >
      {ACTION_ORDER.map((action) => {
        const on = viewer[VIEWER_FIELD[action]];
        const label = on ? LABEL[action].on : LABEL[action].off;
        const count = stats[STAT_FIELD[action]];
        return (
          <button
            key={action}
            type="button"
            className={`act ${action}${on ? ' on' : ''}`}
            // 止めるのはその操作だけ。いいねの返事待ちでブックマークまで押せなくする理由は無い。
            disabled={pending.includes(action)}
            aria-pressed={on}
            title={label}
            aria-label={label}
            onClick={() => onAction(tweet, action)}
          >
            <ActionIcon action={action} on={on} />
            {showCounts && count > 0 ? <span className="n">{compact(count)}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
