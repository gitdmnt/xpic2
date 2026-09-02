import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Media, Options, Tweet, TweetAction } from '../../shared/types';
import { useElementWidth, useMasonry } from '../hooks/useMasonry';
import type { TweetActionState } from '../hooks/useTweetActions';
import { META_HEIGHT, Tile } from './Tile';

/** タイル 1 枚分。group は分割表示をやめたときに束ねられるメディア、lbIndex はライトボックスの開始位置。 */
export interface TileItem {
  key: string;
  tweet: Tweet;
  media: Media;
  group: Media[];
  lbIndex: number;
  /** 外れていく途中。薄くしながら場所を保ち、消えきってから gone になる。 */
  leaving: boolean;
  /** 外れた跡。配置には数えるが描かない（詰めると壁が組み直されるため）。 */
  hole: boolean;
}

interface MasonryGridProps {
  tiles: TileItem[];
  opts: Options;
  onOpen(lbIndex: number): void;
  /** ポスト id → いいね等の状態。同じ投稿のタイルは同じ値を引く。 */
  actions: Map<string, TweetActionState>;
  onAction(tweet: Tweet, action: TweetAction): void;
  onHide(tweet: Tweet): void;
  /**
   * 画面の外へ出たら外すポスト id。tiles に混ぜず別に受け取るのは、拾うたびに tiles が
   * 作り直されると、壁の配置まで計算し直しになるため。
   */
  armed: ReadonlySet<string>;
  /** その投稿のタイルが全部画面の外へ出た合図。 */
  onExit(id: string): void;
  /** 穴を畳んでよい合図。上へ引き切ったときに返す。 */
  onCollapse(): void;
  /**
   * 上へ引き切ったときに壁を読み直す合図。設定で畳むほうを選んでいるあいだは null で、
   * そのときは onCollapse だけを返す。引きの量（opts.pullPx）はどちらでも同じ。
   */
  onReload: (() => void) | null;
  /** モーダルやライトボックスが開いていないときだけ壁のキー操作を受ける。 */
  keyboardActive: boolean;
}

/** タイルの座標は JS で計算するので、CSS ではなくここが余白の唯一の出どころ。 */
const GAP = 12;

/**
 * 画面の外へ出たと見なすまでの余白。縁を跨いだだけで外すと、少し戻したときに消える途中が
 * 見えるので、ひと呼吸ぶん外へ出てから外す。
 */
const SWEEP_MARGIN = 200;

/** 極端な縦長・横長は列を壊すので範囲を丸める。 */
function aspectOf(media: Media): number {
  const w = media.width || 1;
  const h = media.height || 1;
  return Math.min(3, Math.max(0.42, w / h));
}

/** 横一列に束ねるタイルは、各画像の横幅を足した縦横比にする。 */
function aspectOfGroup(group: readonly Media[]): number {
  return group.reduce((sum, media) => sum + aspectOf(media), 0);
}

type Direction = 'left' | 'right' | 'up' | 'down';

