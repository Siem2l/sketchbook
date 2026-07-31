// splinter — a Vectorheart debris field in real 3D, which you can walk around
// and draw into.
//
// Two references, one generator. At one pole, Chapter Three: flat angular
// shards exploding from a focus with hairline rays woven through. At the other,
// MC-202: extruded hardware — rods, boxes, discs — streaming along a diagonal
// under chevrons, arrows and labels. A MIX control runs between them.
//
// The scene is genuinely three-dimensional: every fragment has a position and
// geometry in world space, and an orbiting camera projects it. That means the
// isometric look of the reference posters is not a special case baked into the
// maths — it is simply the ORTHO camera parked at 45°/35°, and you can leave it.
//
// Rendering stays on the 2D canvas rather than WebGL. Faces are projected,
// back-face culled, sorted by depth and filled flat with a hairline stroke,
// which is precisely the look a GPU pipeline fights you for. The cost is
// painter's-algorithm ordering: two interpenetrating fragments can sort wrong.
// In a cloud of flying debris that is close to invisible.
//
// A composition is a pure function of its seed. Seed, view, mix, palette and
// motion are all printed on the page, so any image can be found again.
import p5 from 'p5';

// --------------------------------------------------------------- palettes

const PALETTES = [
  { name: 'VERMILION', bg: '#f7f7f4', ink: '#141412', accent: '#d2402a',
    cols: [
      { fill: '#ffffff', w: 38 }, { fill: '#efefec', w: 15 }, { fill: '#dcdcd8', w: 10 },
      { fill: '#d2402a', w: 14 }, { fill: '#e8836a', w: 8 }, { fill: '#f3b8a7', w: 6 },
      { fill: '#a82d18', w: 4 }, { fill: '#2b2b28', w: 3, smallOnly: true }] },
  // The MC-202 set: pillarbox red, hard black, warm cream.
  { name: 'BLASTER', bg: '#fbfaf7', ink: '#1d1d1b', accent: '#e2231a',
    cols: [
      { fill: '#efece1', w: 28 }, { fill: '#ffffff', w: 16 }, { fill: '#d8d5c9', w: 9 },
      { fill: '#e2231a', w: 20 }, { fill: '#f0574a', w: 7 },
      { fill: '#2b2b2b', w: 15 }, { fill: '#565654', w: 5 }] },
  { name: 'SULPHUR', bg: '#f4f2e8', ink: '#16160f', accent: '#e0a316',
    cols: [
      { fill: '#ffffff', w: 36 }, { fill: '#eeece2', w: 15 }, { fill: '#d8d5c7', w: 10 },
      { fill: '#fabd2f', w: 15 }, { fill: '#ffd769', w: 8 }, { fill: '#b07d10', w: 6 },
      { fill: '#26261c', w: 5, smallOnly: true }] },
  { name: 'CYAN', bg: '#f1f5f6', ink: '#0f1416', accent: '#0090b4',
    cols: [
      { fill: '#ffffff', w: 38 }, { fill: '#e9eff1', w: 15 }, { fill: '#d2dcdf', w: 10 },
      { fill: '#0090b4', w: 14 }, { fill: '#4fbcd8', w: 8 }, { fill: '#a9dceb', w: 6 },
      { fill: '#015f78', w: 4 }, { fill: '#14201f', w: 3, smallOnly: true }] },
  { name: 'INK', bg: '#f4f4f1', ink: '#0f0f0e', accent: '#1a1a18',
    cols: [
      { fill: '#ffffff', w: 34 }, { fill: '#ececea', w: 17 }, { fill: '#d5d5d1', w: 13 },
      { fill: '#a8a8a3', w: 11 }, { fill: '#6d6d68', w: 9 }, { fill: '#3a3a37', w: 7 },
      { fill: '#141412', w: 5, smallOnly: true }] },
];

// --------------------------------------------------------------- structure

// Foci are 3D now. `stretch` elongates the cloud along an axis — how STREAM
// gets MC-202's diagonal river of hardware rather than a ball of debris.
const VIEWS = [
  { name: 'BURST', foci: 1, spread: 1.0, hw: 0.15, stretch: [1, 1, 1],
    place: (r) => [{ x: 0, y: 0, z: 0, a: 0 }] },
  { name: 'TWIN', foci: 2, spread: 0.7, hw: 0.3, stretch: [1.4, 0.8, 1],
    place: (r) => [{ x: -r(0.2, 0.5), y: r(-0.2, 0.2), z: 0, a: 0 },
      { x: r(0.2, 0.5), y: r(-0.1, 0.3), z: r(-0.3, 0.3), a: 0 }] },
  { name: 'COLUMN', foci: 1, spread: 0.9, hw: 0.25, stretch: [0.55, 2.4, 0.55],
    place: (r) => [{ x: 0, y: r(-0.2, 0.2), z: 0, a: 0 }] },
  { name: 'SHOAL', foci: 3, spread: 0.6, hw: 0.4, stretch: [2.2, 0.5, 1.2],
    place: (r) => [{ x: -r(0.3, 0.7), y: r(-0.3, 0), z: r(-0.2, 0.2), a: 0 },
      { x: r(-0.1, 0.2), y: r(-0.1, 0.2), z: r(-0.3, 0.3), a: 0 },
      { x: r(0.4, 0.8), y: r(0, 0.3), z: r(-0.2, 0.2), a: 0 }] },
  // MC-202: a dense mass streaming along one diagonal.
  { name: 'STREAM', foci: 1, spread: 0.8, hw: 0.92, stretch: [2.6, 1.5, 0.7],
    place: (r) => [{ x: 0, y: 0, z: 0, a: 0 }] },
];

const MIXES = [
  { name: 'AUTO', hw: null }, { name: 'SHARDS', hw: 0.02 },
  { name: 'MIXED', hw: 0.5 }, { name: 'HARDWARE', hw: 0.95 },
];

// Which vocabularies are in play. Toggling these is the difference between a
// Chapter Three field and an MC-202 one.
const COMP = { shard: true, rod: true, box: true, disc: true, glyph: true, label: true, ray: true };
const COMP_KEYS = ['shard', 'rod', 'box', 'disc', 'glyph', 'label', 'ray'];

const MOTIONS = [{ name: 'STILL' }, { name: 'DRIFT' }, { name: 'ORBIT' },
  { name: 'BREATHE' }, { name: 'TUMBLE' }];
const SPEEDS = [{ name: 'SLOW', v: 0.35 }, { name: 'MED', v: 1 }, { name: 'FAST', v: 2.4 }];

const LABELS = ['MC-202', 'Λ3', '1983', 'EXIT', 'A3', 'GHETTO BLASTER',
  'NORTHEASTERN', 'SECTOR 7', 'TYPE-R', 'NO SIGNAL', 'BLASTER'];

// ------------------------------------------------------------------ random

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
const rnd = (lo = 0, hi = 1) => lo + R() * (hi - lo);
// Biased low with a long tail — most fragments are small, a few are huge.
const tailed = (lo, hi, power) => lo + (hi - lo) * Math.pow(R(), power);
const pick = (a) => a[Math.floor(R() * a.length)];

