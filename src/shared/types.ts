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
 * Tweet 経由でしか触らないが、共有する型の定義はこの 1 ファイルに揃える。
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

/** on が真なら実行、偽なら取り消し。 */
export interface ActionRequest {
  /** ポストの id。リポストされたものは元ポストの id を指す。 */
  id: string;
  action: TweetAction;
  on: boolean;
}

/** 画面の表示設定。localStorage に保存する。 */
export interface Options {
  /**
   * 0 は「自動」で、画面幅から詰め込める本数を決める。
   * 幅ではなく数を持つのは、幅で指定すると広い画面では列が増えて 1 枚が小さいまま、
   * 狭い画面では 1 列に潰れるため。
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
   * 拾った投稿を、スクロールで画面の外へ出たときに壁から外すか。
   * 掛かるのはおすすめとフォロー中だけで、自分で並びを決めて開いた画面には掛からない。
   */
  sweep: boolean;
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
  sweep: true,
};
