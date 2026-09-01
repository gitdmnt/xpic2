// 設定モーダル。表示設定（表示タブ）と接続設定（接続タブ）を 1 枚のシートに束ねる。
//
// 表示タブはツールバーから引き取ったものである。画面に出しっぱなしだったチェックボックスの列は、
// 一度決めたらほとんど触らない割に場所と視線を取り続けるので、畳んでおけるここへ移した。
//
// 接続タブはサーバ版と役目が変わっている。cookie を貼る欄は無い。認証はブラウザの x.com のセッションを
// そのまま使うので、ここで確かめるのは「権限が下りているか」と「ログインしているか」だけである。
// queryId の上書きも background.ts が勝手に集めるため、cURL 欄はその手当が届かないときの控えとして残す。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Options } from '../../shared/types.ts';
import type { ExtStatus } from '../lib/x.ts';
import { applyCurl, clearOverrides, extStatus, requestPermissions } from '../lib/x.ts';
import { Icon } from './Icon.tsx';

export type SettingsTab = 'display' | 'connection';

export interface SettingsModalProps {
  open: boolean;
  onClose(): void;
  onChanged(status: ExtStatus): void;
  opts: Options;
  /** 変更のあった項目だけを渡す。保存は App の責務。 */
  onOptsChange(patch: Partial<Options>): void;
  /**
   * どちらのタブを見せるか。App が持つ（未接続のときは接続タブを開いて出したいため）。
   * ここの内部 state にすると「開いた瞬間だけ効く初期値」になり、2 度目に開いたとき意図した面が出ない。
   */
  tab: SettingsTab;
  onTabChange(tab: SettingsTab): void;
}

interface Message {
  text: string;
  bad: boolean;
}

/** 列数の選択肢。0 は「自動」で、画面の幅から決める。 */
const COLUMNS: readonly number[] = [0, 2, 3, 4, 5, 6, 7, 8];

/**
 * 「拾ったら消す」のつまみ。1〜30 秒を刻み 1 で送り、その先の 1 目盛りを切に充てる。
 * 猶予が伸びていった先が「もう消さない」なので、切は左端ではなく右端に置く。
 * 保存する値は Options.sweep のまま（0 が切）で、つまみの位置との読み替えはここが持つ。
 */
const SWEEP_MAX = 30;
const SWEEP_OFF = SWEEP_MAX + 1;

/** つまみの位置 → 保存する秒数。 */
function toSweep(pos: number): number {
  return pos >= SWEEP_OFF ? 0 : pos;
}

/** 保存する秒数 → つまみの位置。 */
function toPos(sweep: number): number {
  return sweep === 0 ? SWEEP_OFF : sweep;
}

/** 目盛りの読み。字にも読み上げにも同じものを出す。 */
function sweepLabel(sweep: number): string {
  return sweep === 0 ? '切' : `${sweep}秒`;
}

/** Tab で辿れる要素。details が閉じているときの中身まで拾うので、見えているものへ後で絞る。 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Tab をシートの中で巡回させる。
 * 覆いの裏には写真に重ねた操作ボタンが数百個あり（透明でもフォーカスは当たる）、
 * 外へ逃がすとシートへ戻るまでに Tab を何百回も押すことになる。
 */
function trapTab(e: KeyboardEvent, root: HTMLElement): void {
  // 閉じた details の中身は矩形を持たない。focus() が効かない要素を端に選ぶと巡回が止まる。
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!first || !last) {
    // 行き先が無ければ器自身に留める
    e.preventDefault();
    root.focus();
    return;
  }
  if (!(active instanceof Node) || !root.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
    return;
  }
  // 器自身（tabIndex=-1）から前へ戻るときは末尾へ回す。前向きは DOM 順で先頭に入るので任せる。
  if (e.shiftKey ? active === first || active === root : active === last) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
}

interface CheckProps {
  label: string;
  /** 短くした label から落ちた語。省いた項目には要らない。 */
  title?: string;
  checked: boolean;
  onToggle(value: boolean): void;
}

