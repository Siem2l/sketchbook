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
import p5 from 'p5';

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

const inBounds = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < NX && y < NY && z < NZ;

function apply(op) {
  if (op.t === 'place') cells.set(key(op.x, op.y, op.z), { part: op.part, rot: op.rot });
  else if (op.t === 'delete') cells.delete(key(op.x, op.y, op.z));
  else if (op.t === 'load') cells = new Map(op.next);
  dirty = true;
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
  commit({ t: 'load', prev: [...cells], next });
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
let idBuf = null, idList = [], idStale = true;
let hudHits = [];
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
  // part of a fresh build has somewhere to land.
  for (let x = 0; x < NX; x++) {
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

function spaced(g, str, x, y, tracking) {
  let cx = x;
  for (const ch of str) {
    g.text(ch, cx, y);
    cx += g.textWidth(ch) + tracking;
  }
  return cx - x;
}

function spacedWidth(g, str, tracking) {
  let w = 0;
  for (const ch of str) w += g.textWidth(ch) + tracking;
  return w - tracking;
}

function button(g, u, x, y, w, h, label, action, on, live) {
  poly(g, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
    on ? '#fabd2f' : 'rgba(0,0,0,0)', INK, 1 * u);
  g.noStroke();
  g.fill(INK);
  g.textSize(9 * u);
  const tw = spacedWidth(g, label, 1.1 * u);
  spaced(g, label, x + (w - tw) / 2, y + h / 2 + 3.2 * u, 1.1 * u);
  if (live) hudHits.push({ x, y, w, h, action });
  return x + w;
}

function drawHud(g, u, w, h, live) {
  const narrow = w < 560 * u;
  const M = 20 * u;
  g.push();
  g.textFont(MONO);
  g.textAlign(g.LEFT, g.BASELINE);

  // corner registration marks
  g.stroke(INK);
  g.strokeWeight(1 * u);
  const r = 9 * u;
  for (const [cx, cy, sx, sy] of [[M, M, 1, 1], [w - M, M, -1, 1], [M, h - M, 1, -1], [w - M, h - M, -1, -1]]) {
    g.line(cx, cy, cx + sx * r, cy);
    g.line(cx, cy, cx, cy + sy * r);
  }

  // title block
  g.noStroke();
  g.fill(INK);
  g.textSize(narrow ? 15 * u : 20 * u);
  spaced(g, 'INCONSTRUCTIONS', M + 14 * u, M + 20 * u, 2.4 * u);
  g.textSize(8 * u);
  spaced(g, 'DELTA INC · MC-202 / Λ3', M + 14 * u, M + 34 * u, 1.6 * u);
  g.stroke(INK);
  g.strokeWeight(1 * u);
  g.line(M + 14 * u, M + 40 * u, M + (narrow ? 190 : 260) * u, M + 40 * u);

  // readouts, top right
  const cell = hover ? (hover.ground ? [hover.x, hover.y, 0] : [hover.x, hover.y, hover.z]) : null;
  const rows = [
    ['CELL', cell ? cell.map((n) => String(n).padStart(2, '0')).join(' ') : '-- -- --'],
    ['PARTS', String(cells.size).padStart(3, '0')],
    ['BEARING', bearing()],
    ['MODE', mode.toUpperCase()],
  ];
  g.noStroke();
  g.textAlign(g.RIGHT, g.BASELINE);
  g.textSize(8 * u);
  rows.forEach((row, i) => {
    const y = M + 14 * u + i * 13 * u;
    g.fill('#8a8a80');
    g.text(row[0], w - M - 66 * u, y);
    g.fill(INK);
    g.text(row[1], w - M - 14 * u, y);
  });
  g.textAlign(g.LEFT, g.BASELINE);

  // parts legend
  const lx = M + 14 * u;
  let ly = narrow ? h - 124 * u : M + 76 * u;
  if (narrow) {
    let x = lx;
    PARTS.forEach((part, i) => {
      const sw = 30 * u;
      poly(g, [[x, ly], [x + sw, ly], [x + sw, ly + 20 * u], [x, ly + 20 * u]],
        TONE[part.tone][1], i === activePart ? '#fabd2f' : INK, i === activePart ? 2.4 * u : 1 * u);
      if (live) hudHits.push({ x, y: ly, w: sw, h: 20 * u, action: () => { activePart = i; } });
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
      if (live) hudHits.push({ x: lx - 6 * u, y: ly - 2 * u, w: 156 * u, h: rowH, action: () => { activePart = i; } });
      ly += rowH;
    });
    g.noStroke();
    g.fill('#8a8a80');
    g.textSize(7 * u);
    spaced(g, '1-7 SELECT · R ROTATE · Q/E VIEW', lx, ly + 12 * u, 0.8 * u);
  }

  // controls, bottom. Narrow screens get two rows rather than an overflowing
  // one — the strip has to fit inside the frame at any width.
  const bh = 22 * u;
  const gap = 5 * u;
  const row = (y, defs) => {
    let x = M + 14 * u;
    for (const d of defs) x = button(g, u, x, y, d[0] * u, bh, d[1], d[2], d[3], live) + gap;
  };
  const PLACE = [44, 'PLACE', () => { mode = 'place'; }, mode === 'place'];
  const DELETE = [52, 'DELETE', () => { mode = 'delete'; }, mode === 'delete'];
  const ROT = [40, `R${activeRot}`, () => { activeRot = (activeRot + 1) % 4; }, false];
  const VIEW = [40, 'VIEW', () => turn(1), false];
  const UNDO = [40, 'UNDO', undo, false];
  const REDO = [40, 'REDO', redo, false];
  const PNG = [40, 'PNG', exportPng, false];

  const by = h - M - bh - 8 * u;
  if (narrow) {
    row(by - bh - gap, [PLACE, DELETE, ROT, VIEW]);
    row(by, [UNDO, REDO, [40, 'CLR', () => swapWorld([]), false], PNG]);
  } else {
    row(by, [PLACE, DELETE, ROT, VIEW, UNDO, REDO,
      [44, 'CLEAR', () => swapWorld([]), false],
      [44, 'RESET', () => swapWorld(demoWorld()), false], PNG]);
  }
  g.pop();
}

// ------------------------------------------------------------------ p5 setup

let P = null;

function fit(p) {
  // Fit the whole build volume with margin, then centre it.
  const w = p.width, h = p.height;
  const sw = w / ((NX + NY - 2) * COS30 + 4);
  const sh = h / ((NX + NY) * 0.5 + NZ * 0.55 + 4);
  scale = Math.max(10, Math.min(sw, sh));
  originX = 0;
  originY = 0;
  const c = project(view([NX / 2, NY / 2, NZ * 0.28], angleNow()));
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
  const p = P;
  const u = 3;
  const g = p.createGraphics(p.width * u, p.height * u);
  g.background(PAPER);
  const ox = originX, oy = originY, sc = scale;
  originX *= u; originY *= u; scale *= u;
  rebuildAt(g, u);
  originX = ox; originY = oy; scale = sc;
  drawHud(g, u, p.width * u, p.height * u, false);
  p.saveCanvas(g, 'inconstructions', 'png');
  setTimeout(() => g.remove(), 100);
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

function hudClick(mx, my) {
  for (const hit of hudHits) {
    if (mx >= hit.x && mx <= hit.x + hit.w && my >= hit.y && my <= hit.y + hit.h) {
      hit.action();
      return true;
    }
  }
  return false;
}

function act(mx, my) {
  if (!demoDone) { finishDemo(); return; }
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

    if (turning) {
      dirty = true;
      if (performance.now() - yawAt >= TURN_MS) {
        turning = false;
        yaw = ((yawTo % 4) + 4) % 4;
      }
    }

    if (dirty) { fit(p); rebuild(); }
    if (idStale && !turning) renderIds(p);
    if (!touchUsed) hover = pick(p, p.mouseX, p.mouseY);

    p.background(PAPER);
    drawScene(p);
    drawGhost(p);
    drawHoverMark(p);
    hudHits = [];
    drawHud(p, 1, p.width, p.height, true);
  };

  p.mousePressed = () => {
    if (touchUsed) return;
    act(p.mouseX, p.mouseY);
    return false;
  };

  p.touchStarted = () => {
    touchUsed = true;
    const t = (p.touches && p.touches[0]) || { x: p.mouseX, y: p.mouseY };
    hover = pick(p, t.x, t.y);
    act(t.x, t.y);
    return false;
  };

  p.keyPressed = () => {
    if (!demoDone) { finishDemo(); return false; }
    const k = p.key.toLowerCase();
    if (k >= '1' && k <= String(PARTS.length)) activePart = Number(k) - 1;
    else if (k === 'r') activeRot = (activeRot + 1) % 4;
    else if (k === 'q') turn(-1);
    else if (k === 'e') turn(1);
    else if (k === 'x') mode = mode === 'place' ? 'delete' : 'place';
    else if (k === 'c') swapWorld([]);
    else if (k === 'z' && (p.keyIsDown(p.CONTROL) || p.keyIsDown(91))) p.keyIsDown(p.SHIFT) ? redo() : undo();
    else if (k === 'z') undo();
    else if (k === 'y') redo();
    else if (k === 's') exportPng();
    return false;
  };
});
