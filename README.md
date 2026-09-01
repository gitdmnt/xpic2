# xpic2

X（Twitter）の画像付きポストだけを masonry で並べて眺めるブラウザ拡張機能です。

Chrome と Firefox で動きます。
X の内部 GraphQL API を叩きますが、認証はブラウザが持っている x.com のセッションをそのまま使うので、cookie を貼り付ける手順はありません。

## 導入

```bash
bun install && bun run build
```

`dist/` が拡張機能の本体になります。

Chrome と Edge では、`chrome://extensions` でデベロッパーモードを有効にし、「パッケージ化されていない拡張機能を読み込む」から `dist/` を選びます。

Firefox では `bun run build:firefox` で組み直してから、`about:debugging#/runtime/this-firefox` の「一時的なアドオンを読み込む」で `dist/manifest.json` を選びます。
一時的なアドオンは Firefox を終了すると消えます。
恒久的に入れるには署名が要ります。

ツールバーのアイコンを押すと、タブとして開きます。

## 開発中の組み直し

```bash
bun run watch
```

`src/` の保存を拾って `dist/` を組み直します。
反映はブラウザ側の再読み込みで行います。
画面だけを直したときは xpic2 のタブを再読み込みすれば足り、`src/ext/` と manifest を直したときは拡張機能そのものを再読み込みします（Chrome は `chrome://extensions` の再読み込みボタン、Firefox は `about:debugging` の「再読み込み」）。

保存しただけで自動的に反映される仕組みは入れていません。
それには拡張機能へ再読み込みを指示する常駐プロセスが要り、サーバを無くしたことがこの構成の出発点だからです。

## 使い方

x.com にログインしていれば、それだけで動きます。

Firefox の MV3 ではホスト権限が既定で保留されるため、初回は設定画面の「権限を許可」を押す必要があります。
Chrome では導入時に許可されます。

- 取得元のタブを選び、ユーザー名か検索語を入れて「読み込む」を押します。
- 列幅スライダで列数が変わります（コンテナ幅から自動で列数を決めます）。
- 画像 / 動画 / GIF / RT のチェックで取得対象を絞ります。切り替えると読み直します。
- 「複数画像を分割」を切ると、1 投稿を 1 タイルにまとめます。
- タイルをクリックで拡大表示、`←` `→` で移動、`Esc` で閉じます。
- `/` で検索欄にフォーカスします。
- 下端に近づくと自動で次のページを読み込みます。

## 取得元

| タブ | エンドポイント | 入力 |
| --- | --- | --- |
| ユーザー | `UserMedia` | `@screen_name` |
| 検索 | `SearchTimeline`（product: Media） | 検索語 |
| ブックマーク | `Bookmarks` | 不要 |
| おすすめ | `HomeTimeline` | 不要 |
| フォロー中 | `HomeLatestTimeline` | 不要 |

検索は X の検索構文がそのまま使えます。
`from:someone filter:images min_faves:500` のような絞り込みが有効です。

「おすすめ」と「フォロー中」は x.com のホームの 2 つのタブに対応します。
前者は X のアルゴリズム順、後者はフォローしている人の時系列順です。

## いいね・リポスト・ブックマーク

タイルにマウスを乗せると、左下にいいね・リポスト・ブックマークのボタンが出ます。
拡大表示では本文の下に並び、`l` `t` `b` のキーでも押せます。
すでに掛けてあるものは色が付き、タイルではホバーしていなくても見えたままになります。

対象はポストであって画像ではありません。
X 側の操作がポストにしか掛からないためで、1 投稿を複数タイルに分けて表示していても、どのタイルから押しても同じポストに掛かります。

押した時点で見た目と数値が変わり、X が受け付けなければ押す前の状態へ戻して画面下に理由を出します。

| 操作 | 実行 | 取り消し |
| --- | --- | --- |
| いいね | `FavoriteTweet` | `UnfavoriteTweet` |
| リポスト | `CreateRetweet` | `DeleteRetweet` |
| ブックマーク | `CreateBookmark` | `DeleteBookmark` |

## queryId の追従

X は GraphQL の queryId を随時ローテーションさせます。
表を同梱しても必ず古びるので、この拡張機能は本人の x.com のタブが実際に投げているリクエストを観測し、queryId と features をそのまま拾います（`src/ext/background.ts`）。
x.com を普通に使っているうちに追いつくので、普段は何もしなくて構いません。

拾えるのは、その操作を x.com 側で一度でも行った分だけです。
届かないエンドポイントで「queryId が古くなっています」と出たときは、設定画面の「queryId を手で差し替える」に、そのリクエストの Copy as cURL を貼ります。
読み取るのは queryId と features だけで、cookie や bearer は取り込みません。

