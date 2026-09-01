// masonry の配置計算。
//
// X の API は画像の実寸（original_info）を返す。だから画像の読み込みを待たずに
// 高さを確定でき、読み込み完了のたびに再配置するタイプのガタつきが起きない。
// 配置そのものは「最も低い列へ順に積む」だけの純粋関数で、副作用を持たない。

import { useEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';

export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MasonryParams {
  /** 各タイルの width/height。呼び出し側でクランプ済みであることを前提にする。 */
  aspects: number[];
  containerWidth: number;
  colWidth: number;
  gap: number;
  /** メタ行の高さ。非表示なら 0。 */
  footer: number;
}

export interface MasonryResult {
  placements: Placement[];
  height: number;
  columns: number;
}

/** 列数は「詰め込める本数」で決める。1 列を下回らず、細かくしすぎても読めないので 24 で頭打ち。 */
function columnCount(containerWidth: number, colWidth: number, gap: number): number {
  return Math.max(1, Math.min(24, Math.floor((containerWidth + gap) / (colWidth + gap))));
}

export function computeMasonry(p: MasonryParams): MasonryResult {
  const { aspects, containerWidth, colWidth, gap, footer } = p;
  if (containerWidth <= 0 || aspects.length === 0) {
    return { placements: [], height: 0, columns: 0 };
  }

  const columns = columnCount(containerWidth, colWidth, gap);
  // 指定された colWidth は目安。実際の列幅は余白を差し引いて等分する。
  const width = (containerWidth - gap * (columns - 1)) / columns;
  const heights = new Array<number>(columns).fill(0);

  const placements = aspects.map((aspect) => {
    let target = 0;
    // 0.5px の遊びを持たせるのは、浮動小数の誤差で列が入れ替わるのを防ぐため。
    for (let i = 1; i < columns; i++) {
      if ((heights[i] ?? 0) < (heights[target] ?? 0) - 0.5) target = i;
    }
    const top = heights[target] ?? 0;
    const height = Math.round(width / (aspect || 1)) + footer;
    heights[target] = top + height + gap;
    return {
      x: Math.round(target * (width + gap)),
      y: Math.round(top),
      width,
      height,
    };
  });

  // 末尾の gap はコンテナの外に出るので差し引く。
  const height = Math.max(0, Math.max(...heights) - gap);
  return { placements, height, columns };
}

export function useMasonry(p: MasonryParams): MasonryResult {
  const { aspects, containerWidth, colWidth, gap, footer } = p;
  return useMemo(
    () => computeMasonry({ aspects, containerWidth, colWidth, gap, footer }),
    [aspects, containerWidth, colWidth, gap, footer],
  );
}

/**
 * 要素の幅を測る。
 * 幅が確定するまでは 0 を返すので、呼び出し側は 0 のあいだ描画を止める。
 */
export function useElementWidth<T extends HTMLElement>(ref: RefObject<T | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 誤差程度の変化で再レンダしないよう、0.5px 未満の差は無視する。
    const update = (next: number) => {
      setWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
    };

    update(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) update(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
