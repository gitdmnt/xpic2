// いいね・リポスト・ブックマークの 3 つのトグルと、投稿の URL をコピーする共有ボタン。

import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { Tweet, TweetAction } from "../../shared/types.ts";
import type { TweetActionState } from "../hooks/useTweetActions.ts";
import {
  ACTION_ORDER,
  STAT_FIELD,
  VIEWER_FIELD,
} from "../hooks/useTweetActions.ts";
import { compact } from "../lib/format.ts";
import { Icon, type IconName } from "./Icon.tsx";

// これ何?
type ActionCounts = "none" | "like" | "all";

// これ何?
type ActionBarVariant = "tile" | "meta" | "lightbox";

interface VariantStyle {
  // 何?
  wrap: string;
  pad: string;
  // 何?
  idle: string;
  // ホバー時の何?
  hover: string;
  // ホバー時の何?
  hoverText: string;
  // 何?
  count: string;
}

const VARIANT: Record<ActionBarVariant, VariantStyle> = {
  tile: {
    wrap: "absolute bottom-2 left-2 gap-1 rounded-md bg-veil p-1 transition-opacity focus-within:opacity-100 group-hover:opacity-100 no-hover:opacity-100",
    pad: "px-0.5 py-1",
    idle: "text-fg-dim",
    hover: "hover:bg-shade",
    hoverText: "hover:text-fg",
    count: "",
  },

  meta: {
    wrap: "ml-auto shrink-0 gap-0",
    pad: "px-0.5 py-1",
    idle: "text-fg-faint",
    hover: "hover:bg-shade",
    hoverText: "hover:text-fg",
    count: "",
  },

  lightbox: {
    wrap: "-ml-2 gap-1",
    pad: "px-2 py-1",
    idle: "text-lb-dim",
    hover: "hover:bg-lb-line",
    hoverText: "hover:text-lb-fg",
    count: "text-lb-dim",
  },
};

const BUTTON =
  "inline-flex cursor-pointer items-center justify-center gap-1 rounded-sm border border-transparent leading-none transition-colors disabled:cursor-progress disabled:opacity-45";

// 何?
const ON_COLOR: Record<TweetAction, string> = {
  like: "text-like",
  retweet: "text-repost",
  bookmark: "text-bookmark",
};

export interface ActionBarProps {
  tweet: Tweet;
  /** 未取得なら Tweet の値をそのまま使う（まだ何も押していない状態）。 */
  state: TweetActionState | undefined;
  onAction(tweet: Tweet, action: TweetAction): void;
  variant: ActionBarVariant;
  counts?: ActionCounts;
  /** URL をコピーする 4 つめを出すか。 */
  share?: boolean;
}

/** ボタンの説明。押した状態なら取り消しの言い回しになる。 */
const LABEL: Record<TweetAction, { on: string; off: string }> = {
  like: { on: "いいねを取り消す", off: "いいね" },
  retweet: { on: "リポストを取り消す", off: "リポスト" },
  bookmark: { on: "ブックマークから外す", off: "ブックマークに追加" },
};

/** 共有ボタンの押した後の合図。文字もトーストも出さないので、名前と図だけで伝える。 */
type CopyState = "idle" | "done" | "failed";

/**
 * 図は共有の記号だが、やることは URL のコピーだけ（ネイティブの共有シートは使わない）。
 * 読み上げ名と title は図ではなく実際の動作に合わせる。
 */
const COPY_LABEL: Record<CopyState, string> = {
  idle: "URL をコピー",
  done: "コピーしました",
  failed: "コピーできませんでした",
};

const COPY_ICON: Record<CopyState, IconName> = {
  idle: "share",
  done: "check",
  failed: "warning",
};

/** 合図を出しておく長さ。読み取れて、かつ次の操作の邪魔にならない程度。 */
const COPY_FEEDBACK_MS = 1500;

/**
 * アイコン。塗り分けで on/off を示すので、色に頼らずに状態が読める。
 * リポストだけは閉じた面を持たないため、色と太さだけで示す。
 * 手書きの SVG も Uicons と同じ 15px にする。ライトボックスでは同じ行に両方が並ぶ。
 */
