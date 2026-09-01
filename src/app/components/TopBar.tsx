import type { FormEvent, RefObject } from "react";
import type { Source } from "../../shared/types.ts";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./Icon.tsx";

export interface TopBarProps {
  source: Source;
  onSourceChange(s: Source): void;
  query: string;
  onQueryChange(q: string): void;
  onSubmit(): void;
  onOpenSettings(): void;
  /** `/` キーでフォーカスを当てるために App から渡される。 */
  queryInputRef?: RefObject<HTMLInputElement | null>;
}

// 入力の要らない取得元を先に置く。起動して何もしなくても見えるものが左端にある方が迷いが少ない。
const TABS: ReadonlyArray<{ source: Source; label: string; icon: IconName }> = [
  { source: "foryou", label: "おすすめ", icon: "foryou" },
  { source: "following", label: "フォロー中", icon: "following" },
  { source: "search", label: "検索", icon: "search" },
  { source: "bookmarks", label: "ブックマーク", icon: "bookmark" },
  { source: "user", label: "ユーザー", icon: "user" },
];

/** 語を打ち込む取得元。ブックマークと 2 つのホームタイムラインは自分のものなので語を持たない。 */
type QuerySource = "user" | "search";

function acceptsQuery(source: Source): source is QuerySource {
  return source === "user" || source === "search";
}

const PLACEHOLDER: Record<QuerySource, string> = {
  user: "@screen_name",
  search: "query",
};

// 入力欄の名前。placeholder は文字を打ち込んだ時点で消えるので、名前の出どころにはできない。
// 編集の途中で欄へ戻ったとき、入力値だけが読まれて何の欄か分からなくなる。
const FIELD_LABEL: Record<QuerySource, string> = {
  user: "ユーザー名",
  search: "検索クエリ",
};

export function TopBar({
  source,
  onSourceChange,
  query,
  onQueryChange,
  onSubmit,
  onOpenSettings,
  queryInputRef,
}: TopBarProps) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit();
  }

  return (
    // 唯一の吸着要素。高さは中身と折り返しで変わるので、他所からは高さを当てにしない。
    <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-veil px-4 py-2 backdrop-blur-md max-sm:gap-x-3 max-sm:px-3">
      <nav className="flex flex-wrap gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.source}
            type="button"
            // タブの見た目は設定モーダルと共有する。同じ役目のものに 2 つの流儀を作らない。
            // btn-icon の 32px 角も、ヘッダに並ぶ押せるものすべてで揃えてある。
            className={`btn btn-ghost btn-icon${tab.source === source ? " btn-on" : ""}`}
            // 押しボタンではなく現在地の表明なので aria-pressed ではなく aria-current を使う
            aria-current={tab.source === source ? "page" : undefined}
            // aria-label は読み上げ、title はマウスの担当。片方だけでは届かない相手が出る。
            aria-label={tab.label}
            title={tab.label}
            onClick={() => onSourceChange(tab.source)}
          >
            <Icon name={tab.icon} />
          </button>
        ))}
      </nav>

      {/* 欄は伸ばさず、余った幅は ml-auto に食わせて左右の束を離す。flex-1 にすると空いた幅を
          全部吸って空箱になる。狭い画面で下限を上げるのは、この束が入力欄と「読み込む」を
          抱えているため。下限が低いとボタンの幅だけが残り、入力欄が虫眼鏡だけの箱に潰れる。 */}
      <form
        className="ml-auto flex min-w-0 gap-2 max-[760px]:min-w-60"
        onSubmit={handleSubmit}
      >
        {/* 語を持たない取得元では欄ごと出さない。沈めて置くと、使えないのか空なのかが読めない。
            欄は右寄せの束の中にあるので、消えてもタブの位置は動かない。 */}
        {acceptsQuery(source) && (
          <div className="relative flex min-w-[140px] flex-[0_1_320px] items-center">
            {/* 虫眼鏡は飾りなので触れない。左の余白はアイコンの実幅から決めてある。 */}
            <Icon
              name="search"
              className="pointer-events-none absolute left-3 text-fg-faint"
            />
            {/* 上下の余白が 4px なのは、隣に並ぶアイコンの的（32px 角）と背丈を揃えるため。 */}
            <input
              ref={queryInputRef}
              type="search"
              className="w-full rounded-sm border border-line-input bg-elev py-1 pr-3 pl-9 placeholder:text-fg-faint"
              value={query}
              onChange={(e) => onQueryChange(e.currentTarget.value)}
              aria-label={FIELD_LABEL[source]}
              placeholder={PLACEHOLDER[source]}
              // 検索語の書き方は、字を出さずに済む tooltip へ移す。
              title={
                source === "search"
                  ? "例: 猫 filter:images min_faves:100"
                  : undefined
              }
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}
        <button
          type="submit"
          className="btn btn-ghost btn-icon"
          aria-label="読み込む"
          title="読み込む"
        >
          <Icon name="reload" />
        </button>
      </form>

      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label="設定"
        title="設定"
        onClick={onOpenSettings}
      >
        <Icon name="settings" />
      </button>
    </header>
  );
}
