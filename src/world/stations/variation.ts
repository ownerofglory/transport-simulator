/**
 * Deterministic per-station variation. A stable string (e.g. `vvs:<stationId>`)
 * hashes to a seed, and the seeded generator drives *appearance-only* details
 * (canopy length, furniture counts, poster content). Topology, accessibility,
 * track geometry, and platform height must never be randomized — those come
 * from catalog data. Determinism keeps a station identical across sessions.
 */

// 32-bit FNV-1a string hash → non-zero seed.
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) || 1;
}

export type SeededRandom = {
  next(): number; // [0, 1)
  int(minInclusive: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;
};

// mulberry32 PRNG — small, fast, well-distributed for cosmetic variation.
export function createSeededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)]
  };
}
