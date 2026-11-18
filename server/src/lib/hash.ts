/** FNV-1a 32-bit hash of a string. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Final avalanche so that similar strings do not produce similar outputs.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic pseudo-random number in [0, 1) for a seed string. */
export function rand(seed: string): number {
  return hash32(seed) / 0x100000000;
}

/** Deterministic integer in [min, max] for a seed string. */
export function randInt(seed: string, min: number, max: number): number {
  return min + Math.floor(rand(seed) * (max - min + 1));
}

/** Deterministic pick from a non-empty list. */
export function pick<T>(seed: string, items: readonly T[]): T {
  return items[Math.floor(rand(seed) * items.length)] as T;
}

/**
 * Smooth 1-D value noise in [-1, 1]: random values at integer lattice points,
 * blended with a smoothstep. Continuous in `x`, so sampling it over time gives
 * a curve that drifts instead of jumping.
 */
export function valueNoise(seed: string, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = rand(`${seed}:${i}`) * 2 - 1;
  const b = rand(`${seed}:${i + 1}`) * 2 - 1;
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

/** Short stable id (base36) for a string. */
export function shortId(input: string): string {
  return hash32(input).toString(36) + hash32(`${input}#`).toString(36);
}
