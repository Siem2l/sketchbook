// route — the lane the errand goes down, and everything standing beside it.
//
// Pure by construction: no canvas, no audio, no window. The sketch draws what
// this returns and the tests import it straight into node. Every number that
// decides where the ride goes lives here; every number that decides what it
// looks like lives in sketch.js.
//
// The road is a closed loop rather than an A-to-B, and that was not the first
// plan. A route with an end needs an answer to what happens at the end — a
// fade, a reset, a wall — and all three of them interrupt the one thing the
// page is for, which is pedalling. A loop has no such moment. It also
// guarantees what a straight road cannot: over one circuit the heading passes
// through every one of the eight facings the sprite sheet holds, so the asset
// is fully exercised by simply going round.

const TAU = Math.PI * 2;

// Deterministic, seedable, and three lines. The scenery has to come back
// identical on reload or the landmark readout would be lying about where you
// are, and the tests could not assert on a tree.
export const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// An irregular ring, authored rather than generated. A circle would hold one
// facing per eighth of the loop in a perfectly even rotation, which is the one
// shape that makes the sprite sheet look like a sprite sheet — you see the
// frames tick over on a metronome. Uneven radii mean the facing changes in
// clumps: long straights that hold a frame, then a bend that runs through
// three of them at once.
export const WAYPOINTS = [
  [420, 0], [307, 223], [93, 285], [-105, 323], [-348, 253],
  [-470, 0], [-324, -235], [-102, -314], [111, -342], [332, -241],
];

// Catmull-Rom through every waypoint, closed. Sampled to a fixed spacing so
// that a lookup by distance is an array index and not a search — the bike asks
// for its position sixty times a second and the answer has to be free.
export function buildRoute(waypoints = WAYPOINTS, ds = 4) {
  const n = waypoints.length;
  const at = (i) => waypoints[((i % n) + n) % n];
  const dense = [];
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    // Enough sub-steps that the arc-length error is under a pixel; the
    // resample below fixes the spacing anyway, this only has to be smooth.
    for (let j = 0; j < 24; j++) {
      const t = j / 24;
      const t2 = t * t;
      const t3 = t2 * t;
      dense.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }

  // Cumulative length along the dense polyline, then resample at even ds.
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum[dense.length];
  const count = Math.max(8, Math.round(length / ds));
  const step = length / count;
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);

  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const target = i * step;
    while (cursor < dense.length - 1 && cum[cursor + 1] < target) cursor++;
    const span = cum[cursor + 1] - cum[cursor] || 1;
    const f = (target - cum[cursor]) / span;
    const a = dense[cursor];
    const b = dense[(cursor + 1) % dense.length];
    xs[i] = a[0] + (b[0] - a[0]) * f;
    ys[i] = a[1] + (b[1] - a[1]) * f;
  }

  // Headings from a centred difference over a few samples. A one-sample
  // difference at 4-unit spacing is all quantisation noise, and the facing
  // picked from it flickers between two frames on a straight.
  const hs = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = (i - 3 + count) % count;
    const b = (i + 3) % count;
    hs[i] = Math.atan2(ys[b] - ys[a], xs[b] - xs[a]);
  }

  return { xs, ys, hs, step, count, length: count * step };
}

// Position and heading at distance s. Wraps, so callers never have to.
export function at(route, s) {
  const { xs, ys, hs, step, count } = route;
  const u = ((s / step) % count + count) % count;
  const i = Math.floor(u);
  const j = (i + 1) % count;
  const f = u - i;
  // Headings are angles: lerping 179° and -179° the naive way swings the bike
  // right round the compass on one frame at the wrap.
  let dh = hs[j] - hs[i];
  if (dh > Math.PI) dh -= TAU;
  if (dh < -Math.PI) dh += TAU;
  return {
    x: xs[i] + (xs[j] - xs[i]) * f,
    y: ys[i] + (ys[j] - ys[i]) * f,
    heading: hs[i] + dh * f,
  };
}

// Signed distance from a world point to the road centre, searched locally
// around a known s. Used to keep scenery out of the carriageway.
export function offsetAt(route, s, side, dist) {
  const p = at(route, s);
  return {
    x: p.x + Math.cos(p.heading + Math.PI / 2) * dist * side,
    y: p.y + Math.sin(p.heading + Math.PI / 2) * dist * side,
  };
}

export const ROAD_HALF = 30;

// What you ride through, in order, as fractions of the loop. Naming them is
// what lets the readout say where you are — and having the zones be data
// rather than a chain of ifs is what lets the density and the mix of things
// change per zone without a special case each time.
export const ZONES = [
  { from: 0.00, to: 0.20, name: 'village', density: 0.030, mix: ['cottage', 'fence', 'cottage', 'stone'] },
  { from: 0.20, to: 0.42, name: 'open field', density: 0.016, mix: ['haystack', 'tree', 'post', 'haystack'] },
  { from: 0.42, to: 0.54, name: 'the ford', density: 0.018, mix: ['stone', 'post', 'tree'] },
  { from: 0.54, to: 0.80, name: 'the wood', density: 0.055, mix: ['tree', 'tree', 'tree', 'stone'] },
  { from: 0.80, to: 1.00, name: 'chapel road', density: 0.022, mix: ['stone', 'tree', 'fence', 'cottage'] },
];

