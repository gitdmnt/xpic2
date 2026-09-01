// 画面全体の状態はこのコンポーネントが持つ。
// 子コンポーネントは受け取った値を描くだけにして、取得条件・表示設定・ライトボックス位置の
// 唯一の持ち主をここに集約する（Node 版の state オブジェクトに相当）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Media, Options, Source } from '../shared/types.ts';
import { DEFAULT_OPTIONS } from '../shared/types.ts';
import type { ExtStatus } from './lib/x.ts';
import { extStatus, isReady } from './lib/x.ts';
import { usePersistedState } from './hooks/usePersistedState.ts';
import { useTimeline } from './hooks/useTimeline.ts';
import { useTweetActions } from './hooks/useTweetActions.ts';
import { TopBar } from './components/TopBar.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { MasonryGrid } from './components/MasonryGrid.tsx';
import type { TileItem } from './components/MasonryGrid.tsx';
import { Lightbox } from './components/Lightbox.tsx';
import type { LightboxEntry } from './components/Lightbox.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';

const SOURCE_KEY = 'xpic2:source';
const QUERY_KEY = 'xpic2:query';
const OPTS_KEY = 'xpic2:opts';

const SOURCES: readonly Source[] = ['user', 'search', 'bookmarks', 'foryou', 'following'];

/** 取得元の旧名。localStorage に残った値を、意味の変わらない新しい名前へ読み替える。 */
const LEGACY_SOURCE: Record<string, Source> = { home: 'following' };

/** 実際に X へ投げる取得条件。入力欄の文字列とは別に持ち、「読み込む」で初めて確定させる。 */
interface Request {
  source: Source;
  query: string;
}

function isSource(value: string): value is Source {
  return (SOURCES as readonly string[]).includes(value);
}

/** ブックマークと 2 つのホームタイムラインは自分のものなので入力欄を使わない。 */
function needsQuery(source: Source): boolean {
  return source === 'user' || source === 'search';
}

/** 検索語はそのまま、ユーザー名は先頭の @ を落として送る。 */
function normalizeQuery(source: Source, raw: string): string {
  const trimmed = raw.trim();
  return source === 'search' ? trimmed : trimmed.replace(/^@/, '');
}

// localStorage はプライベートモードなどで例外を投げるので、読み書きとも失敗を握り潰して続行する。
function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できなくても今回のセッションは動くので無視する
  }
}

function initialSource(): Source {
  const saved = readLocal(SOURCE_KEY);
  if (!saved) return 'user';
  if (isSource(saved)) return saved;
  // 廃止した取得元(いいね)は既定へ落とし、改名しただけのものは読み替える。
  return LEGACY_SOURCE[saved] ?? 'user';
}

function initialQuery(): string {
  return readLocal(QUERY_KEY) ?? '';
}

