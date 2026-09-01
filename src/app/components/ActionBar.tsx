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

interface ActionBarProps {
  tweet: Tweet;
  /** undefined なら tweet 側の値をそのまま使う。 */
  state: TweetActionState | undefined;
  onAction(tweet: Tweet, action: TweetAction): void;
}

const BUTTON =
  "inline-flex cursor-pointer items-center justify-center gap-1 rounded-sm border border-transparent leading-none transition-colors disabled:cursor-progress disabled:opacity-45";

const ON_COLOR: Record<TweetAction, string> = {
  like: "text-like",
  retweet: "text-repost",
  bookmark: "text-bookmark",
};

const LABEL: Record<TweetAction, { on: string; off: string }> = {
  like: { on: "いいねを取り消す", off: "いいね" },
  retweet: { on: "リポストを取り消す", off: "リポスト" },
  bookmark: { on: "ブックマークから外す", off: "ブックマークに追加" },
};

// リポストだけ塗りつぶしの図が無いので、on と off に同じ字を置く。
const GLYPH: Record<TweetAction, { on: string; off: string }> = {
  like: { on: "fi-sr-star", off: "fi-rr-star" },
  retweet: { on: "fi-rr-arrows-retweet", off: "fi-rr-arrows-retweet" },
  bookmark: { on: "fi-sr-bookmark", off: "fi-rr-bookmark" },
};

// タイルのクリックで拡大表示が開くため、バー内のクリックは伝播させない。
const stopClick = (e: MouseEvent<HTMLDivElement>) => e.stopPropagation();

interface ToggleProps extends ActionBarProps {
  action: TweetAction;
  className: string;
  /** 押していないときの字色。押したら操作ごとの色に替わる。 */
  off: string;
  withCount?: boolean;
  countClassName?: string;
}

function Toggle({
  tweet,
  state,
  onAction,
  action,
  className,
  off,
  withCount = false,
  countClassName = "",
}: ToggleProps) {
  const on = (state?.viewer ?? tweet.viewer)[VIEWER_FIELD[action]];
  const count = (state?.stats ?? tweet.stats)[STAT_FIELD[action]];
  const label = on ? LABEL[action].on : LABEL[action].off;
  return (
    <button
      type="button"
      className={`${BUTTON} ${className} ${on ? ON_COLOR[action] : off}`}
      disabled={(state?.pending ?? []).includes(action)}
      aria-pressed={on}
      title={label}
      aria-label={label}
      onClick={() => onAction(tweet, action)}
    >
      <i className={`fi text-icon ${GLYPH[action][on ? "on" : "off"]}`} />
      {withCount && count > 0 ? (
        <span
          className={`text-xs tabular-nums @max-[237px]:hidden ${countClassName}`}
        >
          {compact(count)}
        </span>
      ) : null}
    </button>
  );
}

type CopyState = "idle" | "done" | "failed";

/** アイコンは共有だが動作は URL のコピー。ラベルはアイコンではなく動作に合わせる。 */
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

const COPY_FEEDBACK_MS = 1500;

function ShareButton({ url, className }: { url: string; className: string }) {
  const [copy, setCopy] = useState<CopyState>("idle");
  const revert = useRef<ReturnType<typeof setTimeout> | null>(null);
  // タイルは無限スクロールでアンマウントされる。残ったタイマーが解除後に setState する。
  useEffect(
    () => () => {
      if (revert.current !== null) clearTimeout(revert.current);
    },
    [],
  );

  const copyUrl = async () => {
    // 連打すると前のタイマーが新しい表示を先に消すので、押すたびに張り直す。
    if (revert.current !== null) clearTimeout(revert.current);
    try {
      await navigator.clipboard.writeText(url);
      setCopy("done");
    } catch {
      // clipboard は権限や非セキュアコンテキストで失敗する。無反応にはしない。
      setCopy("failed");
    }
    revert.current = setTimeout(() => setCopy("idle"), COPY_FEEDBACK_MS);
  };

  return (
    // トグルではないので aria-pressed は付けない。
    <button
      type="button"
      className={`${BUTTON} ${className}`}
      title={COPY_LABEL[copy]}
      aria-label={COPY_LABEL[copy]}
      onClick={() => void copyUrl()}
    >
      <Icon name={COPY_ICON[copy]} />
    </button>
  );
}

export function OverlayActionBar({ tweet, state, onAction }: ActionBarProps) {
  const viewer = state?.viewer ?? tweet.viewer;
  // 1 つでも on なら、ホバーしていなくても見せる。
  const active = viewer.liked || viewer.retweeted || viewer.bookmarked;
  return (
    <div
      className={`absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-veil p-1 transition-opacity focus-within:opacity-100 group-hover:opacity-100 no-hover:opacity-100 ${
        active ? "opacity-100" : "opacity-0"
      }`}
      onClick={stopClick}
    >
      {ACTION_ORDER.map((action) => (
        <Toggle
          key={action}
          tweet={tweet}
          state={state}
          onAction={onAction}
          action={action}
          className="px-0.5 py-1 hover:bg-shade"
          off="text-fg-dim hover:text-fg"
        />
      ))}
      <ShareButton
        url={tweet.url}
        className="px-0.5 py-1 text-fg-dim hover:bg-shade hover:text-fg"
      />
    </div>
  );
}

export function MetaActionBar({ tweet, state, onAction }: ActionBarProps) {
  return (
    <div
      className="ml-auto flex shrink-0 items-center gap-2"
      onClick={stopClick}
    >
      {ACTION_ORDER.map((action) => (
        <Toggle
          key={action}
          tweet={tweet}
          state={state}
          onAction={onAction}
          action={action}
          className="px-0.5 py-1 hover:bg-shade"
          off="text-fg-faint hover:text-fg"
          withCount={action === "like"}
        />
      ))}
      <ShareButton
        url={tweet.url}
        className="px-0.5 py-1 text-fg-faint hover:bg-shade hover:text-fg"
      />
    </div>
  );
}

export function LightboxActionBar({ tweet, state, onAction }: ActionBarProps) {
  return (
    <div className="-ml-2 flex items-center gap-1">
      {ACTION_ORDER.map((action) => (
        <Toggle
          key={action}
          tweet={tweet}
          state={state}
          onAction={onAction}
          action={action}
          className="px-2 py-1 hover:bg-lb-line"
          off="text-lb-dim hover:text-lb-fg"
          withCount
          countClassName="text-lb-dim"
        />
      ))}
      <ShareButton
        url={tweet.url}
        className="px-2 py-1 text-lb-dim hover:bg-lb-line hover:text-lb-fg"
      />
    </div>
  );
}
