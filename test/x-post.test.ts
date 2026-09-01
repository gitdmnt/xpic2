// 操作が叩く GraphQL オペレーション名の検証。
//
// 名前を間違えても型では気づけず、実行してはじめて 404 になる。
// 実物の placeholder.json（ライブラリが実行時に取ってくる既定値の表）に
// 6 つとも実在することだけを固定しておく。

import { describe, expect, it } from 'bun:test';
import { ACTION_ENDPOINTS } from '../src/server/x-post.ts';
import placeholder from './fixtures-placeholder.json' with { type: 'json' };

const flag = placeholder as Record<string, { queryId?: string } | undefined>;

describe('ACTION_ENDPOINTS', () => {
  it('実行と取り消しで 6 つのオペレーションを使う', () => {
    expect([...ACTION_ENDPOINTS].sort()).toEqual([
      'CreateBookmark',
      'CreateRetweet',
      'DeleteBookmark',
      'DeleteRetweet',
      'FavoriteTweet',
      'UnfavoriteTweet',
    ]);
  });

  it('どれも placeholder.json に queryId を持つ', () => {
    for (const name of ACTION_ENDPOINTS) {
      expect(typeof flag[name]?.queryId).toBe('string');
    }
  });
});
