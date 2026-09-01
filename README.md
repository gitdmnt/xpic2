# xpic2

X（Twitter）の内部 GraphQL API を叩き、画像付きのポストだけを masonry レイアウトで並べるローカル Web アプリです。

Bun + React + TypeScript で動きます。
ブラウザから直接 X の API を呼ぶと CORS と cookie の制約で失敗するため、Bun のローカルサーバが中継します。

## 起動

```bash
bun install && bun start
```

`http://127.0.0.1:5173` が開けるようになります。
ポートは `PORT=8080 bun start` のように変更できます。

開発中は `bun dev` を使うと、フロントエンドの変更がホットリロードされます。

## 接続設定

初回は認証情報が無いため、設定画面が自動で開きます。

1. x.com にログインしたブラウザで DevTools を開き、Network タブを表示します。
2. 誰かのプロフィールの「メディア」タブを開き、`i/api/graphql/…/UserMedia` のリクエストを探します。
3. そのリクエストを右クリックし、Copy → Copy as cURL を選びます。
4. xpic2 の設定画面のテキストエリアに貼り付け、保存します。

cURL からは cookie・bearer・queryId・features をまとめて読み取ります。

このうち queryId と features は「上書き指定」として保存されます。
既定値は twitter-openapi-typescript が x.com から取得するので、普段は cookie を入れるだけで動きます。
cURL を貼り直すのは、その既定値が古びて「queryId が古くなっています」と表示されたときです。
エラーに出た名前のリクエストを貼れば、そのエンドポイントの分だけが差し替わります。

cookie だけを直接貼る方法もあります。
その場合は `auth_token` と `ct0` の両方が必要です。

認証情報は `config.json`（パーミッション 600）にのみ保存され、外部へは送信されません。
`.gitignore` 済みです。

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

## 操作

- 列幅スライダで列数が変わります（コンテナ幅から自動で列数を決めます）。
- 画像 / 動画 / GIF / RT のチェックで取得対象を絞ります。切り替えると読み直します。
- 「複数画像を分割」を切ると、1 投稿を 1 タイルにまとめます。
- タイルをクリックで拡大表示、`←` `→` で移動、`Esc` で閉じます。
- `/` で検索欄にフォーカスします。
- 下端に近づくと自動で次のページを読み込みます。

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

取得元と同じく、これらも queryId のローテーションで 404 になることがあります。
エラーに出た名前のリクエストを x.com の DevTools で Copy as cURL して設定画面に貼れば、その分だけ差し替わります。

## 構成

X への取得は [twitter-openapi-typescript](https://www.npmjs.com/package/twitter-openapi-typescript) に任せています。
GraphQL のリクエスト組み立てとレスポンスの型付けはライブラリ側の仕事で、このリポジトリには持ちません。

```
server.ts                  Bun.serve のエントリ。HTML を import すると Bun が React を自動でバンドルする
src/shared/types.ts        クライアントとサーバが共有する型。API の契約はここが唯一の正
src/server/config.ts       設定の保存と cURL 解析。queryId / features の上書き指定を持つ
src/server/x-client.ts     ライブラリのクライアント生成と、queryId / features の上書き適用
src/server/x-api.ts        取得元ごとの呼び分けとページング
src/server/x-post.ts       いいね / リポスト / ブックマークの実行と取り消し
src/server/x-error.ts      ライブラリの例外を画面に出せる形へ写す。取得と操作で共有する
src/server/map.ts          ライブラリのモデルから Tweet / Media への変換とフィルタ
src/app/                   React の画面
test/                      bun test（x-client / map / x-post / cURL 解析）
```

設計上の要点は 4 つです。

**既定値はライブラリ、上書きだけこちらが持ちます。**
queryId と features の既定値は、ライブラリが実行時に取得する `placeholder.json` が唯一の出どころです。
このリポジトリに既定値の表はありません。
設定画面に貼られた cURL から取れた値だけが上書きとして `config.json` に載り、クライアント生成時に該当分を差し替えます（`src/server/x-client.ts`）。
上書きが 0 件なら、ライブラリの既定値がそのまま効きます。

**queryId は 2 か所に効きます。**
リクエスト URL のパスと、`x-client-transaction-id` の署名の両方が queryId から作られます。
片方だけ直すと署名がパスと食い違って弾かれるので、上書きは必ず両方へ書き込みます。

**操作だけはライブラリのユーティリティを迂回します。**
取得は `TweetApiUtils` に任せていますが、いいね等は生成 API を直接叩いています（`src/server/x-post.ts`）。
`PostApiUtils` はブックマークの作成と削除を持たず、生成 API を呼ぶときに `initOverrides` を渡さないため `x-client-transaction-id` が付きません。
どちらもこちら側からは塞げないので、リクエストの組み立てだけを引き受け、署名は同じ `initOverrides` から借りています。

**masonry の配置は画像の実寸から計算します。**
`originalInfo` の幅と高さを使うので、画像の読み込みを待たずに高さを確定でき、レイアウトのがたつきが起きません。
ただしライブラリの生成モデルは実行時検証をせず、X が値を落とせば `undefined` が流れてきます。
`Number.isFinite` で検証し、駄目なら `sizes` やアスペクト比で補います。

## 制約

- 非公開 API のため、queryId のローテーションで動かなくなることがあります。「queryId が古くなっています」と出たら、そのエンドポイントの cURL を貼り直して上書きしてください。
- レート制限があります。429 が返ったら待ち時間が画面に表示されます。
- 画像や動画を含むポストだけを扱います。メディアの無いポストは表示しません。
- リポストは元ポストとして扱い、リポストした人を添えて表示します。引用ポストの引用元の画像は取り込みません。
- いいね・リポスト・ブックマークは自分のアカウントに実際に反映されます。取り消しも同じ画面から行えます。
- 自分のアカウントで、自分が閲覧できる範囲を見るための道具です。X の利用規約はご自身で確認してください。