function ActionIcon({ action, on }: { action: TweetAction; on: boolean }) {
  const common = {
    viewBox: "0 0 24 24",
    className: "block size-[15px]",
    "aria-hidden": true,
    stroke: "currentColor",
    // Uicons の regular rounded は線が細い。図形は変えず太さだけ合わせる。
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;

  if (action === "retweet") {
    return <i className="fi fi-rr-arrows-retweet"></i>;
  }
  if (action === "like") {
    if (on) {
      return <i className="fi fi-sr-star"></i>;
    } else {
      return <i className="fi fi-rr-star"></i>;
    }
  }
  if (action === "bookmark") {
    if (on) {
      return <i className="fi fi-sr-bookmark"></i>;
    } else {
      return <i className="fi fi-rr-bookmark"></i>;
    }
  }
}

export function ActionBar({
  tweet,
  state,
  onAction,
  variant,
  counts = "none",
  share = false,
}: ActionBarProps) {
  const viewer = state?.viewer ?? tweet.viewer;
  const stats = state?.stats ?? tweet.stats;
  const pending = state?.pending ?? [];
  // どれか 1 つでも掛かっていれば、タイルではホバーしていなくても見えるようにする。
  const active = viewer.liked || viewer.retweeted || viewer.bookmarked;
  const style = VARIANT[variant];

  const [copy, setCopy] = useState<CopyState>("idle");
  const revert = useRef<ReturnType<typeof setTimeout> | null>(null);
  // タイルは無限スクロールで外れる。戻す予約を残したままだと、消えた要素へ setState する。
  useEffect(
    () => () => {
      if (revert.current !== null) clearTimeout(revert.current);
    },
    [],
  );

  const copyUrl = async () => {
    // 連打すると前の予約が先に来て、新しい合図を途中で消してしまう。押すたびに取り直す。
    if (revert.current !== null) clearTimeout(revert.current);
    try {
      await navigator.clipboard.writeText(tweet.url);
      setCopy("done");
    } catch {
      // clipboard は権限や非セキュアな文脈で拒否される。黙って落ちると押せたのか分からない。
      setCopy("failed");
    }
    revert.current = setTimeout(() => setCopy("idle"), COPY_FEEDBACK_MS);
  };

  return (
    <div
      className={`flex items-center ${style.wrap}${
        variant === "tile" ? (active ? " opacity-100" : " opacity-0") : ""
      }`}
      // タイルの中に置くので、押しても拡大表示が開かないよう伝播を止める。
      // 写真に重ねた版でもメタ行に置いた版でも、中のボタンはここで止まる。
      onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
    >
      {ACTION_ORDER.map((action) => {
        const on = viewer[VIEWER_FIELD[action]];
        const label = on ? LABEL[action].on : LABEL[action].off;
        const count = stats[STAT_FIELD[action]];
        const withCount =
          counts === "all" || (counts === "like" && action === "like");
        return (
          <button
            key={action}
            type="button"
            className={`${BUTTON} ${style.pad} ${style.hover} ${
              on ? ON_COLOR[action] : `${style.idle} ${style.hoverText}`
            }`}
            // 止めるのはその操作だけ。いいねの返事待ちでブックマークまで押せなくする理由は無い。
            disabled={pending.includes(action)}
            aria-pressed={on}
            title={label}
            aria-label={label}
            onClick={() => onAction(tweet, action)}
          >
            <ActionIcon action={action} on={on} />
            {/*
              いいねに添える数字は、メタ行でいちばん幅の読めない中身である。「69K」で 27px、
              桁が伸びればもっと要る。細い列ではこれだけで共有ボタンを行の外へ押し出すうえ、
              押し出される前に投稿者名が先に消える。名前は「要る」と言われて戻したものなので、
              狭いときに手放すのは名前ではなく数字のほうにする。
              問い合わせ先はタイル（Tile が @container を持つ）で、見るのは罫の内側の幅なので、
              237px はタイルの実幅 239px にあたる。つまり 240px から数字が出る。
              そこで名前に 6 文字ぶん (77px) 残る。器の外（ライトボックス）では問い合わせ先が
              無いので条件は成立せず、数字はそのまま出る。
            */}
            {withCount && count > 0 ? (
              <span
                className={`text-xs tabular-nums @max-[237px]:hidden ${style.count}`}
              >
                {compact(count)}
              </span>
            ) : null}
          </button>
        );
      })}
      {/* トグルではないので aria-pressed は付けない。押した状態が残らないものに付けると、
          押しっぱなしの何かがあるように読まれる。
          共有には状態色も要らない。4 つのうちここだけ色を持たないことが、
          押しても何も溜まらないことの手掛かりになる。 */}
      {share ? (
        <button
          type="button"
          className={`${BUTTON} ${style.pad} ${style.hover} ${style.idle} ${style.hoverText}`}
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
