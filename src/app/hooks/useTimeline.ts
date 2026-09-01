// X 側の都合が 3 つある。メディアの無いページが返ること、読み直しと進行中のリクエストが
// 競合すること、同じポストが別のページに再び現れること。順に、空ページを跨いで先へ進む、
// 世代番号で古い応答を捨てる、id で重複排除する、で捌く。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Options, Source, Tweet } from '../../shared/types.ts';
import { ApiError, fetchTimeline } from '../lib/x.ts';

interface TimelineError {
  message: string;
  hint: string | null;
  status: number;
}

export interface TimelineState {
  tweets: Tweet[];
  loading: boolean;
  done: boolean;
  error: TimelineError | null;
  /** 続きを読む。読み込み中と終端では何もしない。 */
  load: () => void;
  reload: () => void;
}

export interface UseTimelineParams {
  source: Source;
  query: string;
  opts: Options;
  /** 偽のあいだは読み込まない（ユーザー名が未入力など）。 */
  enabled: boolean;
}

/** 進行中の取得に紐づく可変状態。読み直しのたびに作り直す。 */
interface Run {
  gen: number;
  cursor: string | null;
  done: boolean;
  loading: boolean;
  seen: Set<string>;
  controller: AbortController | null;
}

function newRun(gen: number): Run {
  return { gen, cursor: null, done: false, loading: false, seen: new Set(), controller: null };
}

/** 空ページを跨いで進む回数の上限。X が延々と空を返しても止まるようにする。 */
const MAX_EMPTY_HOPS = 4;

export function useTimeline({ source, query, opts, enabled }: UseTimelineParams): TimelineState {
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<TimelineError | null>(null);

  const runRef = useRef<Run>(newRun(0));
  // 表示だけに関わる設定（列幅・メタ表示など）で読み直さないよう、opts は依存に入れず ref で読む。
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const requestRef = useRef({ source, query });
  requestRef.current = { source, query };

  const run = useCallback(async (fresh: boolean) => {
    const state = runRef.current;
    if (state.loading) return;
    if (!fresh && state.done) return;

    const controller = new AbortController();
    state.loading = true;
    state.controller = controller;
    setLoading(true);
    setError(null);

    // 世代が進んでいたら、この実行は読み直しに追い越されている。
    const alive = () => runRef.current === state;

    try {
      for (let hop = 0; ; hop++) {
        const { source: src, query: q } = requestRef.current;
        const res = await fetchTimeline({
          source: src,
          query: q,
          cursor: fresh && hop === 0 ? null : state.cursor,
          opts: optsRef.current,
          signal: controller.signal,
        });
        if (!alive()) return;

        const added: Tweet[] = [];
        for (const tweet of res.items) {
          if (state.seen.has(tweet.id)) continue;
          state.seen.add(tweet.id);
          added.push(tweet);
        }
        state.cursor = res.cursor;
        state.done = res.cursor === null;

        if (fresh && hop === 0) setTweets(added);
        else if (added.length > 0) setTweets((prev) => [...prev, ...added]);
        setDone(state.done);

        if (added.length === 0 && !state.done && hop < MAX_EMPTY_HOPS) continue;
        return;
      }
    } catch (e) {
      // 中断は読み直しの副作用なので、エラーとして見せない。
      if (controller.signal.aborted) return;
      if (!alive()) return;
      if (e instanceof ApiError) {
        setError({ message: e.message, hint: e.hint, status: e.status });
      } else {
        setError({ message: e instanceof Error ? e.message : String(e), hint: null, status: 0 });
      }
    } finally {
      if (alive()) {
        state.loading = false;
        state.controller = null;
        setLoading(false);
      }
    }
  }, []);

  const reload = useCallback(() => {
    runRef.current.controller?.abort();
    runRef.current = newRun(runRef.current.gen + 1);
    setTweets([]);
    setDone(false);
    setError(null);
    void run(true);
  }, [run]);

  const load = useCallback(() => {
    void run(false);
  }, [run]);

  // 取得条件が変わったら読み直す。表示だけの設定は含めない。
  const filterKey = `${opts.photos ? 1 : 0}${opts.videos ? 1 : 0}${opts.gifs ? 1 : 0}${opts.retweets ? 1 : 0}`;
  useEffect(() => {
    runRef.current.controller?.abort();
    runRef.current = newRun(runRef.current.gen + 1);

    if (!enabled) {
      setTweets([]);
      setDone(false);
      setError(null);
      setLoading(false);
      return;
    }
    setTweets([]);
    setDone(false);
    setError(null);
    void run(true);
    // StrictMode の二重実行では 1 回目が中断され、2 回目の世代だけが結果を反映する。
  }, [source, query, filterKey, enabled, run]);

  useEffect(() => () => runRef.current.controller?.abort(), []);

  return { tweets, loading, done, error, load, reload };
}
