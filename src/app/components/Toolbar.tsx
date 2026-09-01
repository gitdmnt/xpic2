// 表示設定のツールバー。列幅スライダ・各チェックボックス・件数表示。

import type { Options } from '../../shared/types.ts';

export interface ToolbarProps {
  opts: Options;
  /** 変更のあった項目だけを渡す。保存とレイアウト反映は App の責務。 */
  onChange(patch: Partial<Options>): void;
  mediaCount: number;
  tweetCount: number;
}

interface CheckProps {
  label: string;
  checked: boolean;
  onToggle(value: boolean): void;
}

/** キーを動的に組み立てると Partial<Options> への代入で型が緩むので、呼び出し側で項目名を書く。 */
function Check({ label, checked, onToggle }: CheckProps) {
  return (
    <label className="chk">
      <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.currentTarget.checked)} /> {label}
    </label>
  );
}

export function Toolbar({ opts, onChange, mediaCount, tweetCount }: ToolbarProps) {
  return (
    <div className="toolbar">
      <label className="ctl">
        列幅
        <input
          type="range"
          min={140}
          max={560}
          step={10}
          value={opts.colWidth}
          onChange={(e) => onChange({ colWidth: Number(e.currentTarget.value) })}
        />
        <output>{opts.colWidth}</output>
      </label>

      <span className="sep"></span>

      <Check label="画像" checked={opts.photos} onToggle={(v) => onChange({ photos: v })} />
      <Check label="動画" checked={opts.videos} onToggle={(v) => onChange({ videos: v })} />
      <Check label="GIF" checked={opts.gifs} onToggle={(v) => onChange({ gifs: v })} />
      <Check label="RT" checked={opts.retweets} onToggle={(v) => onChange({ retweets: v })} />

      <span className="sep"></span>

      <Check label="情報を表示" checked={opts.meta} onToggle={(v) => onChange({ meta: v })} />
      <Check label="センシティブをぼかす" checked={opts.blur} onToggle={(v) => onChange({ blur: v })} />
      <Check label="複数画像を分割" checked={opts.split} onToggle={(v) => onChange({ split: v })} />

      <span className="grow"></span>

      {/* 0 枚のときは何も出さない（初期表示で「0 枚 / 0 投稿」が出るのを避ける） */}
      <span className="counter">{mediaCount ? `${mediaCount} 枚 / ${tweetCount} 投稿` : ''}</span>
    </div>
  );
}
