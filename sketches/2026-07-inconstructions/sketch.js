// inconstructions — an ephemeral Vectorheart assembly sandbox.
//
// Build interlocking axonometric structures from a closed kit of parts on a
// bounded integer lattice. Nothing is saved; the only thing that leaves the
// page is a PNG.
//
// Three constraints do all the heavy lifting:
//   1. Parts occupy integer cells, so occlusion is a sort (by depth along the
//      view vector) rather than a depth buffer. No interpenetration artifacts.
//   2. Picking reads a pixel out of an offscreen buffer where every face is
//      filled with a colour encoding its identity. Exact, and independent of
//      part geometry — new parts need no picking maths.
//   3. Colour belongs to the part type, not the instance, so every build is
//      automatically coherent and there is no colour picker.
//
// The interface is not decoration around the tool; it *is* the tool, drawn in
// the same idiom as the thing it makes.
import '../_lib/chrome.css';
import p5 from 'p5';
import { spaced, spacedWidth, titleBlock, readout, regMarks } from '../_lib/type.js';
import { exportPng as exportPngTo } from '../_lib/export.js';
import { buttonStyle, button, hitLayer, strip, slider } from '../_lib/panel.js';

// ---------------------------------------------------------------- constants

const NX = 12, NY = 12, NZ = 10;   // build volume, in cells (NX must equal NY)
const COS30 = Math.cos(Math.PI / 6);
const TURN_MS = 320;               // quarter-turn duration
const DEMO_MS = 4000;              // opening assembly duration
const BEARINGS = ['NE', 'SE', 'SW', 'NW'];
const MONO = 'monospace';

// Warm paper field, near-black hairlines — both references are print-light.
// Each part colour carries its own three face tones: top, right, left.
const PAPER = '#eceae1';
const INK = '#16160f';

// The library takes colour as data so it can stay colour-blind. This sketch's
// palette is fixed; splinter's changes with its active palette.
const THEME = { ink: INK, paper: PAPER, accent: '#fabd2f', onAccent: INK, muted: '#8a8a80' };
const BTN = buttonStyle({ theme: THEME, size: 9, tracking: 1.1, dy: 3.2, align: 'baseline', shape: 'poly' });

const TONE = {
  grey:   ['#c2c2ba', '#98988f', '#6b6b64'],
  pale:   ['#e9e8e0', '#d3d2c9', '#aaa99f'],
  white:  ['#fdfcf7', '#efeee6', '#cfcec4'],
  dark:   ['#43433b', '#2a2a24', '#191915'],
  accent: ['#ffd35e', '#fabd2f', '#cf9a1d'],
};

// ------------------------------------------------------------ part geometry

// Six outward-facing quads, wound counter-clockwise when seen from outside.
// Screen-space signed area later tells us which of them face the camera, so
// this winding convention is the only thing that has to stay consistent.
function box(x0, y0, z0, x1, y1, z1) {
  return [
    { n: [1, 0, 0], v: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] },
    { n: [-1, 0, 0], v: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] },
    { n: [0, 1, 0], v: [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]] },
    { n: [0, -1, 0], v: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
    { n: [0, 0, 1], v: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
    { n: [0, 0, -1], v: [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]] },
  ];
}

// A ramp rising along +x: bottom, back wall, the slope, and two triangular
// sides. The slope is the only non-axis-aligned face in the whole kit, which is
// why placement snaps normals to their dominant axis before using them.
function ramp() {
  const s = Math.SQRT1_2;
  const A = [0, 0, 0], B = [1, 0, 0], C = [1, 0, 1];
  const D = [0, 1, 0], E = [1, 1, 0], F = [1, 1, 1];
  return [
    { n: [0, 0, -1], v: [A, D, E, B] },
    { n: [1, 0, 0], v: [B, E, F, C] },
    { n: [-s, 0, s], v: [A, C, F, D] },
    { n: [0, -1, 0], v: [A, B, C] },
    { n: [0, 1, 0], v: [D, F, E] },
  ];
}

// The closed kit. Each part is a union of primitives; where two primitives
// abut, the shared hairline reads as a panel line, which is on-aesthetic.
const PARTS = [
  { id: 'BLOCK', tone: 'grey',   code: 'B·10', geo: box(0, 0, 0, 1, 1, 1) },
  { id: 'SLAB',  tone: 'pale',   code: 'S·04', geo: box(0, 0, 0, 1, 1, 0.5) },
  { id: 'RAMP',  tone: 'grey',   code: 'R·22', geo: ramp() },
  { id: 'PLATE', tone: 'white',  code: 'P·01',
    geo: box(0, 0, 0, 1, 0.42, 0.16).concat(box(0, 0.58, 0, 1, 1, 0.16)) },
  { id: 'POST',  tone: 'dark',   code: 'X·37', geo: box(0.32, 0.32, 0, 0.68, 0.68, 1) },
  // The accent parts are a flat band resting on the cell floor rather than a
  // centred pipe, so a run reads as the ribbon in the reference rather than
  // floating above whatever it sits on.
  { id: 'TUBE',  tone: 'accent', code: 'T·50', geo: box(0, 0.28, 0, 1, 0.72, 0.45) },
  { id: 'ELBOW', tone: 'accent', code: 'E·51',
    geo: box(0, 0.28, 0, 0.72, 0.72, 0.45).concat(box(0.28, 0.28, 0, 0.72, 1, 0.45)) },
];

// Quarter-turns about the vertical axis. Points spin about the cell's centre;
// direction vectors spin about the origin.
function spinVec([x, y, z], r) {
  let v = [x, y];
  for (let i = 0; i < r; i++) v = [-v[1], v[0]];
  return [v[0], v[1], z];
}

function spin([x, y, z], r) {
  const v = spinVec([x - 0.5, y - 0.5, z], r);
  return [v[0] + 0.5, v[1] + 0.5, v[2]];
}

// Part geometry, pre-rotated once per (part, rotation) pair.
const GEO = PARTS.map((part) =>
  [0, 1, 2, 3].map((r) =>
    part.geo.map((q) => ({ n: spinVec(q.n, r), v: q.v.map((v) => spin(v, r)) }))));

// Placement uses the face's dominant axis, so the ramp's sloped face still
// resolves to a whole neighbouring cell.
function snapNormal(n) {
  const a = n.map(Math.abs);
  const i = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
  const out = [0, 0, 0];
  out[i] = Math.sign(n[i]);
  return out;
}

// --------------------------------------------------------------- world state

const key = (x, y, z) => `${x},${y},${z}`;
let cells = new Map();             // "x,y,z" -> { part, rot }
let past = [];                     // undo stack of invertible operations
let future = [];                   // redo stack

// The buildable ceiling. Fixed in the sandbox; the tower raises it as it goes.
let zCeil = NZ;
let zFloor = 0;                    // the tower prunes what falls below this
const inBounds = (x, y, z) => x >= 0 && y >= 0 && z >= zFloor && x < NX && y < NY && z < zCeil;

function apply(op) {
  if (op.t === 'place') cells.set(key(op.x, op.y, op.z), { part: op.part, rot: op.rot });
  else if (op.t === 'delete') cells.delete(key(op.x, op.y, op.z));
  else if (op.t === 'load') { cells = new Map(op.next); rebound(); }
  dirty = true;
}