// -------------------------------------------------------------- 3D basics

const v3 = (x, y, z) => ({ x, y, z });
const vadd = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const vsub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const vmul = (a, s) => v3(a.x * s, a.y * s, a.z * s);
const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const vcross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
function vnorm(a) {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
}
// A pair of axes spanning the plane perpendicular to n — used to lay flat
// fragments out in their own plane before placing them in the world.
function basis(n) {
  const up = Math.abs(n.y) > 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
  const u = vnorm(vcross(up, n));
  return [u, vcross(n, u)];
}
// Rodrigues rotation — spin a vector about an arbitrary axis. Fragments carry
// their own axis and rate, which is what makes them tumble rather than slide.
function vrot(v, axis, ang) {
  const c = Math.cos(ang), si = Math.sin(ang);
  const cr = vcross(axis, v), d = vdot(axis, v) * (1 - c);
  return v3(v.x * c + cr.x * si + axis.x * d,
    v.y * c + cr.y * si + axis.y * d,
    v.z * c + cr.z * si + axis.z * d);
}

function randomDir() {
  const z = rnd(-1, 1), t = rnd(0, Math.PI * 2), r = Math.sqrt(1 - z * z);
  return v3(Math.cos(t) * r, Math.sin(t) * r, z);
}

// ------------------------------------------------------------------ camera

// Orbit camera. ORTHO parked at 45°/35.26° is exactly the isometric projection
// the reference posters are drawn in; PERSP is what makes walking around feel
// like walking around.
const cam = { yaw: -Math.PI / 4, pitch: 0.6155, dist: 2.6, ortho: true,
  target: v3(0, 0, 0), zoom: 1 };

function camBasis() {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  // Rows of the view rotation: right, up, forward(toward camera).
  return {
    r: v3(cy, 0, -sy),
    u: v3(sy * sp, cp, cy * sp),
    f: v3(sy * cp, -sp, cy * cp),
  };
}

let VB = camBasis();
let camPos = v3(0, 0, 0);
let unit = 1;                       // world unit -> screen pixels

function updateCamera(w, h) {
  VB = camBasis();
  unit = Math.min(w, h) * 0.46 * cam.zoom;
  camPos = vadd(cam.target, vmul(VB.f, cam.dist));
}

// Project a world point. Returns screen x/y plus a depth for sorting; null when
// the point falls behind a perspective camera.
function project(p, k, ox, oy) {
  const d = vsub(p, cam.target);
  const x = vdot(d, VB.r), y = vdot(d, VB.u), z = vdot(d, VB.f);
  if (cam.ortho) return { x: ox + x * unit * k, y: oy - y * unit * k, d: -z };
  const depth = cam.dist - z;
  if (depth < 0.05) return null;
  const s = (unit * 1.5) / depth;
  return { x: ox + x * s * k, y: oy - y * s * k, d: depth };
}

// ------------------------------------------------------------------ colour

function weightedColour(p) {
  const total = p.cols.reduce((a, c) => a + c.w, 0);
  let r = R() * total;
  for (const c of p.cols) { r -= c.w; if (r <= 0) return c; }
  return p.cols[0];
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f)));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}
const strokeOf = (hex) => shade(hex, -0.55);

// ------------------------------------------------------------- vocabularies

// A real box: eight corners, six faces, each with an outward normal so the
// renderer can cull the ones facing away. Solids are shaded per face from one
// base colour so each object still reads as a single thing.
function boxFaces(c, ax, ay, az, ex, ey, ez, fill) {
  const P = (i, j, k) => vadd(c, vadd(vadd(vmul(ax, i * ex), vmul(ay, j * ey)), vmul(az, k * ez)));
  const q = [
    { n: ax, s: 1, v: [P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)] },
    { n: vmul(ax, -1), s: -1, v: [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)] },
    { n: ay, s: 1, v: [P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1)] },
    { n: vmul(ay, -1), s: -1, v: [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)] },
    { n: az, s: 1, v: [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)] },
    { n: vmul(az, -1), s: -1, v: [P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1)] },
  ];
  // Tone by face orientation so solids read consistently as the camera moves.
  return q.map((f) => {
    const t = f.n.y > 0.5 ? 0.22 : f.n.y < -0.5 ? -0.34 : (f.n.x > 0.3 ? 0 : -0.16);
    return { v: f.v, n: f.n, fill: shade(fill, t), stroke: strokeOf(fill), cull: true };
  });
}

// A flat polygon living in its own plane — the Chapter Three shard. Double
// sided, so it is never culled.
function flatFace(c, n, len, wid, fill, sides) {
  const [u, w] = basis(n);
  const k = sides || 3 + Math.floor(R() * 3);
  const angs = [];
  for (let i = 0; i < k; i++) angs.push(rnd(0, Math.PI * 2));
  angs.sort((a, b) => a - b);
  const v = angs.map((t) => {
    const rr = rnd(0.4, 1);
    return vadd(c, vadd(vmul(u, Math.cos(t) * rr * len * 0.5), vmul(w, Math.sin(t) * rr * wid * 0.5)));
  });
  return [{ v, n, fill, stroke: strokeOf(fill), cull: false }];
}

function discFace(c, n, r, fill) {
  const [u, w] = basis(n);
  const v = [];
  for (let i = 0; i < 20; i++) {
    const t = (i / 20) * Math.PI * 2;
    v.push(vadd(c, vadd(vmul(u, Math.cos(t) * r), vmul(w, Math.sin(t) * r))));
  }
  return [{ v, n, fill, stroke: strokeOf(fill), cull: false }];
}

// A rod: a long box with contrasting collars and an end cap. MC-202's unit.
function rodFaces(c, dir, len, rad, p) {
  const ax = vnorm(dir);
  const [ay, az] = basis(ax);
  const base = weightedColour(p).fill;
  const out = boxFaces(c, ax, ay, az, len, rad, rad, base);
  const bands = Math.floor(rnd(0, 3));
  for (let i = 0; i < bands; i++) {
    const t = rnd(-0.75, 0.75);
    out.push(...boxFaces(vadd(c, vmul(ax, len * t)), ax, ay, az,
      len * rnd(0.06, 0.15), rad * 1.3, rad * 1.3, weightedColour(p).fill));
  }
  if (R() < 0.5) out.push(...discFace(vadd(c, vmul(ax, len * 1.02)), ax, rad * 1.15, shade(base, 0.3)));
  return out;
}

// Flat marks that always face the camera — chevrons, arrows, bars. In the
// references these live in the picture plane, not in the scene's space.
function glyphBillboard(c, s, fill) {
  const kind = Math.floor(R() * 4);
  const pts = [];
  if (kind < 2) {
    for (let i = 0; i < (kind === 0 ? 1 : 2); i++) {
      const o = i * s * 0.55;
      pts.push([[o - s * 0.5, 0], [o, -s * 0.42], [o + s * 0.12, -s * 0.42],
        [o - s * 0.34, 0], [o + s * 0.12, s * 0.42], [o, s * 0.42]]);
    }
  } else if (kind === 2) {
    pts.push([[-s * 0.45, s * 0.4], [0, -s * 0.45], [s * 0.45, s * 0.4]]);
  } else {
    const h = s * rnd(0.05, 0.13);
    pts.push([[-s * 0.5, -h], [s * 0.5, -h], [s * 0.5, h], [-s * 0.5, h]]);
  }
  return { billboard: pts, at: c, fill, rot: rnd(-0.35, 0.35) };
}

