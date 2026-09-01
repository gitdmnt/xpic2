// localStorage に載せた状態を扱うフック。
// 表示設定（Options）のように「後から項目が増える」値を保存するため、
// 読み出しは初期値との浅いマージにする。

import { useCallback, useEffect, useState } from 'react';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 保存済みの値を復元する。
 * オブジェクトのときは初期値のキーだけを採用し、型が食い違う項目は捨てる。
 * こうしないと、項目を増やしたときに未定義が混ざり、項目を減らしたときに
 * 古い残骸が居座って画面が壊れる。
 */
function restore<T>(key: string, initial: T): T {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    // プライベートモードなど localStorage 自体が触れない環境では初期値で動かす
    return initial;
  }
  if (raw === null) return initial;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return initial;
  }

  if (isRecord(initial)) {
    if (!isRecord(parsed)) return initial;
    const merged: Record<string, unknown> = { ...initial };
    for (const k of Object.keys(initial)) {
      const stored = parsed[k];
      if (stored === undefined) continue;
      if (typeof stored !== typeof initial[k]) continue;
      merged[k] = stored;
    }
    return merged as T;
  }

  // スカラーや配列はそのまま採用する（マージのしようがない）
  return parsed as T;
}

export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => restore(key, initial));

  // 書き込みを更新関数の中でなく副作用で行う。
  // StrictMode は更新関数を二度呼ぶので、そこに副作用を置くと二重書き込みになる。
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 容量超過や保存禁止の環境では諦める。画面の動作は止めない。
    }
  }, [key, value]);

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => (typeof next === 'function' ? (next as (prev: T) => T)(prev) : next));
  }, []);

  return [value, set];
}
