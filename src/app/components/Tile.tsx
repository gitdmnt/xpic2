import { memo, useEffect, useRef, useState } from 'react';
import type { Media, Tweet, TweetAction } from '../../shared/types';
import type { Placement } from '../hooks/useMasonry';
import type { TweetActionState } from '../hooks/useTweetActions';
import { mediaUrl } from '../lib/format';
import { ActionBar } from './ActionBar';
import { Icon, type IconName } from './Icon';

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

/**
 * 右上バッジ 1 つ分。
 * ▶ と GIF をアイコンにしたので、文字列の配列では表せなくなった。
 * 枚数（+2）だけは数なのでアイコンに置き換えられず、文字のまま残す。
 */
interface Badge {
  /** React の key。種別ごとに 1 つしか出ないので種別名で足りる。 */
  key: string;
  icon?: IconName;
  text?: string;
  /**
   * 読み上げでの名前。Icon は aria-hidden なので、GIF のように文字を伴わないバッジは
   * これが無いと中身の空の要素になり、種別がまるごと伝わらない。
   */
  label: string;
}

/** 右上バッジ。動画は秒数、GIF は種別、グループは残り枚数を示す。 */
function badges(media: Media, groupCount: number): Badge[] {
  const list: Badge[] = [];
  if (media.type === 'video') {
    const seconds = media.durationMs ? Math.round(media.durationMs / 1000) : null;
    list.push({
      key: 'video',
      icon: 'play',
      text: seconds === null ? undefined : `${seconds}s`,
      label: seconds === null ? '動画' : `動画 ${seconds} 秒`,
    });
  }
  if (media.type === 'animated_gif') list.push({ key: 'gif', icon: 'gif', label: 'GIF' });
  if (groupCount > 1) list.push({ key: 'group', text: `+${groupCount - 1}`, label: `ほか ${groupCount - 1} 枚` });
  return list;
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

  const badgeList = badges(media, groupCount);

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
        {badgeList.length > 0 && (
          <div className="badge">
            {badgeList.map((b) => (
              // role="img" で 1 つの図として名前を与える。中の記号ではなく label が読まれる。
              <span key={b.key} role="img" aria-label={b.label}>
                {b.icon ? <Icon name={b.icon} /> : null}
                {b.icon && b.text ? ' ' : null}
                {b.text}
              </span>
            ))}
          </div>
        )}
        {/* 「センシティブ」の字はアイコン 1 つに畳んだ。Icon は aria-hidden なので、
            role="img" と aria-label が無いと中身の空の要素になり、警告そのものが消える。
            title は、絵だけでは伝わらない利用者のためにホバーで語を出す。 */}
        {tweet.sensitive && (
          <div className="sensitive-tag" role="img" aria-label="センシティブ" title="センシティブ">
            <Icon name="hidden" />
          </div>
        )}
        {/* 操作ボタンの居場所はメタ行だが、情報を表示を切ると行ごと消える。
            そのときだけ従来どおり画像に重ねて、押す手段が無くなるのを防ぐ。 */}
        {!showMeta && <ActionBar tweet={tweet} state={action} onAction={onAction} share className="tile-actions" />}
      </div>
      {showMeta && (
        <div className="meta">
          {/* 名前が見える字に戻ったので、アバターの alt は空にする。
              同じ語を alt と字の両方に置くと、読み上げで投稿者名が二度続く。
              長い名前は省略記号で切れるため、全体を読む手段として title は字の側に残す。 */}
          <img src={tweet.user.avatar} alt="" loading="lazy" />
          <span className="name" title={tweet.user.name}>
            {tweet.user.name}
          </span>
          {/* いいね数はボタン自身が持つ（counts="like"）。別に ♥ を並べるとハートが二つになる。 */}
          <ActionBar tweet={tweet} state={action} onAction={onAction} counts="like" share className="meta-actions" />
        </div>
      )}
    </article>
  );
});
