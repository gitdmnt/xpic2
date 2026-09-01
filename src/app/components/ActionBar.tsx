// いいね・リポスト・ブックマークの 3 つのトグルと、投稿の URL をコピーする共有ボタン。
// タイルとライトボックスで同じものを使う。
//
// 操作の対象はポストであって画像ではない。1 投稿を複数のタイルに分けて表示していても、
// どのタイルから押しても同じポストに掛かり、表示も同時に変わる
//（useTweetActions がポストの id 単位で状態を持つため）。
//
// 並びは 4 つでも、共有だけは性質が違う。押しても状態が残らず X へも何も送らないので、
// TweetAction にも useTweetActions の楽観更新にも通さず、押した合図までこの中で閉じている。
//
// 画面の他のアイコンは Uicons の字体（Icon.tsx）に寄せたが、トグルの 3 つは inline SVG のまま残す。
// 押した状態を「同じ図形の塗り」で示せるのが SVG の利点で、字体では線画と塗りが別のグリフになり、
// regular だけを読み込む方針と噛み合わない。色に頼らず形で状態が読めることも手放したくない。
// 線の印象は strokeWidth を 1.6 に落として regular rounded へ寄せてある。
// 共有は塗りで状態を示さないので、こちらは字体のアイコンで足りる。

import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { Tweet, TweetAction } from '../../shared/types.ts';
import type { TweetActionState } from '../hooks/useTweetActions.ts';
import { ACTION_ORDER, STAT_FIELD, VIEWER_FIELD } from '../hooks/useTweetActions.ts';
import { compact } from '../lib/format.ts';
import { Icon, type IconName } from './Icon.tsx';

// 数値をどこまで添えるか。タイルは狭いので、いいねだけに絞れる口を用意する。
// 呼ぶ側は文字列そのままで渡すので export しない（型を持ち出す相手がいない）。
type ActionCounts = 'none' | 'like' | 'all';

export interface ActionBarProps {
  tweet: Tweet;
  /** 未取得なら Tweet の値をそのまま使う（まだ何も押していない状態）。 */
  state: TweetActionState | undefined;
  onAction(tweet: Tweet, action: TweetAction): void;
  counts?: ActionCounts;
  /** URL をコピーする 4 つめを出すか。 */
  share?: boolean;
  className?: string;
}

/** ボタンの説明。押した状態なら取り消しの言い回しになる。 */
const LABEL: Record<TweetAction, { on: string; off: string }> = {
  like: { on: 'いいねを取り消す', off: 'いいね' },
  retweet: { on: 'リポストを取り消す', off: 'リポスト' },
  bookmark: { on: 'ブックマークから外す', off: 'ブックマークに追加' },
};

/** 共有ボタンの押した後の合図。文字もトーストも出さないので、名前と図だけで伝える。 */
type CopyState = 'idle' | 'done' | 'failed';

/**
 * 図は共有の記号だが、やることは URL のコピーだけ（ネイティブの共有シートは使わない）。
 * 読み上げ名と title は図ではなく実際の動作に合わせる。
 */
const COPY_LABEL: Record<CopyState, string> = {
  idle: 'URL をコピー',
  done: 'コピーしました',
  failed: 'コピーできませんでした',
};

const COPY_ICON: Record<CopyState, IconName> = { idle: 'share', done: 'check', failed: 'warning' };

/** 合図を出しておく長さ。読み取れて、かつ次の操作の邪魔にならない程度。 */
const COPY_FEEDBACK_MS = 1500;

/**
 * アイコン。塗り分けで on/off を示すので、色に頼らずに状態が読める。
 * リポストだけは閉じた面を持たないため、色と太さだけで示す。
 */
function ActionIcon({ action, on }: { action: TweetAction; on: boolean }) {
  const common = {
    viewBox: '0 0 24 24',
    'aria-hidden': true,
    stroke: 'currentColor',
    // Uicons の regular rounded は線が細い。図形は変えず太さだけ合わせる。
    strokeWidth: 1.6,
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

export function ActionBar({ tweet, state, onAction, counts = 'none', share = false, className }: ActionBarProps) {
  const viewer = state?.viewer ?? tweet.viewer;
  const stats = state?.stats ?? tweet.stats;
  const pending = state?.pending ?? [];
  // どれか 1 つでも掛かっていれば、タイルではホバーしていなくても見えるようにする。
  const active = viewer.liked || viewer.retweeted || viewer.bookmarked;

  const [copy, setCopy] = useState<CopyState>('idle');
  const revert = useRef<ReturnType<typeof setTimeout> | null>(null);
  // タイルは無限スクロールで外れる。戻す予約を残したままだと、消えた要素へ setState する。
  useEffect(() => () => {
    if (revert.current !== null) clearTimeout(revert.current);
  }, []);

  const copyUrl = async () => {
    // 連打すると前の予約が先に来て、新しい合図を途中で消してしまう。押すたびに取り直す。
    if (revert.current !== null) clearTimeout(revert.current);
    try {
      await navigator.clipboard.writeText(tweet.url);
      setCopy('done');
    } catch {
      // clipboard は権限や非セキュアな文脈で拒否される。黙って落ちると押せたのか分からない。
      setCopy('failed');
    }
    revert.current = setTimeout(() => setCopy('idle'), COPY_FEEDBACK_MS);
  };

  return (
    <div
      className={['actions', className, active ? 'active' : ''].filter(Boolean).join(' ')}
      // タイルの中に置くので、押しても拡大表示が開かないよう伝播を止める。
      // 画像に重ねた版でもメタ行に置いた版でも、中のボタンはここで止まる。
      onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
    >
      {ACTION_ORDER.map((action) => {
        const on = viewer[VIEWER_FIELD[action]];
        const label = on ? LABEL[action].on : LABEL[action].off;
        const count = stats[STAT_FIELD[action]];
        const withCount = counts === 'all' || (counts === 'like' && action === 'like');
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
            {withCount && count > 0 ? <span className="n">{compact(count)}</span> : null}
          </button>
        );
      })}
      {/* トグルではないので aria-pressed は付けない。押した状態が残らないものに付けると、
          押しっぱなしの何かがあるように読まれる。 */}
      {share ? (
        <button
          type="button"
          className="act share"
          title={COPY_LABEL[copy]}
          aria-label={COPY_LABEL[copy]}
          onClick={() => void copyUrl()}
        >
          <Icon name={COPY_ICON[copy]} />
        </button>
      ) : null}
    </div>
  );
}
