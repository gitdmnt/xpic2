// X の API が画像の実寸（original_info）を返すので、読み込みを待たずに高さを確定できる。
// 読み込み完了のたびに再配置するタイプのガタつきは起きない。

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
  /** 表示したい列数。0 は「自動」で、画面幅から決める。 */
  columns: number;
  gap: number;
  /** メタ行の高さ。非表示なら 0。 */
  footer: number;
}

export interface MasonryResult {
  placements: Placement[];
  height: number;
  /** 実際に使った列数。指定は画面幅で頭打ちにされるので、要求と一致するとは限らない。 */
  columns: number;
}

/** 自動のときに目安とする列幅。列幅を直接指定していた頃の既定値で、見え方を変えないための数字。 */
const AUTO_COL_WIDTH = 290;

/** 列を割り込ませてよい下限の幅。これより細いと画像が縮みすぎて何が写っているか判らなくなる。 */
const MIN_COL_WIDTH = 132;

function resolveColumns(containerWidth: number, requested: number, gap: number): number {
  if (requested <= 0) {
    // 自動は「目安幅で詰め込める本数」。1 列を下回らず、細かくしすぎても読めないので 24 で頭打ち。
    return Math.max(1, Math.min(24, Math.floor((containerWidth + gap) / (AUTO_COL_WIDTH + gap))));
  }
  // 明示指定でも画面幅で頭打ちにする。これが無いと携帯で 8 列指定が潰れたまま出て使い物にならない。
  const fits = Math.floor((containerWidth + gap) / (MIN_COL_WIDTH + gap));
  return Math.max(1, Math.min(requested, fits));
}

function computeMasonry(p: MasonryParams): MasonryResult {
  const { aspects, containerWidth, columns, gap, footer } = p;
  if (containerWidth <= 0 || aspects.length === 0) {
    return { placements: [], height: 0, columns: 0 };
  }

  const cols = resolveColumns(containerWidth, columns, gap);
  const width = (containerWidth - gap * (cols - 1)) / cols;
  const heights = new Array<number>(cols).fill(0);

  const placements = aspects.map((aspect) => {
    let target = 0;
    // 0.5px の遊びを持たせるのは、浮動小数の誤差で列が入れ替わるのを防ぐため。
    for (let i = 1; i < cols; i++) {
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
  return { placements, height, columns: cols };
}

export function useMasonry(p: MasonryParams): MasonryResult {
  const { aspects, containerWidth, columns, gap, footer } = p;
  return useMemo(
    () => computeMasonry({ aspects, containerWidth, columns, gap, footer }),
    [aspects, containerWidth, columns, gap, footer],
  );
}

/** 幅が確定するまでは 0 を返す。呼び出し側は 0 のあいだ描画を止める。 */
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
