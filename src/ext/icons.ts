// ツールバーとインストール画面に出すアイコンを、その場で描いて PNG にする。
//
// 画像をリポジトリに置かないのは、色を変えたときに描き直し忘れた差分が残らないようにするため。
// 図柄は masonry の列を 4 つの矩形で表している。画面のヘッダのロゴは藍鼠の四角 1 つで、こちらとは別物。
// 同じ図柄を index.html の favicon にも直書きしてあるので、色を変えるときは両方を揃える。

import { deflateSync } from 'node:zlib';

// 地だけは生成りに寄せず墨のまま残す。ブラウザのツールバーは明暗どちらもあり得るので、
// 明るい地にすると明色のツールバーの上でアイコンの輪郭が消える。
const BG: RGB = [0x2b, 0x28, 0x22];
const ACCENT: RGB = [0xf4, 0xf1, 0xe8]; // 生成り
const ACCENT2: RGB = [0x8f, 0xa3, 0xb8]; // 藍鼠。墨地の上で読めるよう画面の --accent より明度を上げてある

type RGB = [number, number, number];

/** 32 分率で書いた図柄。実サイズへは描画時に拡大する。 */
const TILES: Array<{ x: number; y: number; w: number; h: number; color: RGB }> = [
  { x: 6, y: 6, w: 8, h: 12, color: ACCENT },
  { x: 17, y: 6, w: 9, h: 8, color: ACCENT2 },
  { x: 6, y: 21, w: 8, h: 5, color: ACCENT2 },
  { x: 17, y: 17, w: 9, h: 9, color: ACCENT },
];

/** 角丸の内側かどうか。角の 4 分円だけ半径で判定すれば足りる。 */
function inside(px: number, py: number, x: number, y: number, w: number, h: number, r: number): boolean {
  if (px < x || py < y || px >= x + w || py >= y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/**
 * RGBA を描く。小さいサイズでも角が汚くならないよう 3x3 で重ね取りする。
 * 本格的なアンチエイリアスではないが、16px でも輪郭が保つ程度には効く。
 */
function render(size: number): Uint8Array {
  const s = size / 32;
  const px = new Uint8Array(size * size * 4);
  const sub = 3;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < sub; sy++) {
        for (let sx = 0; sx < sub; sx++) {
          const fx = (x + (sx + 0.5) / sub) / s;
          const fy = (y + (sy + 0.5) / sub) / s;
          let color: RGB | null = null;
          if (inside(fx, fy, 0, 0, 32, 32, 7)) {
            color = BG;
            for (const t of TILES) {
              if (inside(fx, fy, t.x, t.y, t.w, t.h, 2)) color = t.color;
            }
          }
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += 255;
          }
        }
      }
      const n = sub * sub;
      const i = (y * size + x) * 4;
      // 透明な部分の色を混ぜないよう、色は塗られた分だけで平均する。
      const covered = a / 255;
      px[i] = covered ? Math.round(r / covered) : 0;
      px[i + 1] = covered ? Math.round(g / covered) : 0;
      px[i + 2] = covered ? Math.round(b / covered) : 0;
      px[i + 3] = Math.round(a / n);
    }
  }
  return px;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  body.set(new TextEncoder().encode(type), 0);
  body.set(data, 4);

  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

/** 8bit RGBA・非インタレースの最小構成の PNG を書く。フィルタは全行 0（None）。 */
export function pngIcon(size: number): Uint8Array {
  const px = render(size);
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    raw.set(px.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

export const ICON_SIZES = [16, 32, 48, 128] as const;
