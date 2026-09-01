import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import type { Media, Tweet, TweetAction } from '../../shared/types';
import { ext } from '../../ext/browser.ts';
import type { TweetActionState } from '../hooks/useTweetActions';
import { compact, mediaUrl, relTime } from '../lib/format';
import { LightboxActionBar } from './ActionBar';
import { Icon } from './Icon';

/**
 * タイルは 1 ポストの複数メディアを束ねるが、拡大表示は 1 枚ずつ送るので、
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
  /** 手前に別のモーダルがある間は、背後でキー操作を受けない。 */
  keyboardActive?: boolean;
}

/** 残りがこの件数を切ったら追加読み込みを促す。 */
const NEAR_END = 6;

/** pbs.twimg.com の URL は末尾が拡張子を持たないので、format クエリから補ってやる。 */
function save(url: string): Promise<unknown> {
  let filename: string | undefined;
  try {
    const u = new URL(url);
    const base = u.pathname.split('/').pop();
    const format = u.searchParams.get('format');
    if (base) filename = format && !base.includes('.') ? `${base}.${format}` : base;
  } catch {
    // 名前を作れなければブラウザに任せる
  }
  return ext().downloads.download(filename ? { url, filename } : { url });
}

/** 拡大表示中のショートカット。x.com の割り当てに合わせてある。 */
const ACTION_KEYS: Record<string, TweetAction> = { l: 'like', t: 'retweet', b: 'bookmark' };

/** Tab で辿れる要素。 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Tab を覆いの中で巡回させる。
 * aria-modal は支援技術から外側を隠すだけで、フォーカスは止めてくれない。
 * 宣言と実態を合わせないと、隠したはずの背後のタイルへフォーカスだけが出ていく。
 */
function trapTab(e: KeyboardEvent, root: HTMLElement): void {
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (!(active instanceof Node) || !root.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
    return;
  }
  if (e.shiftKey ? active === first : active === last) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
}

/** 墨地に浮かせる的。地も罫も持たせず、触れたときだけ罫と同じ薄い白を敷く。 */
const LB_BTN = 'btn btn-ghost absolute z-2 p-0 text-lb-fg hover:bg-lb-line hover:text-lb-fg';

const LB_NAV = `${LB_BTN} top-1/2 h-16 w-11 -translate-y-1/2 max-sm:h-14 max-sm:w-9`;

const STAGE_MEDIA = 'max-h-full max-w-full rounded-sm object-contain';

/**
 * 下の束に並ぶアイコン 1 つ。余白が無いと 15px 角の的しか残らないので 31px 角まで広げ、
 * 上下は margin で戻して、隣に並ぶ閲覧数や寸法の行を厚くしない。
 */
const LB_LINK = 'inline-flex items-center -my-2 p-2 text-lb-dim hover:text-lb-fg hover:underline';

