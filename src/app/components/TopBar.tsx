// ヘッダ。取得元タブ・検索フォーム・設定ボタンを並べる表示専用コンポーネント。

import type { FormEvent, RefObject } from 'react';
import type { Source } from '../../shared/types.ts';

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

const TABS: ReadonlyArray<{ source: Source; label: string }> = [
  { source: 'user', label: 'ユーザー' },
  { source: 'search', label: '検索' },
  { source: 'bookmarks', label: 'ブックマーク' },
  { source: 'foryou', label: 'おすすめ' },
  { source: 'following', label: 'フォロー中' },
];

const PLACEHOLDER: Record<Source, string> = {
  user: '@screen_name',
  search: '検索語（例: 猫 filter:images min_faves:100）',
  bookmarks: '自分のブックマーク（入力不要）',
  foryou: 'おすすめタイムライン（入力不要）',
  following: 'フォロー中タイムライン（入力不要）',
};

/** ブックマークと 2 つのホームタイムラインは自分のものなので入力語を持たない。 */
function acceptsQuery(source: Source): boolean {
  return source === 'user' || source === 'search';
}

export function TopBar({
  source,
  onSourceChange,
  query,
  onQueryChange,
  onSubmit,
  onOpenSettings,
  queryInputRef,
}: TopBarProps) {
  const enabled = acceptsQuery(source);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    // ブラウザのページ遷移を止め、読み込みは App 側の責務に委ねる
    e.preventDefault();
    onSubmit();
  }

  return (
    <header className="bar">
      <div className="brand"><span className="logo"></span>xpic2</div>

      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.source}
            type="button"
            className={tab.source === source ? 'on' : ''}
            onClick={() => onSourceChange(tab.source)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <form className="query" onSubmit={handleSubmit}>
        <input
          ref={queryInputRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.currentTarget.value)}
          placeholder={PLACEHOLDER[source]}
          disabled={!enabled}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="primary">読み込む</button>
      </form>

      <button type="button" className="ghost" title="設定" onClick={onOpenSettings}>設定</button>
    </header>
  );
}