// ------------------------------------------------------------- composition

let seed = 1;
let paletteIx = 0, viewIx = 0, mixIx = 0, motionIx = 0, speedIx = 1;
let mode = 'LOOK';
let foci = [];
let scene = [];
let strokes = [];
let revealAt = 0, clock = 0;

const pal = () => PALETTES[paletteIx];
const view = () => VIEWS[viewIx];
const mixHw = () => (MIXES[mixIx].hw === null ? view().hw : MIXES[mixIx].hw);

function chooseKind(hw) {
  const hard = ['rod', 'box', 'disc'].filter((k) => COMP[k]);
  const flat = ['shard'].filter((k) => COMP[k]);
  const pool = (R() < hw && hard.length) ? hard : (flat.length ? flat : hard);
  if (!pool.length) return null;
  if (pool === hard) {
    const w = { rod: 0.78, box: 0.19, disc: 0.03 };
    let tot = pool.reduce((a, k) => a + w[k], 0), r = R() * tot;
    for (const k of pool) { r -= w[k]; if (r <= 0) return k; }
  }
  return pool[Math.floor(R() * pool.length)];
}

function piece(f, v, p, hw) {
  const kind = chooseKind(hw);
  if (!kind) return null;

  // Density falls off with distance: a dense knot at the focus thinning to a
  // spray. Uniform coverage kills the burst.
  const dir = randomDir();
  const r = tailed(0.02, hw > 0.6 ? 0.78 : 1.15, hw > 0.6 ? 2.3 : 1.8);
  const at = v3(f.x + dir.x * r * v.stretch[0],
    f.y + dir.y * r * v.stretch[1],
    f.z + dir.z * r * v.stretch[2]);

  // Fragments grow as they travel outward — the cue that reads as explosion.
  const grow = 0.3 + r * 0.62;
  const len = grow * tailed(0.025, 0.2, 2.05);

  // Geometry is built about the origin and carried by the piece's own
  // position and orientation, so a fragment can tumble as a rigid body.
  const O = v3(0, 0, 0);
  let faces, col;
  if (kind === 'rod') {
    const rl = Math.min(len, 0.24), rr = Math.max(0.004, len / rnd(6, 17));
    faces = rodFaces(O, dir, rl, rr, p);
    // A rod is a capsule, not a sphere. This is the whole reason for Tier 2:
    // a bounding sphere round a long bar is mostly air, so rods would hover
    // apart instead of crossing and stacking.
    col = { kind: 'cap', ax: vnorm(dir), h: Math.max(0, rl - rr), r: rr * 1.15 };
  } else if (kind === 'box') {
    const s = len * rnd(0.16, 0.4);
    const ax = vnorm(randomDir());
    const [ay, az] = basis(ax);
    const ey = s * rnd(0.5, 1.5), ez = s * rnd(0.5, 1.5);
    faces = boxFaces(O, ax, ay, az, s, ey, ez, weightedColour(p).fill);
    col = { kind: 'obb', u: ax, v: ay, w: az, he: v3(s, ey, ez) };
  } else if (kind === 'disc') {
    const dr = len * rnd(0.1, 0.26);
    faces = discFace(O, vnorm(randomDir()), dr, weightedColour(p).fill);
    col = { kind: 'cap', ax: v3(1, 0, 0), h: 0, r: dr * 0.8 };
  } else {
    let c = weightedColour(p);
    // Near-black reads as a hole punched in the paper — fine as a fleck, wrong
    // as a slab. The reference never uses it at scale.
    if (c.smallOnly && len > 0.12) c = p.cols[0];
    // Shards lie in a plane that mostly contains their flight direction, so
    // they read as spinning flakes rather than randomly angled cards.
    const n = vnorm(vadd(vcross(dir, randomDir()), vmul(randomDir(), 0.25)));
    const wid = len / tailed(2, 20, 1.6);
    faces = flatFace(O, n, len, wid, c.fill);
    const [bu, bw] = basis(n);
    // A shard is a very flat box, which SAT handles happily.
    col = { kind: 'obb', u: bu, v: bw, w: n, he: v3(len * 0.4, wid * 0.4, len * 0.02 + 0.002) };
  }
  // Smaller debris tumbles faster, which is what sells the scale difference.
  return { faces, at, home: at, dir, rev: R(), size: len, col,
    spinAxis: randomDir(), spinRate: rnd(-1, 1) * (0.6 + 0.5 / (len + 0.08)),
    vel: v3(0, 0, 0), rot: 0, focus: v3(f.x, f.y, f.z) };
}

function rayPiece(f, v, p) {
  if (!COMP.ray) return null;
  const dir = randomDir();
  const r0 = tailed(0, 0.5, 1.6), r1 = r0 + rnd(0.25, 1.5);
  const S = (t) => v3(f.x + dir.x * t * v.stretch[0], f.y + dir.y * t * v.stretch[1],
    f.z + dir.z * t * v.stretch[2]);
  return {
    line: { a: S(r0), b: S(r1), col: R() < 0.62 ? p.accent : '#9a9a94',
      alpha: rnd(25, 130), weight: rnd(0.35, 1.3) },
    at: S((r0 + r1) / 2), home: S((r0 + r1) / 2), dir, rev: R(),
    vel: v3(0, 0, 0), focus: v3(f.x, f.y, f.z),
  };
}

function markPiece(f, v, p) {
  if (!COMP.glyph && !COMP.label) return null;
  const dir = randomDir();
  const r = tailed(0.1, 1.3, 1.3);
  const at = v3(f.x + dir.x * r * v.stretch[0], f.y + dir.y * r * v.stretch[1],
    f.z + dir.z * r * v.stretch[2]);
  if (COMP.label && (!COMP.glyph || R() < 0.34)) {
    return { label: { text: pick(LABELS), size: rnd(0.009, 0.022),
      col: R() < 0.45 ? p.accent : p.ink, rot: rnd(-0.2, 0.2) },
      at, home: at, dir, rev: R(), vel: v3(0, 0, 0), focus: v3(f.x, f.y, f.z) };
  }
  return { glyph: glyphBillboard(v3(0, 0, 0), rnd(0.022, 0.075), R() < 0.55 ? p.accent : p.ink),
    at, home: at, dir, rev: R(), vel: v3(0, 0, 0), focus: v3(f.x, f.y, f.z) };
}

function build() {
  const v = view(), p = pal(), hw = mixHw();
  const out = [];
  const per = Math.round(rnd(420, 640) * (hw > 0.6 ? 1.35 : 1) / foci.length);
  for (const f of foci) {
    for (let i = 0; i < per; i++) out.push(piece(f, v, p, hw));
    for (let i = 0; i < Math.round(rnd(45, 90) / foci.length); i++) out.push(rayPiece(f, v, p));
    // Graphic furniture scales with how much hardware is in the mix — the
    // chevrons and callouts belong to MC-202, not to Chapter Three.
    const marks = Math.round(rnd(5, 20) * (0.25 + hw));
    for (let i = 0; i < marks; i++) out.push(markPiece(f, v, p));
  }
  return out.filter(Boolean);
}

