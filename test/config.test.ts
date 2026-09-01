// cURL 解析の検証。
//
// parseCurl は queryId 上書きの唯一の入口になった。
// ライブラリの placeholder.json が陳腐化したとき、ユーザーがそれを塞ぐ手段はここしかない。
// 落ちると「壊れたら自分で直せる」という設計上の前提そのものが崩れる。

import { describe, expect, it } from 'bun:test';
import { parseCurl } from '../src/server/config.ts';

const CURL = `curl 'https://x.com/i/api/graphql/QID123/UserMedia?variables=%7B%22userId%22%3A%2244196397%22%7D&features=%7B%22new_feature_enabled%22%3Atrue%2C%22old_flag%22%3Afalse%7D' \\
  -H 'authorization: Bearer TESTTOKEN' \\
  -H 'x-twitter-client-language: ja' \\
  -H 'x-client-transaction-id: SHOULD_NOT_PERSIST' \\
  -H 'cookie: guest_id=v1%3A1; auth_token=AAA; ct0=BBB' \\
  -H 'user-agent: Mozilla/5.0 (Test)'`;

describe('parseCurl', () => {
  it('URL から queryId とオペレーション名を取り出す', () => {
    const { patch, opName } = parseCurl(CURL);
    expect(opName).toBe('UserMedia');
    expect(patch.queryIds).toEqual({ UserMedia: 'QID123' });
  });

  it('cookie と bearer と user-agent を取り出す', () => {
    const { patch } = parseCurl(CURL);
    expect(patch.cookie).toBe('guest_id=v1%3A1; auth_token=AAA; ct0=BBB');
    expect(patch.bearer).toBe('Bearer TESTTOKEN');
    expect(patch.userAgent).toBe('Mozilla/5.0 (Test)');
  });

  it('features を JSON として復元する', () => {
    const { patch } = parseCurl(CURL);
    expect(patch.features).toEqual({ new_feature_enabled: true, old_flag: false });
  });

  it('x-client-transaction-id は保存しない', () => {
    // リクエスト毎に計算される値なので、貼り付けても次のリクエストでは通らない。
    // 保存すると古い署名を送り続けることになる。
    const parsed = parseCurl(CURL);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('SHOULD_NOT_PERSIST');
    expect(serialized).not.toContain('x-client-transaction-id');
  });

  it('-b / --cookie 形式の cookie も読む', () => {
    const { patch } = parseCurl(`curl 'https://x.com/i/api/graphql/Q/Likes' -b 'auth_token=X; ct0=Y'`);
    expect(patch.cookie).toBe('auth_token=X; ct0=Y');
  });

  it('二重引用符のヘッダも読む（Windows の Copy as cURL 対策）', () => {
    const { patch } = parseCurl(`curl "https://x.com/i/api/graphql/Q9/Bookmarks" -H "cookie: auth_token=A; ct0=B"`);
    expect(patch.cookie).toBe('auth_token=A; ct0=B');
    expect(patch.queryIds).toEqual({ Bookmarks: 'Q9' });
  });

  it('features が壊れていても他の抽出結果は活かす', () => {
    const { patch } = parseCurl(
      `curl 'https://x.com/i/api/graphql/QX/Likes?features=%7Bbroken' -H 'cookie: auth_token=A; ct0=B'`,
    );
    expect(patch.queryIds).toEqual({ Likes: 'QX' });
    expect(patch.cookie).toBe('auth_token=A; ct0=B');
  });

  it('cURL でない入力でも例外を投げない', () => {
    expect(() => parseCurl('')).not.toThrow();
    expect(() => parseCurl('ただの文章です')).not.toThrow();
    expect(parseCurl('').patch.queryIds).toBeUndefined();
  });

  it('graphql でない URL からは queryId を取らない', () => {
    const { patch, opName } = parseCurl(`curl 'https://x.com/home' -H 'cookie: auth_token=A; ct0=B'`);
    expect(opName).toBeNull();
    expect(patch.queryIds).toBeUndefined();
    expect(patch.cookie).toBe('auth_token=A; ct0=B');
  });
});
