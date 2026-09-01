// 取得条件・表示設定・ライトボックス位置の唯一の持ち主。
// 子コンポーネントは受け取った値を描くだけにする。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Media, Options, Source } from '../shared/types.ts';
import { DEFAULT_OPTIONS } from '../shared/types.ts';
import type { ExtStatus } from './lib/x.ts';
import { extStatus, isReady } from './lib/x.ts';
import { usePersistedState } from './hooks/usePersistedState.ts';
import { useTimeline } from './hooks/useTimeline.ts';
import { useTweetActions } from './hooks/useTweetActions.ts';
import { useAutoDismiss } from './hooks/useAutoDismiss.ts';
import { Icon } from './components/Icon.tsx';
import { TopBar } from './components/TopBar.tsx';
import { MasonryGrid } from './components/MasonryGrid.tsx';
import type { TileItem } from './components/MasonryGrid.tsx';
import { Lightbox } from './components/Lightbox.tsx';
import type { LightboxEntry } from './components/Lightbox.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import type { SettingsTab } from './components/SettingsModal.tsx';

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
    // 保存できなくても今回のセッションは動く。
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
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('display');
  const [lbIndex, setLbIndex] = useState(-1);

  // どのタブを開くかは呼ぶ側が決める。自分で開いた人が見たいのは表示設定で、こちらが勝手に
  // 開くのは接続が整っていないときだけなので、開く理由ごとに行き先が違う。
  const openSettings = useCallback((tab: SettingsTab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

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

  const {
    actions,
    toggle: handleAction,
    error: actionError,
    dismissError,
  } = useTweetActions(tweets);

  // 掃うのはおすすめとフォロー中だけ。自分で並びを決めて開いた画面では、
  // 見えているものが勝手に減るほうが困る。
  const sweeping = opts.sweep && (request.source === 'foryou' || request.source === 'following');
  // 掃くのを止める合図には lbIndex を使う。丸めた lightboxIndex は tiles から導くので、
  // ここで見ると tiles → dismissed → tiles の輪になる。
  const {
    armed,
    phase: dismissed,
    dismiss,
  } = useAutoDismiss(tweets, actions, sweeping && lbIndex < 0);

  // ── タイルとライトボックスの導出 ─────────────────────────────
  // split が真なら 1 メディア 1 タイル、偽なら 1 投稿 1 タイル（group は投稿の全メディア）。
  // ライトボックスはタイル順に group を展開した並びなので、lbIndex はその先頭位置になる。
  // 縦横比のクランプは、TileItem が生の Media を運ぶ契約なので MasonryGrid 側で行う。
  const tiles = useMemo<TileItem[]>(() => {
    const out: TileItem[] = [];
    let lb = 0;
    for (const tweet of tweets) {
      const phase = sweeping ? dismissed.get(tweet.id) : undefined;
      if (phase === 'gone') continue;
      const groups: Media[][] = opts.split ? tweet.media.map((m) => [m]) : [tweet.media];
      for (const group of groups) {
        const media = group[0];
        if (!media) continue;
        out.push({ key: `${tweet.id}:${media.key}`, tweet, media, group, lbIndex: lb, leaving: phase === 'leaving' });
        lb += group.length;
      }
    }
    return out;
  }, [tweets, opts.split, sweeping, dismissed]);

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
        // 権限が無い・ログインしていないなら、何も読まずに接続タブを開く。
        if (!ready) openSettings('connection');
      })
      .catch((e: unknown) => {
        if (alive) setConfigError(e instanceof Error ? e.message : '状況を取得できませんでした。');
      });
    return () => {
      alive = false;
    };
  }, [openSettings]);

  // x.com のセッションが切れると 401 が返るので、接続タブを開いてログインし直しへ誘導する。
  useEffect(() => {
    if (error?.status === 401) openSettings('connection');
  }, [error, openSettings]);

  // 操作の失敗は画面の隅に出す。読み流されても困らない内容なので、少し置いて自分で消す。
  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(dismissError, 6000);
    return () => clearTimeout(timer);
  }, [actionError, dismissError]);

  // ── 無限スクロール ───────────────────────────────────────────
  // 依存が変わるたびに張り直すことで、センチネルが視界に残ったままでも次の読み込みが続く。
  // 見るのはタイルではなく取得済みの投稿。拾って外したぶんで壁が空になっても、続きは読み続ける。
  const hasTweets = tweets.length > 0;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !enabled || loading || done || !hasTweets) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: '1400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, loading, done, hasTweets, loadMore]);

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
      // 端で止めずに巻き戻す。
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
    if (configError) return <div className="text-danger"><Icon name="warning" /> {configError}</div>;
    if (configured === false) return <>x.com への権限とログインが要ります</>;
    if (error) {
      return (
        <>
          <div className="text-danger"><Icon name="warning" /> {error.message}</div>
          {error.hint ? <div className="mt-2 text-sm text-fg-faint">{error.hint}</div> : null}
        </>
      );
    }
    if (loading) {
      return (
        <>
          {/* 待機の印は 20px の円 1 つ。動きを減らす設定では回さない。 */}
          <div className="mx-auto size-5 animate-turn rounded-full border-2 border-line border-t-accent motion-reduce:animate-none" />
          {/* 回る図形は読み上げに何も残さないので、字は隠したまま持たせる */}
          <span className="sr-only">読み込み中</span>
        </>
      );
    }
    if (configured === true && !enabled && tiles.length === 0) {
      // 「読み込む」はアイコンだけで名前を持たない。押す先を語らず、要るものだけ言う。
      return <>{source === 'search' ? '検索語を入力' : 'ユーザー名を入力'}</>;
    }
    if (done) {
      // 終端は罫 1 本で足りるが、0 件のときは罫の上に何も無く、線だけでは伝わらない。
      // 見るのはタイルではなく取得できた投稿。掃って空になったときに「見つかりません」と言うと、
      // 集まらなかったのか掃い終えたのかが逆に伝わる。
      return tweets.length === 0 ? <>見つかりません</> : <hr className="mx-auto my-2 w-10 border-t border-line-strong" />;
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
        // 準備が済むまでは接続へ振る。未接続の本文は文言だけで、設定へ入る導線が歯車しか無いため。
        onOpenSettings={() => openSettings(configured === false ? 'connection' : 'display')}
        queryInputRef={queryInputRef}
      />

      <main className="p-4 max-sm:p-3">
        <MasonryGrid
          tiles={tiles}
          opts={opts}
          onOpen={setLbIndex}
          actions={actions}
          onAction={handleAction}
          armed={armed}
          onExit={dismiss}
        />
        {/* 無限スクロールのセンチネル。高さ 0 だと交差が起きないので 1px だけ持たせる。 */}
        <div ref={sentinelRef} className="h-px" />
        {/* 上下を詰め、下だけ厚くする（頁の終いの余白をここが持つため）。 */}
        <div className="px-4 pt-6 pb-10 text-center text-fg-dim">{status}</div>
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

      {/* 操作の失敗通知。ライトボックス (z-70) より前に出す。拡大表示中に押しても読めるようにするため。 */}
      {actionError ? (
        <div
          className="fixed bottom-4 left-1/2 z-80 flex max-w-[min(680px,calc(100%_-_32px))] -translate-x-1/2 items-center gap-3 rounded-md border border-line bg-elev py-2 pr-2 pl-4 text-sm text-danger shadow-float"
          role="status"
        >
          <span>{actionError}</span>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="閉じる" onClick={dismissError}>
            <Icon name="close" />
          </button>
        </div>
      ) : null}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={handleStatusChanged}
        opts={opts}
        onOptsChange={patchOpts}
        tab={settingsTab}
        onTabChange={setSettingsTab}
      />
    </>
  );
}
