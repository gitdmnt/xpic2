// x-client-transaction-id-generater（署名の生成元）が Node の Buffer を base64 の変換にだけ使う。
// buffer パッケージは数十 KB でその大半を使わないので、実際に来る 3 つの形だけを atob / btoa で埋める。
// 埋めていない使い方は例外にする。黙って別の値を返すと、署名が通らない理由を queryId の古さと
// 見分けられなくなる。

/** base64 の入出力だけを足した Uint8Array。 */
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

/** 既にあるなら本物なので触らない（Bun でのテスト実行がこれに当たる）。 */
export function installBufferShim(): void {
  const g = globalThis as { Buffer?: unknown };
  g.Buffer ??= bufferShim;
}