// A whole world just arrived from the undo log; work out what volume it needs.
function rebound() {
  let lo = Infinity, hi = -1;
  for (const k of cells.keys()) {
    const z = Number(k.split(',')[2]);
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  zCeil = Math.max(NZ, hi + 1);
  // A world whose lowest part is off the ground and which reaches past the
  // sandbox ceiling is a pruned tower; anything else stands on the ground.
  zFloor = lo !== Infinity && lo > 0 && hi >= NZ ? lo : 0;
}

function invert(op) {
  if (op.t === 'place') return { t: 'delete', x: op.x, y: op.y, z: op.z };
  if (op.t === 'delete') return { t: 'place', x: op.x, y: op.y, z: op.z, part: op.part, rot: op.rot };
  return { t: 'load', next: op.prev, prev: op.next };
}

function commit(op) {
  apply(op);
  past.push(op);
  future.length = 0;
}

function place(x, y, z, part, rot) {
  if (!inBounds(x, y, z) || cells.has(key(x, y, z))) return false;
  commit({ t: 'place', x, y, z, part, rot });
  return true;
}

function remove(x, y, z) {
  const c = cells.get(key(x, y, z));
  if (!c) return false;
  commit({ t: 'delete', x, y, z, part: c.part, rot: c.rot });
  return true;
}

function undo() {
  const op = past.pop();
  if (!op) return;
  apply(invert(op));
  future.push(op);
}

function redo() {
  const op = future.pop();
  if (!op) return;
  apply(op);
  past.push(op);
}

// Clear and reset are themselves operations, so they undo like anything else.
function swapWorld(next) {
  exitModes();
  commit({ t: 'load', prev: [...cells], next });
  gen.rolled = false;
}

// Record an operation that has already been applied by hand. Generation moves
// hundreds of cells at once; the log should hold one entry, not hundreds.
function record(op) {
  past.push(op);
  future.length = 0;
}

// A cheap order-independent fingerprint of the lattice. It exists so a test can
// tell "the same composition came back" from "a different one did" without any
// way to set the seed from outside.
function signature() {
  let h = 2166136261 >>> 0;
  for (const k of [...cells.keys()].sort()) {
    const c = cells.get(k);
    const s = `${k}:${c.part}.${c.rot}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Is every part reachable from the lowest live layer? In the sandbox that layer
// is the ground; in the tower it is whatever pruning has left at the bottom.
// This is the one structural property every pass here promises.
function connected() {
  const seen = new Set();
  const stack = [];
  for (const k of cells.keys()) {
    if (Number(k.split(',')[2]) === zFloor) { seen.add(k); stack.push(k); }
  }
  while (stack.length) {
    const [x, y, z] = stack.pop().split(',').map(Number);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const n = key(x + dx, y + dy, z + dz);
      if (cells.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return seen.size === cells.size;
}

// ----------------------------------------------------------------- generator
//
// Five passes over the lattice, each reading only what the pass before it left,
// so a composition is a pure function of (seed, parameters):
//
//   1. field   — occupancy from lerp(template, noise, MIX), thresholded by
//                DENSITY. Symmetry folds the coordinates before sampling.
//   2. support — flood-fill from the ground; floaters either get a post
//                dropped under them or are deleted. This is what turns an
//                isosurface into a building.
//   3. typing  — each cell picks a part from its own neighbourhood; exposed
//                tops become slabs and plates, step edges get ramps.
//   4. ribbon  — accent walks over the surface: TUBE along runs, ELBOW at
//                corners. One continuous yellow line does more for the
//                reference look than any amount of massing subtlety.
//   5. trim    — apron plates and corner posts.
//
// MIX is the whole architecture exposed as one control. Templates are scalar
// fields rather than builders precisely so that they can be crossfaded with
// noise; everything downstream is shared, so a sixth template is one function.

const PID = Object.fromEntries(PARTS.map((p, i) => [p.id, i]));
const CX = NX / 2, CY = NY / 2;

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a, b, t) => a + (b - a) * t;
// Squash a signed depth in cells into occupancy: 1 a cell inside, 0.5 exactly
// on the surface, 0 a cell outside. Templates work in depths rather than in
// occupancy so that DENSITY can dilate and erode them by a stated number of
// cells, and so their values saturate — a field that never leaves the middle of
// the range would simply be drowned by noise at any MIX above zero.
const edge = (t) => clamp01(0.5 + t * 0.5);

// Small deterministic PRNG (mulberry32), as in the splinter sketch.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let R = rng(1);

// +X +Y -X -Y, in the same order as the quarter-turn rotations — so a ramp
// rising toward DIRS[i] is exactly rotation i, and a tube running along DIRS[i]
// is rotation i % 2.
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const opp = (d) => (d + 2) % 4;
const dirIndex = (dx, dy) => DIRS.findIndex((d) => d[0] === dx && d[1] === dy);

// An elbow's two arms, per rotation, derived from its geometry: rot 0 joins -X
// to +Y and each turn spins that pair. A corner arriving along `in` and leaving
// along `out` has arms {opp(in), out}.
const ELBOW_ROT = { '1,2': 0, '2,3': 1, '0,3': 2, '0,1': 3 };
const elbowRot = (a, b) => ELBOW_ROT[[a, b].sort().join(',')];

// Depth inside the template's own footprint, keeping it clear of the plinth.
const inside = (x, y) => Math.min(CX * 0.86 - Math.abs(x + 0.5 - CX),
  CY * 0.86 - Math.abs(y + 0.5 - CY));

// Templates are fields, not builders: (x, y, z) -> depth in cells, positive
// inside the form. Intersection is `min`, union is `max`, and adding a sixth
// template is one function — everything about how the result becomes *parts*
// lives downstream and is shared.
const TEMPLATES = [
  // Stepped setbacks on a Chebyshev radius, so the tower stays square in iso.
  // Hollow between floors: a solid ziggurat is the one shape in this kit that
  // reads as a lump rather than as a structure.
  { id: 'TOWER', f: (x, y, z) => {
    const tier = Math.floor((z / span) * 3) / 3;
    const rad = CX * (0.72 - 0.46 * tier);
    const d = Math.max(Math.abs(x + 0.5 - CX), Math.abs(y + 0.5 - CY));
    return Math.min(rad - d, z % 4 === 0 ? 9 : d - (rad - 2.2));
  } },
  // Concentric plateaus — a wide base that steps down to the perimeter.
  { id: 'TERRACE', f: (x, y, z) => {
    const d = Math.max(Math.abs(x + 0.5 - CX), Math.abs(y + 0.5 - CY)) / CX;
    const h = (Math.round((1 - d) * 3) / 3) * span * 0.72;
    return Math.min(inside(x, y), h - z - 0.5);
  } },
  // Orthogonal beam lanes with legs at the intersections.
  { id: 'GANTRY', f: (x, y, z) => {
    const lx = ((x - 1) % 4 + 4) % 4, ly = ((y - 1) % 4 + 4) % 4;
    const dx = Math.min(lx, 4 - lx), dy = Math.min(ly, 4 - ly);
    const dz = Math.min(z % 4, 4 - (z % 4));
    const leg = Math.min(0.7 - dx, 0.7 - dy);
    const beam = Math.min(0.7 - Math.min(dx, dy), 0.7 - dz);
    return Math.min(inside(x, y), Math.max(leg, beam));
  } },
  // Stacked decks with voids punched through, tied together by columns.
  { id: 'SLABS', f: (x, y, z) => {
    const mz = z % 3;
    const deck = Math.min(0.6 - Math.min(mz, 3 - mz), (0.55 - Math.cos((x + 0.5) * 0.85)
      * Math.cos((y + 0.5) * 0.85)) * 3);
    const column = (Math.abs(Math.cos((x + 0.5) * 0.85) * Math.cos((y + 0.5) * 0.85)) - 0.74) * 3;
    return Math.min(inside(x, y), Math.max(deck, column));
  } },
  // A diagonal backbone with ribs at intervals along it.
  { id: 'SPINE', f: (x, y, z) => {
    const dx = x + 0.5 - CX, dy = y + 0.5 - CY;
    const along = (dx + dy) / Math.SQRT2, across = (dx - dy) / Math.SQRT2;
    const core = Math.min(1.7 - Math.abs(across), span * 0.58 - z, CX * 1.1 - Math.abs(along));
    const rib = Math.abs(along % 3) < 0.9 && z < 3
      ? Math.min(4.4 - Math.abs(across), CX * 1.05 - Math.abs(along)) : -9;
    return Math.max(core, rib);
  } },
];

// Which templates a tower module draws from: TOWER, GANTRY and SLABS twice
// over, TERRACE and SPINE once. Indices into TEMPLATES.
const TOWER_MIX = [0, 0, 1, 2, 2, 3, 3, 4];

const SYMS = ['NONE', 'MIRROR', 'QUAD'];
const SLIDERS = [['MIX', 'mix'], ['DENSITY', 'density'], ['GRAIN', 'grain'],
  ['ACCENT', 'accent'], ['TRIM', 'trim']];

// The defaults are where the good compositions live; the ranges deliberately
// reach far enough to break one.
const gen = {
  seed: 0x51e3d0,
  template: 0,
  sym: 1,
  legs: true,
  mix: 0.45,
  density: 0.5,
  grain: 0.40,
  accent: 0.55,
  trim: 0.62,
  open: true,
  // The opening composition is the fixed reference build, not a roll — so the
  // printed line does not claim a seed that would not reproduce it.
  rolled: false,
  // The two endless modes. Mutually exclusive: they are two answers to the same
  // question, and churn inside a climbing shaft has no coherent reading.
  flux: false,
  tower: false,
};

let span = NZ;                     // height of the window currently being composed
const moduleSeed = (mi) => (gen.seed ^ Math.imul(mi + 1, 0x9e3779b9)) >>> 0;

const template = () => TEMPLATES[gen.template];

// Symmetry folds coordinates before sampling rather than mirroring the result:
// the fold is free and cannot produce two parts in one cell.
function fold(x, y) {
  if (gen.sym === 0) return [x, y];
  const cx = (NX - 1) / 2, cy = (NY - 1) / 2;
  const fx = cx - Math.abs(x - cx);
  return gen.sym === 1 ? [fx, y] : [fx, cy - Math.abs(y - cy)];
}

// Domain-warped perlin, biased to thin out with height and to fall away from
// the walls of the build volume so compositions never clip the plinth.
// Sampled at absolute z so a tower's mass runs continuously through its seams,
// but thinned against the *window's* own height — an absolute falloff would
// starve every module above the first.
function noiseField(x, y, z, lz) {
  const s = 0.06 + gen.grain * 0.34;
  const wx = P.noise(x * s * 2 + 40, y * s * 2 + 40, z * s * 2 + 40) * 0.8;
  const wy = P.noise(x * s * 2 + 90, y * s * 2 + 90, z * s * 2 + 90) * 0.8;
  const n = (P.noise(x * s + wx, y * s + wy, z * s * 0.8) - 0.5) * 1.9 + 0.5;
  const wall = edge(Math.min(x, NX - 1 - x, y, NY - 1 - y) - 1.2);
  return clamp01(n * (1 - 0.45 * (lz / span)) * (0.5 + 0.5 * wall));
}

// Which part a cell becomes, given a way to ask what is next to it. Shared by
// the generator's typing pass and by GROW, so accreted parts are
// indistinguishable from generated ones.
function typeCell(x, y, z, occ, dir) {
  const top = !occ(x, y, z + 1);
  const lat = DIRS.filter(([dx, dy]) => occ(x + dx, y + dy, z)).length;
  if (dir !== undefined && R() < gen.accent * 0.16 && top) {
    return { part: PID.TUBE, rot: dir % 2 };
  }
  if (top && lat === 0 && (z === 0 || occ(x, y, z - 1)) && R() < 0.75) {
    return { part: PID.POST, rot: 0 };
  }
  if (top) {
    const r = R();
    if (r < 0.26 * gen.trim) return { part: PID.PLATE, rot: R() < 0.5 ? 0 : 1 };
    if (r < 0.72 * gen.trim) return { part: PID.SLAB, rot: 0 };
  }
  return { part: PID.BLOCK, rot: 0 };
}

// Run the whole pipeline for the current seed and parameters. Returns an
// ordered op list rather than touching the world, so the caller decides whether
// to animate it, and so the whole thing stays testable as a pure function.
function composeRange(z0, z1, below, mi) {
  if (!P) return [];
  const nz = z1 - z0;
  // Templates measure their vertical features against the window being
  // composed, so a module tiles rather than stretching one shape over a tower.
  // A module tells them it is taller than it is: most templates thin toward
  // their own top (SPINE fills 58% of its height, TERRACE 72%), and stacking
  // that sawtooth is what leaves a gap at every seam for the cap to bridge with
  // a spike. Seeing only their dense lower portion makes modules meet.
  span = mi === undefined ? nz : nz * 1.8;
  R = rng((mi === undefined ? gen.seed : moduleSeed(mi)) || 1);
  // One noise field for the whole tower, sampled at absolute z: continuity
  // across the seams comes free, and re-seeding per module would put a visible
  // discontinuity at every one of them.
  P.noiseSeed(gen.seed);
  P.noiseDetail(2, 0.5);

  const at = (x, y, z) => ((z - z0) * NY + y) * NX + x;
  const mass = new Uint8Array(NX * NY * nz);      // 0 empty, 1 mass, 2 leg
  const inWin = (x, y, z) => x >= 0 && y >= 0 && x < NX && y < NY && z >= z0 && z < z1;
  // Below the window we consult the module underneath; above it there is
  // nothing yet. Everything else in the pipeline asks through here.
  const occ = (x, y, z) => {
    if (x < 0 || y < 0 || x >= NX || y >= NY || z >= z1) return false;
    if (z < z0) return below ? below(x, y, z) : false;
    return mass[at(x, y, z)] !== 0;
  };
  const parts = new Map();                        // "x,y,z" -> { part, rot, phase }
  const emit = (x, y, z, part, rot, phase) => {
    parts.set(key(x, y, z), { part, rot, phase });
  };

  // 1 — field. Module 0 uses the template the panel selected; every module
  // above it picks its own, so a tower changes character as it rises.
  // Module 0 uses the template the panel selected; every module above it picks
  // its own, weighted toward the two whose features are periodic in z. The
  // height-capped templates only show their dense base inside a module, so a
  // tower made mostly of those reads as stacked lumps.
  const tf = (mi === undefined || mi === 0
    ? template() : TEMPLATES[TOWER_MIX[Math.floor(R() * TOWER_MIX.length)]]).f;
  // A tower module gets its own plan — narrower than the volume, and offset
  // from the module below — so the tower jogs as it rises instead of extruding
  // one slab. The centre and radius are perlin in the module index rather than
  // random per module: consecutive plans then wander instead of jumping, so
  // they always overlap enough to join without a neck.
  const plan = mi === undefined ? null
    : { r: 2.9 + P.noise(mi * 0.45, 2900) * 2.0,
      x: mi === 0 ? 0 : (P.noise(mi * 0.3, 900) - 0.5) * 5.5,
      y: mi === 0 ? 0 : (P.noise(mi * 0.3, 1900) - 0.5) * 5.5 };
  // DENSITY 0.5 puts the surface exactly on the template's own level set; away
  // from there it dilates or erodes by up to two cells, and it biases the noise
  // by a comparable amount so the control still bites at MIX 1.
  // Tower modules sit a little under the panel's density: a module is a small
  // plan, and at the sandbox setting a small plan fills in solid.
  const bias = gen.density - 0.5 - (mi === undefined ? 0 : 0.07);
  for (let z = z0; z < z1; z++) {
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        const [fx, fy] = fold(x, y);
        let d = tf(fx, fy, z - z0);
        if (plan) {
          d = Math.min(d, plan.r - Math.max(Math.abs(x + 0.5 - CX - plan.x),
            Math.abs(y + 0.5 - CY - plan.y)));
        }
        const t = edge(d + bias * 4);
        const n = clamp01(noiseField(fx, fy, z, z - z0) + bias * 0.55);
        if (lerp(t, n, gen.mix) > 0.5) mass[at(x, y, z)] = 1;
      }
    }
  }

  // 1b — stitch. A module that touches nothing underneath would break the
  // tower's chain permanently, so force mass at the seam above whatever the
  // module below left at its top.
  if (below) {
    let joined = false, sx = -1, sy = -1;
    for (let y = 0; y < NY && !joined; y++) {
      for (let x = 0; x < NX && !joined; x++) {
        if (!below(x, y, z0 - 1)) continue;
        if (mass[at(x, y, z0)]) joined = true;
        else if (sx < 0 || Math.hypot(x - CX, y - CY) < Math.hypot(sx - CX, sy - CY)) {
          sx = x; sy = y;
        }
      }
    }
    if (!joined && sx >= 0) {
      mass[at(sx, sy, z0)] = 1;
      if (z0 + 1 < z1) mass[at(sx, sy, z0 + 1)] = 1;
    }
  }

  // 2 — support. Flood-fill from whatever the window stands on, then deal with
  // whatever never got reached.
  const seen = new Uint8Array(mass.length);
  const stack = [];
  const reach = (x, y, z) => {
    if (!inWin(x, y, z) || seen[at(x, y, z)] || !mass[at(x, y, z)]) return;
    seen[at(x, y, z)] = 1;
    stack.push([x, y, z]);
  };
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) if (!below || below(x, y, z0 - 1)) reach(x, y, z0);
  }
  const walk = () => {
    while (stack.length) {
      const [x, y, z] = stack.pop();
      for (const [dx, dy] of DIRS) reach(x + dx, y + dy, z);
      reach(x, y, z - 1);
      reach(x, y, z + 1);
    }
  };
  walk();
  for (let z = z0; z < z1; z++) {
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        if (!mass[at(x, y, z)] || seen[at(x, y, z)]) continue;
        // Collect the floating component, then either prop it up or drop it.
        const comp = [];
        seen[at(x, y, z)] = 1;
        stack.push([x, y, z]);
        while (stack.length) {
          const c = stack.pop();
          comp.push(c);
          for (const [dx, dy] of DIRS) reach(c[0] + dx, c[1] + dy, c[2]);
          reach(c[0], c[1], c[2] - 1);
          reach(c[0], c[1], c[2] + 1);
        }
        if (!gen.legs) {
          for (const c of comp) mass[at(c[0], c[1], c[2])] = 0;
          continue;
        }
        let anchor = comp[0];
        for (const c of comp) {
          const better = c[2] < anchor[2] || (c[2] === anchor[2]
            && Math.hypot(c[0] - CX, c[1] - CY) < Math.hypot(anchor[0] - CX, anchor[1] - CY));
          if (better) anchor = c;
        }
        // Drop a leg until it finds something. If it walks out of the bottom of
        // the window without landing on the module below, the component cannot
        // be made to stand: take the legs back out and drop it.
        const legs = [];
        let landed = z0 === 0;
        for (let zz = anchor[2] - 1; zz >= z0; zz--) {
          if (mass[at(anchor[0], anchor[1], zz)]) { landed = true; break; }
          mass[at(anchor[0], anchor[1], zz)] = 2;
          legs.push(zz);
        }
        if (!landed && below) landed = below(anchor[0], anchor[1], z0 - 1);
        if (!landed) {
          for (const zz of legs) mass[at(anchor[0], anchor[1], zz)] = 0;
          for (const c of comp) mass[at(c[0], c[1], c[2])] = 0;
        }
      }
    }
  }

  // 2b — cap. Guarantee the module hands something to the one above it, or the
  // next module has nothing to stitch to and the tower ends here.
  if (mi !== undefined) {
    let tx = -1, ty = -1, tz = -1;
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        for (let z = z1 - 1; z >= z0; z--) {
          if (!mass[at(x, y, z)]) continue;
          if (z > tz) { tx = x; ty = y; tz = z; }
          break;
        }
      }
    }
    if (tz < 0 && below) {
      for (let y = 0; y < NY && tz < 0; y++) {
        for (let x = 0; x < NX && tz < 0; x++) if (below(x, y, z0 - 1)) { tx = x; ty = y; tz = z0 - 1; }
      }
    }
    // A long thin cap reads as a flagpole, so anything more than a step up is
    // built as a solid core rather than as a post.
    if (tz >= 0) {
      const core = z1 - 1 - tz > 2;
      for (let z = Math.max(tz + 1, z0); z < z1; z++) mass[at(tx, ty, z)] = core ? 3 : 2;
    }
  }

  // 3 — typing
  for (let z = z0; z < z1; z++) {
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        const m = mass[at(x, y, z)];
        if (!m) continue;
        if (m === 2) emit(x, y, z, PID.POST, 0, 0);
        else if (m === 3) emit(x, y, z, PID.BLOCK, 0, 0);
        else {
          const t = typeCell(x, y, z, occ);
          emit(x, y, z, t.part, t.rot, 0);
        }
      }
    }
  }

  // 3b — ramps. The only pass that adds cells: an empty cell sitting one step
  // below an exposed top becomes a ramp rising toward it.
  const ramps = [];
  for (let z = z0; z < z1; z++) {
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        if (mass[at(x, y, z)] || occ(x, y, z + 1)) continue;
        if (z > 0 && !occ(x, y, z - 1)) continue;
        const up = [];
        for (let d = 0; d < 4; d++) {
          const [dx, dy] = DIRS[d];
          if (occ(x + dx, y + dy, z) && !occ(x + dx, y + dy, z + 1)) up.push(d);
        }
        if (up.length !== 1) continue;
        // A ramp has to come from somewhere: the cell behind it must be open at
        // this level and standing on the same floor. Without this the pass
        // leans a wedge against every isolated column and the result is roofs.
        const [bx, by] = DIRS[opp(up[0])];
        if (occ(x + bx, y + by, z) || !(z === 0 || occ(x + bx, y + by, z - 1))) continue;
        if (R() < 0.55 * gen.trim) ramps.push([x, y, z, up[0]]);
      }
    }
  }
  for (const [x, y, z, d] of ramps) {
    mass[at(x, y, z)] = 1;
    emit(x, y, z, PID.RAMP, d, 1);
  }

  // 4 — ribbon
  const topZ = (x, y) => {
    for (let z = z1 - 1; z >= z0; z--) if (mass[at(x, y, z)]) return z;
    return -1;
  };
  const runs = 1 + Math.floor(gen.accent * 2.4);
  const maxLen = 3 + Math.round(gen.accent * 11);
  for (let i = 0, spent = 0; i < runs && spent < 6; spent++) {
    let sx = 0, sy = 0, z = -1;
    for (let tries = 0; tries < 80 && z < 0; tries++) {
      sx = Math.floor(R() * NX);
      sy = Math.floor(R() * NY);
      const t = topZ(sx, sy);
      if (t >= 0 && t + 1 < z1 && !mass[at(sx, sy, t + 1)]) z = t + 1;
    }
    if (z < 0) continue;
    const path = [[sx, sy]];
    let d = Math.floor(R() * 4), cx = sx, cy = sy, gap = 0;
    while (path.length < maxLen) {
      // Straight is strongly preferred; a run reads as a line, not a scribble.
      const opts = R() < 0.72 ? [d, (d + 1) % 4, (d + 3) % 4]
        : [(d + (R() < 0.5 ? 1 : 3)) % 4, d];
      let moved = false;
      for (const nd of opts) {
        const nx = cx + DIRS[nd][0], ny = cy + DIRS[nd][1];
        if (!inWin(nx, ny, z)) continue;
        const t = topZ(nx, ny);
        // A run stays level. Where the surface drops away it may bridge for a
        // couple of cells — the reference is full of ribbons crossing voids —
        // but it never climbs, and it never floats off on its own.
        if (t > z - 1 || mass[at(nx, ny, z)]) continue;
        const g2 = t === z - 1 ? 0 : gap + 1;
        if (g2 > 2) continue;
        if (path.some((p) => p[0] === nx && p[1] === ny)) continue;
        d = nd; cx = nx; cy = ny; gap = g2;
        path.push([cx, cy]);
        moved = true;
        break;
      }
      if (!moved) break;
    }
    // Trim any bridge left hanging off the end.
    while (path.length && topZ(path[path.length - 1][0], path[path.length - 1][1]) !== z - 1) path.pop();
    if (path.length < 2) continue;
    i++;
    for (let j = 0; j < path.length; j++) {
      const [x, y] = path[j];
      const pv = path[j - 1], nx = path[j + 1];
      const inD = pv ? dirIndex(x - pv[0], y - pv[1]) : null;
      const outD = nx ? dirIndex(nx[0] - x, nx[1] - y) : null;
      let part = PID.TUBE, rot;
      if (inD === null) rot = outD % 2;
      else if (outD === null || inD === outD) rot = inD % 2;
      else { part = PID.ELBOW; rot = elbowRot(opp(inD), outD); }
      mass[at(x, y, z)] = 1;
      emit(x, y, z, part, rot, 2);
    }
  }

  // 5 — trim: an apron of plates around the footprint, posts on its corners.
  // Both are features of the ground, so only a window standing on it gets them.
  if (z0 === 0) {
    let x0 = NX, y0 = NY, x1 = -1, y1 = -1;
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        let any = false;
        for (let z = z0; z < z1 && !any; z++) any = mass[at(x, y, z)] !== 0;
        if (!any) continue;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y);
        x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        if (mass[at(x, y, 0)]) continue;
        let side = -1;
        for (let d = 0; d < 4; d++) {
          const [dx, dy] = DIRS[d];
          if (inWin(x + dx, y + dy, 0) && mass[at(x + dx, y + dy, 0)] === 1) side = d;
        }
        // The plate's slot runs across the edge it sits against.
        if (side >= 0 && R() < 0.34 * gen.trim) emit(x, y, 0, PID.PLATE, side % 2 === 0 ? 1 : 0, 1);
      }
    }
    if (x1 >= 0) {
      for (const [x, y] of [[x0 - 1, y0 - 1], [x1 + 1, y0 - 1], [x0 - 1, y1 + 1], [x1 + 1, y1 + 1]]) {
        if (inWin(x, y, 0) && !mass[at(x, y, 0)] && !parts.has(key(x, y, 0))
          && R() < 0.6 * gen.trim) emit(x, y, 0, PID.POST, 0, 1);
      }
    }
  }

  // Bottom-up, outward from the centre, ribbons last — so a roll assembles like
  // the opening replay does and the accent lands as the finishing move.
  const ops = [];
  for (const [k, v] of parts) {
    const [x, y, z] = k.split(',').map(Number);
    ops.push({ x, y, z, part: v.part, rot: v.rot, phase: v.phase,
      d: Math.hypot(x + 0.5 - CX, y + 0.5 - CY) });
  }
  ops.sort((a, b) => (a.phase - b.phase) || (a.z - b.z) || (a.d - b.d));
  return ops;
}

// ------------------------------------------------------- running a generation

const GEN_MS = 1100;
let genPlay = null;                // { ops, at, start, prev }
let dragSnapshot = null;           // world at the start of a slider drag
let dragMoved = false;

function applyOp(o) {
  cells.set(key(o.x, o.y, o.z), { part: o.part, rot: o.rot });
  dirty = true;
}

function startGen(ops, prev) {
  cells = new Map();
  gen.rolled = true;
  genPlay = { ops, at: 0, start: performance.now(), prev };
  dirty = true;
}

function finishGen() {
  if (!genPlay) return;
  for (; genPlay.at < genPlay.ops.length; genPlay.at++) applyOp(genPlay.ops[genPlay.at]);
  record({ t: 'load', prev: genPlay.prev, next: [...cells] });
  genPlay = null;
}

// The bounded sandbox is the pipeline over the whole volume, standing on the
// ground. Everything else about it is the same code path a module takes.
const compose = () => composeRange(0, NZ, null);

// Leaving an endless mode without recording: the caller is about to record a
// load op of its own, which covers the transition in one entry.
function exitModes() {
  gen.flux = false;
  gen.tower = false;
  modeSnapshot = null;
  fluxQueue = [];
  viewZ = 0;
  zFloor = 0;
  zCeil = NZ;
}

function roll() {
  finishDemo();
  exitModes();
  gen.seed = Math.floor(P.random(1, 4294967295)) >>> 0;
  const prev = [...cells];
  startGen(compose(), prev);
}

// Any parameter change re-runs the pipeline for the *current* seed, so a slider
// shows you that parameter's effect rather than a different composition.
// Mid-drag the result is not recorded; the whole drag costs one undo.
function retune() {
  finishDemo();
  if (genPlay) finishGen();
  exitModes();
  const prev = dragSnapshot || [...cells];
  const ops = compose();
  cells = new Map();
  gen.rolled = true;
  for (const o of ops) applyOp(o);
  if (!dragSnapshot) record({ t: 'load', prev, next: [...cells] });
  dirty = true;
}

// Accretion under the same typing rules, reading whatever is in the lattice —
// hand-built or generated. This is where the generator takes over a build.
function growStep() {
  const keys = [...cells.keys()];
  if (!keys.length) return false;
  const occ = (x, y, z) => cells.has(key(x, y, z));
  for (let t = 0; t < 80; t++) {
    const [x, y, z] = keys[Math.floor(R() * keys.length)].split(',').map(Number);
    const d = Math.floor(R() * 5);
    const [dx, dy, dz] = d === 4 ? [0, 0, 1] : [DIRS[d][0], DIRS[d][1], 0];
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (!inBounds(nx, ny, nz) || occ(nx, ny, nz)) continue;
    // Cantilevers are allowed but rare; everything else stands on something.
    if (nz > 0 && !occ(nx, ny, nz - 1) && R() > 0.25) continue;
    if (P.noise(nx * 0.28, ny * 0.28, nz * 0.28) < 0.36) continue;
    const part = typeCell(nx, ny, nz, occ, dz === 0 ? d : undefined);
    const k = key(nx, ny, nz);
    cells.set(k, part);
    dirty = true;
    return k;                      // the caller may want to remember what grew
  }
  return null;
}

function grow(n) {
  finishDemo();
  if (genPlay) finishGen();
  const prev = [...cells];
  let added = 0;
  for (let i = 0; i < n; i++) if (growStep()) added++;
  if (added) record({ t: 'load', prev, next: [...cells] });
}

// ------------------------------------------------------------ endless: FLUX
//
// The bounded volume, alive: growth runs continuously and the oldest grown
// parts erode away, so the structure churns at roughly constant mass forever.

const FLUX_MS = 110;               // one churn tick
let fluxAt = 0;
let fluxTarget = 0;                // mass the churn holds itself to
let fluxQueue = [];                // keys in the order flux placed them
let modeSnapshot = null;           // world as it was when the mode was switched on

function fluxStep() {
  for (let i = 0; i < 2; i++) {
    if (cells.size >= fluxTarget + 12) break;
    const k = growStep();
    if (k) fluxQueue.push(k);
  }
  // Erode from the front of the queue: oldest first, so the change reads as a
  // conveyor rather than as flicker. Anything no longer exposed goes to the
  // back, and a cut that would orphan part of the structure is refused.
  let tries = 0;
  while (cells.size > fluxTarget && fluxQueue.length && tries++ < 8) {
    const k = fluxQueue.shift();
    const c = cells.get(k);
    if (!c) continue;
    const [x, y, z] = k.split(',').map(Number);
    if (cells.has(key(x, y, z + 1))) { fluxQueue.push(k); continue; }
    cells.delete(k);
    if (!connected()) { cells.set(k, c); fluxQueue.push(k); continue; }
    dirty = true;
    break;
  }
}

function setFlux(on) {
  if (on === gen.flux) return;
  if (on) {
    finishDemo();
    if (genPlay) finishGen();
    gen.tower = false;
    modeSnapshot = [...cells];
    fluxQueue = [];
    fluxTarget = Math.max(120, cells.size);
    gen.flux = true;
  } else {
    gen.flux = false;
    record({ t: 'load', prev: modeSnapshot, next: [...cells] });
    modeSnapshot = null;
  }
}

// ----------------------------------------------------------- endless: TOWER
//
// The volume becomes a shaft with no ceiling. Modules of MZ levels generate
// ahead of a camera that rises at a crawl, each picking its own template, and
// what falls far enough behind is pruned so the live set stays the size the
// bounded sandbox was.

const MZ = 8;                      // module height, in cells
const RISE = 1.15;                 // cells per second
// Half-height of the drawn window. The canvas shows roughly twelve levels at
// the tower's framing, so this is a margin over what is visible, not a guess.
const ZWIN = 9;
const KEEP = 3;                    // modules kept below the camera
let viewZ = 0;                     // camera altitude, in cells
let towerTop = 0;                  // top of the generated tower
let riseHold = 0;                  // climbing pauses until this timestamp

function generateModule(mi) {
  const z0 = mi * MZ, z1 = z0 + MZ;
  const below = mi === 0 ? null : (x, y, z) => cells.has(key(x, y, z));
  zCeil = z1;
  for (const o of composeRange(z0, z1, below, mi)) {
    cells.set(key(o.x, o.y, o.z), { part: o.part, rot: o.rot });
  }
  towerTop = z1;
  dirty = true;
}

// Prune whole modules rather than a sliding cut: the new bottom layer is then a
// module's own bottom layer, which is what keeps everything above it connected.
function pruneTower() {
  const floor = Math.max(0, (Math.floor(viewZ / MZ) - KEEP) * MZ);
  if (floor <= zFloor) return;
  for (const k of [...cells.keys()]) if (Number(k.split(',')[2]) < floor) cells.delete(k);
  zFloor = floor;
  dirty = true;
}

function towerStep(dt) {
  if (performance.now() > riseHold) viewZ += RISE * dt;
  while (towerTop < viewZ + MZ * 2) generateModule(towerTop / MZ);
  pruneTower();
  dirty = true;
}

function setTower(on) {
  if (on === gen.tower) return;
  if (on) {
    finishDemo();
    if (genPlay) finishGen();
    setFlux(false);
    modeSnapshot = [...cells];
    cells = new Map();
    viewZ = 0;
    towerTop = 0;
    zFloor = 0;
    gen.tower = true;
    gen.rolled = true;
    towerStep(0);
  } else {
    gen.tower = false;
    zCeil = Math.max(NZ, towerTop);
    record({ t: 'load', prev: modeSnapshot, next: [...cells] });
    modeSnapshot = null;
  }
}

function scrub(delta) {
  if (!gen.tower) return;
  // Scrubbing is clamped to the live window: what was pruned is gone, not
  // regenerated, and the climb pauses while you look.
  viewZ = Math.max(zFloor + 2, Math.min(towerTop - MZ, viewZ + delta));
  riseHold = performance.now() + 2500;
  dirty = true;
}

function paramLines() {
  const n = (v) => String(Math.round(v * 100)).padStart(2, '0');
  return [
    gen.rolled
      ? `${gen.tower ? 'TOWER' : template().id} · ${gen.seed.toString(16).toUpperCase().padStart(8, '0')}`
      : `${template().id} · UNROLLED`,
    `MIX ${n(gen.mix)} DEN ${n(gen.density)} GRN ${n(gen.grain)} ACC ${n(gen.accent)}`
      + ` TRM ${n(gen.trim)} · ${SYMS[gen.sym]}${gen.legs ? ' · LEGS' : ''}`,
  ];
}

// ------------------------------------------------------- the opening assembly

// A fixed sequence, identical on every load. It exists to teach the vocabulary
// without words, and to give the gallery thumbnail something to catch.
function demoOps() {
  const ops = [];
  const add = (part, x, y, z, rot = 0) =>
    ops.push({ part: PARTS.findIndex((p) => p.id === part), x, y, z, rot });
  const c = NX >> 1;

  // The core mass and the accent ribbon go down first, then the apron and the
  // marker posts finish the composition. Order matters beyond taste: the
  // gallery thumbnail is taken 2.5s into a 4s assembly, so anything placed in
  // the last third never appears on the tile. The accent has to land early.
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) add('BLOCK', c + dx, c + dy, 0);
  for (const [dx, dy] of [[-1, 0], [0, 0], [1, 0], [0, -1], [0, 1]]) add('BLOCK', c + dx, c + dy, 1);

  add('SLAB', c, c - 1, 2);
  add('SLAB', c, c + 1, 2);
  add('ELBOW', c - 1, c, 2, 3);
  add('TUBE', c, c, 2, 0);
  add('ELBOW', c + 1, c, 2, 1);

  // Apron: the perimeter of the 5x5 footprint, with ramps replacing the plates
  // on the axis. Corners are emitted once, not twice.
  for (let i = -2; i <= 2; i++) {
    add('PLATE', c + i, c - 2, 0, 0);
    add('PLATE', c + i, c + 2, 0, 0);
  }
  for (const i of [-1, 1]) {
    add('PLATE', c - 2, c + i, 0, 1);
    add('PLATE', c + 2, c + i, 0, 1);
  }
  add('RAMP', c - 2, c, 0, 0);
  add('RAMP', c + 2, c, 0, 2);
  for (const [dx, dy] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) add('POST', c + dx, c + dy, 0);
  return ops;
}

const DEMO = demoOps();
let demoAt = 0;                    // how many demo ops have landed
let demoDone = false;

function finishDemo() {
  if (demoDone) return;
  for (; demoAt < DEMO.length; demoAt++) {
    const o = DEMO[demoAt];
    cells.set(key(o.x, o.y, o.z), { part: o.part, rot: o.rot });
  }
  demoDone = true;
  past = [];
  future = [];
  dirty = true;
}

function demoWorld() {
  const m = new Map();
  for (const o of DEMO) m.set(key(o.x, o.y, o.z), { part: o.part, rot: o.rot });
  return [...m];
}

// -------------------------------------------------------------- view + input

let yaw = 0;                       // quarter-turns, integer at rest
let yawFrom = 0, yawTo = 0, yawAt = 0, turning = false;
let activePart = 0;
let activeRot = 0;
let mode = 'place';                // 'place' | 'delete'
let hover = null;                  // { x, y, z, nx, ny, nz, ground }
let dirty = true;                  // scene or camera changed; rebuild faces
let faces = [];
let idBuf = null, idList = [], idStale = true, idsAt = 0;
const hud = hitLayer();
let scale = 30, originX = 0, originY = 0;
let touchUsed = false;

const bearing = () => BEARINGS[((Math.round(yaw) % 4) + 4) % 4];

// Yaw the whole lattice about its vertical axis, then project. At rest the
// angle is an exact multiple of 90 degrees, so every edge lands on a true
// isometric angle; during a turn it sweeps between them.
function view(pt, angle) {
  const cx = NX / 2, cy = NY / 2;
  const dx = pt[0] - cx, dy = pt[1] - cy;
  const c = Math.cos(angle), s = Math.sin(angle);
  return [cx + dx * c - dy * s, cy + dx * s + dy * c, pt[2]];
}

function project(v, s = scale) {
  return [originX + s * COS30 * (v[0] - v[1]), originY + s * (0.5 * (v[0] + v[1]) - v[2])];
}

// Depth along the view vector. Larger is nearer, so faces sort ascending.
const depth = (v) => v[0] + v[1] + v[2];

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a;
}

// Tone follows the camera, not the part: tops stay lightest through every turn.
function toneIndex(n) {
  if (n[2] > 0.85) return 0;
  return COS30 * (n[0] - n[1]) > 0 ? 1 : 2;
}

const angleNow = () => {
  if (!turning) return yaw * Math.PI / 2;
  const t = Math.min(1, (performance.now() - yawAt) / TURN_MS);
  const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
  return (yawFrom + (yawTo - yawFrom) * e) * Math.PI / 2;
};

// Rebuild the visible face list. Cached — only camera or world changes touch it.
function rebuild() {
  const angle = angleNow();
  faces = [];
  idList = [];

  for (const [k, cell] of cells) {
    const [cx, cy, cz] = k.split(',').map(Number);
    const cd = depth(view([cx + 0.5, cy + 0.5, cz + 0.5], angle));
    const tones = TONE[PARTS[cell.part].tone];
    // Culling to a window around the camera is what keeps a tower's face list —
    // and therefore the sort and the ID buffer — the size the sandbox's is.
    if (gen.tower && (cz < viewZ - ZWIN || cz > viewZ + ZWIN)) continue;

    for (const q of GEO[cell.part][cell.rot]) {
      const world = q.v.map((v) => view([v[0] + cx, v[1] + cy, v[2] + cz], angle));
      const pts = world.map((v) => project(v));
      if (signedArea(pts) <= 0) continue;                       // back-facing
      const n = view([q.n[0], q.n[1], q.n[2]], angle);
      const nn = view([0, 0, 0], angle);
      const nv = [n[0] - nn[0], n[1] - nn[1], q.n[2]];
      let fd = 0;
      for (const w of world) fd += depth(w);
      faces.push({ pts, fill: tones[toneIndex(nv)], cd, fd: fd / world.length,
        id: idList.length + 1 });
      idList.push({ x: cx, y: cy, z: cz, n: q.n });
    }
  }

  // The ground plane is pickable but never drawn — it only exists so the first
  // part of a fresh build has somewhere to land. Once the tower has climbed
  // past it there is nothing there to click.
  for (let x = 0; !(gen.tower && viewZ > ZWIN) && x < NX; x++) {
    for (let y = 0; y < NY; y++) {
      if (cells.has(key(x, y, 0))) continue;
      const world = [[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]]
        .map((v) => view(v, angle));
      const pts = world.map((v) => project(v));
      if (signedArea(pts) <= 0) continue;
      idList.push({ x, y, z: -1, n: [0, 0, 1], ground: true, pts });
    }
  }

  faces.sort((a, b) => (a.cd - b.cd) || (a.fd - b.fd));
  dirty = false;
  idStale = true;
}

// ------------------------------------------------------------------- picking

function renderIds(p) {
  if (!idBuf) return;
  idBuf.clear();
  idBuf.background(0);
  idBuf.noStroke();
  const paint = (pts, id) => {
    idBuf.fill((id >> 16) & 255, (id >> 8) & 255, id & 255);
    idBuf.beginShape();
    for (const [x, y] of pts) idBuf.vertex(x, y);
    idBuf.endShape(idBuf.CLOSE);
  };
  // Ground first, so any real face wins the pixel.
  for (let i = 0; i < idList.length; i++) if (idList[i].ground) paint(idList[i].pts, i + 1);
  for (const f of faces) paint(f.pts, f.id);
  idBuf.loadPixels();
  idStale = false;
  idsAt = performance.now();
}

function pick(p, mx, my) {
  if (!idBuf || idStale || turning) return null;
  const x = Math.floor(mx), y = Math.floor(my);
  if (x < 0 || y < 0 || x >= idBuf.width || y >= idBuf.height) return null;
  const i = 4 * (y * idBuf.width + x);
  const px = idBuf.pixels;
  const id = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
  if (!id || id > idList.length) return null;
  return idList[id - 1];
}

// ------------------------------------------------------------------ drawing

function poly(g, pts, fill, stroke, weight) {
  g.fill(fill);
  if (stroke) { g.stroke(stroke); g.strokeWeight(weight); } else g.noStroke();
  g.beginShape();
  for (const [x, y] of pts) g.vertex(x, y);
  g.endShape(g.CLOSE);
}

function drawGround(g, s, angle) {
  g.noFill();
  // Interior lines sit back so the structure reads first; only the boundary of
  // the build volume is drawn in ink, framing it like a plinth.
  g.stroke('#c9c6ba');
  g.strokeWeight(0.8 * (s / scale));
  for (let i = 0; i <= NX; i++) {
    const a = project(view([i, 0, 0], angle), s), b = project(view([i, NY, 0], angle), s);
    const c = project(view([0, i, 0], angle), s), d = project(view([NX, i, 0], angle), s);
    g.line(a[0], a[1], b[0], b[1]);
    g.line(c[0], c[1], d[0], d[1]);
  }
  g.stroke(INK);
  g.strokeWeight(1.4 * (s / scale));
  const corners = [[0, 0, 0], [NX, 0, 0], [NX, NY, 0], [0, NY, 0]].map((v) => project(view(v, angle), s));
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    g.line(a[0], a[1], b[0], b[1]);
  }
}

function drawScene(g) {
  g.push();
  drawGround(g, scale, angleNow());
  for (const f of faces) poly(g, f.pts, f.fill, INK, 1.1);
  g.pop();
}

// The part that would land where you're pointing, drawn faint. Placement stops
// feeling like a guess.
function drawGhost(g) {
  if (!hover || mode !== 'place' || turning) return;
  const t = target();
  if (!t) return;
  const angle = angleNow();
  const tones = TONE[PARTS[activePart].tone];
  const out = [];
  for (const q of GEO[activePart][activeRot]) {
    const world = q.v.map((v) => view([v[0] + t.x, v[1] + t.y, v[2] + t.z], angle));
    const pts = world.map((v) => project(v));
    if (signedArea(pts) <= 0) continue;
    const n = view([q.n[0], q.n[1], q.n[2]], angle);
    const nn = view([0, 0, 0], angle);
    out.push({ pts, fill: tones[toneIndex([n[0] - nn[0], n[1] - nn[1], q.n[2]])],
      d: world.reduce((a, w) => a + depth(w), 0) });
  }
  out.sort((a, b) => a.d - b.d);
  g.push();
  g.drawingContext.globalAlpha = 0.45;
  for (const f of out) poly(g, f.pts, f.fill, INK, 1.1);
  g.pop();
}

function drawHoverMark(g) {
  if (!hover || turning) return;
  if (mode === 'delete' && hover.ground) return;
  const angle = angleNow();
  if (hover.ground) {
    const pts = [[hover.x, hover.y, 0], [hover.x + 1, hover.y, 0],
      [hover.x + 1, hover.y + 1, 0], [hover.x, hover.y + 1, 0]]
      .map((v) => project(view(v, angle)));
    poly(g, pts, g.color(250, 189, 47, 60), '#fabd2f', 1.6);
    return;
  }
  // Outline the hovered part's silhouette cheaply: re-stroke its visible faces.
  g.noFill();
  g.stroke(mode === 'delete' ? '#d1462f' : '#fabd2f');
  g.strokeWeight(2);
  for (let i = 0; i < idList.length; i++) {
    const e = idList[i];
    if (e.ground || e.x !== hover.x || e.y !== hover.y || e.z !== hover.z) continue;
    const f = faces.find((q) => q.id === i + 1);
    if (!f) continue;
    g.beginShape();
    for (const [x, y] of f.pts) g.vertex(x, y);
    g.endShape(g.CLOSE);
  }
}

// The cell a click would fill: the neighbour across the hovered face.
function target() {
  if (!hover) return null;
  if (hover.ground) {
    return cells.has(key(hover.x, hover.y, 0)) ? null : { x: hover.x, y: hover.y, z: 0 };
  }
  const n = snapNormal(hover.n);
  const t = { x: hover.x + n[0], y: hover.y + n[1], z: hover.z + n[2] };
  if (!inBounds(t.x, t.y, t.z) || cells.has(key(t.x, t.y, t.z))) return null;
  return t;
}

// ---------------------------------------------------------------------- HUD

function rect4(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

// Height of the generator panel, so a narrow layout can bottom-anchor it. Kept
// in step with the row increments in drawGenPanel by hand.
const PANEL_H = (u) => (14 + 18 + 14 + SLIDERS.length * 16 + 18 + 18 + 18 + 12) * u;

function drawGenPanel(g, u, x, y, w) {
  const bh = 15 * u, gap = 4 * u;
  poly(g, rect4(x - 10 * u, y - 10 * u, w + 20 * u, PANEL_H(u)), 'rgba(236,234,225,0.93)', INK, 1 * u);
  g.noStroke();
  g.fill('#8a8a80');
  g.textSize(7 * u);
  g.textAlign(g.LEFT, g.BASELINE);
  spaced(g, 'GENERATOR', x, y + 6 * u, 1.4 * u);
  y += 14 * u;

  button(g, u, x, y, w, bh, template().id, { style: BTN, layer: hud, label: 'TEMPLATE', action: () => {
    gen.template = (gen.template + 1) % TEMPLATES.length;
    retune();
  } });
  y += 18 * u;

  g.noStroke();
  g.textSize(7 * u);
  g.fill('#8a8a80');
  g.text('SEED', x, y + 6 * u);
  g.fill(INK);
  g.textAlign(g.RIGHT, g.BASELINE);
  g.text(gen.seed.toString(16).toUpperCase().padStart(8, '0'), x + w, y + 6 * u);
  g.textAlign(g.LEFT, g.BASELINE);
  y += 14 * u;

  for (const [label, k] of SLIDERS) {
    slider(g, u, x, y, w, label, gen[k], (v) => {
      if (v === gen[k]) return;
      gen[k] = v;
      dragMoved = true;
      retune();
    }, { style: BTN, layer: hud });
    y += 16 * u;
  }

  const half = (w - gap) / 2;
  button(g, u, x, y, half, bh, SYMS[gen.sym], { style: BTN, layer: hud, label: 'SYM', action: () => {
    gen.sym = (gen.sym + 1) % SYMS.length;
    retune();
  } });
  button(g, u, x + half + gap, y, half, bh, 'LEGS', { style: BTN, layer: hud, on: gen.legs, action: () => {
    gen.legs = !gen.legs;
    retune();
  } });
  y += 18 * u;

  const third = (w - 2 * gap) / 3;
  button(g, u, x, y, third, bh, 'ROLL', { style: BTN, layer: hud, action: roll });
  button(g, u, x + third + gap, y, third, bh, 'GROW', { style: BTN, layer: hud, action: () => grow(14) });
  button(g, u, x + 2 * (third + gap), y, third, bh, 'STEP', { style: BTN, layer: hud, action: () => grow(1) });
  y += 18 * u;

  // The two endless modes.
  button(g, u, x, y, half, bh, 'FLUX', { style: BTN, layer: hud, on: gen.flux, action: () => setFlux(!gen.flux) });
  button(g, u, x + half + gap, y, half, bh, 'TOWER', { style: BTN, layer: hud, on: gen.tower, action: () => setTower(!gen.tower) });
}

function drawHud(g, u, w, h, live) {
  const narrow = w < 560 * u;
  const M = 20 * u;
  g.push();
  g.textFont(MONO);
  g.textAlign(g.LEFT, g.BASELINE);

  regMarks(g, u, w, h, { theme: THEME, margin: 20 });

  // The rule ran from M + 14u to M + (narrow ? 190 : 260)u, so its width is the
  // difference: 176 narrow, 246 wide.
  titleBlock(g, u, {
    x: M + 14 * u, y: M + 20 * u,
    title: 'INCONSTRUCTIONS', titleSize: narrow ? 15 : 20, titleTracking: 2.4,
    sub: 'DELTA INC · MC-202 / Λ3', subColor: INK, subDy: 14,
    rule: narrow ? 176 : 246, ruleDy: 20,
    theme: THEME,
  });

  // readouts, top right
  const cell = hover ? (hover.ground ? [hover.x, hover.y, 0] : [hover.x, hover.y, hover.z]) : null;
  const rows = [
    ['CELL', cell ? cell.map((n) => String(n).padStart(2, '0')).join(' ') : '-- -- --'],
    ['PARTS', String(cells.size).padStart(3, '0')],
    ['BEARING', bearing()],
    ['MODE', mode.toUpperCase()],
  ];
  // The climb has a statistic attached to it, like everything else here.
  if (gen.tower) {
    rows.push(['ALT', String(Math.round(viewZ)).padStart(4, '0')]);
    rows.push(['MODULE', String(towerTop / MZ).padStart(3, '0')]);
  }
  readout(g, u, { x: w - M - 14 * u, y: M + 14 * u, rows, gap: 52, rowH: 13, size: 8, theme: THEME });

  // parts legend
  const lx = M + 14 * u;
  let ly = narrow ? h - 124 * u : M + 76 * u;
  if (narrow) {
    let x = lx;
    PARTS.forEach((part, i) => {
      const sw = 30 * u;
      poly(g, [[x, ly], [x + sw, ly], [x + sw, ly + 20 * u], [x, ly + 20 * u]],
        TONE[part.tone][1], i === activePart ? '#fabd2f' : INK, i === activePart ? 2.4 * u : 1 * u);
      if (live) hud.add(x, ly, sw, 20 * u, { action: () => { activePart = i; }, label: part.id });
      x += sw + 5 * u;
    });
  } else {
    g.textSize(8 * u);
    PARTS.forEach((part, i) => {
      const on = i === activePart;
      const rowH = 19 * u;
      if (on) poly(g, [[lx - 6 * u, ly - 2 * u], [lx + 150 * u, ly - 2 * u],
        [lx + 150 * u, ly + rowH - 4 * u], [lx - 6 * u, ly + rowH - 4 * u]], 'rgba(250,189,47,0.28)', null, 0);
      poly(g, [[lx, ly + 2 * u], [lx + 14 * u, ly + 2 * u], [lx + 14 * u, ly + 12 * u], [lx, ly + 12 * u]],
        TONE[part.tone][1], INK, 1 * u);
      g.noStroke();
      g.fill(INK);
      spaced(g, part.id, lx + 22 * u, ly + 11 * u, 1.2 * u);
      g.fill('#8a8a80');
      g.textAlign(g.RIGHT, g.BASELINE);
      g.text(part.code, lx + 150 * u, ly + 11 * u);
      g.textAlign(g.LEFT, g.BASELINE);
      if (live) hud.add(lx - 6 * u, ly - 2 * u, 156 * u, rowH, { action: () => { activePart = i; }, label: part.id });
      ly += rowH;
    });
    g.noStroke();
    g.fill('#8a8a80');
    g.textSize(7 * u);
    spaced(g, '1-7 SELECT · R ROTATE · Q/E VIEW', lx, ly + 12 * u, 0.8 * u);
    spaced(g, 'SPACE ROLL · T TEMPLATE · G GROW', lx, ly + 23 * u, 0.8 * u);
    spaced(g, 'F FLUX · W TOWER · WHEEL SCRUB', lx, ly + 34 * u, 0.8 * u);
  }

  // controls, bottom. Narrow screens get two rows rather than an overflowing
  // one — the strip has to fit inside the frame at any width.
  const bh = 22 * u;
  const gap = 5 * u;
  const row = (y, defs) => strip(g, u, M + 14 * u, y, bh, defs,
    { gap: 5, layer: hud, style: BTN, live });
  const PLACE = [44, 'PLACE', () => { mode = 'place'; }, mode === 'place'];
  const DELETE = [52, 'DELETE', () => { mode = 'delete'; }, mode === 'delete'];
  const ROT = [40, `R${activeRot}`, () => { activeRot = (activeRot + 1) % 4; }, false];
  const VIEW = [40, 'VIEW', () => turn(1), false];
  const UNDO = [40, 'UNDO', undo, false];
  const REDO = [40, 'REDO', redo, false];
  const PNG = [40, 'PNG', exportPng, false];

  const ROLL = [44, 'ROLL', roll, false];
  const GROW = [44, 'GROW', () => grow(14), false];
  const STEP = [40, 'STEP', () => grow(1), false];
  const GEN = [36, 'GEN', () => { gen.open = !gen.open; }, gen.open];

  const by = h - M - bh - 8 * u;
  if (narrow) {
    row(by - 2 * (bh + gap), [PLACE, DELETE, ROT, VIEW]);
    row(by - bh - gap, [UNDO, REDO, [40, 'CLR', () => swapWorld([]), false], PNG]);
    row(by, [ROLL, GROW, STEP, GEN]);
  } else {
    row(by, [PLACE, DELETE, ROT, VIEW, UNDO, REDO,
      [44, 'CLEAR', () => swapWorld([]), false],
      [44, 'RESET', () => swapWorld(demoWorld()), false], PNG, ROLL, GROW, GEN]);
  }

  // The printed parameter line. It is what makes a composition reproducible,
  // so it goes into the export while the dashboard itself does not.
  g.noStroke();
  g.fill('#8a8a80');
  g.textSize(7 * u);
  g.textAlign(g.RIGHT, g.BASELINE);
  // Stacked under the readout column, which grows by two rows in TOWER mode.
  const stackY = M + 14 * u + rows.length * 13 * u;
  paramLines().forEach((line, i) => {
    g.fill(i === 0 ? INK : '#8a8a80');
    g.text(line, w - M - 14 * u, stackY + 4 * u + i * 12 * u);
  });
  g.textAlign(g.LEFT, g.BASELINE);

  // The generator panel: a right-hand column on desktop, a bottom-anchored
  // overlay on a phone. Only ever drawn live — never into the export.
  if (live && gen.open) {
    const pw = narrow ? w - 2 * (M + 14 * u) : 196 * u;
    const px = narrow ? M + 14 * u : w - M - 14 * u - pw;
    const py = narrow ? h - 132 * u - PANEL_H(u) : stackY + 40 * u;
    drawGenPanel(g, u, px, py, pw);
    // Declared last so the panel's own controls win the pixel: everything else
    // inside the frame is swallowed, and a stray click cannot edit the lattice.
    hud.region(px - 10 * u, py - 10 * u, pw + 20 * u, PANEL_H(u));
  }
  g.pop();
}

// ------------------------------------------------------------------ p5 setup

let P = null;

function fit(p) {
  // Fit the whole build volume with margin, then centre it.
  const w = p.width, h = p.height;
  // In TOWER mode the framing is a fixed window travelling up the shaft, so the
  // scale must not be derived from a volume that keeps getting taller.
  const zSpan = gen.tower ? 15 : NZ;
  const focus = gen.tower ? viewZ + 3 : NZ * 0.28;
  const sw = w / ((NX + NY - 2) * COS30 + 4);
  const sh = h / ((NX + NY) * 0.5 + zSpan * 0.55 + 4);
  scale = Math.max(10, Math.min(sw, sh));
  originX = 0;
  originY = 0;
  const c = project(view([NX / 2, NY / 2, focus], angleNow()));
  originX = w / 2 - c[0];
  originY = h / 2 - c[1];
}

function turn(dir) {
  if (turning) return;
  yawFrom = yaw;
  yawTo = yaw + dir;
  yawAt = performance.now();
  turning = true;
}

function exportPng() {
  exportPngTo(P, {
    // A rolled composition is reproducible from its seed, so the file carries
    // it; the reference build has no seed to claim.
    name: gen.rolled ? `inconstructions-${gen.seed.toString(16)}` : 'inconstructions',
    render: (g, u) => {
      g.background(PAPER);
      const ox = originX, oy = originY, sc = scale;
      originX *= u; originY *= u; scale *= u;
      rebuildAt(g, u);
      originX = ox; originY = oy; scale = sc;
      drawHud(g, u, P.width * u, P.height * u, false);
    },
  });
  dirty = true;
}

// Render the scene straight into an arbitrary buffer at the current transform.
function rebuildAt(g, u) {
  const angle = angleNow();
  drawGround(g, scale, angle);
  const list = [];
  for (const [k, cell] of cells) {
    const [cx, cy, cz] = k.split(',').map(Number);
    const cd = depth(view([cx + 0.5, cy + 0.5, cz + 0.5], angle));
    const tones = TONE[PARTS[cell.part].tone];
    for (const q of GEO[cell.part][cell.rot]) {
      const world = q.v.map((v) => view([v[0] + cx, v[1] + cy, v[2] + cz], angle));
      const pts = world.map((v) => project(v));
      if (signedArea(pts) <= 0) continue;
      const n = view([q.n[0], q.n[1], q.n[2]], angle);
      const nn = view([0, 0, 0], angle);
      list.push({ pts, fill: tones[toneIndex([n[0] - nn[0], n[1] - nn[1], q.n[2]])], cd,
        fd: world.reduce((a, w) => a + depth(w), 0) / world.length });
    }
  }
  list.sort((a, b) => (a.cd - b.cd) || (a.fd - b.fd));
  for (const f of list) poly(g, f.pts, f.fill, INK, 1.1 * u);
}

let dragHit = null;

function hudClick(mx, my) {
  const hit = hud.press(mx, my);
  if (hit) {
    if (hit.drag) {
      // A drag is one undo entry, so the world is snapshotted before the first
      // value change rather than on every frame of the drag.
      dragHit = hit;
      dragSnapshot = [...cells];
      dragMoved = false;
      hit.drag(mx, my);
    } else if (hit.action) {
      hit.action();
    }
    return true;
  }
  // The panel's own background: swallow the click rather than editing the
  // lattice behind it.
  return hud.swallows(mx, my);
}

function dragTo(mx, my) {
  if (dragHit) dragHit.drag(mx, my);
}

function endDrag() {
  if (dragHit && dragMoved) record({ t: 'load', prev: dragSnapshot, next: [...cells] });
  dragHit = null;
  dragSnapshot = null;
  dragMoved = false;
}

function act(mx, my) {
  if (!demoDone) { finishDemo(); return; }
  if (genPlay) { finishGen(); return; }
  if (hudClick(mx, my)) return;
  const hit = pick(P, mx, my);
  if (!hit) return;
  if (mode === 'delete') {
    if (!hit.ground) remove(hit.x, hit.y, hit.z);
    return;
  }
  hover = hit;
  const t = target();
  if (t) place(t.x, t.y, t.z, activePart, activeRot);
}

let probeG = null;

// The HUD is drawn on the canvas, so a test can't read it as text. This is the
// one external seam: a read-only view of exactly what the HUD already shows,
// with no way to drive the sketch from outside.
if (typeof window !== 'undefined') {
  window.__inconstructions = {
    parts: () => cells.size,
    bearing: () => bearing(),
    mode: () => mode,
    activePart: () => PARTS[activePart].id,
    rot: () => activeRot,
    demoDone: () => demoDone,
    cell: () => (hover ? [hover.x, hover.y, hover.ground ? 0 : hover.z] : null),
    // The cell the ghost preview is currently occupying, or null when a click
    // here would be refused. Exactly what the ghost already shows on screen.
    target: () => { const t = target(); return t ? [t.x, t.y, t.z] : null; },
    undoDepth: () => past.length,
    redoDepth: () => future.length,
    // Where a named control actually is, so tests never hardcode a pixel and
    // break the moment the panel gains a row — which is exactly what happened
    // when the generator dashboard pushed everything down by ten.
    buttonAt: (label) => {
      const b = hud.find(label);
      return b ? { x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) } : null;
    },
    // A scratch buffer so a test can exercise the shared type module against
    // the same p5 text metrics the sketch itself uses. Made once, not per call.
    graphics: () => (probeG || (probeG = P.createGraphics(200, 60))),
    // Generator state — the same values the panel and the printed parameter
    // line already show, plus a fingerprint of the lattice so a test can tell
    // "the same composition came back" without being able to set a seed.
    seed: () => gen.seed,
    template: () => template().id,
    symmetry: () => SYMS[gen.sym],
    params: () => ({ mix: gen.mix, density: gen.density, grain: gen.grain,
      accent: gen.accent, trim: gen.trim, legs: gen.legs }),
    panelOpen: () => gen.open,
    generating: () => genPlay !== null,
    signature: () => signature(),
    grounded: () => connected(),
    flux: () => gen.flux,
    tower: () => gen.tower,
    altitude: () => Math.round(viewZ),
    modules: () => towerTop / MZ,
    // Highest occupied level — how a test tells an unbounded tower from a
    // composition that merely fills the sandbox.
    top: () => {
      let hi = -1;
      for (const k of cells.keys()) hi = Math.max(hi, Number(k.split(',')[2]));
      return hi;
    },
  };
}

new p5((p) => {
  P = p;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    idBuf = p.createGraphics(p.width, p.height);
    idBuf.pixelDensity(1);
    if (idBuf.noSmooth) idBuf.noSmooth();
    fit(p);
    p.textFont(MONO);
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    idBuf.remove();
    idBuf = p.createGraphics(p.width, p.height);
    idBuf.pixelDensity(1);
    if (idBuf.noSmooth) idBuf.noSmooth();
    fit(p);
    dirty = true;
  };

  p.draw = () => {
    // opening assembly
    if (!demoDone) {
      const want = Math.floor((p.millis() / DEMO_MS) * DEMO.length);
      while (demoAt < Math.min(want, DEMO.length)) {
        const o = DEMO[demoAt++];
        cells.set(key(o.x, o.y, o.z), { part: o.part, rot: o.rot });
        dirty = true;
      }
      if (demoAt >= DEMO.length) { demoDone = true; past = []; future = []; }
    }

    // the endless modes
    if (gen.tower) towerStep(Math.min(50, p.deltaTime) / 1000);
    else if (gen.flux && p.millis() - fluxAt > FLUX_MS) {
      fluxAt = p.millis();
      fluxStep();
    }

    // a generated composition assembling itself
    if (genPlay) {
      const want = Math.floor(((performance.now() - genPlay.start) / GEN_MS) * genPlay.ops.length);
      while (genPlay.at < Math.min(want, genPlay.ops.length)) applyOp(genPlay.ops[genPlay.at++]);
      if (genPlay.at >= genPlay.ops.length) finishGen();
    }

    if (turning) {
      dirty = true;
      if (performance.now() - yawAt >= TURN_MS) {
        turning = false;
        yaw = ((yawTo % 4) + 4) % 4;
      }
    }

    if (dirty) { fit(p); rebuild(); }
    // renderIds ends in a full-canvas readback. While the tower climbs the
    // scene is dirty every frame, so it is throttled — hover precision during a
    // slow climb is worth less than the frame rate.
    if (idStale && !turning && (!gen.tower || performance.now() - idsAt > 130)) renderIds(p);
    if (!touchUsed) hover = pick(p, p.mouseX, p.mouseY);

    p.background(PAPER);
    drawScene(p);
    drawGhost(p);
    drawHoverMark(p);
    hud.clear();
    drawHud(p, 1, p.width, p.height, true);
  };

  p.mousePressed = () => {
    if (touchUsed) return;
    act(p.mouseX, p.mouseY);
    return false;
  };

  p.mouseDragged = () => {
    if (touchUsed) return false;
    dragTo(p.mouseX, p.mouseY);
    return false;
  };

  p.mouseReleased = () => {
    endDrag();
    return false;
  };

  p.mouseWheel = (e) => {
    if (!gen.tower) return;
    scrub(-e.delta / 40);
    return false;
  };

  p.touchStarted = () => {
    touchUsed = true;
    const t = (p.touches && p.touches[0]) || { x: p.mouseX, y: p.mouseY };
    hover = pick(p, t.x, t.y);
    act(t.x, t.y);
    return false;
  };

  p.touchMoved = () => {
    const t = (p.touches && p.touches[0]) || { x: p.mouseX, y: p.mouseY };
    dragTo(t.x, t.y);
    return false;
  };

  p.touchEnded = () => {
    endDrag();
    return false;
  };

  p.keyPressed = () => {
    if (!demoDone) { finishDemo(); return false; }
    if (genPlay) { finishGen(); return false; }
    const k = p.key.toLowerCase();
    if (k === ' ') { roll(); return false; }
    if (k >= '1' && k <= String(PARTS.length)) activePart = Number(k) - 1;
    else if (k === 'r') activeRot = (activeRot + 1) % 4;
    else if (k === 'q') turn(-1);
    else if (k === 'e') turn(1);
    else if (k === 'x') mode = mode === 'place' ? 'delete' : 'place';
    else if (k === 'c') swapWorld([]);
    else if (k === 't') { gen.template = (gen.template + 1) % TEMPLATES.length; retune(); }
    else if (k === 'm') { gen.sym = (gen.sym + 1) % SYMS.length; retune(); }
    else if (k === 'g') grow(14);
    else if (k === 'n') grow(1);
    else if (k === 'p') gen.open = !gen.open;
    else if (k === 'f') setFlux(!gen.flux);
    else if (k === 'w') setTower(!gen.tower);
    else if (k === 'z' && (p.keyIsDown(p.CONTROL) || p.keyIsDown(91))) p.keyIsDown(p.SHIFT) ? redo() : undo();
    else if (k === 'z') undo();
    else if (k === 'y') redo();
    else if (k === 's') exportPng();
    return false;
  };
});
