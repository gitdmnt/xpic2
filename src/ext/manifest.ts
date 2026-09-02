// JSON を 2 つ置くと大半が重複し、片方だけ直す事故が起きるので、target ごとの差分だけをここに書く。

export type Target = 'chrome' | 'firefox';

/** x.com が本体、GitHub は queryId の既定値の取得元。 */
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
    // cookies は x-csrf-token の ct0、webRequest は queryId の観測、downloads は原寸の保存、
    // storage は queryId の上書きの保管。clipboardWrite は、押してから応答が返るまでに
    // 操作の有効期限が切れるとコピーが拒否されるため明示する。
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
            // 署名や設定の保存先を決めるID。公開後の更新でも変えない。
            gecko: {
              id: '@xpic2-gitdmnt',
              // Firefox の組み込み同意画面をデスクトップ・Androidとも使える版から対象にする。
              strict_min_version: '142.0',
              // X の投稿・応答・セッション情報・検索語・ユーザー操作を、主機能のためXへ送受信する。
              data_collection_permissions: {
                required: ['personalCommunications', 'websiteContent', 'searchTerms', 'websiteActivity'],
              },
            },
          },
        }
      : {}),
  };
}
