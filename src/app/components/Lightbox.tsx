import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import type { Media, Tweet, TweetAction } from '../../shared/types';
import { ext } from '../../ext/browser.ts';
import type { TweetActionState } from '../hooks/useTweetActions';
import { compact, mediaUrl, relTime } from '../lib/format';
import { ActionBar } from './ActionBar';
import { Icon } from './Icon';

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

/**
 * ブラウザのダウンロードに渡す。
 * pbs.twimg.com の URL は末尾が拡張子を持たないので、format クエリから補ってやる。
 */
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

export function Lightbox({ list, index, onIndexChange, onClose, onNearEnd, actions, onAction }: LightboxProps) {
  const entry = index >= 0 ? list[index] : undefined;
  const visible = entry !== undefined;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /** 開く直前にフォーカスがあった要素。閉じたらここへ返す。 */
  const restoreRef = useRef<HTMLElement | null>(null);

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
    if (!visible) return;
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
    <div className="lightbox" ref={rootRef} role="dialog" aria-modal="true" onClick={closeOnSelf}>
      {/* 記号の文字（✕ ‹ ›）は字体次第で大きさも重心も揃わないので、アイコンに寄せる。 */}
      {/* .icon-btn は付けない。あちらのホバー色は生成り地向けで、墨地のここでは字が地に沈む。 */}
      <button ref={closeRef} className="lb-close" aria-label="閉じる" onClick={onClose}>
        <Icon name="close" />
      </button>
      <button className="lb-nav prev" aria-label="前へ" onClick={() => move(-1)}>
        <Icon name="prev" />
      </button>
      <button className="lb-nav next" aria-label="次へ" onClick={() => move(1)}>
        <Icon name="next" />
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
        <div className="lb-body">
          <div>
            <span className="who">{tweet.user.name}</span>{' '}
            <span className="handle">
              @{tweet.user.screenName} · {relTime(tweet.createdAt)}
              {tweet.retweetedBy ? ` · @${tweet.retweetedBy.screenName} がリポスト` : ''}
            </span>
          </div>
          {tweet.text ? <div className="txt">{tweet.text}</div> : null}
          <div className="row">
            {/* 共有（URL のコピー）は下のリンク束ではなく操作ボタンの並びに置く。
                あちらは「この画像をどう開くか」で、コピーの対象はポストだから。 */}
            <ActionBar
              tweet={tweet}
              state={actions.get(tweet.id)}
              onAction={onAction}
              counts="all"
              share
              className="lb-actions"
            />
            <div className="lb-links">
              {/* アイコンは aria-hidden なので、数だけでは何の数か伝わらない。 */}
              {tweet.stats.views ? (
                <span role="img" aria-label={`閲覧数 ${compact(tweet.stats.views)}`}>
                  <Icon name="views" /> {compact(tweet.stats.views)}
                </span>
              ) : null}
              <span>
                {media.width}×{media.height}
              </span>
              {/* 3 つとも字を落としてアイコンだけにした。Icon は aria-hidden なので、
                  aria-label が無いとリンクもボタンも無名になる。落とした語はそのまま
                  aria-label と title に移してあり、読み上げとホバーでは今までどおり出る。 */}
              <a
                className="lb-link"
                href={tweet.url}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="X で開く"
                title="X で開く"
              >
                <Icon name="external" />
              </a>
              <a
                className="lb-link"
                href={orig}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="原寸"
                title="原寸"
              >
                <Icon name="expand" />
              </a>
              {/* サーバ版は中継してファイル名を付けていた。拡張機能では downloads API がそれをやる。 */}
              <button
                type="button"
                className="aslink lb-link"
                aria-label="保存"
                title="保存"
                onClick={() => void save(saveUrl)}
              >
                <Icon name="download" />
              </button>
              {/* 墨地なので生成り向けの --fg-faint では読めない。色はクラスへ預けて styles.css に決めさせる。 */}
              <span className="lb-index">
                {index + 1} / {list.length}
              </span>
            </div>
          </div>
        </div>
      </figcaption>
    </div>
  );
}
