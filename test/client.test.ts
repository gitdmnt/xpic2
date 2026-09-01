// リクエスト URL は flag.queryId、x-client-transaction-id の署名は flag['@path'] から
// 作られるため、両方が同時に、かつ矛盾なく書き換わることが要件になる。

import { describe, expect, it } from 'bun:test';
import type { TwitterOpenApiClient } from 'twitter-openapi-typescript';
import { applyOverrides } from '../src/x/client.ts';
import placeholder from './fixtures-placeholder.json' with { type: 'json' };

type Flag = Record<string, Record<string, unknown>>;

/** 実物の placeholder.json を毎回コピーして使う（テスト間で汚さない）。 */
function freshClient(): { flag: Flag } {
  return { flag: structuredClone(placeholder) as Flag };
}

const asClient = (c: { flag: Flag }) => c as unknown as TwitterOpenApiClient;

describe('applyOverrides', () => {
  it('queryId と @path の両方を書き換える', () => {
    const c = freshClient();
    const before = c.flag.UserMedia as { queryId: string; '@path': string };
    expect(before.queryId).toBe('9EovraBTXJYGSEQXZqlLmQ');
    expect(before['@path']).toContain('9EovraBTXJYGSEQXZqlLmQ');

    const applied = applyOverrides(asClient(c), { UserMedia: 'NEWQUERYID0000000000AA' }, {});

    const after = c.flag.UserMedia as { queryId: string; '@path': string };
    expect(applied.queryIds).toEqual(['UserMedia']);
    expect(after.queryId).toBe('NEWQUERYID0000000000AA');
    expect(after['@path']).toBe('/i/api/graphql/NEWQUERYID0000000000AA/UserMedia');
    // 署名とリクエスト URL が食い違わないこと
    expect(after['@path']).toContain(after.queryId);
    expect(after['@path']).not.toContain('9EovraBTXJYGSEQXZqlLmQ');
  });

  it('指定しなかったエンドポイントには触れない', () => {
    const c = freshClient();
    const bookmarksBefore = (c.flag.Bookmarks as { queryId: string }).queryId;
    applyOverrides(asClient(c), { UserMedia: 'NEWQUERYID0000000000AA' }, {});
    expect((c.flag.Bookmarks as { queryId: string }).queryId).toBe(bookmarksBefore);
  });

  it('存在しないエンドポイント名は黙って無視する', () => {
    const c = freshClient();
    const applied = applyOverrides(asClient(c), { NoSuchOperation: 'X' }, {});
    expect(applied.queryIds).toEqual([]);
  });

  it('既定値と同じ値なら書き換えたと報告しない', () => {
    const c = freshClient();
    const applied = applyOverrides(asClient(c), { UserMedia: '9EovraBTXJYGSEQXZqlLmQ' }, {});
    expect(applied.queryIds).toEqual([]);
  });

  it('5 つの取得元すべてを一度に上書きできる', () => {
    const c = freshClient();
    const ids = {
      UserMedia: 'AAAAAAAAAAAAAAAAAAAAAA',
      SearchTimeline: 'BBBBBBBBBBBBBBBBBBBBBB',
      Bookmarks: 'CCCCCCCCCCCCCCCCCCCCCC',
      HomeTimeline: 'DDDDDDDDDDDDDDDDDDDDDD',
      HomeLatestTimeline: 'EEEEEEEEEEEEEEEEEEEEEE',
    };
    const applied = applyOverrides(asClient(c), ids, {});
    expect(applied.queryIds.sort()).toEqual(Object.keys(ids).sort());
    for (const [op, id] of Object.entries(ids)) {
      const e = c.flag[op] as { queryId: string; '@path': string };
      expect(e.queryId).toBe(id);
      expect(e['@path']).toBe(`/i/api/graphql/${id}/${op}`);
    }
  });

  it('features は既存のキーだけ上書きし、未知の名前は足さない', () => {
    const c = freshClient();
    const f = (c.flag.UserMedia as { features: Record<string, unknown> }).features;
    const known = Object.keys(f)[0]!;
    const originalCount = Object.keys(f).length;

    const applied = applyOverrides(asClient(c), {}, { [known]: !f[known], not_a_real_feature: true });

    expect(applied.features).toEqual([known]);
    expect(Object.keys(f).length).toBe(originalCount);
    expect('not_a_real_feature' in f).toBe(false);
  });
});