export const zoneAt = (route, s) => {
  const f = ((s / route.length) % 1 + 1) % 1;
  return ZONES.find((z) => f >= z.from && f < z.to) ?? ZONES[0];
};

// The bridge sits in the middle of `the ford`, and the river is drawn from the
// same numbers, so the water can never end up somewhere the crossing is not.
export const bridgeAt = (route) => {
  const s = route.length * 0.48;
  const p = at(route, s);
  return { s, ...p, halfLength: 46, planks: 7 };
};

// The river crosses where the bridge crosses, by construction rather than by
// coincidence — both are derived from the same point on the route, so the water
// cannot drift out from under the planks. It is also what keeps the scenery's
// feet dry: placeProps rejects anything that would stand in it.
export const riverAt = (route) => {
  const b = bridgeAt(route);
  return {
    x: b.x,
    y: b.y,
    nx: Math.cos(b.heading + Math.PI / 2),
    ny: Math.sin(b.heading + Math.PI / 2),
    half: 900,
    width: 78,
  };
};

// A landmark rather than scatter: the chapel is placed, not sprinkled, because
// the bell is the loudest thing on the loop and it should ring somewhere you
// can see coming.
export const chapelAt = (route) => {
  const s = route.length * 0.88;
  return { s, ...offsetAt(route, s, 1, 96), kind: 'chapel' };
};

// Everything standing beside the road. Each carries the distance it sits at so
// the ride can tell when it has just gone past one, which is the whole of the
// place-to-sound coupling: passing a thing plays it.
// How much road frontage a thing takes up, used to stop the scenery growing
// through itself. Roughly the widest the sketch draws each kind.
const FOOTPRINT = {
  cottage: 128, chapel: 170, haystack: 50, tree: 34, stone: 16, post: 12, fence: 16,
};

export function placeProps(route, seed = 20260813) {
  const rnd = mulberry32(seed);
  const props = [];
  const occupied = {};
  const river = riverAt(route);
  // Distance from the water, along the river's own normal. Anything closer
  // than this is standing in it, and an oak growing mid-stream reads as a bug
  // in a way that almost nothing else on the page would.
  const inWater = (x, y) =>
    Math.abs((x - river.x) * river.nx + (y - river.y) * river.ny) < river.width + 14;

  for (const zone of ZONES) {
    const from = zone.from * route.length;
    const to = zone.to * route.length;
    const count = Math.round((to - from) * zone.density);
    for (let i = 0; i < count; i++) {
      const s = from + ((i + rnd() * 0.8) / count) * (to - from);
      const kind = zone.mix[Math.floor(rnd() * zone.mix.length)];
      const side = rnd() < 0.5 ? -1 : 1;
      // Verges are kept clear by kind: a fence hugs the road, a cottage stands
      // well back, and a tree is anywhere between. Uniform jitter put oaks in
      // the middle of the carriageway and cottages in the next field.
      const back = { post: 8, fence: 12, stone: 10, tree: 30, haystack: 56, cottage: 92 }[kind];
      const dist = ROAD_HALF + back + rnd() * (kind === 'tree' ? 60 : 22);
      const where = offsetAt(route, s, side, dist);
      if (inWater(where.x, where.y)) continue;
      // Two bands per verge, and a thing only has to clear the last thing in
      // its own band. Packing everything against everything would forbid a
      // tree beside a cottage that stands forty units further back; packing
      // nothing gave a village where the houses grew through each other.
      const band = `${side}:${FOOTPRINT[kind] > 40 ? 'big' : 'small'}`;
      const half = FOOTPRINT[kind] / 2;
      if (s - half < (occupied[band] ?? -Infinity)) continue;
      occupied[band] = s + half;
      props.push({
        kind,
        s,
        side,
        dist,
        ...where,
        // One roll of the dice per prop, held for its lifetime: the sketch
        // reads it for height, lean and colour so that a given tree is that
        // tree on every frame and after every reload.
        r: rnd(),
        r2: rnd(),
      });
    }
  }

  props.push({ ...chapelAt(route), side: 1, dist: 96, r: 0.5, r2: 0.5 });

  const bridge = bridgeAt(route);
  for (let i = 0; i < bridge.planks; i++) {
    const s = bridge.s - bridge.halfLength + ((i + 0.5) / bridge.planks) * bridge.halfLength * 2;
    props.push({ kind: 'plank', s, side: 0, dist: 0, ...at(route, s), r: 0, r2: 0 });
  }

  props.sort((a, b) => a.s - b.s);
  return props;
}

// What a thing sounds like when you ride past it. The pitch is a fraction, not
// a frequency: shared/audio.js turns fractions into notes that are in the key
// the bass is already playing, and a frequency chosen here would be in no key
// at all.
export const VOICE = {
  tree: { strike: 'canopy', pitch: 0.72, gain: 1 },
  stone: { strike: 'bell', pitch: 0.45, gain: 1 },
  chapel: { strike: 'bell', pitch: 0.12, gain: 1 },
  plank: { strike: 'ground', pitch: 0.05, gain: 1 },
  cottage: { strike: 'bell', pitch: 0.60, gain: 0.7 },
  haystack: null,
  fence: null,
  post: null,
};
