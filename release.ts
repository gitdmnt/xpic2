// 配布用の zip を 2 つ作る。拡張機能そのものと、審査へ出す原文。
// AMO は縮めたコードを載せた拡張機能に原文の同梱を求めるので、この 2 つは必ず対で作る。
//
// バージョンの出どころは package.json ひとつだけ。ここで書き換えてから組むので、
// manifest.json と zip のファイル名は必ず揃う（build.ts は別プロセスで読み直す）。
//
// 組むのは Firefox 向けだけ。Chrome へは読み込ませるだけで済み、zip に詰める理由が無い。

import { rm, mkdir } from 'node:fs/promises';
import { $ } from 'bun';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('使い方: bun run release <version>   例: bun run release 1.1.0');
  process.exit(1);
}

const pkgPath = 'package.json';
const pkgText = await Bun.file(pkgPath).text();
if (!/"version":\s*"[^"]*"/.test(pkgText)) {
  console.error(`${pkgPath} に version がありません。`);
  process.exit(1);
}
// 行ごと差し替える。JSON へ起こして書き戻すと、鍵の並びや余白がこちらの都合で動く。
await Bun.write(pkgPath, pkgText.replace(/("version":\s*)"[^"]*"/, `$1"${version}"`));

// 縮めたコードを配ってしまう前に、型と試験を通す。ここで落ちれば zip は作られない。
await $`bun run typecheck`;
await $`bun test`;
await $`bun build.ts --firefox`;

await mkdir('release', { recursive: true });
const ext = `release/xpic2-${version}-firefox.zip`;
const src = `release/xpic2-${version}-source.zip`;
// zip は既にある書庫へ足し込むので、作り直す前に落とす。
await rm(ext, { force: true });
await rm(src, { force: true });

// 中身を書庫の根に置く。dist/ の階層ごと詰めると、Firefox が manifest.json を見つけられない。
await $`zip -r -X -q ../${ext} .`.cwd('dist');

// 原文は git が追っているものだけを詰める。node_modules も dist も release も外れ、
// config.json のような手元の設定は .gitignore が弾く。
// 作業ツリーの側を詰めるので、コミット前の変更もそのまま入る（組んだ dist と中身が揃う）。
const files = (await $`git ls-files`.text()).split('\n').filter(Boolean);
await $`zip -X -q ${src} ${files}`;

const mb = (path: string) => `${(Bun.file(path).size / 1024 / 1024).toFixed(1)} MB`;
console.log(`${version} を作りました。`);
console.log(`  ${ext} (${mb(ext)})`);
console.log(`  ${src} (${mb(src)})`);
