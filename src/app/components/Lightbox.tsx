import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import type { Media, Tweet, TweetAction } from '../../shared/types';
import type { TweetActionState } from '../hooks/useTweetActions';
import { compact, mediaUrl, relTime } from '../lib/format';
import { ActionBar } from './ActionBar';

/**
 * ライトボックスに並べる 1 枚分。
 * タイルは 1 ポストの複数メディアを束ねて表示するが、拡大表示は 1 枚ずつ送るので、
 * ここではポスト × メディアに展開した粒度で持つ。
 */
export interface LightboxEntry {
  tweet: Tweet;
  media: Media;
}

export interface LightboxProps {
  list: LightboxEntry[];
  /** 表示中の位置。0 未満なら非表示。 */
  index: number;
  onIndexChange(i: number): void;
  onClose(): void;
  onNearEnd(): void;
  /** ポスト id → いいね等の状態。 */
  actions: Map<string, TweetActionState>;
  onAction(tweet: Tweet, action: TweetAction): void;
}

/** 残りがこの件数を切ったら追加読み込みを促す（移植元と同じ閾値）。 */
const NEAR_END = 6;

/** 拡大表示中のショートカット。x.com の割り当てに合わせてある。 */
const ACTION_KEYS: Record<string, TweetAction> = { l: 'like', t: 'retweet', b: 'bookmark' };

export function Lightbox({ list, index, onIndexChange, onClose, onNearEnd, actions, onAction }: LightboxProps) {
  const entry = index >= 0 ? list[index] : undefined;
  const visible = entry !== undefined;
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // 前後移動。移植元と同じく端では反対側へ回り込む。
  // 負の剰余を避けるため length を足してからもう一度剰余を取る。
  const move = useCallback(
    (delta: number) => {
      if (list.length === 0) return;
      onIndexChange((((index + delta) % list.length) + list.length) % list.length);
    },
    [index, list.length, onIndexChange],
  );

  // 表示中は背後のページをスクロールさせない。閉じても外れても必ず元へ戻す。
  useEffect(() => {
    if (!visible) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [visible]);

  // キー操作は表示中だけ document に張る。非表示のときに握ると画面側の「/」などと衝突する。
  // 早期 return より前なので、ショートカットの対象は entry から直に取る。
  const activeTweet = entry?.tweet;
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Cmd+L のようなブラウザ側の割り当ては奪わない。
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const action = ACTION_KEYS[e.key];
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'j') move(1);
      else if (e.key === 'ArrowLeft' || e.key === 'k') move(-1);
      else if (action && activeTweet) onAction(activeTweet, action);
      else return;
      // 矢印キーでの背後スクロールを止める。
      e.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible, move, onClose, activeTweet, onAction]);

  // onNearEnd の同一性が変わるたびに再発火させたくないので、呼び出しは ref 経由にする。
  const nearEndRef = useRef(onNearEnd);
  useEffect(() => {
    nearEndRef.current = onNearEnd;
  });
  useEffect(() => {
    if (!visible) return;
    if (index > list.length - NEAR_END) nearEndRef.current();
  }, [visible, index, list.length]);

  // React は muted を属性として出さないことがあり、その場合 GIF の自動再生がブラウザに拒否される。
  // DOM プロパティを直接立てて確実にする。
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = entry?.media.type === 'animated_gif';
  }, [entry]);

  if (!entry) return null;

  const { tweet, media } = entry;
  const large = mediaUrl(media.url, 'large');
  const orig = mediaUrl(media.url, 'orig');
  // 写真は原寸、動画・GIF は mp4 を保存対象にする。
  const saveUrl = `/api/media?dl=1&url=${encodeURIComponent(media.type === 'photo' ? orig : (media.video ?? orig))}`;
  const isMovie = (media.type === 'video' || media.type === 'animated_gif') && Boolean(media.video);
  // 送るたびに要素を作り直す。src を保持したままだと前の画像のフォールバック状態が残る。
  const stageKey = `${index}:${media.key}`;

  const closeOnSelf = (e: MouseEvent<HTMLElement>) => {
    // 余白のクリックだけで閉じる。画像やボタンを踏んだときは閉じない。
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={closeOnSelf}>
      <button className="lb-close" aria-label="閉じる" onClick={onClose}>
        ✕
      </button>
      <button className="lb-nav prev" aria-label="前へ" onClick={() => move(-1)}>
        ‹
      </button>
      <button className="lb-nav next" aria-label="次へ" onClick={() => move(1)}>
        ›
      </button>

      <figure className="lb-stage" onClick={closeOnSelf}>
        {isMovie ? (
          <video
            key={stageKey}
            ref={videoRef}
            src={media.video ?? undefined}
            poster={large}
            controls={media.type === 'video'}
            autoPlay
            loop
            playsInline
          />
        ) : (
          <img
            key={stageKey}
            src={large}
            alt={media.alt ?? ''}
            onError={(e) => {
              // large 派生が存在しない媒体があるので素の URL へ落とす。二重発火は src 比較で止める。
              const img = e.currentTarget;
              if (img.src !== media.url) img.src = media.url;
            }}
          />
        )}
      </figure>

      <figcaption className="lb-info">
        <img className="av" src={tweet.user.avatar} alt="" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div>
            <span className="who">{tweet.user.name}</span>{' '}
            <span className="handle">
              @{tweet.user.screenName} · {relTime(tweet.createdAt)}
              {tweet.retweetedBy ? ` · @${tweet.retweetedBy.screenName} がリポスト` : ''}
            </span>
          </div>
          {tweet.text ? <div className="txt">{tweet.text}</div> : null}
          <div className="row">
            <ActionBar
              tweet={tweet}
              state={actions.get(tweet.id)}
              onAction={onAction}
              showCounts
              className="lb-actions"
            />
            {tweet.stats.views ? <span>👁 {compact(tweet.stats.views)}</span> : null}
            <span>
              {media.width}×{media.height}
            </span>
            <a href={tweet.url} target="_blank" rel="noreferrer noopener">
              X で開く
            </a>
            <a href={orig} target="_blank" rel="noreferrer noopener">
              原寸
            </a>
            <a href={saveUrl}>保存</a>
            <span style={{ color: 'var(--fg-faint)' }}>
              {index + 1} / {list.length}
            </span>
          </div>
        </div>
      </figcaption>
    </div>
  );
}

export default Lightbox;