## 構成

X への取得は [twitter-openapi-typescript](https://www.npmjs.com/package/twitter-openapi-typescript) に任せています。
GraphQL のリクエスト組み立てとレスポンスの型付けはライブラリ側の仕事で、このリポジトリには持ちません。

```
build.ts                   dist/ の組み立て。manifest とアイコンもここで作る
src/shared/types.ts        取得層と画面が共有する型。契約はここが唯一の正
src/ext/browser.ts         Chrome と Firefox の拡張 API の差を吸収する
src/ext/background.ts      x.com のリクエストを観測して queryId を拾う
src/ext/manifest.ts        manifest の組み立て。Chrome と Firefox の差分だけを持つ
src/ext/icons.ts           アイコンをその場で描いて PNG にする
src/ext/buffer.ts          署名生成が使う Node の Buffer の穴埋め
src/x/client.ts            クライアント生成、権限とログインの確認、queryId の上書き適用
src/x/flags.ts             queryId / features の上書きの保管と、URL・cURL の解析
src/x/timeline.ts          取得元ごとの呼び分けとページング
src/x/actions.ts           いいね / リポスト / ブックマークの実行と取り消し
src/x/error.ts             失敗を画面に出せる形へ写す。取得と操作で共有する
src/x/map.ts               ライブラリのモデルから Tweet / Media への変換とフィルタ
src/app/                   React の画面
test/                      bun test
```

設計上の要点は 5 つです。

**認証情報を持ちません。**
x.com へのリクエストにはブラウザが自分の cookie を載せます。
こちらが用意するのは `x-csrf-token` だけで、これは HttpOnly でない `ct0` から作ります（`src/x/client.ts`）。
`auth_token` は読みませんし、保存もしません。

**ライブラリの fetch を差し替えています。**
既定の fetch は credentials が same-origin なので、`chrome-extension://` のページから x.com を叩いても cookie が載りません。
`TwitterOpenApi.fetchApi` を置き換えて、x.com 宛のときだけ `credentials: 'include'` を足しています。
ライブラリはそのあと `cookie` ヘッダを自分で立てますが、これは禁止ヘッダ名なのでブラウザに落とされます。落とされて正しく、載るのはブラウザが持つ本物です。

**既定値はライブラリ、上書きだけこちらが持ちます。**
queryId と features の既定値は、ライブラリが実行時に取得する `placeholder.json` が唯一の出どころです。
このリポジトリに既定値の表はありません。
観測と cURL で得た値だけが上書きとして `storage.local` に載り、クライアント生成時に該当分を差し替えます。

**queryId は 2 か所に効きます。**
リクエスト URL のパスと、`x-client-transaction-id` の署名の両方が queryId から作られます。
片方だけ直すと署名がパスと食い違って弾かれるので、上書きは必ず両方へ書き込みます。

**masonry の配置は画像の実寸から計算します。**
`originalInfo` の幅と高さを使うので、画像の読み込みを待たずに高さを確定でき、レイアウトのがたつきが起きません。
ただしライブラリの生成モデルは実行時検証をせず、X が値を落とせば `undefined` が流れてきます。
`Number.isFinite` で検証し、駄目なら `sizes` やアスペクト比で補います。

## 権限

| 権限 | 用途 |
| --- | --- |
| `https://x.com/*` `https://api.x.com/*` | 取得と操作。cookie もこの権限があってはじめて載る |
| `https://raw.githubusercontent.com/*` | queryId と features の既定値、署名鍵の取得（ライブラリが行う） |
| `cookies` | `x-csrf-token` に使う `ct0` を読む |
| `webRequest` | x.com のリクエストを観測して queryId を拾う |
| `storage` | queryId / features の上書きの保管 |
| `downloads` | 原寸の保存 |

## 制約

- 非公開 API のため、queryId のローテーションで一時的に動かなくなることがあります。x.com を開いて該当の操作を行うか、cURL を貼ると塞げます。
- レート制限があります。429 が返ったら待ち時間が画面に表示されます。
- 画像や動画を含むポストだけを扱います。メディアの無いポストは表示しません。
- リポストは元ポストとして扱い、リポストした人を添えて表示します。引用ポストの引用元の画像は取り込みません。
- いいね・リポスト・ブックマークは自分のアカウントに実際に反映されます。取り消しも同じ画面から行えます。
- 自分のアカウントで、自分が閲覧できる範囲を見るための道具です。X の利用規約はご自身で確認してください。