export function Lightbox({ list, index, onIndexChange, onClose, onNearEnd, actions, onAction, keyboardActive = true }: LightboxProps) {
  const entry = index >= 0 ? list[index] : undefined;
  const visible = entry !== undefined;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /** 開く直前にフォーカスがあった要素。閉じたらここへ返す。 */
  const restoreRef = useRef<HTMLElement | null>(null);

  // 端では反対側へ回り込む。負の剰余を避けるため length を足してからもう一度剰余を取る。
  const move = useCallback(
    (delta: number) => {
      if (list.length === 0) return;
      onIndexChange((((index + delta) % list.length) + list.length) % list.length);
    },
    [index, list.length, onIndexChange],
  );

  // 表示中は背後のページをスクロールさせない。閉じても外れても必ず元へ戻す。
  // フォーカスも同じ寿命で扱う。開いたら閉じるボタンへ移し、閉じたら開いた元へ返す。
  useEffect(() => {
    if (!visible) return;
    document.body.style.overflow = 'hidden';
    const from = document.activeElement;
    restoreRef.current = from instanceof HTMLElement ? from : null;
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = '';
      const back = restoreRef.current;
      restoreRef.current = null;
      // 読み直しで元の要素が消えていることもあるので、繋がっているときだけ返す。
      if (back?.isConnected) back.focus();
    };
  }, [visible]);

  // キー操作は表示中だけ document に張る。非表示のときに握ると画面側の「/」などと衝突する。
  // 早期 return より前なので、ショートカットの対象は entry から直に取る。
  const activeTweet = entry?.tweet;
  useEffect(() => {
    if (!visible || !keyboardActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Cmd+L のようなブラウザ側の割り当ては奪わない。
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Tab') {
        if (rootRef.current) trapTab(e, rootRef.current);
        return;
      }
      const action = ACTION_KEYS[e.key];
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'j') move(1);
      else if (e.key === 'ArrowLeft' || e.key === 'k') move(-1);
      else if (action && activeTweet) {
        // 長押し中に API の返事が戻ると再び反転できてしまうため、操作キーのリピートは捨てる。
        if (!e.repeat) onAction(activeTweet, action);
      }
      else return;
      // 矢印キーでの背後スクロールを止める。
      e.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible, keyboardActive, move, onClose, activeTweet, onAction]);

  // onNearEnd の同一性が変わるたびに再発火させたくないので、呼び出しは ref 経由にする。
  const nearEndRef = useRef(onNearEnd);
  useEffect(() => {
    nearEndRef.current = onNearEnd;
  });
  useEffect(() => {
    if (!visible) return;
    if (index > list.length - NEAR_END) nearEndRef.current();
  }, [visible, index, list.length]);

  // React は muted を属性として出さないことがあり、GIF の自動再生が拒否される。直接立てる。
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = entry?.media.type === 'animated_gif';
  }, [entry]);

  if (!entry) return null;

  const { tweet, media } = entry;
  const large = mediaUrl(media.url, 'large');
  const orig = mediaUrl(media.url, 'orig');
  // 写真は原寸、動画と GIF は mp4 を保存対象にする。
  const saveUrl = media.type === 'photo' ? orig : (media.video ?? orig);
  const isMovie = (media.type === 'video' || media.type === 'animated_gif') && Boolean(media.video);
  // 送るたびに要素を作り直す。src を保持したままだと前の画像のフォールバック状態が残る。
  const stageKey = `${index}:${media.key}`;

  const closeOnSelf = (e: MouseEvent<HTMLElement>) => {
    // 余白のクリックだけで閉じる。画像やボタンを踏んだときは閉じない。
    if (e.target === e.currentTarget) onClose();
  };

  return (
    // ここだけ墨地にする。周りを沈めないと写真の明暗が正しく見えない。
    // 輪郭の藍鼠は墨地の上で沈むので、この器の中だけ地の色で描く。
    <div
      className="fixed inset-0 z-70 grid grid-rows-[1fr_auto] bg-lb-bg text-lb-fg [&_:focus-visible]:outline-lb-fg"
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      onClick={closeOnSelf}
    >
      {/* 囲みは持たせない。狭い画面では舞台の余白が縮む一方でボタンの位置は据え置きなので、
          枠があると写真の上に線が乗る。押せることはホバーの地だけで伝える。 */}
      <button
        ref={closeRef}
        className={`${LB_BTN} top-4 right-4 size-9`}
        aria-label="閉じる"
        onClick={onClose}
      >
        <Icon name="close" />
      </button>
      {/* 送り矢印は押す的の大きさが要るので、アイコンだけ 20px にする。 */}
      <button className={`${LB_NAV} left-3`} aria-label="前へ" onClick={() => move(-1)}>
        <Icon name="prev" size="lg" />
      </button>
      <button className={`${LB_NAV} right-3`} aria-label="次へ" onClick={() => move(1)}>
        <Icon name="next" size="lg" />
      </button>

      <figure
        className="flex min-h-0 items-center justify-center px-16 pt-6 pb-2 max-sm:px-2 max-sm:pt-4 max-sm:pb-1"
        onClick={closeOnSelf}
      >
        {/* 墨地の上では影が働かないので付けない。角丸も写真の縁を削らない程度に留める。 */}
        {isMovie ? (
          <video
            key={stageKey}
            className={STAGE_MEDIA}
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
            className={STAGE_MEDIA}
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

      <figcaption className="mx-auto flex w-full max-w-[1000px] items-start gap-3 px-6 pt-3 pb-6 text-sm text-lb-dim max-sm:px-4 max-sm:pb-4">
        <img className="size-9 shrink-0 rounded-full" src={tweet.user.avatar} alt="" />
        {/* 長い本文で flex アイテムが縮まないと省略が効かないので min-w-0 が要る。 */}
        <div className="min-w-0 flex-1">
          <div>
            <span className="font-semibold text-lb-fg">{tweet.user.name}</span>{' '}
            <span className="font-normal text-lb-dim">
              @{tweet.user.screenName} · {relTime(tweet.createdAt)}
              {tweet.retweetedBy ? ` · @${tweet.retweetedBy.screenName} がリポスト` : ''}
            </span>
          </div>
          {tweet.text ? (
            <div className="mt-1 mb-2 break-words whitespace-pre-wrap text-lb-fg">{tweet.text}</div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            {/* 共有（URL のコピー）は下のリンク束ではなく操作ボタンの並びに置く。
                あちらは「この画像をどう開くか」で、コピーの対象はポストだから。 */}
            <LightboxActionBar tweet={tweet} state={actions.get(tweet.id)} onAction={onAction} />
            <div className="flex flex-wrap items-center gap-4">
              {/* アイコンは aria-hidden なので、数だけでは何の数か伝わらない。 */}
              {tweet.stats.views ? (
                <span role="img" aria-label={`閲覧数 ${compact(tweet.stats.views)}`}>
                  <Icon name="views" /> {compact(tweet.stats.views)}
                </span>
              ) : null}
              <span>
                {media.width}×{media.height}
              </span>
              {/* 的を広げたぶん、アイコンどうしは隙間 0 の束にする。離れたままだと 3 つが
                  ひと束に見えず、押せる範囲も判らない。 */}
              <div className="flex items-center">
                <a
                  className={LB_LINK}
                  href={tweet.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="X で開く"
                  title="X で開く"
                >
                  <Icon name="external" />
                </a>
                <a
                  className={LB_LINK}
                  href={orig}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="原寸"
                  title="原寸"
                >
                  <Icon name="expand" />
                </a>
                {/* downloads API を呼ぶので button だが、隣の 2 つと並ぶので見た目はリンクに揃える。 */}
                <button
                  type="button"
                  className={`${LB_LINK} cursor-pointer`}
                  aria-label="保存"
                  title="保存"
                  onClick={() => void save(saveUrl)}
                >
                  <Icon name="download" />
                </button>
              </div>
              {/* 「1 / 240」。送るたびに桁が変わるので、等幅数字にして左右の揺れを止める。 */}
              <span className="text-lb-dim tabular-nums">
                {index + 1} / {list.length}
              </span>
            </div>
          </div>
        </div>
      </figcaption>
    </div>
  );
}
