// ヘッダ。取得元タブ・検索フォーム・件数・設定ボタンを並べる表示専用コンポーネント。

import type { FormEvent, RefObject } from 'react';
import type { Source } from '../../shared/types.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';

export interface TopBarProps {
  source: Source;
  onSourceChange(s: Source): void;
  query: string;
  onQueryChange(q: string): void;
  onSubmit(): void;
  onOpenSettings(): void;
  mediaCount: number;
  tweetCount: number;
  /** `/` キーでフォーカスを当てるために App から渡される。 */
  queryInputRef?: RefObject<HTMLInputElement | null>;
}

// 入力の要らない自分向けのタイムラインを先に置き、語を打ち込む取得元を後ろにまとめる。
// 起動して何もしなくても見えるものが左端にある方が、初回の迷いが少ない。
const TABS: ReadonlyArray<{ source: Source; label: string; icon: IconName }> = [
  { source: 'foryou', label: 'おすすめ', icon: 'foryou' },
  { source: 'following', label: 'フォロー中', icon: 'following' },
  { source: 'search', label: '検索', icon: 'search' },
  { source: 'bookmarks', label: 'ブックマーク', icon: 'bookmark' },
  { source: 'user', label: 'ユーザー', icon: 'user' },
];

/** 語を打ち込む取得元。ブックマークと 2 つのホームタイムラインは自分のものなので語を持たない。 */
type QuerySource = 'user' | 'search';

// 戻り値を型で語らせているので、呼んだ側では source がこの 2 つに絞られる。
// 下の 2 つの表を全 Source ぶん持たなくて済むのはそのおかげで、
// 使われない行（「この取得元では使いません」のような穴埋め）が生まれない。
function acceptsQuery(source: Source): source is QuerySource {
  return source === 'user' || source === 'search';
}

const PLACEHOLDER: Record<QuerySource, string> = {
  user: '@screen_name',
  search: '検索語',
};

// 入力欄の名前。placeholder は文字を打ち込んだ時点で消えるので、名前の出どころにはできない。
// 編集の途中で欄へ戻ったとき、入力値だけが読まれて何の欄か分からなくなる。
const FIELD_LABEL: Record<QuerySource, string> = {
  user: 'ユーザー名',
  search: '検索語',
};

export function TopBar({
  source,
  onSourceChange,
  query,
  onQueryChange,
  onSubmit,
  onOpenSettings,
  mediaCount,
  tweetCount,
  queryInputRef,
}: TopBarProps) {
  // 件数から語を落とした分は title で補う。桁区切りは数字と語の両方で使うので一度だけ作る。
  const mediaText = mediaCount.toLocaleString('ja-JP');
  const tweetText = tweetCount.toLocaleString('ja-JP');

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    // ブラウザのページ遷移を止め、読み込みは App 側の責務に委ねる
    e.preventDefault();
    onSubmit();
  }

  return (
    // 唯一の吸着要素。高さは中身と折り返しで変わるので、他所からは高さを当てにしない。
    <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-veil px-4 py-2 backdrop-blur-md max-sm:gap-x-3 max-sm:px-3">
      {/* 名前は四角に託し、字は読み上げと tooltip に残す。器は中身が 1 つになったので外した。
          12px では点に見えるので 16px。shrink-0 は、ヘッダが詰まったとき
          唯一の中身が無い要素であるここが真っ先に潰れるのを止めるため。 */}
      <span className="size-4 shrink-0 rounded-sm bg-accent" role="img" aria-label="xpic2" title="xpic2" />

      <nav className="flex flex-wrap gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.source}
            type="button"
            // タブの見た目はヘッダと設定モーダルで共有する。同じ役目のものに 2 つの流儀を作らない。
            // 字を落としてアイコン 1 つになったので、正方形の的にする。btn-icon の 32px 角は
            // 設定ボタンや「読み込む」と同じで、ヘッダに並ぶ押せるものの寸法がこれ 1 つで済む。
            className={`btn btn-ghost btn-icon${tab.source === source ? ' btn-on' : ''}`}
            // 押しボタンではなく現在地の表明なので aria-pressed ではなく aria-current を使う
            aria-current={tab.source === source ? 'page' : undefined}
            // 字を落としたので、表の label がそのままボタンの名前になる。両方に配るのは
            // aria-label が読み上げ、title がマウスの担当で、どちらか片方では届かない相手が出るため。
            aria-label={tab.label}
            title={tab.label}
            onClick={() => onSourceChange(tab.source)}
          >
            <Icon name={tab.icon} />
          </button>
        ))}
      </nav>

      {/* 字を落としたヘッダでは、伸びてよい要素はこの欄だけになる。flex-1 のままだと
          空いた幅を全部吸って 1000px 近い空箱になり、生成りの余白が消える。
          だから欄は伸ばさず、余った幅は ml-auto に食わせて左右の束を離す。
          狭い画面で下限を上げるのは、この束が「入力欄 + 読み込む」の 2 つを抱えているため。
          下限が低いとボタンの幅だけが残り、入力欄が虫眼鏡だけの箱に潰れる。
          下限に達したこの束は折り返して次の段を丸ごと使うので、ヘッダが 2 段でも 3 段でも成り立つ。 */}
      <form className="ml-auto flex min-w-0 gap-2 max-[760px]:min-w-60" onSubmit={handleSubmit}>
        {/* 語を持たない取得元では欄ごと出さない。placeholder から「入力不要」を落とした結果、
            沈めて置いておくと「ただの空箱」になり、使えないのか空なのかが読み取れなくなる。
            欄は右寄せの束の中にあるので、消えてもタブの位置は動かない。 */}
        {acceptsQuery(source) && (
          <div className="relative flex min-w-[140px] flex-[0_1_320px] items-center">
            {/* 虫眼鏡は飾りなので触れない。左の余白はアイコンの実幅から決めてある。 */}
            <Icon name="search" className="pointer-events-none absolute left-3 text-fg-faint" />
            {/* 上下の余白が 4px なのは、隣に並ぶアイコンの的（32px 角）と背丈を揃えるため。
                ここだけ 40px あると、字が消えて低くなったヘッダの中で入力欄だけが浮く。 */}
            <input
              ref={queryInputRef}
              type="search"
              className="w-full rounded-sm border border-line-input bg-elev py-1 pr-3 pl-9 placeholder:text-fg-faint"
              value={query}
              onChange={(e) => onQueryChange(e.currentTarget.value)}
              aria-label={FIELD_LABEL[source]}
              placeholder={PLACEHOLDER[source]}
              // placeholder から外した検索語の書き方は、字を出さずに済む tooltip へ移す
              title={source === 'search' ? '例: 猫 filter:images min_faves:100' : undefined}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-icon" aria-label="読み込む" title="読み込む">
          <Icon name="reload" />
        </button>
      </form>

      {/* 0 枚のときは何も出さない（初期表示で「0 / 0」が出るのを避ける）。
          数字だけでは何の数か分からないので、単位は title に置く */}
      <span
        className="text-sm text-fg-dim tabular-nums"
        title={mediaCount ? `画像 ${mediaText} 枚 / ${tweetText} 投稿` : undefined}
      >
        {mediaCount ? `${mediaText} / ${tweetText}` : ''}
      </span>

      {/* Icon は aria-hidden なので、文字を落としたこのボタンは aria-label が無いと無名になる */}
      <button type="button" className="btn btn-ghost btn-icon" aria-label="設定" title="設定" onClick={onOpenSettings}>
        <Icon name="settings" />
      </button>
    </header>
  );
}
