import { describe, expect, it } from 'bun:test';
import { findNeighbor } from '../src/app/components/MasonryGrid.tsx';

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
