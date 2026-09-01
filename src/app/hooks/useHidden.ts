// 押して非表示にした投稿の記録。掃く仕掛けと違い、こちらは自分で選んだものなので localStorage に
// 残し、取得元をまたいで効かせる（検索でもブックマークでも、一度消したものは出さない）。

import { useCallback, useMemo } from 'react';
import { usePersistedState } from './usePersistedState.ts';

const KEY = 'xpic2:hidden';

/**
 * 覚えておく上限。id は JSON にして 22 バイトほどなので、5000 件で 110KB と localStorage には軽い。
 * 無くても破綻しないが、無制限に伸びるものを置く理由も無い。溢れたら古いものから落とす。
 */
const LIMIT = 5000;

const EMPTY: string[] = [];

/**
 * usePersistedState は配列を素通りさせる（器も中身も見ない）ので、検査はここで一度掛ける。
 * 器から見るのは、別の形の値が入っていると filter そのものが落ちて画面が出なくなるため。
 */
function clean(ids: unknown): string[] {
  return Array.isArray(ids) ? ids.filter((v): v is string => typeof v === 'string') : [];
}

export interface HiddenState {
  /** 非表示にしたポスト id。 */
  hidden: ReadonlySet<string>;
  hide(id: string): void;
  /** 1 件だけ記録から外す。直前の非表示を戻すために使う。 */
  unhide(id: string): void;
  /** 記録を全部忘れる。押し間違いの受け皿。 */
  clear(): void;
}

export function useHidden(): HiddenState {
  const [ids, setIds] = usePersistedState<string[]>(KEY, EMPTY);

  const hidden = useMemo(() => new Set(clean(ids)), [ids]);

  const hide = useCallback(
    (id: string) => {
      setIds((prev) => {
        const base = clean(prev);
        if (base.includes(id)) return prev;
        const next = [...base, id];
        return next.length > LIMIT ? next.slice(next.length - LIMIT) : next;
      });
    },
    [setIds],
  );

  const clear = useCallback(() => setIds([]), [setIds]);

  const unhide = useCallback(
    (id: string) => setIds((prev) => clean(prev).filter((v) => v !== id)),
    [setIds],
  );

  return { hidden, hide, unhide, clear };
}