/** 指定方向にあるタイルから、進行方向と横ずれの合計が最小のものを選ぶ。 */
export function findNeighbor(
  placements: readonly { x: number; y: number; width: number; height: number }[],
  current: number,
  direction: Direction,
  available: ReadonlySet<number>,
): number {
  const from = placements[current];
  if (!from) return current;
  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  let best = current;
  let bestScore = Infinity;
  placements.forEach((p, i) => {
    if (i === current || !available.has(i)) return;
    const dx = p.x + p.width / 2 - fx;
    const dy = p.y + p.height / 2 - fy;
    const primary = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
    if (primary <= 0) return;
    const cross = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = primary + cross * 2;
    if (score < bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/** viewport と縦に交差して表示中のうち、上端が最小で同値なら左端が最小のタイル。 */
export function findTopLeftVisible(
  placements: readonly { x: number; y: number; width: number; height: number }[],
  available: ReadonlySet<number>,
  viewportTop: number,
  viewportBottom: number,
): number {
  let best = -1;
  placements.forEach((p, i) => {
    if (!available.has(i) || p.y + p.height <= viewportTop || p.y >= viewportBottom) return;
    const chosen = best < 0 ? undefined : placements[best];
    const top = Math.max(p.y, viewportTop);
    const chosenTop = chosen ? Math.max(chosen.y, viewportTop) : Infinity;
    if (!chosen || top < chosenTop || (top === chosenTop && p.x < chosen.x)) best = i;
  });
  return best;
}

export function MasonryGrid(props: MasonryGridProps) {
  const { tiles, opts, onOpen, actions, onAction, onHide, armed, onExit, onCollapse, onReload, keyboardActive } =
    props;
  const gridRef = useRef<HTMLDivElement>(null);
  const containerWidth = useElementWidth(gridRef);

  // useMasonry の再計算を tiles の変化だけに縛るため、配列の同一性を保つ。
  const aspects = useMemo(() => tiles.map((t) => aspectOfGroup(t.group)), [tiles]);

  const { placements, height } = useMasonry({
    aspects,
    containerWidth,
    columns: opts.columns,
    gap: GAP,
    footer: opts.meta ? META_HEIGHT : 0,
  });

  /** 穴を畳む直前に控える錨。畳んだ後に同じタイルの位置を見て、その差をスクロール量へ返す。 */
  const anchorRef = useRef<{ key: string; y: number } | null>(null);
  /**
   * 詰めた 1 回だけタイルの遷移を止める。スクロールは即座に戻るのに位置だけ 280ms かけて動くと、
   * 打ち消しが噛み合わず壁ごと流れて見える。
   */
  const [still, setStill] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const available = useMemo(() => {
    const out = new Set<number>();
    tiles.forEach((t, i) => {
      if (!t.hole && !t.leaving && placements[i]) out.add(i);
    });
    return out;
  }, [tiles, placements]);

  const selectedIndex = selectedKey === null ? -1 : tiles.findIndex((t) => t.key === selectedKey);

  /** 未選択なら、今見えているタイルのうち左上にあるものから始める。 */
  const initialIndex = useCallback(() => {
    const wall = gridRef.current?.getBoundingClientRect().top ?? 0;
    return findTopLeftVisible(placements, available, -wall, window.innerHeight - wall);
  }, [available, placements]);

  useEffect(() => {
    if (selectedKey !== null && (selectedIndex < 0 || !available.has(selectedIndex))) setSelectedKey(null);
  }, [selectedKey, selectedIndex, available]);

  // 選んだタイルへフォーカスを移し、画面の外なら必要な分だけスクロールする。
  useEffect(() => {
    if (selectedKey === null) return;
    const elements = gridRef.current?.querySelectorAll<HTMLElement>('[data-tile-key]');
    const el = elements ? [...elements].find((item) => item.dataset.tileKey === selectedKey) : undefined;
    el?.focus({ preventScroll: true });
    const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'nearest' });
  }, [selectedKey]);

  useEffect(() => {
    if (!keyboardActive) return;
    const directions: Record<string, Direction> = {
      ArrowLeft: 'left', ArrowDown: 'down', ArrowUp: 'up', ArrowRight: 'right',
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      if (active instanceof HTMLElement && active.isContentEditable) return;
      // ヘッダやタイル内のボタンをキーボードで押すときは、その要素自身の操作を優先する。
      if (active instanceof HTMLButtonElement || active instanceof HTMLAnchorElement) return;
      const direction = directions[e.key];
      let current = selectedIndex >= 0 && available.has(selectedIndex) ? selectedIndex : initialIndex();
      if (direction) {
        if (current < 0) return;
        const next = selectedIndex < 0 ? current : findNeighbor(placements, current, direction, available);
        setSelectedKey(tiles[next]?.key ?? null);
      } else if (e.key === 'Enter' && current >= 0) {
        onOpen(tiles[current]?.lbIndex ?? 0);
      } else if ((e.key === 'l' || e.key === 'b') && current >= 0) {
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        if (selectedIndex < 0) {
          setSelectedKey(tiles[current]?.key ?? null);
          e.preventDefault();
          return;
        }
        const tweet = tiles[current]?.tweet;
        if (tweet) onAction(tweet, e.key === 'l' ? 'like' : 'bookmark');
      } else if (e.key === 'm' && current >= 0) {
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        if (selectedIndex < 0) {
          setSelectedKey(tiles[current]?.key ?? null);
          e.preventDefault();
          return;
        }
        const tweet = tiles[current]?.tweet;
        if (tweet) onHide(tweet);
      } else {
        return;
      }
      e.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [keyboardActive, selectedIndex, available, initialIndex, placements, tiles, onOpen, onAction, onHide]);

  // スクロールを見る場所はここ 1 つ。掃く合図と、穴を畳む合図の両方をここで出す。
  //
  // 掃くのは投稿単位で、そのタイルが全部画面の外へ出てから（1 枚でも見えているうちに外すと、
  // 見ている写真が消える）。タイルごとに IntersectionObserver を張らないのは、投稿の占める帯が
  // placements からしか出せず、通知の遅れも挟まりたくないため。
  //
  // 畳むのは上へ戻り始めたとき。下へ読み進めている最中に詰めると、見ている場所より上が縮んで
  // 並びが動く。上へ向かっているあいだなら、動く先（下）は既に見た側になる。
  //
  // 引き切ったときに畳むか読み直すかは設定が決める。読み直しを選んでいるあいだは畳まない
  //（壁ごと入れ替わるので穴は結果として消える）ぶん、畳む穴が無くても引きは数える。
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    // 投稿 id → そのタイル全部を覆う帯（壁の中の座標）。
    const spans = new Map<string, { top: number; bottom: number }>();
    let holes = false;
    tiles.forEach((t, i) => {
      if (t.hole) holes = true;
      const p = placements[i];
      if (!p || !armed.has(t.tweet.id)) return;
      const span = spans.get(t.tweet.id);
      if (!span) {
        spans.set(t.tweet.id, { top: p.y, bottom: p.y + p.height });
        return;
      }
      span.top = Math.min(span.top, p.y);
      span.bottom = Math.max(span.bottom, p.y + p.height);
    });
    if (spans.size === 0 && !holes && !onReload) return;

    let frame = 0;
    let last = window.scrollY;
    let pull = 0;
    // 読み直すのはこの壁につき一度きり。読み直すと壁が空になり、その拍子に走るスクロールを
    // 引きとして数えてしまうと、そのまま二度目へ続いてしまう。
    let reloaded = false;

    /** 画面の上端にいちばん近いタイル。並び順はおおよそ上から下なので、先頭から見つけて足りる。 */
    const anchor = (wall: number) => {
      for (const [i, t] of tiles.entries()) {
        const p = placements[i];
        if (!p || t.hole) continue;
        if (wall + p.y + p.height > 0) return { key: t.key, y: p.y };
      }
      return null;
    };

    const check = () => {
      frame = 0;
      // 壁の上端だけ測れば、あとは配置の値で足りる。読むのは 1 フレームに 1 回。
      const wall = el.getBoundingClientRect().top;
      const view = window.innerHeight;

      for (const [id, span] of spans) {
        if (wall + span.bottom > -SWEEP_MARGIN && wall + span.top < view + SWEEP_MARGIN) continue;
        // 張り直しまでのあいだ何度も返さないよう、返した投稿は帯ごと落とす。
        spans.delete(id);
        onExit(id);
      }

      if (!holes && !onReload) return;
      const y = window.scrollY;
      const back = last - y;
      last = y;
      // 下向きが挟まったら数え直す。往復ではなく、上へ向かい続けたぶんだけを見る。
      pull = back > 0 ? pull + back : 0;
      if (pull < opts.pullPx) return;
      pull = 0;
      if (onReload) {
        if (reloaded) return;
        reloaded = true;
        onReload();
        return;
      }
      anchorRef.current = anchor(wall);
      setStill(true);
      onCollapse();
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };

    // 拾った時点で既に外にある投稿（拡大表示の中で拾って閉じた場合）は、ここで外れる。
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [armed, tiles, placements, onExit, onCollapse, onReload, opts.pullPx]);

  // 畳んだぶんスクロール量を戻す。描く前に済ませないと、詰まった壁が一度描かれてから跳ねる。
  // 遷移を戻すのもここ。同じ位置のまま戻すので、動きは起きない。
  useLayoutEffect(() => {
    const held = anchorRef.current;
    if (!held) return;
    anchorRef.current = null;
    const i = tiles.findIndex((t) => t.key === held.key);
    const p = i < 0 ? undefined : placements[i];
    if (p && p.y !== held.y) window.scrollBy(0, p.y - held.y);
    setStill(false);
  }, [tiles, placements, still]);

  // onOpen は親のレンダー毎に別関数になりうる。Tile の memo を無効化しないよう、
  // 各タイルへ渡すハンドラは tiles 単位で固定し、呼び出し先だけ ref で最新に保つ。
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);
  const openHandlers = useMemo(
    () => tiles.map((t) => () => onOpenRef.current(t.lbIndex)),
    [tiles],
  );

  return (
    // 遷移を止めるのは器の側から。タイルの class より詳細度が高いので、確実にこちらが勝つ。
    <div
      className={still ? 'relative w-full [&_article]:transition-none' : 'relative w-full'}
      ref={gridRef}
      style={{ height: `${height}px` }}
    >
      {/* 幅が測れるまでは配置が全て原点に潰れるので描かない。 */}
      {containerWidth > 0 &&
        tiles.map((t, i) => {
          const placement = placements[i];
          const handler = openHandlers[i];
          // 穴は場所だけ取って何も描かない。aspects には残っているので下の配置は動かない。
          if (t.hole || !placement || !handler) return null;
          return (
            <Tile
              key={t.key}
              tileKey={t.key}
              tweet={t.tweet}
              media={t.media}
              group={t.group}
              placement={placement}
              showMeta={opts.meta}
              blurred={opts.blur && t.tweet.sensitive}
              leaving={t.leaving}
              onOpen={handler}
              action={actions.get(t.tweet.id)}
              onAction={onAction}
              onHide={onHide}
            />
          );
        })}
    </div>
  );
}
