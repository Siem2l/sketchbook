// Deterministic sampler for the ranking experiment: turns one integer seed
// into N fully-specified message-noise variants.
//
// Deterministic on purpose. The whole experiment rests on being able to say
// "variant 37 is this exact image" months later, and on being able to re-run
// the same 64 against different criteria. A variant is a plain object, the
// manifest is JSON, and both go in git — which for an experiment beats a
// database, because you get provenance and diffs for free and there is no
// schema to migrate.
//
// The sampling is stratified rather than uniform-random. With 64 draws over
// four modes, six palettes and five continuous axes, independent uniform
// sampling reliably leaves whole regions empty and doubles up elsewhere — and
// a ranking over a lumpy sample says as much about the lumps as about taste.
// Mode and palette are dealt round-robin so coverage is exact; the continuous
// axes are Latin-hypercube sampled, one draw per equal-probability stratum,
// shuffled independently per axis.

export const MODES = ['topo', 'contour', 'hybrid', 'hatch'];
export const PALETTES = ['bathyal', 'oxide', 'ordnance', 'graphite', 'risograph', 'thermal'];

// Ranges match the sketch's own controls. Sampling outside them would produce
// images the sketch cannot be driven to by hand, which would make the ranking
// unactionable — you could not go and reproduce a winner with the sliders.
export const AXES = {
  bands: { min: 3, max: 32, round: true },
  zoom: { min: 0.3, max: 3 },
  warp: { min: 0, max: 1.5 },
  octaves: { min: 1, max: 5, round: true },
  sea: { min: 0.1, max: 0.9 },
  // Not a slider, but it is in the stamp and it changes the image completely:
  // where in the loop the frame was taken.
  t: { min: 0, max: 4 },
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// One draw per stratum, then shuffle: every axis covers its full range exactly
// once per n draws, but the axes stay uncorrelated with each other.
function latinHypercube(n, axis, rnd) {
  const strata = [];
  for (let i = 0; i < n; i++) {
    const u = (i + rnd()) / n;
    const v = axis.min + u * (axis.max - axis.min);
    strata.push(axis.round ? Math.round(v) : v);
  }
  return shuffled(strata, rnd);
}

export function sampleVariants({ n = 64, seed = 1, messages = 8 } = {}) {
  const rnd = mulberry32(seed);

  const cols = {};
  for (const [name, axis] of Object.entries(AXES)) cols[name] = latinHypercube(n, axis, rnd);

  // The message is the one input the stamp deliberately omits, so it has to be
  // carried in the manifest or a variant is not reproducible from its record.
  // Several of them, because the message sets the terrain's underlying scale
  // and noise seed — one message for all 64 would vary the treatment of a
  // single landscape rather than sampling landscapes.
  const pool = Array.from({ length: messages }, (_, i) => `lab-${seed}-${i}`);

  const modeOrder = shuffled(Array.from({ length: n }, (_, i) => MODES[i % MODES.length]), rnd);
  const palOrder = shuffled(Array.from({ length: n }, (_, i) => PALETTES[i % PALETTES.length]), rnd);

  return Array.from({ length: n }, (_, i) => ({
    id: `v${String(i).padStart(3, '0')}`,
    message: pool[i % pool.length],
    mode: modeOrder[i],
    palette: palOrder[i],
    bands: cols.bands[i],
    zoom: +cols.zoom[i].toFixed(3),
    warp: +cols.warp[i].toFixed(3),
    octaves: cols.octaves[i],
    sea: +cols.sea[i].toFixed(3),
    t: +cols.t[i].toFixed(3),
  }));
}

// The stamp the sketch would print for this variant — the string that lets you
// reproduce it by hand, given the message.
export function stampOf(v) {
  return `t=${v.t.toFixed(3)} · ${v.palette} · ${v.mode} · `
    + `b${v.bands} z${v.zoom.toFixed(2)} w${v.warp.toFixed(2)} o${v.octaves} s${v.sea.toFixed(2)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const v = sampleVariants({ n: Number(process.argv[2]) || 64 });
  console.log(JSON.stringify(v, null, 2));
}