function generate(s, keep = {}) {
  seed = s >>> 0;
  R = rng(seed || 1);
  if (!keep.view) viewIx = Math.floor(R() * VIEWS.length); else R();
  if (!keep.palette) paletteIx = Math.floor(R() * PALETTES.length); else R();
  foci = view().place(rnd).slice(0, view().foci);
  scene = build();
  revealAt = performance.now();
}

// Re-run for the current settings, keeping the seed — and keeping whatever you
// have drawn. Marks are only ever removed by UNDO and CLEAR.
function regenerate() {
  R = rng(seed || 1); R(); R();
  foci = view().place(rnd).slice(0, view().foci);
  scene = build();
  revealAt = performance.now();
  if (sim.live) detonate();
  if (P) P.loop();
}

// -------------------------------------------------------------------- physics

// Exponential drag with time constant TAU. Launch velocity is set to
// (home - focus) / TAU, which makes a fragment asymptotically settle exactly
// into the position the composition designed for it: DETONATE assembles the
// poster out of an explosion instead of merely scattering it.
const TAU = 1.4;
const sim = { live: false, gravity: false, floor: true, collide: true, t: 0 };
const FLOOR_Y = -1.15;
// A shallow bowl rather than an infinite plane. On a flat floor the debris
// spreads into a single layer and collision has nothing to do; the bowl
// gathers it so fragments actually rest on each other and pile up.
const BOWL = 1.5;
const floorAt = (x, z) => FLOOR_Y + BOWL * (x * x + z * z);
const floorNormal = (x, z) => vnorm(v3(-2 * BOWL * x, 1, -2 * BOWL * z));

function detonate() {
  sim.live = true;
  sim.t = 0;
  selectBodies();
  for (const list of [scene, ...strokes]) {
    for (const it of list) {
      const f = it.focus || v3(0, 0, 0);
      it.at = vadd(f, vmul(vsub(it.home, f), 0.02));
      it.vel = vmul(vsub(it.home, f), 1 / TAU);
      it.rot = 0;
      it.grounded = false;
    }
  }
  if (P) P.loop();
}

function settle() {
  sim.live = false;
  for (const list of [scene, ...strokes]) {
    for (const it of list) { it.at = it.home; it.vel = v3(0, 0, 0); it.rot = 0; it.grounded = false; }
  }
  if (P) P.loop();
}

// ------------------------------------------------------------- collision

// Tier-2 collision: capsules for rods, oriented boxes for everything else.
// Only runs under gravity — without it the sim converges onto the designed
// composition and nothing needs to touch — and only for the largest fragments,
// which keeps the body count in the low hundreds instead of the high hundreds.
const MAX_BODIES = 240;
let bodies = [];
let contactCount = 0, worstDepth = 0;

function selectBodies() {
  const all = [];
  for (const list of [scene, ...strokes]) for (const it of list) if (it.col) all.push(it);
  all.sort((a, b) => b.size - a.size);
  bodies = all.slice(0, MAX_BODIES);
  for (const b of bodies) {
    // Mass from a rough volume, floored so nothing behaves like a feather.
    b.invMass = 1 / Math.max(0.004, Math.pow(b.size, 2) * 3);
    b.radius = b.col.kind === 'cap'
      ? b.col.h + b.col.r
      : Math.hypot(b.col.he.x, b.col.he.y, b.col.he.z);
  }
}

const spun = (b, v) => (b.rot ? vrot(v, b.spinAxis, b.rot) : v);

function worldCap(b) {
  const ax = spun(b, b.col.ax);
  return { a: vadd(b.at, vmul(ax, b.col.h)), b: vsub(b.at, vmul(ax, b.col.h)), r: b.col.r };
}
function worldObb(b) {
  return { c: b.at, u: spun(b, b.col.u), v: spun(b, b.col.v), w: spun(b, b.col.w), he: b.col.he };
}

// Closest points between two segments (Ericson, Real-Time Collision Detection).
function segSeg(p1, q1, p2, q2) {
  const d1 = vsub(q1, p1), d2 = vsub(q2, p2), r = vsub(p1, p2);
  const a = vdot(d1, d1), e = vdot(d2, d2), f = vdot(d2, r);
  let s, t;
  if (a < 1e-9 && e < 1e-9) return [p1, p2];
  if (a < 1e-9) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = vdot(d1, r);
    if (e < 1e-9) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = vdot(d1, d2), den = a * e - b * b;
      s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  return [vadd(p1, vmul(d1, s)), vadd(p2, vmul(d2, t))];
}

function closestOnObb(o, p) {
  const d = vsub(p, o.c);
  let q = o.c;
  for (const [ax, he] of [[o.u, o.he.x], [o.v, o.he.y], [o.w, o.he.z]]) {
    const dist = Math.min(he, Math.max(-he, vdot(d, ax)));
    q = vadd(q, vmul(ax, dist));
  }
  return q;
}

// Separating-axis test: 15 axes, smallest overlap wins and becomes the contact
// normal. Returns null the moment any axis separates the pair.
function satObb(A, B) {
  const axesA = [A.u, A.v, A.w], axesB = [B.u, B.v, B.w];
  const heA = [A.he.x, A.he.y, A.he.z], heB = [B.he.x, B.he.y, B.he.z];
  const d = vsub(B.c, A.c);
  let best = Infinity, axis = null;
  const test = (L) => {
    const len = Math.hypot(L.x, L.y, L.z);
    if (len < 1e-6) return true;
    const n = vmul(L, 1 / len);
    let ra = 0, rb = 0;
    for (let i = 0; i < 3; i++) ra += heA[i] * Math.abs(vdot(axesA[i], n));
    for (let i = 0; i < 3; i++) rb += heB[i] * Math.abs(vdot(axesB[i], n));
    const dist = Math.abs(vdot(d, n));
    const overlap = ra + rb - dist;
    if (overlap <= 0) return false;
    if (overlap < best) { best = overlap; axis = vdot(d, n) < 0 ? vmul(n, -1) : n; }
    return true;
  };
  for (const a of axesA) if (!test(a)) return null;
  for (const b of axesB) if (!test(b)) return null;
  for (const a of axesA) for (const b of axesB) if (!test(vcross(a, b))) return null;
  return axis ? { n: axis, depth: best } : null;
}

