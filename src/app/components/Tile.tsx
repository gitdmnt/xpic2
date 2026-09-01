import { memo, useEffect, useRef, useState } from 'react';
import type { Media, Tweet, TweetAction } from '../../shared/types';
import type { Placement } from '../hooks/useMasonry';
import type { TweetActionState } from '../hooks/useTweetActions';
import { mediaUrl } from '../lib/format';
import { MetaActionBar, OverlayActionBar } from './ActionBar';
import { Icon, type IconName } from './Icon';

/**
 * メタ行の高さ。下の `h-[34px]` と一致していなければ
 * masonry の計算とサムネイルの実高さがずれるので、ここを唯一の定義とする。
 */
export const META_HEIGHT = 34;

interface TileProps {
  tileKey: string;
  tweet: Tweet;
  media: Media;
  groupCount: number;
  placement: Placement;
  showMeta: boolean;
  blurred: boolean;
  leaving: boolean;
  onOpen(): void;
  /** いいね・リポスト・ブックマークの状態。ポスト単位なので同じ投稿のタイルは同じ値を受け取る。 */
  action: TweetActionState | undefined;
  onAction(tweet: Tweet, action: TweetAction): void;
  onHide(tweet: Tweet): void;
}

/** 右上バッジ 1 つ分。枚数（+2）だけは数なのでアイコンに置き換えられず、文字で持つ。 */
interface Badge {
  /** React の key。種別ごとに 1 つしか出ないので種別名で足りる。 */
  key: string;
  icon?: IconName;
  text?: string;
  /** 読み上げでの名前。GIF のように文字を伴わないバッジは、これが無いと種別ごと伝わらない。 */
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

// 触れたときに動くのは囲みだけ。写真の明るさは変えない（見えているものが変わってしまう）。
//
// group は写真に重ねる操作ボタンの出し入れ、@container はメタ行の数字の出し入れが見る先。
//
// animate-pop を要素へ直に当てられるのは、生成の時点で最終位置の transform がインラインで入り、
// 原点からの飛び込みが起きないため。既存タイルが動くときは transition だけが効く。
const TILE =
  'group @container absolute top-0 left-0 flex cursor-zoom-in flex-col overflow-hidden rounded-md border border-line bg-elev' +
  ' transition-[transform,width,height,opacity] duration-280 ease-tile will-change-transform animate-pop hover:border-line-strong' +
  ' motion-reduce:animate-none motion-reduce:transition-none scroll-my-16';

export const Tile = memo(function Tile({
  tileKey,
  tweet,
  media,
  groupCount,
  placement,
  showMeta,
  blurred,
  leaving,
  onOpen,
  action,
  onAction,
  onHide,
}: TileProps) {
  const rootRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // 再生中は img を隠して video を見せる。差し替えではなく表示の入れ替えで行う。
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
  // ぼかしは写真だけに掛ける。囲みまでぼかすとタイルの縁が滲む。
  const pic = `block size-full bg-sunk object-cover${blurred ? ' scale-110 blur-[24px] saturate-[.6]' : ''}`;

  return (
    <article
      ref={rootRef}
      data-tile-key={tileKey}
      tabIndex={-1}
      className={leaving ? `${TILE} opacity-0` : TILE}
      // 外れていく途中は触れない。薄いだけのタイルを押して拡大表示が開くのを防ぐ。
      // pointer-events では読み上げと Tab の順序に残ってしまうので inert で丸ごと外す
      //（中に操作ボタンがあるため、aria-hidden だけでは焦点の当たる要素が隠れた木に残る）。
      inert={leaving}
      style={{
        width: `${placement.width}px`,
        height: `${placement.height}px`,
        transform: `translate3d(${placement.x}px, ${placement.y}px, 0)`,
      }}
      onClick={onOpen}
      onMouseEnter={hasVideo && media.type === 'video' ? () => setPlaying(true) : undefined}
      onMouseLeave={hasVideo && media.type === 'video' ? () => setPlaying(false) : undefined}
    >
      {/* 高さは masonry が round(colW / aspect) + footer で出した値なので、伸縮せず収まる。 */}
      <div
        className="relative min-h-0 w-full flex-auto overflow-hidden bg-sunk"
        style={{ height: `${placement.height - footer}px` }}
      >
        <img
          className={pic}
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
            className={pic}
            src={media.video ?? undefined}
            muted
            loop
            playsInline
            preload="none"
            style={playing ? undefined : { display: 'none' }}
          />
        )}
        {badgeList.length > 0 && (
          <div className="absolute top-2 right-2 flex gap-1 text-2xs tracking-[.02em]">
            {badgeList.map((b) => (
              // role="img" で 1 つの図として名前を与える。中の記号ではなく label が読まれる。
              <span key={b.key} role="img" aria-label={b.label} className="rounded-sm bg-veil px-1.5 py-0.5 text-fg">
                {b.icon ? <Icon name={b.icon} /> : null}
                {b.icon && b.text ? ' ' : null}
                {b.text}
              </span>
            ))}
          </div>
        )}
        {/* role="img" と aria-label が無いと中身の空の要素になり、警告そのものが消える。
            ぼかしの下の写真は明るさが読めないので、印の側に地を敷く（影で浮かせる手は地が
            明るいと効かない）。15px ではぼけた写真の上で判らないので、ここだけ 20px にする。 */}
        {blurred && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-1/2 flex items-center justify-center bg-veil px-2 py-1 text-fg"
            role="img"
            aria-label="センシティブ"
            title="センシティブ"
          >
            <Icon name="hidden" size="lg" />
          </div>
        )}
        {/* 操作ボタンの居場所はメタ行だが、その表示を切ると行ごと消える。
            そのときだけ写真に重ねて、押す手段が無くなるのを防ぐ。 */}
        {!showMeta && (
          <OverlayActionBar tweet={tweet} state={action} onAction={onAction} onHide={onHide} />
        )}
      </div>
      {/* 高さ 34px は masonry の footer 値と対になっている。片方だけ変えると行がずれる。 */}
      {showMeta && (
        <div className="flex h-[34px] shrink-0 items-center gap-2 border-t border-line bg-elev px-2 text-xs text-fg-dim">
          {/* 同じ語を alt と字の両方に置くと読み上げで投稿者名が二度続くので、alt は空にする。
              長い名前は省略記号で切れるため、全体を読む手段として title は字の側に残す。 */}
          <img src={tweet.user.avatar} alt="" loading="lazy" className="size-[18px] shrink-0 rounded-full" />
          {/* この行で伸び縮みしてよいのは名前だけ。min-w-0 が無いと flex アイテムは中身の
              最小幅より細くならず、1 タイルが 132px まで痩せたときに右のボタンを行の外へ
              押し出す。flex-auto と対にして、余った幅も足りない幅も名前が引き受ける。 */}
          <span className="min-w-0 flex-auto truncate font-medium text-fg" title={tweet.user.name}>
            {tweet.user.name}
          </span>
          {/* いいね数はボタンが自分で出す。別に ♥ を並べるとハートが二つになる。 */}
          <MetaActionBar tweet={tweet} state={action} onAction={onAction} onHide={onHide} />
        </div>
      )}
    </article>
  );
});
