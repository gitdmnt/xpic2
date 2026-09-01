// アイコン。Flaticon の Uicons（@flaticon/flaticon-uicons）を字体名ごとここに閉じ込める。
//
// 使う側は意味の名前だけを書く。`fi-rr-…` という字体名がこのファイルの外に漏れないので、
// 別のアイコン集へ乗り換えるときも、探す場所はこの表 1 つで済む。
// 逆に言うと、クラス名を直に書いた瞬間にその保証が消えるので、他所では書かない。
//
// 読み込むのは regular（線画）だけで、solid（塗り）は入れていない。
// 字体を 1 つに絞ると線の太さが揃い、拡張機能に同梱する font も 1 セットで済む。
// 押した状態を塗りで示す 3 ボタン（いいね・リポスト・ブックマーク）は、
// 塗りと線を 1 つの図形で切り替えられる手書きの SVG を ActionBar が持っている。

/** 画面で使うアイコンの意味。字体名との対応は下の表が持つ。 */
export type IconName =
  | 'foryou'
  | 'following'
  | 'search'
  | 'bookmark'
  | 'user'
  | 'reload'
  | 'settings'
  | 'close'
  | 'prev'
  | 'next'
  | 'download'
  | 'external'
  | 'expand'
  | 'views'
  | 'hidden'
  | 'play'
  | 'gif'
  | 'share'
  | 'check'
  | 'display'
  | 'connection'
  | 'warning';

/** 意味 → Uicons の字体名。 */
const GLYPH: Record<IconName, string> = {
  foryou: 'fi-rr-sparkles',
  following: 'fi-rr-users',
  search: 'fi-rr-search',
  bookmark: 'fi-rr-bookmark',
  user: 'fi-rr-user',
  reload: 'fi-rr-refresh',
  settings: 'fi-rr-settings-sliders',
  close: 'fi-rr-cross-small',
  prev: 'fi-rr-angle-left',
  next: 'fi-rr-angle-right',
  download: 'fi-rr-download',
  external: 'fi-rr-arrow-up-right-from-square',
  expand: 'fi-rr-expand',
  views: 'fi-rr-eye',
  // センシティブの印。views の目に斜線を引いた字なので、隣に置いて対だと分かるようにする。
  hidden: 'fi-rr-eye-crossed',
  play: 'fi-rr-play',
  gif: 'fi-rr-gif',
  // 共有ボタン。図は共有の記号だが、やることは URL のコピーだけ（呼ぶ側が名前でそう言う）。
  share: 'fi-rr-share',
  // コピーが通ったときの合図。文字を出さずにこの図へ挿げ替えるだけで済ませる。
  check: 'fi-rr-check',
  display: 'fi-rr-layout-fluid',
  connection: 'fi-rr-plug',
  warning: 'fi-rr-triangle-warning',
};

/**
 * 大きさ。md（15px）に寄せるのが原則で、置き場所ごとに刻まない。同じ行に別寸のアイコンが並ぶ。
 * lg（20px）は 2 つだけ。ライトボックスの送り矢印は押す的の大きさが要り、
 * ぼかしの上の印はぼけた写真の上で判る大きさが要る。
 */
type IconSize = 'md' | 'lg';

const SIZE: Record<IconSize, string> = { md: 'text-icon', lg: 'text-icon-lg' };

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /**
   * 位置と色を変えたいときだけ。大きさは size で指定する。
   * font-size のクラスを 2 つ重ねると、どちらが勝つかは並び順ではなく生成された CSS の順で決まる。
   */
  className?: string;
}

/**
 * Uicons は擬似要素で字を出すので、中身の無い要素を 1 つ置く。
 *
 * 行の高さを 1 に固定するのは、行の高さがアイコンの有無で変わるのを防ぐため。
 * 字体名の前に必ず空白を置くのは、Uicons のセレクタが `[class*=" fi-rr-"]` を見ているため。
 *
 * aria-hidden を必ず付けるのは、字体のグリフが読み上げでは意味のない記号にしかならないため。
 * 文字を伴わないボタンは、これで無名になる。呼ぶ側が aria-label を付けること。
 */
export function Icon({ name, size = 'md', className }: IconProps) {
  return (
    <i
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center leading-none not-italic ${SIZE[size]}${
        className ? ` ${className}` : ''
      } ${GLYPH[name]}`}
    />
  );
}