function contactOf(A, B) {
  const ca = A.col.kind === 'cap', cb = B.col.kind === 'cap';
  if (ca && cb) {
    const x = worldCap(A), y = worldCap(B);
    const [p, q] = segSeg(x.a, x.b, y.a, y.b);
    const diff = vsub(q, p), dist = Math.hypot(diff.x, diff.y, diff.z);
    const rad = x.r + y.r;
    if (dist >= rad || dist < 1e-9) return null;
    return { n: vmul(diff, 1 / dist), depth: rad - dist };
  }
  if (ca !== cb) {
    // Capsule against box: reduce the capsule to the sphere at whichever point
    // of its axis is nearest the box. Cheap, and good enough for a pile.
    const cap = ca ? A : B, box = ca ? B : A;
    const w = worldCap(cap), o = worldObb(box);
    const [p] = segSeg(w.a, w.b, o.c, o.c);
    const q = closestOnObb(o, p);
    const diff = vsub(p, q), dist = Math.hypot(diff.x, diff.y, diff.z);
    if (dist >= w.r) return null;
    const n = dist > 1e-9 ? vmul(diff, 1 / dist) : v3(0, 1, 0);
    const depth = w.r - dist;
    return ca ? { n: vmul(n, -1), depth } : { n, depth };
  }
  return satObb(worldObb(A), worldObb(B));
}

function resolve(A, B, c) {
  const rel = vsub(B.vel, A.vel);
  const vn = vdot(rel, c.n);
  const inv = A.invMass + B.invMass;
  if (inv <= 0) return;
  if (vn < 0) {
    const e = 0.12;                       // debris is not bouncy
    const j = -(1 + e) * vn / inv;
    const imp = vmul(c.n, j);
    A.vel = vsub(A.vel, vmul(imp, A.invMass));
    B.vel = vadd(B.vel, vmul(imp, B.invMass));
    // Tangential rub becomes spin. Not a real inertia tensor, but it stops
    // fragments sliding past each other like ice.
    const t = vsub(rel, vmul(c.n, vn));
    const tl = Math.hypot(t.x, t.y, t.z);
    if (tl > 1e-6) {
      const fr = vmul(t, -Math.min(0.35 * j, tl) / tl);
      A.vel = vsub(A.vel, vmul(fr, A.invMass));
      B.vel = vadd(B.vel, vmul(fr, B.invMass));
      A.spinRate = (A.spinRate || 0) - tl * 0.25 * A.invMass * 0.02;
      B.spinRate = (B.spinRate || 0) + tl * 0.25 * B.invMass * 0.02;
    }
  }
  // Positional correction, with slop so resting contacts do not jitter.
  const corr = Math.max(c.depth - 0.002, 0) / inv * 0.45;
  A.at = vsub(A.at, vmul(c.n, corr * A.invMass));
  B.at = vadd(B.at, vmul(c.n, corr * B.invMass));
  A.grounded = B.grounded = false;
}

// Spatial hash, rebuilt each substep. Cell size tracks the largest body so a
// pair can never be missed by more than one cell.
function collide() {
  contactCount = 0; worstDepth = 0;
  if (!bodies.length) return;
  let cell = 0;
  for (const b of bodies) cell = Math.max(cell, b.radius);
  cell = Math.max(0.05, cell * 2);
  const grid = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  for (const b of bodies) {
    b.cx = Math.floor(b.at.x / cell); b.cy = Math.floor(b.at.y / cell); b.cz = Math.floor(b.at.z / cell);
    const k = key(b.cx, b.cy, b.cz);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(b);
  }
  for (let iter = 0; iter < 3; iter++) {
    for (const A of bodies) {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const cellList = grid.get(key(A.cx + dx, A.cy + dy, A.cz + dz));
        if (!cellList) continue;
        for (const B of cellList) {
          if (B === A || B.size > A.size || (B.size === A.size && B.rev <= A.rev)) continue;
          const d = Math.hypot(B.at.x - A.at.x, B.at.y - A.at.y, B.at.z - A.at.z);
          if (d > A.radius + B.radius) continue;      // broadphase reject
          const c = contactOf(A, B);
          if (!c) continue;
          if (iter === 0) { contactCount++; worstDepth = Math.max(worstDepth, c.depth); }
          resolve(A, B, c);
        }
      }
    }
  }
}

function stepPhysics(dt) {
  if (!sim.live) return;
  sim.t += dt;
  const k = dt / TAU;
  for (const list of [scene, ...strokes]) {
    for (const it of list) {
      if (!it.vel) continue;
      if (sim.gravity) it.vel = vadd(it.vel, v3(0, -1.6 * dt, 0));
      // Drag pulls velocity toward zero; without gravity that lands the piece
      // on its designed position and holds it there.
      it.vel = vmul(it.vel, Math.max(0, 1 - k));
      it.at = vadd(it.at, vmul(it.vel, dt));
      if (it.spinRate) it.rot += it.spinRate * dt * (it.grounded ? 0.1 : 1);
      if (it.spinRate) it.spinRate *= Math.max(0, 1 - k * 0.8);

      if (sim.gravity && sim.floor) {
        const lift = (it.radius || 0.01) * 0.45;
        const surf = floorAt(it.at.x, it.at.z) + lift;
        if (it.at.y < surf) {
          it.at = v3(it.at.x, surf, it.at.z);
          const n = floorNormal(it.at.x, it.at.z);
          const vn = vdot(it.vel, n);
          if (vn < 0) {
            // Reflect, then scrub the tangential component. Because the
            // surface is curved, what survives is a slide toward the centre.
            const bounce = vsub(it.vel, vmul(n, vn * 1.32));
            const tang = vsub(bounce, vmul(n, vdot(bounce, n)));
            it.vel = vadd(vmul(n, vdot(bounce, n)), vmul(tang, 0.72));
          }
          if (Math.hypot(it.vel.x, it.vel.y, it.vel.z) < 0.06) {
            it.vel = vmul(it.vel, 0.4);
            it.grounded = true;
          }
        }
      }
    }
  }
  // Contacts only matter once things are falling and piling; without gravity
  // the field settles onto its designed positions and nothing needs to touch.
  if (sim.gravity && sim.collide) collide();
}

// ---------------------------------------------------------------- drawing in

// A drag paints fragments onto a plane through the target that faces the
// camera, so what you draw lands where you are looking.
function strokePiece(sx, sy, w, h, speed) {
  const p = pal(), hw = mixHw();
  const nx = (sx - w / 2) / (unit || 1), ny = -(sy - h / 2) / (unit || 1);
  const at = vadd(cam.target, vadd(vmul(VB.r, nx), vmul(VB.u, ny)));
  const len = (0.02 + Math.min(speed, 60) / 60 * 0.07) * rnd(0.6, 1.5);
  const dir = vnorm(vadd(vmul(VB.r, rnd(-1, 1)), vmul(VB.u, rnd(-1, 1))));
  let faces;
  const roll = R();
  if (roll < hw * 0.78) {
    faces = rodFaces(v3(0, 0, 0), dir, len * 1.6, Math.max(0.004, len / rnd(6, 14)), p);
  } else if (roll < hw) {
    const s = len * rnd(0.3, 0.8);
    const ax = vnorm(randomDir());
    const [ay, az] = basis(ax);
    faces = boxFaces(v3(0, 0, 0), ax, ay, az, s, s * rnd(0.6, 1.4), s * rnd(0.5, 1.5), weightedColour(p).fill);
  } else {
    let c = weightedColour(p);
    if (c.smallOnly && len > 0.12) c = p.cols[0];
    faces = flatFace(v3(0, 0, 0), VB.f, len, len / tailed(2, 16, 1.5), c.fill);
  }
  return { faces, at, home: at, dir, rev: 0, size: len,
    spinAxis: randomDir(), spinRate: rnd(-1, 1) * 0.8,
    vel: v3(0, 0, 0), rot: 0, focus: cam.target };
}

