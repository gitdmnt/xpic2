import { useEffect, useMemo, useRef } from 'react';
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
  /** 外れていく途中。薄くしながら場所を保ち、消えきってから tiles から外れる。 */
  leaving: boolean;
}

interface MasonryGridProps {
  tiles: TileItem[];
  opts: Options;
  onOpen(lbIndex: number): void;
  /** ポスト id → いいね等の状態。同じ投稿のタイルは同じ値を引く。 */
  actions: Map<string, TweetActionState>;
  onAction(tweet: Tweet, action: TweetAction): void;
}

/** タイルの座標は JS で計算するので、CSS ではなくここが余白の唯一の出どころ。 */
const GAP = 12;

/** 極端な縦長・横長は列を壊すので範囲を丸める。 */
function aspectOf(media: Media): number {
  const w = media.width || 1;
  const h = media.height || 1;
  return Math.min(3, Math.max(0.42, w / h));
}

export function MasonryGrid({ tiles, opts, onOpen, actions, onAction }: MasonryGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const containerWidth = useElementWidth(gridRef);

  // useMasonry の再計算を tiles の変化だけに縛るため、配列の同一性を保つ。
  const aspects = useMemo(() => tiles.map((t) => aspectOf(t.media)), [tiles]);

  const { placements, height } = useMasonry({
    aspects,
    containerWidth,
    columns: opts.columns,
    gap: GAP,
    footer: opts.meta ? META_HEIGHT : 0,
  });

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
    <div className="relative w-full" ref={gridRef} style={{ height: `${height}px` }}>
      {/* 幅が測れるまでは配置が全て原点に潰れるので描かない。 */}
      {containerWidth > 0 &&
        tiles.map((t, i) => {
          const placement = placements[i];
          const handler = openHandlers[i];
          if (!placement || !handler) return null;
          return (
            <Tile
              key={t.key}
              tweet={t.tweet}
              media={t.media}
              groupCount={t.group.length}
              placement={placement}
              showMeta={opts.meta}
              blurred={opts.blur && t.tweet.sensitive}
              leaving={t.leaving}
              onOpen={handler}
              action={actions.get(t.tweet.id)}
              onAction={onAction}
            />
          );
        })}
    </div>
  );
}
