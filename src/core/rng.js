// Deterministic RNG (mulberry32). A fixed seed can be supplied in development
// builds to reproduce reward results (GDD 12.1); otherwise seeded from entropy.

export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chanceBp: bp => next() * 10000 < bp,
    getState: () => a >>> 0,
    setState: s => { a = s >>> 0; }
  };
}

export function entropySeed() {
  return (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;
}
