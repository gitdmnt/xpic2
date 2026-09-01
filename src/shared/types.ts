// クライアントとサーバで共有する型。API の契約はここが唯一の正。

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

/** GET /api/timeline のレスポンス。 */
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

/** POST /api/action のリクエスト。on が真なら実行、偽なら取り消し。 */
export interface ActionRequest {
  /** ポストの id。リポストされたものは元ポストの id を指す。 */
  id: string;
  action: TweetAction;
  on: boolean;
}

/** POST /api/action のレスポンス。要求どおりに落ち着いた状態をそのまま返す。 */
export interface ActionResponse {
  ok: true;
  id: string;
  action: TweetAction;
  on: boolean;
}

/** エラー時の共通ボディ。 */
export interface ApiErrorBody {
  error: string;
  hint: string | null;
}

/** GET /api/config のレスポンス。認証情報そのものは含めない。 */
export interface ConfigStatus {
  configured: boolean;
  cookieKeys: string[];
  cookieLength: number;
  bearerCustom: boolean;
  queryIds: Record<string, string>;
  featureCount: number;
  extraHeaderKeys: string[];
  file: string;
}

/** POST /api/config のリクエスト。 */
export interface ConfigPatchRequest {
  curl?: string;
  cookie?: string;
  bearer?: string;
  queryIds?: Record<string, string>;
}

export interface ConfigSaveResponse {
  ok: true;
  note: string | null;
  status: ConfigStatus;
}

/** 画面の表示設定。localStorage に保存する。 */
export interface Options {
  colWidth: number;
  photos: boolean;
  videos: boolean;
  gifs: boolean;
  retweets: boolean;
  meta: boolean;
  blur: boolean;
  split: boolean;
}

export const DEFAULT_OPTIONS: Options = {
  colWidth: 290,
  photos: true,
  videos: true,
  gifs: true,
  retweets: true,
  meta: true,
  blur: true,
  split: true,
};
