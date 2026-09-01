// queryId 上書きの入口の検証。
//
// 主な供給元は background.ts の観測（fromUrl）で、cURL の貼り付けはその控え。
// どちらも同じ URL 解析に落ちるので、ここでまとめて固定する。
// 落ちると「既定値が古びたときに自分で塞げる」という前提そのものが崩れる。

import { describe, expect, it } from 'bun:test';
import { fromUrl, parseCurl, parseFeatures } from '../src/x/flags.ts';

const URL_WITH_FEATURES =
  'https://x.com/i/api/graphql/QID123/UserMedia' +
  '?variables=%7B%22userId%22%3A%2244196397%22%7D' +
  '&features=%7B%22new_feature_enabled%22%3Atrue%2C%22old_flag%22%3Afalse%7D';

const CURL = `curl '${URL_WITH_FEATURES}' \\
  -H 'authorization: Bearer TESTTOKEN' \\
  -H 'x-client-transaction-id: SHOULD_NOT_PERSIST' \\
  -H 'cookie: guest_id=v1%3A1; auth_token=SHOULD_NOT_PERSIST; ct0=BBB'`;

describe('fromUrl', () => {
  it('queryId とオペレーション名を取り出す', () => {
    const { patch, opName } = fromUrl(new URL(URL_WITH_FEATURES));
    expect(opName).toBe('UserMedia');
    expect(patch.queryIds).toEqual({ UserMedia: 'QID123' });
  });

  it('features を JSON として復元する', () => {
    const { patch } = fromUrl(new URL(URL_WITH_FEATURES));
    expect(patch.features).toEqual({ new_feature_enabled: true, old_flag: false });
  });

  it('graphql でない URL からは何も取らない', () => {
    const { patch, opName } = fromUrl(new URL('https://x.com/home'));
    expect(opName).toBeNull();
    expect(patch.queryIds).toBeUndefined();
  });

  it('オペレーション名の無い URL も弾く', () => {
    const { opName } = fromUrl(new URL('https://x.com/i/api/graphql/QID123'));
    expect(opName).toBeNull();
  });
});

describe('parseCurl', () => {
  it('cURL 文字列から queryId と features を取り出す', () => {
    const { patch, opName } = parseCurl(CURL);
    expect(opName).toBe('UserMedia');
    expect(patch.queryIds).toEqual({ UserMedia: 'QID123' });
    expect(patch.features).toEqual({ new_feature_enabled: true, old_flag: false });
  });

  it('認証情報は取り込まない', () => {
    // cookie も bearer もブラウザのセッションに任せているので、貼り付けから拾う理由が無い。
    // 拾ってしまうと、保存する必要のない秘密を拡張機能が抱えることになる。
    const serialized = JSON.stringify(parseCurl(CURL));
    expect(serialized).not.toContain('SHOULD_NOT_PERSIST');
    expect(serialized).not.toContain('TESTTOKEN');
    expect(serialized).not.toContain('ct0');
  });

  it('二重引用符の URL も読む（Windows の Copy as cURL 対策）', () => {
    const { patch, opName } = parseCurl(`curl "https://x.com/i/api/graphql/Q9/Bookmarks" -H "accept: */*"`);
    expect(opName).toBe('Bookmarks');
    expect(patch.queryIds).toEqual({ Bookmarks: 'Q9' });
  });

  it('features が壊れていても queryId は活かす', () => {
    const { patch } = parseCurl(`curl 'https://x.com/i/api/graphql/QX/Likes?features=%7Bbroken'`);
    expect(patch.queryIds).toEqual({ Likes: 'QX' });
    expect(patch.features).toBeUndefined();
  });

  it('cURL でない入力でも例外を投げない', () => {
    expect(() => parseCurl('')).not.toThrow();
    expect(() => parseCurl('ただの文章です')).not.toThrow();
    expect(parseCurl('').patch.queryIds).toBeUndefined();
  });
});

describe('parseFeatures', () => {
  it('真偽値でない項目は捨てる', () => {
    expect(parseFeatures('{"a":true,"b":"yes","c":1,"d":false}')).toEqual({ a: true, d: false });
  });

  it('空・壊れた入力では null を返す', () => {
    expect(parseFeatures(null)).toBeNull();
    expect(parseFeatures('')).toBeNull();
    expect(parseFeatures('{broken')).toBeNull();
    expect(parseFeatures('[1,2]')).toBeNull();
    expect(parseFeatures('{"a":"x"}')).toBeNull();
  });
});
