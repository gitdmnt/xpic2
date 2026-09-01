// 署名（x-client-transaction-id）の生成がここを通る。値がずれると X に弾かれるが、
// エラーは「queryId が古い」と見分けが付かない形で出るため、ここで本物と突き合わせておく。

import { describe, expect, it } from 'bun:test';
import { bufferShim } from '../src/ext/buffer.ts';

describe('bufferShim', () => {
  it('base64 の復号が Node の Buffer と一致する', () => {
    for (const s of ['', 'AA==', 'aGVsbG8=', 'w4TDlsOc', Buffer.from([0, 1, 127, 128, 255]).toString('base64')]) {
      expect(Array.from(bufferShim.from(s, 'base64'))).toEqual(Array.from(Buffer.from(s, 'base64')));
    }
  });

  it('base64 の符号化が Node の Buffer と一致する', () => {
    for (const bytes of [[], [0], [0, 1, 127, 128, 255], Array.from({ length: 69 }, (_, i) => (i * 7) % 256)]) {
      const data = new Uint8Array(bytes);
      expect(bufferShim.from(data).toString('base64')).toBe(Buffer.from(data).toString('base64'));
    }
  });

  it('subarray してもバイト列として扱える', () => {
    const b = bufferShim.from('aGVsbG8=', 'base64');
    expect(b[0]).toBe('h'.charCodeAt(0));
    expect(Array.from(b.subarray(1))).toEqual(Array.from(Buffer.from('ello')));
  });

  it('base64 以外を求められたら例外にする', () => {
    // 黙って別の値を返すと、署名が通らない理由を追えなくなる。
    expect(() => bufferShim.from('aa', 'hex')).toThrow();
    expect(() => bufferShim.from(new Uint8Array([1])).toString('hex')).toThrow();
  });
});