/** キーを動的に組み立てると Partial<Options> への代入で型が緩むので、呼び出し側で項目名を書く。 */
function Check({ label, title, checked, onToggle }: CheckProps) {
  // aria-label は付けない。見えている語と読み上げの名前がずれると、音声で操作する人が
  // 画面の「ぼかす」を指して呼べなくなる（WCAG 2.5.3）。落とした語は説明として title に持たせる。
  // label と input の両方に置くのは、行のどこに乗せてもツールチップを出しつつ、
  // 読み上げには input 自身の title を説明として拾わせるため。
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 select-none" title={title}>
      <input
        type="checkbox"
        className="m-0 size-[15px] shrink-0 accent-accent"
        title={title}
        checked={checked}
        onChange={(e) => onToggle(e.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

/** タブ 1 枚分の中身。小見出しどうしの間はここで一律に決め、各節には持たせない。 */
const PANEL = 'grid gap-6';

/** 節の小見出し。 */
const OPT_TITLE = 'mb-2 text-xs font-semibold tracking-[.04em] text-fg-dim';

/** 選択肢の並び。狭い画面では折り返させる。 */
const OPT_LIST = 'flex flex-wrap gap-x-4 gap-y-2';

/** 添え物の一行。 */
const LEDE = 'text-sm text-fg-dim';

/** シートの中に置くボタンの並び。ActionBar とは別物なので、間隔もこちらで決める。 */
const ROW = 'flex flex-wrap items-center gap-3';

export function SettingsModal({
  open,
  onClose,
  onChanged,
  opts,
  onOptsChange,
  tab,
  onTabChange,
}: SettingsModalProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  /** 開く直前にフォーカスがあった要素。閉じたらここへ返す。 */
  const restoreRef = useRef<HTMLElement | null>(null);
  const [curl, setCurl] = useState('');
  const [msg, setMsg] = useState<Message | null>(null);
  const [status, setStatus] = useState<ExtStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<ExtStatus | null> => {
    try {
      const s = await extStatus();
      setStatus(s);
      onChanged(s);
      return s;
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : '状況を取得できませんでした。', bad: true });
      return null;
    }
  }, [onChanged]);

  // 開くたびに取り直す。権限は拡張機能の管理画面からも変えられるので、こちらの記憶は当てにしない。
  // 見ているタブでは条件を付けない。App が準備状況を知る経路はこの onChanged だけなので、
  // 表示タブを開いただけのときも取り直しておかないと、読み込みが止まったままになる。
  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // Ctrl+Tab などブラウザ側の割り当ては奪わない。
      else if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey && sheetRef.current) {
        trapTab(e, sheetRef.current);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 開いたらシートへフォーカスを移し、閉じたら開いた元の要素へ返す。
  // aria-modal で外側を隠す以上、フォーカスを外に残すと「隠した側に立っている」状態になる。
  useEffect(() => {
    if (!open) return;
    const from = document.activeElement;
    restoreRef.current = from instanceof HTMLElement ? from : null;
    sheetRef.current?.focus();
    return () => {
      const back = restoreRef.current;
      restoreRef.current = null;
      // 閉じるまでに元の要素が消えていることもあるので、繋がっているときだけ返す。
      if (back?.isConnected) back.focus();
    };
  }, [open]);

  const handleGrant = useCallback(async () => {
    setBusy(true);
    try {
      const ok = await requestPermissions();
      setMsg(
        ok
          ? { text: '許可されました。', bad: false }
          : { text: '許可されませんでした。', bad: true },
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const handleCurl = useCallback(async () => {
    const text = curl.trim();
    if (!text) {
      setMsg({ text: 'cURL を貼り付けてください。', bad: true });
      return;
    }
    setBusy(true);
    try {
      setMsg({ text: await applyCurl(text), bad: false });
      setCurl('');
      await refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : '取り込めませんでした。', bad: true });
    } finally {
      setBusy(false);
    }
  }, [curl, refresh]);

  const handleClear = useCallback(async () => {
    setBusy(true);
    try {
      await clearOverrides();
      setMsg({ text: '上書きを消しました。以後はライブラリの既定値だけで動きます。', bad: false });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  if (!open) return null;

  const ops = Object.entries(status?.queryIds ?? {});

  return (
    // 覆いは墨を薄く流すだけにする。背後の生成りが透けて見えるほうが、戻る先が分かる。
    <div
      className="fixed inset-0 z-60 flex items-start justify-center overflow-auto bg-scrim px-4 py-[6vh]"
      // オーバーレイ自身をクリックしたときだけ閉じる（シート内の操作で閉じない）
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-[min(760px,100%)] rounded-md border border-line bg-elev p-6 shadow-sheet max-sm:p-4"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        // 開いた直後の行き先。中の操作子ではなくシート自身に落として、見出しから読ませる。
        tabIndex={-1}
      >
        {/*
          header 自身に並べ方（flex や justify-content）は持たせない。h2 は読み上げ専用で、
          閉じるは角へ浮かせてあるから、流れの中に並べる相手がひとつも残っていない。
          余白も持たせない。持たせると ✕ だけの帯とタブの帯が二重に積まれる。
          浮かせる位置がシートの内側余白と同じ値なのは、タブの行と背丈を揃えるため。
        */}
        <header>
          {/*
            見出しは目には出さない。開いている面はタブが示しているので、字にすると重なる。
            要素ごと消せないのは、シートの aria-labelledby がこの id を指しているためである。
          */}
          <h2 id="settings-title" className="sr-only">設定</h2>
          <button
            type="button"
            className="btn btn-ghost btn-icon absolute top-6 right-6 max-sm:top-4 max-sm:right-4"
            aria-label="閉じる"
            title="閉じる"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>

        {/*
          role="tab" にすると tabpanel との id 紐付けと矢印キーでの移動まで揃える必要が出る。
          面の切り替えは押した状態が伝われば足りるので、セグメントと同じ aria-pressed で済ませる。

          字は落としてアイコンだけにした。Icon は aria-hidden なので、そのままではボタンが無名になる。
          落とした語は aria-label と title の両方へ移す。
          見た目はヘッダのタブと共有する。同じ役目のものに 2 つの流儀を作らない。
        */}
        <nav className="mb-6 flex flex-wrap gap-1">
          <button
            type="button"
            className={`btn btn-ghost btn-icon${tab === 'display' ? ' btn-on' : ''}`}
            aria-pressed={tab === 'display'}
            aria-label="表示"
            title="表示"
            onClick={() => onTabChange('display')}
          >
            <Icon name="display" />
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-icon${tab === 'connection' ? ' btn-on' : ''}`}
            aria-pressed={tab === 'connection'}
            aria-label="接続"
            title="接続"
            onClick={() => onTabChange('connection')}
          >
            <Icon name="connection" />
          </button>
        </nav>

        {tab === 'display' ? (
          <div className={PANEL}>
            <div>
              <h3 className={OPT_TITLE} id="opt-columns">列数</h3>
              {/* 「自動」の説明文は置かない。選択肢の先頭にその語が出ている以上、言い直しにしかならない。 */}
              {/* ボタン単位で移動する読み上げでは「2」だけが読まれるので、群に小見出しの名前を与える。 */}
              {/* 段組みの数だけ横に並ぶので、狭い画面では折り返させる。
                  罫で継いだ一体の帯にすると、折り返した瞬間に継ぎ目が破綻する。 */}
              <div className="flex flex-wrap gap-1" role="group" aria-labelledby="opt-columns">
                {COLUMNS.map((n) => (
                  // 選んだ状態の見せ方はタブに倣う。ここだけ罫を差し色にすると、
                  // 同じシートの中で列数セグメントがいちばん濃い図形になる。
                  // 塗りをタブほど濃くしないのは、こちらには「自動」「3」という字が残っているためで、
                  // 選択は字色が先に伝える。塗りは念押しでよい。
                  <button
                    key={n}
                    type="button"
                    className={`btn min-w-11 text-sm tabular-nums${opts.columns === n ? ' btn-on-weak' : ''}`}
                    aria-pressed={opts.columns === n}
                    onClick={() => onOptsChange({ columns: n })}
                  >
                    {n === 0 ? '自動' : n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className={OPT_TITLE} id="opt-filter">絞り込み</h3>
              {/* 「RT」は語だけでは立たない。何の絞り込みかは小見出しが持っている。 */}
              <div className={OPT_LIST} role="group" aria-labelledby="opt-filter">
                <Check label="画像" checked={opts.photos} onToggle={(v) => onOptsChange({ photos: v })} />
                <Check label="動画" checked={opts.videos} onToggle={(v) => onOptsChange({ videos: v })} />
                <Check label="GIF" checked={opts.gifs} onToggle={(v) => onOptsChange({ gifs: v })} />
                <Check label="RT" checked={opts.retweets} onToggle={(v) => onOptsChange({ retweets: v })} />
              </div>
            </div>

            <div>
              <h3 className={OPT_TITLE} id="opt-look">見せ方</h3>
              <div className={OPT_LIST} role="group" aria-labelledby="opt-look">
                <Check
                  label="情報"
                  title="投稿者といいね数をタイルに出す"
                  checked={opts.meta}
                  onToggle={(v) => onOptsChange({ meta: v })}
                />
                <Check
                  label="ぼかす"
                  title="センシティブな画像をぼかす"
                  checked={opts.blur}
                  onToggle={(v) => onOptsChange({ blur: v })}
                />
                <Check
                  label="分割"
                  title="1 投稿の複数画像を別々のタイルにする"
                  checked={opts.split}
                  onToggle={(v) => onOptsChange({ split: v })}
                />
              </div>
            </div>

            <div>
              {/* 入り切りと長さを 1 列に畳んである。切ったときに秒数のボタンだけが宙に浮かず、
                  選び直せば前の長さがそのまま戻る。列数の「自動」と同じ作りである。
                  ここだけ添え物の一行を許すのは、掛かる先も、秒数が何の長さなのかも、
                  数字の並びからは読み取れないためで、他の節と違って言わずには成立しない。 */}
              <h3 className={OPT_TITLE} id="opt-sweep">拾ったら消す</h3>
              {/* 右端が切であることは、そこまで送らないと判らない。一言だけ添えておく。 */}
              <p id="opt-sweep-note" className={`${LEDE} mb-2`}>
                おすすめ・フォロー中で、いいねかブックマークを付けた投稿を壁から外すまでの猶予。
                取り消せば残ります。右端まで送ると切。
              </p>
              <div className="flex items-center gap-3">
                {/* 小見出しだけでは「10秒」が何の 10 秒か伝わらないので、説明も名前に添える。
                    読み上げは既定では位置の数（31）を読むので、字と同じ語を aria-valuetext で被せる。
                    つまみの背丈を 32px にするのは、シートに並ぶ他の押せるものと揃えるため。 */}
                <input
                  type="range"
                  className="h-8 max-w-80 flex-1 cursor-pointer accent-accent"
                  min={1}
                  max={SWEEP_OFF}
                  step={1}
                  value={toPos(opts.sweep)}
                  aria-labelledby="opt-sweep"
                  aria-describedby="opt-sweep-note"
                  aria-valuetext={sweepLabel(opts.sweep)}
                  onChange={(e) => onOptsChange({ sweep: toSweep(Number(e.currentTarget.value)) })}
                />
                {/* 送るたびに桁が変わるので、等幅数字と固定幅で左右の揺れを止める。
                    読み上げには input 自身が同じ語を持っているので、こちらは目だけに出す。 */}
                <span className="w-10 shrink-0 text-sm text-fg-dim tabular-nums" aria-hidden="true">
                  {sweepLabel(opts.sweep)}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className={PANEL}>
            {/* 「cookie を貼る必要はない」は書かない。貼る欄がどこにも無いので、疑う人がいない。 */}
            <p className={LEDE}>ブラウザの x.com のセッションをそのまま使います。</p>

            {/*
              「あり／なし」の語は、色と 1 字の印に預ける。
              印は aria-hidden にし、代わりに同じ語を sr-only で置く。字を減らしても読み上げは変わらない。
              上書きの 2 行に色を振らないのは、0 件が異常ではないからである。ここを赤にすると
              既定値だけで正しく動いている状態が赤く見え、権限とログインの赤の意味まで薄まる。
            */}
            <div className="rounded-md border border-line bg-sunk p-3 font-mono text-xs whitespace-pre-wrap text-fg-dim">
              <div
                className={status?.granted ? 'text-repost' : 'text-danger'}
                title={status?.granted ? 'x.com への権限: あり' : 'x.com への権限: なし'}
              >
                権限 <span aria-hidden="true">{status?.granted ? '✓' : '—'}</span>
                <span className="sr-only">{status?.granted ? 'あり' : 'なし'}</span>
              </div>
              <div
                className={status?.loggedIn ? 'text-repost' : 'text-danger'}
                title={status?.loggedIn ? 'x.com のログイン: あり' : 'x.com のログイン: なし'}
              >
                ログイン <span aria-hidden="true">{status?.loggedIn ? '✓' : '—'}</span>
                <span className="sr-only">{status?.loggedIn ? 'あり' : 'なし'}</span>
              </div>
              <div>queryId の上書き {ops.length}</div>
              {/* queryId の値は目で照合するためのものなので、ここだけは省略しない。
                  fg-faint の 4.6:1 はページ地に対する値で、沈めた地の上では 4.26:1 まで落ちる。
                  この面に置く本文サイズの字は 1 段濃い fg-dim にする（この箱の既定色がそれ）。 */}
              {ops.map(([op, id]) => (
                <div key={op} className="pl-[1.2em]">
                  {op}: {id}
                </div>
              ))}
              <div>features の上書き {status?.featureCount ?? 0}</div>
            </div>

            <div className={ROW}>
              {status && !status.granted && (
                <button type="button" className="btn btn-primary" onClick={() => void handleGrant()} disabled={busy}>
                  権限を許可
                </button>
              )}
              {status && status.granted && !status.loggedIn && (
                <a
                  className="text-sm text-accent"
                  href="https://x.com/login"
                  target="_blank"
                  rel="noreferrer noopener"
                  title="x.com を開いてログイン"
                >
                  ログイン
                </a>
              )}
              {msg && <span className={msg.bad ? 'text-sm text-danger' : 'text-sm text-accent'}>{msg.text}</span>}
            </div>

            <details>
              <summary className="cursor-pointer text-sm text-fg-dim">queryId を手で入れる</summary>
              {/*
                自動で追いかける仕組みと、それが届かない条件の説明は落とした。
                この欄を開く人は自動で拾えなかったところに来ているので、経緯はもう分かっている。
                手順と、何を読み取るかの 2 点だけ残す。
              */}
              <p className={LEDE}>
                DevTools の <b>Network</b> で該当のリクエストを <b>Copy as cURL</b> して貼り付けてください。
                読み取るのは queryId と features だけです。
              </p>
              <label className="my-4 block">
                <span className="mb-1 block text-xs text-fg-dim">cURL を貼り付け</span>
                <textarea
                  className="w-full resize-y rounded-sm border border-line-input bg-sunk px-3 py-2 font-mono text-xs leading-normal"
                  rows={5}
                  value={curl}
                  onChange={(e) => setCurl(e.currentTarget.value)}
                  placeholder="curl 'https://x.com/i/api/graphql/xxxx/FavoriteTweet' ..."
                />
              </label>
              <div className={ROW}>
                <button type="button" className="btn" onClick={() => void handleCurl()} disabled={busy}>
                  取り込む
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  title="queryId と features の上書きを全部消す"
                  onClick={() => void handleClear()}
                  disabled={busy}
                >
                  消す
                </button>
              </div>
            </details>

            {/* レート制限と仕様変更の注意は落とした。非公開 API を使う以上いつでも当てはまる一般論で、
                画面に常時出しておく理由が無い。保存しないという約束のほうは、ここでしか言えない。 */}
            <p className="text-xs text-fg-faint">保存するのは queryId と features の上書きだけで、認証情報は保存しません。</p>
          </div>
        )}
      </div>
    </div>
  );
}
