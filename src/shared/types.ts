// 取得層（src/x）と画面（src/app）で共有する型。両者の契約はここが唯一の正。

export type MediaType = 'photo' | 'video' | 'animated_gif';

export interface Media {
  /** media_key。タイルの React key に使う。 */
  key: string;
  type: MediaType;
  /** pbs.twimg.com の元 URL（サイズ指定なし）。 */
  url: string;
  width: number;
  height: number;
  alt: string | null;
  /** video / animated_gif のときの mp4 URL。 */
  video?: string | null;
  durationMs?: number | null;
}

/**
 * ポストの作者。いまは Tweet 経由でしか触らないが、共有する型の定義はこの 1 ファイルに揃える。
 * @public
 */
export interface UserRef {
  name: string;
  screenName: string;
  avatar: string;
  verified: boolean;
}

export interface TweetStats {
  replies: number;
  retweets: number;
  likes: number;
  views: number;
  bookmarks: number;
}

/**
 * そのポストに対して自分が既に掛けた操作。X の legacy の favorited / retweeted / bookmarked。
 * 取得した時点の値なので、画面で押した結果はクライアント側が上書きして持つ。
 */
export interface TweetViewerState {
  liked: boolean;
  retweeted: boolean;
  bookmarked: boolean;
}

export interface Tweet {
  id: string;
  url: string;
  text: string;
  lang?: string;
  createdAt: string | null;
  sensitive: boolean;
  isRetweet: boolean;
  /** リポストされた場合のリポスト元。作者は常に元ポストの作者。 */
  retweetedBy: { name: string; screenName: string } | null;
  isReply: boolean;
  user: UserRef;
  stats: TweetStats;
  viewer: TweetViewerState;
  media: Media[];
}

export type Source = 'user' | 'search' | 'bookmarks' | 'foryou' | 'following';

export interface Filters {
  photos: boolean;
  videos: boolean;
  gifs: boolean;
  retweets: boolean;
  replies: boolean;
}

/** タイムライン 1 回分の取得結果。 */
export interface TimelineResponse {
  items: Tweet[];
  cursor: string | null;
  /** X へ投げた GraphQL リクエスト数（デバッグ用）。 */
  requests: number;
  /** フィルタ前に拾えたポスト数（デバッグ用）。 */
  raw: number;
}

/**
 * ポストへ掛けられる操作。TweetViewerState の各項目と 1 対 1 で対応する。
 * 画像単位ではなくポスト単位なのは、X 側の操作がポストにしか掛からないため。
 */
export type TweetAction = 'like' | 'retweet' | 'bookmark';

/** 操作 1 回分の指定。on が真なら実行、偽なら取り消し。 */
export interface ActionRequest {
  /** ポストの id。リポストされたものは元ポストの id を指す。 */
  id: string;
  action: TweetAction;
  on: boolean;
}

/** 画面の表示設定。localStorage に保存する。 */
export interface Options {
  /**
   * masonry の列数。0 は「自動」で、画面幅から詰め込める本数を決める。
   * 列「幅」ではなく列「数」を持つのは、同じ設定でも画面の広さで見え方が変わるのを避けるため。
   * 幅を指定すると、広い画面では列が増えて 1 枚が小さいまま、狭い画面では 1 列に潰れる。
   */
  columns: number;
  photos: boolean;
  videos: boolean;
  gifs: boolean;
  retweets: boolean;
  meta: boolean;
  blur: boolean;
  split: boolean;
  /**
   * 拾った投稿を壁から外すまでの秒数。0 は切。
   * 入り切りと長さを 1 つの数で持つのは、切っているあいだ秒数だけが宙に浮くのを避けるため。
   * 掛かるのはおすすめとフォロー中だけで、自分で並びを決めて開いた画面には掛からない。
   */
  sweep: number;
}

export const DEFAULT_OPTIONS: Options = {
  columns: 0,
  photos: true,
  videos: true,
  gifs: true,
  retweets: true,
  meta: true,
  blur: true,
  split: true,
  sweep: 10,
};
