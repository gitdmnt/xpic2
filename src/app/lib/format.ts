// 表示用の文字列整形。public/app.js の mediaUrl / compact / relTime をそのまま移植したもの。
// 副作用も外部依存も持たないので、テストからも UI からも素で呼べる。

/** pbs.twimg.com のサイズ付き URL に変換する。 */
export function mediaUrl(url: string, size: 'small' | 'medium' | 'large' | 'orig'): string {
  // 拡張子を format= に移し替えるのは、既定の変換先が jpg で png の透過が黒く潰れるため。
  // 元の拡張子を明示すればアルファが保たれる。
  const m = /^(.*)\.(jpg|jpeg|png|webp|gif)$/i.exec(url);
  if (m) return `${m[1]}?format=${m[2].toLowerCase()}&name=${size}`;
  // 拡張子が取れない URL（既にクエリ付きなど）はサイズ指定だけを足す。
  return `${url}${url.includes('?') ? '&' : '?'}name=${size}`;
}

/** いいね数などの大きな数を 12.3K / 4.2M に丸める。 */
export function compact(n: number): string {
  // 桁が増えたら小数を落とすのは、タイル下部のメタ行の幅を一定に保つため。
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(n);
}

/** ISO 日時を「3 時間前」形式にする。30 日以上前は相対表記が意味を失うので日付にする。 */
export function relTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return '数秒前';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 時間前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 日前`;
  return date.toLocaleDateString('ja-JP');
}