// ------------------------------------------------------------------ render

const DISPLAY = 'Helvetica, Arial, sans-serif';

// Per-fragment motion. DRIFT streams everything outward on a loop, fading at
// both ends so nothing pops; the rest are whole-field transforms.
function motionOffset(it) {
  if (MOTIONS[motionIx].name !== 'DRIFT' || !it.dir) return null;
  const phase = (clock * 0.07 + it.rev) % 1;
  const alpha = Math.min(1, phase / 0.12) * Math.min(1, (1 - phase) / 0.22);
  return { off: vmul(it.dir, phase * 0.9), alpha };
}

function collectFaces(k, w, h, reveal) {
  const out = [];
  const breathe = MOTIONS[motionIx].name === 'BREATHE' ? 1 + Math.sin(clock * 0.7) * 0.08 : 1;
  // Poster framing: the field sits left of centre so the type block on the
  // right has air around it, exactly as both references are composed.
  const ox = w * (w > 760 * k ? 0.40 : 0.5), oy = h * 0.46;
  const all = [scene, ...strokes];

  for (const list of all) {
    for (const it of list) {
      if (it.rev > reveal) continue;
      const m = motionOffset(it);
      const shift = m ? m.off : null;
      const alpha = m ? m.alpha : 1;
      // Local geometry -> world: spin about the fragment's own axis, then
      // translate to its current position, then apply any field-wide motion.
      const spun = it.rot ? (v) => vrot(v, it.spinAxis, it.rot) : null;
      const move = (p, local) => {
        let q = local ? vadd(it.at, spun ? spun(p) : p) : p;
        if (!local) q = p;
        if (shift) q = vadd(q, shift);
        return breathe === 1 ? q : vadd(cam.target, vmul(vsub(q, cam.target), breathe));
      };

      if (it.line) {
        const d0 = vsub(it.at, it.home);
        const a = project(move(vadd(it.line.a, d0)), k, ox, oy);
        const b = project(move(vadd(it.line.b, d0)), k, ox, oy);
        if (a && b) out.push({ line: it.line, a, b, d: Math.max(a.d, b.d), alpha });
        continue;
      }
      if (it.label || it.glyph) {
        const c = project(move(it.at), k, ox, oy);
        if (c) out.push({ mark: it, c, d: c.d, alpha,
          scale: cam.ortho ? unit * k : (unit * 1.5 * k) / c.d });
        continue;
      }
      for (const f of it.faces) {
        // Cull faces pointing away. Flat fragments are double sided and never
        // culled, which is why shards stay visible from behind.
        const n = spun ? spun(f.n) : f.n;
        const anchor = vadd(it.at, spun ? spun(f.v[0]) : f.v[0]);
        if (f.cull && vdot(n, vsub(camPos, anchor)) <= 0) continue;
        const pts = [];
        let bad = false, d = 0;
        for (const v of f.v) {
          const q = project(move(v, true), k, ox, oy);
          if (!q) { bad = true; break; }
          pts.push(q); d += q.d;
        }
        if (bad || pts.length < 3) continue;
        out.push({ face: f, pts, d: d / pts.length, alpha });
      }
    }
  }
  // Painter's algorithm: far to near.
  out.sort((a, b) => b.d - a.d);
  return out;
}

function drawScene(g, k, w, h, reveal) {
  for (const item of collectFaces(k, w, h, reveal)) {
    g.drawingContext.globalAlpha = item.alpha;
    if (item.line) {
      g.stroke(item.line.col);
      g.drawingContext.globalAlpha = (item.line.alpha / 255) * item.alpha;
      g.strokeWeight(item.line.weight * k);
      g.line(item.a.x, item.a.y, item.b.x, item.b.y);
    } else if (item.mark) {
      const it = item.mark;
      g.push();
      g.translate(item.c.x, item.c.y);
      if (it.label) {
        g.rotate(it.label.rot);
        g.noStroke();
        g.fill(it.label.col);
        g.textFont(DISPLAY);
        g.textStyle(g.BOLD);
        g.textSize(Math.max(3, it.label.size * item.scale));
        g.textAlign(g.LEFT, g.BASELINE);
        g.text(it.label.text, 0, 0);
        g.textStyle(g.NORMAL);
      } else {
        g.rotate(it.glyph.rot);
        g.noStroke();
        g.fill(it.glyph.fill);
        for (const poly of it.glyph.billboard) {
          g.beginShape();
          for (const [x, y] of poly) g.vertex(x * item.scale, y * item.scale);
          g.endShape(g.CLOSE);
        }
      }
      g.pop();
    } else {
      const f = item.face;
      g.fill(f.fill);
      g.stroke(f.stroke);
      g.strokeWeight(0.6 * k);
      g.beginShape();
      for (const q of item.pts) g.vertex(q.x, q.y);
      g.endShape(g.CLOSE);
    }
    g.drawingContext.globalAlpha = 1;
  }
}

// -------------------------------------------------------------------- type

function spaced(g, str, x, y, tracking) {
  let cx = x;
  for (const ch of str) { g.text(ch, cx, y); cx += g.textWidth(ch) + tracking; }
  return cx - x;
}

const ROWS = [
  ['WALK AROUND IT', 'DRAG TO ORBIT · WHEEL TO DOLLY'],
  ['DRAW INTO IT', 'SWITCH TO DRAW, THEN DRAG'],
  ['DETONATE IT', 'X TO EXPLODE · G GRAVITY · S PNG'],
];

function drawType(g, k, w, h) {
  const p = pal();
  const narrow = w < 760 * k;
  const bw = narrow ? w - 48 * k : 372 * k;
  const bx = narrow ? 24 * k : w - bw - 56 * k;
  const by = narrow ? h - 214 * k : h * 0.44;

  g.push();
  g.noStroke();
  const bgc = g.color(p.bg);
  bgc.setAlpha(238);
  g.fill(bgc);
  g.rect(bx - 18 * k, by - 44 * k, bw + 36 * k, 192 * k);

  g.textAlign(g.LEFT, g.BASELINE);
  g.textFont(DISPLAY);
  g.textStyle(g.BOLD);
  g.fill(p.ink);
  g.textSize(23 * k);
  spaced(g, '»SPLINTER', bx, by - 16 * k, 1.4 * k);
  g.textStyle(g.NORMAL);
  g.textFont('monospace');
  g.textSize(7.2 * k);
  g.fill('#6d6d66');
  spaced(g, `${view().name} · ${MIXES[mixIx].name} · ${p.name} · ${cam.ortho ? 'ORTHO' : 'PERSP'} · ${seed.toString(16).toUpperCase().padStart(8, '0')}`,
    bx, by - 4 * k, 0.9 * k);

  g.stroke('#bdbdb6');
  g.strokeWeight(1 * k);
  g.line(bx, by + 4 * k, bx + bw, by + 4 * k);
  g.noStroke();

  ROWS.forEach(([title, sub], i) => {
    const y = by + 30 * k + i * 38 * k;
    g.textFont(DISPLAY);
    g.textStyle(g.BOLD);
    g.textSize(13.5 * k);
    g.fill(p.ink);
    spaced(g, title, bx, y, 0.9 * k);
    g.textStyle(g.NORMAL);
    g.textFont('monospace');
    g.textSize(6.5 * k);
    g.fill('#7d7d76');
    spaced(g, sub, bx, y + 11 * k, 0.9 * k);
    g.textFont(DISPLAY);
    g.textStyle(g.BOLD);
    g.textSize(38 * k);
    g.fill(p.accent);
    const num = `0${i + 1}`;
    g.text(num, bx + bw - g.textWidth(num), y + 4 * k);
    g.textStyle(g.NORMAL);
  });
  g.pop();
}

