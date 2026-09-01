// Buffer の穴埋め。
//
// x-client-transaction-id-generater（署名の生成元）は Node の Buffer を base64 の変換だけに使う。
// ブラウザには Buffer が無いので、実際に使われている 3 つの形だけを atob / btoa で埋める。
// buffer パッケージを丸ごと持ち込むと数十 KB になり、その大半は使わない。
//
// 埋めていない使い方が来たら例外にする。黙って別の値を返すと、署名が通らない理由が
// 「queryId が古い」と見分けられなくなるため。

/** base64 の入出力だけを足した Uint8Array。subarray や Array.from はそのまま効く。 */
class Base64Bytes extends Uint8Array {
  override toString(encoding?: string): string {
    if (encoding !== 'base64') {
      throw new Error(`Buffer の穴埋めは base64 だけです（${String(encoding)} が要求されました）。`);
    }
    let binary = '';
    for (const byte of this) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
}

function from(input: string | ArrayLike<number>, encoding?: string): Base64Bytes {
  if (typeof input === 'string') {
    if (encoding !== 'base64') {
      throw new Error(`Buffer の穴埋めは base64 だけです（${String(encoding)} が要求されました）。`);
    }
    const binary = atob(input);
    const out = new Base64Bytes(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Base64Bytes(input);
}

export const bufferShim = { from };

/**
 * globalThis.Buffer が無ければ置く。
 * 既にあるなら本物なので触らない（Bun でのテスト実行がこれに当たる）。
 */
export function installBufferShim(): void {
  const g = globalThis as { Buffer?: unknown };
  g.Buffer ??= bufferShim;
}
