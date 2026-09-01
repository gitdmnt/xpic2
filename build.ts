// 画面は index.html を入口にして Bun に任せる。相対 import をたどって資産をまとめてくれるので、
// 並べる一覧をこちらで持たなくてよい。styles.css は bun-plugin-tailwind が横取りして Tailwind を
// 通し、拾うクラスも同じバンドルが辿った tsx から集まる。
// background だけは別に組む。MV3 の service worker と Firefox の event page はどちらも
// 単体のファイルとして読まれるので、import を残さない iife にする。

import { watch } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import tailwind from 'bun-plugin-tailwind';
import { ICON_SIZES, pngIcon } from './src/ext/icons.ts';
import { manifest, type Target } from './src/ext/manifest.ts';
import pkg from './package.json' with { type: 'json' };

const target: Target = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
const watching = process.argv.includes('--watch');
const outdir = 'dist';

async function build(): Promise<boolean> {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(`${outdir}/icons`, { recursive: true });

  const page = await Bun.build({
    entrypoints: ['src/app/index.html'],
    outdir,
    target: 'browser',
    plugins: [tailwind],
    minify: true,
    // MV3 のページは既定の CSP が script-src 'self' なので、インライン化された断片は読み込めない。
    // 資産は必ず別ファイルとして吐かせる。
    sourcemap: 'none',
  });
  if (!page.success) {
    console.error(page.logs.join('\n'));
    return false;
  }

  const background = await Bun.build({
    entrypoints: ['src/ext/background.ts'],
    outdir,
    target: 'browser',
    format: 'iife',
    minify: true,
    naming: '[dir]/background.[ext]',
    sourcemap: 'none',
  });
  if (!background.success) {
    console.error(background.logs.join('\n'));
    return false;
  }

  await writeFile(`${outdir}/manifest.json`, `${JSON.stringify(manifest(target, pkg.version), null, 2)}\n`);
  for (const size of ICON_SIZES) {
    await writeFile(`${outdir}/icons/${size}.png`, pngIcon(size));
  }
  return true;
}

const ok = await build();
if (!ok && !watching) process.exit(1);

console.log(`${target} 向けに ${outdir}/ を作りました。`);
console.log(
  target === 'chrome'
    ? 'chrome://extensions でデベロッパーモードを入れ、「パッケージ化されていない拡張機能を読み込む」から dist/ を選んでください。'
    : 'about:debugging#/runtime/this-firefox の「一時的なアドオンを読み込む」から dist/manifest.json を選んでください。',
);

if (watching) {
  // 組み直すだけで、反映はブラウザ側の再読み込みに任せる。自動で反映させるには開発用のサーバを
  // 常駐させることになり、それを無くしたのが拡張機能にした理由なので、ここでは踏み込まない。
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch('src', { recursive: true }, () => {
    clearTimeout(timer);
    // エディタは 1 回の保存で複数のイベントを出すので、少し待ってからまとめて組む。
    timer = setTimeout(() => {
      void build().then((done) => {
        console.log(done ? `組み直しました (${new Date().toLocaleTimeString('ja-JP')})` : '組み直しに失敗しました。');
      });
    }, 80);
  });
  console.log('src/ を監視しています。終了は Ctrl-C。');
}