// ------------------------------------------------------------------- panel

let uiHits = [];
let uiBounds = { x: 0, y: 0, w: 0, h: 0 };

function chip(g, k, x, y, w, h, label, on, action, live) {
  const p = pal();
  g.fill(on ? p.accent : 'rgba(0,0,0,0)');
  g.stroke(p.ink);
  g.strokeWeight(1 * k);
  g.rect(x, y, w, h);
  g.noStroke();
  g.fill(on ? '#ffffff' : p.ink);
  g.textFont('monospace');
  g.textSize(7.2 * k);
  g.textAlign(g.CENTER, g.CENTER);
  g.text(label, x + w / 2, y + h / 2 + 0.5 * k);
  g.textAlign(g.LEFT, g.BASELINE);
  if (live) uiHits.push({ x, y, w, h, action, label });
}

function drawPanel(g, k, w, h, live) {
  const p = pal();
  const M = 34 * k, cw = 80 * k, gap = 4 * k, bh = 17 * k;
  const panelW = cw * 2 + gap;
  let y = 56 * k;
  const top = y - 30 * k;

  g.push();
  g.noStroke();
  const bgc = g.color(p.bg);
  bgc.setAlpha(230);
  g.fill(bgc);
  g.rect(M - 10 * k, top, panelW + 20 * k, 440 * k);

  const heading = (t) => {
    g.noStroke(); g.fill('#6d6d66'); g.textFont('monospace'); g.textSize(6.8 * k);
    g.textAlign(g.LEFT, g.BASELINE); g.text(t, M, y - 6 * k); y += 2 * k;
  };

  heading('MODE');
  chip(g, k, M, y, cw, bh, 'LOOK', mode === 'LOOK', () => { mode = 'LOOK'; }, live);
  chip(g, k, M + cw + gap, y, cw, bh, 'DRAW', mode === 'DRAW', () => { mode = 'DRAW'; }, live);
  y += bh + gap + 12 * k;

  heading('COMPONENTS');
  COMP_KEYS.forEach((key, i) => {
    chip(g, k, M + (i % 2) * (cw + gap), y + Math.floor(i / 2) * (bh + gap), cw, bh,
      key.toUpperCase(), COMP[key], () => { COMP[key] = !COMP[key]; regenerate(); }, live);
  });
  y += Math.ceil(COMP_KEYS.length / 2) * (bh + gap) + 12 * k;

  heading('COMPOSITION');
  const cyc = [
    [`VIEW ${view().name}`, () => { viewIx = (viewIx + 1) % VIEWS.length; regenerate(); }],
    [`MIX ${MIXES[mixIx].name}`, () => { mixIx = (mixIx + 1) % MIXES.length; regenerate(); }],
    [`PAL ${pal().name}`, () => { paletteIx = (paletteIx + 1) % PALETTES.length; regenerate(); }],
    [`CAM ${cam.ortho ? 'ORTHO' : 'PERSP'}`, () => { cam.ortho = !cam.ortho; P.loop(); }],
    [`TIME ${MOTIONS[motionIx].name}`, () => { motionIx = (motionIx + 1) % MOTIONS.length; P.loop(); }],
    [`RATE ${SPEEDS[speedIx].name}`, () => { speedIx = (speedIx + 1) % SPEEDS.length; }],
  ];
  for (const [label, action] of cyc) { chip(g, k, M, y, panelW, bh, label, false, action, live); y += bh + gap; }

  y += 10 * k;
  heading('PHYSICS');
  chip(g, k, M, y, panelW, bh, sim.live ? 'RE-DETONATE' : 'DETONATE', sim.live, () => detonate(), live);
  y += bh + gap;
  chip(g, k, M, y, cw, bh, 'GRAVITY', sim.gravity,
    () => { sim.gravity = !sim.gravity; if (!sim.live) detonate(); P.loop(); }, live);
  chip(g, k, M + cw + gap, y, cw, bh, 'FLOOR', sim.floor,
    () => { sim.floor = !sim.floor; P.loop(); }, live);
  y += bh + gap;
  chip(g, k, M, y, panelW, bh, 'COLLIDE', sim.collide,
    () => { sim.collide = !sim.collide; P.loop(); }, live);
  y += bh + gap;
  chip(g, k, M, y, panelW, bh, 'SETTLE', false, () => settle(), live);
  y += bh + gap + 12 * k;

  chip(g, k, M, y, panelW, bh, 'NEW COMPOSITION', false, () => reseed(), live);
  y += bh + gap;
  chip(g, k, M, y, cw, bh, 'ISO VIEW', false, () => {
    cam.yaw = -Math.PI / 4; cam.pitch = 0.6155; cam.ortho = true; cam.zoom = 1; P.loop();
  }, live);
  chip(g, k, M + cw + gap, y, cw, bh, 'CLEAR', false, () => { strokes = []; P.loop(); }, live);
  y += bh + gap;

  uiBounds = { x: M - 10 * k, y: top, w: panelW + 20 * k, h: y - top + 6 * k };
  g.pop();
}

const insidePanel = (x, y) => x >= uiBounds.x && x <= uiBounds.x + uiBounds.w
  && y >= uiBounds.y && y <= uiBounds.y + uiBounds.h;

// ------------------------------------------------------------------ sketch

let P = null;
let dragging = null, lastPt = null;

function render(g, k, w, h, reveal, withPanel) {
  g.background(pal().bg);
  drawScene(g, k, w, h, reveal);
  drawType(g, k, w, h);
  // The panel is a tool, not part of the poster — the export leaves it out.
  if (withPanel) { uiHits = []; drawPanel(g, k, w, h, true); }
  g.push();
  g.noStroke();
  g.fill('#6d6d66');
  g.textFont('monospace');
  g.textSize(7 * k);
  g.textAlign(g.LEFT, g.BASELINE);
  spaced(g, `SKETCHBOOK · SIEM2L.NL · ${strokes.length} STROKE${strokes.length === 1 ? '' : 'S'}`,
    36 * k, h - 28 * k, 1.2 * k);
  g.pop();
}

function reseed() {
  generate(Math.floor(P.random(1, 4294967295)) >>> 0, {});
  P.loop();
}

function exportPng() {
  const p = P, k = 3;
  const g = p.createGraphics(p.width * k, p.height * k);
  const su = unit;
  updateCamera(p.width, p.height);
  render(g, k, p.width * k, p.height * k, 1.1, false);
  unit = su;
  p.saveCanvas(g, `splinter-${seed.toString(16)}`, 'png');
  setTimeout(() => g.remove(), 200);
}