export function App() {
  // 入力欄の値（source / query）と、確定済みの取得条件（request）を分けて持つ。
  const [source, setSource] = useState<Source>(initialSource);
  const [query, setQuery] = useState<string>(initialQuery);
  const [request, setRequest] = useState<Request>(() => {
    const s = initialSource();
    return { source: s, query: needsQuery(s) ? normalizeQuery(s, initialQuery()) : '' };
  });

  // 欠けたキーの既定値での穴埋めは usePersistedState が済ませてくれるので、ここでは差分だけ重ねる。
  const [opts, setOpts] = usePersistedState<Options>(OPTS_KEY, DEFAULT_OPTIONS);
  const patchOpts = useCallback(
    (patch: Partial<Options>) => {
      setOpts((prev) => ({ ...prev, ...patch }));
    },
    [setOpts],
  );

  /** 権限とログインの状況。取得前は null で、この間は読み込みを始めない。 */
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lbIndex, setLbIndex] = useState(-1);

  const queryInputRef = useRef<HTMLInputElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // 未設定のまま X を叩いても 401 になるだけなので、設定状況が確認できるまでは読み込みを止める。
  const enabled = configured === true && (!needsQuery(request.source) || request.query !== '');

  const { tweets, loading, done, error, load, reload } = useTimeline({
    source: request.source,
    query: request.query,
    opts,
    enabled,
  });

  // いいね・リポスト・ブックマークは取得と独立に動く。押した結果はこちらが覚える。
  const {
    actions,
    toggle: handleAction,
    error: actionError,
    dismissError,
  } = useTweetActions(tweets);

  // ── タイルとライトボックスの導出 ─────────────────────────────
  // split が真なら 1 メディア 1 タイル、偽なら 1 投稿 1 タイル（group は投稿の全メディア）。
  // ライトボックスはタイル順に group を展開した並びなので、lbIndex はその先頭位置になる。
  // なお width/height の 0.42〜3 クランプは、タイルの実寸を扱う MasonryGrid 側で一度だけ行う
  // （TileItem は生の Media を運ぶ契約なので、ここでクランプ済みの値を渡す口が無い）。
  const tiles = useMemo<TileItem[]>(() => {
    const out: TileItem[] = [];
    let lb = 0;
    for (const tweet of tweets) {
      const groups: Media[][] = opts.split ? tweet.media.map((m) => [m]) : [tweet.media];
      for (const group of groups) {
        const media = group[0];
        if (!media) continue;
        out.push({ key: `${tweet.id}:${media.key}`, tweet, media, group, lbIndex: lb });
        lb += group.length;
      }
    }
    return out;
  }, [tweets, opts.split]);

  const entries = useMemo<LightboxEntry[]>(() => {
    const out: LightboxEntry[] = [];
    for (const tile of tiles) {
      for (const media of tile.group) out.push({ tweet: tile.tweet, media });
    }
    return out;
  }, [tiles]);

  // 読み直しでリストが縮んだときに範囲外を指し続けないよう、描画前に丸める。
  const lightboxIndex = lbIndex >= 0 && lbIndex < entries.length ? lbIndex : -1;

  // load は再レンダごとに同一性が変わりうるので、監視の張り直しを増やさないよう ref 経由で呼ぶ。
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const loadMore = useCallback(() => {
    loadRef.current();
  }, []);

  // ── 起動時の状況確認 ─────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    extStatus()
      .then((status) => {
        if (!alive) return;
        const ready = isReady(status);
        setConfigured(ready);
        // 権限が無い・ログインしていないなら、何も読まずに設定モーダルを開く。
        if (!ready) setSettingsOpen(true);
      })
      .catch((e: unknown) => {
        if (alive) setConfigError(e instanceof Error ? e.message : '状況を取得できませんでした。');
      });
    return () => {
      alive = false;
    };
  }, []);

  // cookie の失効は 401 で返ってくるので、設定モーダルを自動で開いて貼り直しへ誘導する。
  useEffect(() => {
    if (error?.status === 401) setSettingsOpen(true);
  }, [error]);

  // 操作の失敗は画面の隅に出す。読み流されても困らない内容なので、少し置いて自分で消す。
  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(dismissError, 6000);
    return () => clearTimeout(timer);
  }, [actionError, dismissError]);

  // ── 無限スクロール ───────────────────────────────────────────
  // 依存が変わるたびに張り直すことで、センチネルが視界に残ったままでも次の読み込みが続く。
  const hasTiles = tiles.length > 0;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !enabled || loading || done || !hasTiles) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: '1400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, loading, done, hasTiles, loadMore]);

  // ── キーボード ───────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      // モーダルやライトボックスの背後にある入力へフォーカスを飛ばさない。
      if (settingsOpen || lightboxIndex >= 0) return;
      const active = document.activeElement;
      // 入力中の '/' はただの文字なので奪わない。
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      if (active instanceof HTMLElement && active.isContentEditable) return;
      e.preventDefault();
      queryInputRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen, lightboxIndex]);

  // ── 操作 ─────────────────────────────────────────────────────
  const handleSourceChange = useCallback((next: Source) => {
    setSource(next);
    writeLocal(SOURCE_KEY, next);
    // 入力の要らない取得元は切り替えた時点で読み込む。
    if (!needsQuery(next)) setRequest({ source: next, query: '' });
  }, []);

  const handleQueryChange = useCallback((next: string) => {
    setQuery(next);
    writeLocal(QUERY_KEY, next);
  }, []);

  const handleSubmit = useCallback(() => {
    const next = needsQuery(source) ? normalizeQuery(source, query) : '';
    setRequest((prev) => {
      // 条件が同じだと useTimeline の依存が動かないので、その場合だけ明示的に読み直す。
      if (prev.source === source && prev.query === next) {
        reload();
        return prev;
      }
      return { source, query: next };
    });
  }, [source, query, reload]);

  const handleIndexChange = useCallback(
    (i: number) => {
      const n = entries.length;
      if (n === 0) return;
      // 端で止めずに巻き戻す（Node 版と同じ）。
      setLbIndex(((i % n) + n) % n);
    },
    [entries.length],
  );

  const handleStatusChanged = useCallback((status: ExtStatus) => {
    setConfigError(null);
    setConfigured(isReady(status));
  }, []);

  // ── 状態表示 ─────────────────────────────────────────────────
  const status = (() => {
    if (configError) return <div className="err">{configError}</div>;
    if (configured === false) return <>まず接続設定を済ませてください。</>;
    if (error) {
      return (
        <>
          <div className="err">{error.message}</div>
          {error.hint ? <div className="hint">{error.hint}</div> : null}
        </>
      );
    }
    if (loading) {
      return (
        <>
          <div className="spinner" />
          読み込み中…
        </>
      );
    }
    if (configured === true && !enabled && tiles.length === 0) {
      return <>{source === 'search' ? '検索語を入力してください。' : 'ユーザー名を入力して「読み込む」を押してください。'}</>;
    }
    if (done) {
      return <>{tiles.length === 0 ? '条件に合う画像付きポストが見つかりませんでした。' : 'これ以上ありません。'}</>;
    }
    return null;
  })();

  return (
    <>
      <TopBar
        source={source}
        onSourceChange={handleSourceChange}
        query={query}
        onQueryChange={handleQueryChange}
        onSubmit={handleSubmit}
        onOpenSettings={() => setSettingsOpen(true)}
        queryInputRef={queryInputRef}
      />

      <Toolbar opts={opts} onChange={patchOpts} mediaCount={tiles.length} tweetCount={tweets.length} />

      <main>
        <MasonryGrid tiles={tiles} opts={opts} onOpen={setLbIndex} actions={actions} onAction={handleAction} />
        <div id="sentinel" ref={sentinelRef} />
        <div className="status">{status}</div>
      </main>

      <Lightbox
        list={entries}
        index={lightboxIndex}
        onIndexChange={handleIndexChange}
        onClose={() => setLbIndex(-1)}
        onNearEnd={loadMore}
        actions={actions}
        onAction={handleAction}
      />

      {actionError ? (
        <div className="toast" role="status">
          <span>{actionError}</span>
          <button type="button" className="ghost" aria-label="閉じる" onClick={dismissError}>
            ✕
          </button>
        </div>
      ) : null}

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onChanged={handleStatusChanged} />
    </>
  );
}
