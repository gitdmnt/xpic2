// manifest を組み立てる。
//
// Chrome と Firefox で違うのは background の書き方と、Firefox が要求する拡張 ID だけである。
// JSON を 2 つ置くと大半が重複し、片方だけ直す事故が起きるので、差分だけをここに書く。

export type Target = 'chrome' | 'firefox';

/** ここに挙げた宛先だけへ届けば足りる。x.com が本体、GitHub は queryId の既定値の取得元。 */
const HOST_PERMISSIONS = [
  'https://x.com/*',
  'https://api.x.com/*',
  'https://raw.githubusercontent.com/*',
];

const ICONS = { '16': 'icons/16.png', '32': 'icons/32.png', '48': 'icons/48.png', '128': 'icons/128.png' };

export function manifest(target: Target, version: string): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: 'xpic2',
    version,
    description: 'X の画像付きポストだけを masonry で並べて眺めるビューア。',
    // cookies は x-csrf-token に使う ct0 を読むため、webRequest は queryId を観測するため。
    // downloads は原寸の保存、storage は queryId の上書きの保管に使う。
    // clipboardWrite は共有ボタンの URL コピー。押した瞬間の操作から呼ぶので本来は要らないが、
    // 利用者が押してから応答が返るまでの間に操作の有効期限が切れると拒否されるため、明示して塞ぐ。
    permissions: ['storage', 'cookies', 'downloads', 'webRequest', 'clipboardWrite'],
    host_permissions: HOST_PERMISSIONS,
    icons: ICONS,
    action: { default_title: 'xpic2 を開く', default_icon: ICONS },
    background:
      // Chrome の MV3 は service worker、Firefox は今のところ event page しか受け付けない。
      target === 'chrome' ? { service_worker: 'background.js' } : { scripts: ['background.js'] },
    ...(target === 'firefox'
      ? {
          browser_specific_settings: {
            // 署名や設定の保存先を決めるのに ID が要る。配布しないので固定値でよい。
            gecko: { id: 'xpic2@localhost', strict_min_version: '128.0' },
          },
        }
      : {}),
  };
}