// Read-only view of what the interface already shows, for the behaviour tests.
if (typeof window !== 'undefined') {
  window.__splinter = {
    seed: () => seed,
    palette: () => pal().name,
    view: () => view().name,
    mix: () => MIXES[mixIx].name,
    motion: () => MOTIONS[motionIx].name,
    speed: () => SPEEDS[speedIx].name,
    mode: () => mode,
    ortho: () => cam.ortho,
    camera: () => ({ yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist }),
    components: () => ({ ...COMP }),
    pieces: () => scene.length,
    strokes: () => strokes.length,
    strokePieces: () => strokes.reduce((a, s) => a + s.length, 0),
    // Where a named button actually is, so tests never hardcode a pixel and
    // break the moment the panel gains a row.
    buttonAt: (label) => {
      const b = uiHits.find((h) => h.label === label || h.label.startsWith(label));
      return b ? { x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) } : null;
    },
    physics: () => ({ live: sim.live, gravity: sim.gravity, floor: sim.floor,
      collide: sim.collide, t: sim.t }),
    collision: () => ({ bodies: bodies.length, contacts: contactCount,
      worstDepth: +worstDepth.toFixed(4) }),
    // Mean clearance above the floor *surface beneath each body*. Measuring
    // against a flat datum would just report the bowl's curvature; this reports
    // stacking, which is the thing collision is supposed to produce.
    pileHeight: () => (bodies.length
      ? bodies.reduce((a, b) => a + (b.at.y - floorAt(b.at.x, b.at.z)), 0) / bodies.length : 0),
    // Mean distance from each fragment's designed position — 0 when settled.
    spread: () => {
      let n = 0, d = 0;
      for (const it of scene) { if (!it.home) continue; n++; d += Math.hypot(it.at.x - it.home.x, it.at.y - it.home.y, it.at.z - it.home.z); }
      return n ? d / n : 0;
    },
    lowest: () => scene.reduce((m, it) => Math.min(m, it.at ? it.at.y : m), Infinity),
    settled: () => performance.now() - revealAt > 1500,
  };
}

new p5((p) => {
  P = p;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    updateCamera(p.width, p.height);
    generate(Math.floor(p.random(1, 4294967295)) >>> 0, {});
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    updateCamera(p.width, p.height);
    p.loop();
  };

  p.draw = () => {
    const dt = Math.min(0.05, p.deltaTime / 1000) * SPEEDS[speedIx].v;
    clock += (p.deltaTime / 1000) * SPEEDS[speedIx].v;
    stepPhysics(dt);
    if (MOTIONS[motionIx].name === 'TUMBLE') cam.yaw += p.deltaTime / 1000 * 0.12 * SPEEDS[speedIx].v;
    if (MOTIONS[motionIx].name === 'ORBIT') cam.yaw += p.deltaTime / 1000 * 0.28 * SPEEDS[speedIx].v;
    updateCamera(p.width, p.height);
    const reveal = Math.min(1.1, (performance.now() - revealAt) / 1400);
    render(p, 1, p.width, p.height, reveal, true);
    const moving = MOTIONS[motionIx].name !== 'STILL' || sim.live;
    if (!moving && reveal >= 1.1 && !dragging) p.noLoop();
  };

  const beginDrag = () => {
    // The panel swallows the gesture — you cannot orbit or draw through a button.
    for (const hit of uiHits) {
      if (p.mouseX >= hit.x && p.mouseX <= hit.x + hit.w
        && p.mouseY >= hit.y && p.mouseY <= hit.y + hit.h) { hit.action(); p.loop(); return; }
    }
    if (insidePanel(p.mouseX, p.mouseY)) { p.loop(); return; }
    lastPt = { x: p.mouseX, y: p.mouseY };
    if (mode === 'DRAW' && !p.keyIsDown(p.SHIFT)) {
      dragging = { kind: 'draw', stroke: [] };
      strokes.push(dragging.stroke);
    } else {
      dragging = { kind: 'orbit' };
    }
    p.loop();
  };

  const moveDrag = () => {
    if (!dragging || !lastPt) return;
    const dx = p.mouseX - lastPt.x, dy = p.mouseY - lastPt.y;
    if (dragging.kind === 'orbit') {
      cam.yaw -= dx * 0.006;
      cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch + dy * 0.005));
      lastPt = { x: p.mouseX, y: p.mouseY };
      return;
    }
    const d = Math.hypot(dx, dy);
    if (d < 7) return;
    const n = 1 + Math.floor(R() * 2);
    for (let i = 0; i < n; i++) {
      dragging.stroke.push(strokePiece(p.mouseX, p.mouseY, p.width, p.height, d));
    }
    lastPt = { x: p.mouseX, y: p.mouseY };
  };

  const endDrag = () => {
    if (dragging && dragging.kind === 'draw' && dragging.stroke.length === 0) strokes.pop();
    dragging = null;
    lastPt = null;
    p.loop();
  };

  p.mousePressed = () => { beginDrag(); return false; };
  p.mouseDragged = () => { moveDrag(); return false; };
  p.mouseReleased = () => { endDrag(); return false; };
  p.touchStarted = () => { beginDrag(); return false; };
  p.touchMoved = () => { moveDrag(); return false; };
  p.touchEnded = () => { endDrag(); return false; };

  p.mouseWheel = (e) => {
    if (cam.ortho) cam.zoom = Math.max(0.25, Math.min(4, cam.zoom * (1 - e.delta * 0.0012)));
    else cam.dist = Math.max(0.4, Math.min(9, cam.dist * (1 + e.delta * 0.0012)));
    p.loop();
    return false;
  };

  p.keyPressed = () => {
    const k = p.key.toLowerCase();
    if (p.key === ' ') { reseed(); return false; }
    if (k === 'v') { viewIx = (viewIx + 1) % VIEWS.length; regenerate(); return false; }
    if (k === 'm') { mixIx = (mixIx + 1) % MIXES.length; regenerate(); return false; }
    if (k === 'k') { paletteIx = (paletteIx + 1) % PALETTES.length; regenerate(); return false; }
    if (k === 't') { motionIx = (motionIx + 1) % MOTIONS.length; p.loop(); return false; }
    if (k === 'r') { speedIx = (speedIx + 1) % SPEEDS.length; p.loop(); return false; }
    if (k === 'o') { cam.ortho = !cam.ortho; p.loop(); return false; }
    if (k === 'd') { mode = mode === 'DRAW' ? 'LOOK' : 'DRAW'; p.loop(); return false; }
    if (k === 'z') { strokes.pop(); p.loop(); return false; }
    if (k === 'c') { strokes = []; p.loop(); return false; }
    if (k === 'x') { detonate(); return false; }
    if (k === 'g') { sim.gravity = !sim.gravity; if (!sim.live) detonate(); p.loop(); return false; }
    if (k === 'b') { sim.collide = !sim.collide; p.loop(); return false; }
    if (k === 's') { exportPng(); return false; }
    return true;
  };
});
