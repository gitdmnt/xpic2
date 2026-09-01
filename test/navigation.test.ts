import { describe, expect, it } from 'bun:test';
import { findNeighbor, findTopLeftVisible } from '../src/app/components/MasonryGrid.tsx';

describe('findNeighbor', () => {
  const placements = [
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 112, y: 0, width: 100, height: 160 },
    { x: 0, y: 112, width: 100, height: 100 },
    { x: 112, y: 172, width: 100, height: 100 },
  ];
  const all = new Set([0, 1, 2, 3]);

  it('上下左右の近いタイルを選ぶ', () => {
    expect(findNeighbor(placements, 0, 'right', all)).toBe(1);
    expect(findNeighbor(placements, 0, 'down', all)).toBe(2);
    expect(findNeighbor(placements, 3, 'left', all)).toBe(2);
    expect(findNeighbor(placements, 3, 'up', all)).toBe(1);
  });

  it('利用できないタイルを飛ばす', () => {
    expect(findNeighbor(placements, 0, 'down', new Set([0, 3]))).toBe(3);
  });
});

describe('findTopLeftVisible', () => {
  const placements = [
    { x: 0, y: -120, width: 100, height: 100 },
    { x: 0, y: -50, width: 100, height: 100 },
    { x: 112, y: -50, width: 100, height: 100 },
    { x: 224, y: 10, width: 100, height: 100 },
    { x: 336, y: 220, width: 100, height: 100 },
    { x: 336, y: -120, width: 100, height: 200 },
  ];

  it('表示中の最上段から左端のタイルを選ぶ', () => {
    expect(findTopLeftVisible(placements, new Set([0, 1, 2, 3, 4, 5]), 0, 200)).toBe(1);
  });

  it('上端が切れていても画面内の上端と左端で選ぶ', () => {
    expect(findTopLeftVisible(placements, new Set([1, 2, 5]), 0, 200)).toBe(1);
  });

  it('利用できないタイルと画面外のタイルを除く', () => {
    expect(findTopLeftVisible(placements, new Set([0, 1, 3, 4]), 0, 200)).toBe(1);
    expect(findTopLeftVisible(placements, new Set([0, 4]), 0, 200)).toBe(-1);
  });
});
