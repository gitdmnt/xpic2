import { memo, useEffect, useRef, useState } from 'react';
import type { Media, Tweet, TweetAction } from '../../shared/types';
import type { Placement } from '../hooks/useMasonry';
import type { TweetActionState } from '../hooks/useTweetActions';
import { compact, mediaUrl } from '../lib/format';
import { ActionBar } from './ActionBar';

/**
 * メタ行の高さ。style.css の `.meta { height: 34px }` と一致していなければ
 * masonry の計算とサムネイルの実高さがずれるので、ここを唯一の定義とする。
 */
export const META_HEIGHT = 34;

interface TileProps {
  tweet: Tweet;
  media: Media;
  groupCount: number;
  placement: Placement;
  showMeta: boolean;
  blurred: boolean;
  onOpen(): void;
  /** いいね・リポスト・ブックマークの状態。ポスト単位なので同じ投稿のタイルは同じ値を受け取る。 */
  action: TweetActionState | undefined;
  onAction(tweet: Tweet, action: TweetAction): void;
}

/** 右上バッジの文言。動画は秒数、GIF は種別、グループは残り枚数を示す。 */
function badgeLabels(media: Media, groupCount: number): string[] {
  const labels: string[] = [];
  if (media.type === 'video') labels.push(media.durationMs ? `▶ ${Math.round(media.durationMs / 1000)}s` : '▶');
  if (media.type === 'animated_gif') labels.push('GIF');
  if (groupCount > 1) labels.push(`+${groupCount - 1}`);
  return labels;
}

export const Tile = memo(function Tile({
  tweet,
  media,
  groupCount,
  placement,
  showMeta,
  blurred,
  onOpen,
  action,
  onAction,
}: TileProps) {
  const rootRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // 再生中は img を隠して video を見せる。Node 版と同じく表示の入れ替えで実現する。
  const [playing, setPlaying] = useState(false);
  // CDN のサイズ付き URL が 404 になる個体が実在するので、素の URL へ一度だけ落とす。
  const [fallback, setFallback] = useState(false);

  const isMotion = media.type === 'video' || media.type === 'animated_gif';
  const hasVideo = isMotion && Boolean(media.video);
  const footer = showMeta ? META_HEIGHT : 0;

  // GIF は画面内に入ったら自動再生する。動画はホバー中だけなので監視しない。
  useEffect(() => {
    if (media.type !== 'animated_gif' || !media.video) return;
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setPlaying(e.isIntersecting);
      },
      { rootMargin: '100px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [media.type, media.video]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // muted を属性任せにすると自動再生がブロックされることがあるため、DOM プロパティを直接立てる。
    v.muted = true;
    if (playing) {
      // 再生要求は拒否されうる（省電力・ユーザー操作なし）。落ちても画像表示のままで支障はない。
      void v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [playing]);

  const labels = badgeLabels(media, groupCount);

  return (
    <article
      ref={rootRef}
      className={blurred ? 'tile blur' : 'tile'}
      style={{
        width: `${placement.width}px`,
        height: `${placement.height}px`,
        transform: `translate3d(${placement.x}px, ${placement.y}px, 0)`,
      }}
      onClick={onOpen}
      onMouseEnter={hasVideo && media.type === 'video' ? () => setPlaying(true) : undefined}
      onMouseLeave={hasVideo && media.type === 'video' ? () => setPlaying(false) : undefined}
    >
      <div className="thumb" style={{ height: `${placement.height - footer}px` }}>
        <img
          className="pic"
          loading="lazy"
          decoding="async"
          alt={media.alt ?? tweet.text.slice(0, 80)}
          src={fallback ? media.url : mediaUrl(media.url, 'medium')}
          style={playing ? { display: 'none' } : undefined}
          onError={() => {
            // 素の URL でも失敗したら再設定しない（無限ループ防止）。
            if (!fallback) setFallback(true);
          }}
        />
        {hasVideo && (
          <video
            ref={videoRef}
            className="pic"
            src={media.video ?? undefined}
            muted
            loop
            playsInline
            preload="none"
            style={playing ? undefined : { display: 'none' }}
          />
        )}
        {labels.length > 0 && (
          <div className="badge">
            {labels.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        )}
        {tweet.sensitive && <div className="sensitive-tag">センシティブ</div>}
        <ActionBar tweet={tweet} state={action} onAction={onAction} className="tile-actions" />
      </div>
      {showMeta && (
        <div className="meta">
          <img src={tweet.user.avatar} alt="" loading="lazy" />
          <span className="name">{tweet.user.name}</span>
          {/* 押した結果を映すため、取得時の値ではなく楽観更新後の統計を出す。 */}
          <span className="likes">♥ {compact((action?.stats ?? tweet.stats).likes)}</span>
        </div>
      )}
    </article>
  );
});
