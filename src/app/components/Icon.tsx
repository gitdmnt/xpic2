// Uicons（@flaticon/flaticon-uicons）の字体名をここに閉じ込める。使う側は意味の名前だけを書く。
// 別のアイコン集へ乗り換えるときに探す場所を 1 つで済ませるためなので、他所では字体名を書かない。
//
// 読み込むのは regular（線画）と solid（塗り）。solid を使うのは押した状態を塗りで示す
// ActionBar の 3 ボタンだけで、そこだけは字体名を直に書いている。

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
  share: 'fi-rr-share',
  check: 'fi-rr-check',
  display: 'fi-rr-layout-fluid',
  connection: 'fi-rr-plug',
  warning: 'fi-rr-triangle-warning',
};

/**
 * md（15px）に寄せるのが原則で、置き場所ごとに刻まない。lg（20px）は 2 つだけで、
 * ライトボックスの送り矢印は押す的の大きさが、ぼかしの上の印は判る大きさが要るため。
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
 * Uicons は擬似要素で字を出すので、中身の無い要素を 1 つ置く。行の高さを 1 に固定するのは、
 * 行の高さがアイコンの有無で変わるのを防ぐため。字体名の前に空白が要るのは、Uicons の
 * セレクタが `[class*=" fi-rr-"]` を見ているため。
 *
 * aria-hidden はグリフが読み上げでは意味のない記号にしかならないから。文字を伴わないボタンは
 * これで無名になるので、呼ぶ側が aria-label を付けること。
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
