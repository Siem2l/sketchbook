// errand — a medieval bicycle, a lane that goes round, and a tune you pedal.
//
// The sprite it rides is generated, not drawn: scripts/gen-medieval-bike.mjs
// renders one signed-distance model of the bike from eight camera yaws and four
// roll phases and quantises the result to a 24-colour palette. This page uses
// the same projection the generator used — 2:1 isometric, 30 degrees of pitch,
// 45 degrees to a facing — so the world and the sprite agree about which way is
// north without anything being fudged at the seam.
//
// Two couplings, and they are the reason the page exists:
//
// The cadence is the clock. `beats` does not advance with time, it advances
// with distance travelled, so the sixteen-step sequencer in shared/beat.js is
// being turned by the back wheel. Ride harder and the tempo rises because there
// are more beats in the same second, not because a slider moved. Stop pedalling
// and the bar slows with the bike and lands, which is a ritardando nobody wrote.
//
// The road is the score. Everything standing beside the lane carries the
// distance it sits at, and passing one strikes it: trees are a noise burst,
// milestones and cottages a struck bell, the chapel the same bell an octave and
// a half down, the bridge planks a thud under the wheels. Where you are is what
// you hear.
//
// What the speed does to the arrangement is deliberately not a mix control. The
// lanes of the pattern are masks — one bit per sixteenth — so speed can add
// voices by setting bits rather than by turning anything up: rolling gets you a
// kick, faster brings the bass in, faster still the hats. Coasting to a halt
// empties all three and leaves the pad, which is a drone, which is the sound of
// a bicycle not being pedalled.
//
// The page moves on load with no gesture and opens no AudioContext until you
// ask for one: the bike arrives already rolling and coasts to a stop if you
// never touch it. That is the repo's convention for the thumbnail grabber and
// the tests, and it happens to be the right way in — you catch it mid-errand.

import sheetUrl from '../../sprites/medieval-bike/bike_iso_8dir.png';
import shadowUrl from '../../sprites/medieval-bike/bike_iso_8dir_shadow.png';
import spriteMeta from '../../sprites/medieval-bike/palette.json';
import { Listener, noteFor } from '../../shared/audio.js';
import { DEFAULT, clone } from '../../shared/beat.js';
import { buildRoute, at, placeProps, zoneAt, bridgeAt, riverAt, ROAD_HALF, VOICE, mulberry32 } from './route.js';

// ---------------------------------------------------------------- projection

// The generator's camera, written down again. Changing either of these without
// re-rendering the sheet puts the bike on a road it is not standing on.
const UP = [0.35355339, 0.35355339, 0.8660254];
const RIGHT = [-0.70710678, 0.70710678, 0];

const projX = (x, y) => RIGHT[0] * x + RIGHT[1] * y;
const projY = (x, y, z = 0) => -(UP[0] * x + UP[1] * y + UP[2] * z);
// Painter's depth. Larger is further from the camera, so the sort runs
// descending and the far side of the village is laid down first.
const depth = (x, y) => x + y;

// Which of the eight frames a heading wants. The sheet was rendered by turning
// the camera; here the camera is fixed and the bike turns, so what survives is
// the difference — heading minus the camera's own 45 degrees.
const FACINGS = 8;
const facingFor = (heading) => {
  const step = Math.round((heading - Math.PI / 4) / (Math.PI * 2 / FACINGS));
  return ((step % FACINGS) + FACINGS) % FACINGS;
};

const SPRITE = spriteMeta.frame.width;
const PIVOT = spriteMeta.frame.pivot;
const ROLL = spriteMeta.roll;

// ------------------------------------------------------------------- palette

const P = spriteMeta.ramps;
const INK = spriteMeta.outline;
// Dusk, so the lantern is worth having. The scenery borrows the sprite's own
// ramps wherever it can — the cottages are its wood, the milestones its iron —
// which is what stops the bike from looking pasted onto someone else's picture.
const C = {
  grass: ['#20291f', '#293425', '#33402c', '#3d4b33'],
  road: ['#3b3a33', '#4a4740', '#57534a', '#645f54'],
  water: ['#1b2630', '#22303c', '#2b3b49'],
  thatch: P.wood,
  stone: P.iron,
  sky: '#12141a',
  glow: '#ffd36b',
};

// ------------------------------------------------------------------- staging

const route = buildRoute();
const props = placeProps(route);
const bridge = bridgeAt(route);
const river = riverAt(route);

// Ground scatter, drawn once into a list and culled per frame. Tufts are the
// cheapest thing on screen that tells you the ground is moving under you.
const tufts = (() => {
  const rnd = mulberry32(7);
  const out = [];
  for (let i = 0; i < 2600; i++) {
    const x = (rnd() * 2 - 1) * 620;
    const y = (rnd() * 2 - 1) * 620;
    out.push({ x, y, r: rnd() });
  }
  return out;
})();

// ---------------------------------------------------------------------- ride

const ride = {
  s: 0,
  v: 92, // arrives rolling: the page has to move before anyone touches it
  pedalling: false,
  beats: 0,
  lap: 0,
  bob: 0,
};

// Pedalling settles where the push balances the losses — (ACCEL - ROLLING) /
// DRAG, about 160 — and the tiers below sit under that so the top one is
// somewhere a rider can actually get to.
//
// The losses are small on purpose. The first pass had a drag of 1.0 against a
// rolling resistance of 14, which brought the bike from its opening speed to a
// dead stop inside a second and a half — the thumbnail caught it already
// parked. A bicycle coasts. These numbers give it about six seconds of
// freewheeling, which is long enough for letting go to feel like a decision
// rather than like a brake.
const ACCEL = 62;
const V_MAX = 165;
const DRAG = 0.35;
const ROLLING = 6; // rolling resistance, in units per second squared
// Half a wheel revolution to the beat. At a comfortable 90 units a second that
// lands around 115bpm, which is roughly the tempo a person actually pedals at.
// About seven tenths of a wheel revolution to the beat. Exactly half put a hard
// effort at 173bpm with hats on the eighths, which is not a bicycle; this puts
// the top of the range around 145 and a steady cruise around 90.
const DIST_PER_BEAT = Math.PI * ROLL.wheelRadius * 1.4;

// ------------------------------------------------------------------ the tune

const pattern = clone(DEFAULT);
const audio = new Listener(pattern);
// Voices arrive as the speed does, and leave with hysteresis: without the
// deadband a bike hovering on a threshold flickers the hats on and off every
// other frame, which sounds like a fault rather than like a gear change.
const TIERS = [
  { in: 0, out: -1, kick: 0, bass: 0, hat: 0, name: 'drone' },
  { in: 12, out: 6, kick: 0x0101, bass: 0, hat: 0, name: 'kick' },
  { in: 55, out: 46, kick: 0x0101, bass: 0x1111, hat: 0, name: '+ bass' },
  { in: 100, out: 88, kick: 0x1111, bass: 0x1111, hat: 0x5555, name: '+ hats' },
];
let tier = 0;

function setTier(v) {
  while (tier < TIERS.length - 1 && v >= TIERS[tier + 1].in) tier++;
  while (tier > 0 && v < TIERS[tier].out) tier--;
  const t = TIERS[tier];
  pattern.kick = t.kick;
  pattern.bass = t.bass;
  pattern.hat = t.hat;
  return t;
}

// Where the prop scan got to last frame. Props are sorted by distance, so
// passing them is a pointer walking forward and resetting at the lap.
let propCursor = 0;

function passProps(fromS, toS) {
  const fire = (a, b) => {
    while (propCursor < props.length && props[propCursor].s <= b) {
      const prop = props[propCursor++];
      if (prop.s < a) continue;
      const voice = VOICE[prop.kind];
      if (!voice) continue;
      // The ping is set whether or not anything is audible. With the sound off
      // the page still shows you what it would be playing, which is the only
      // honest way to advertise a coupling you have to click to hear.
      prop.ping = 1;
      audio.strike(voice.strike, noteFor(voice.pitch));
    }
  };
  if (toS >= fromS) {
    fire(fromS, toS);
  } else {
    fire(fromS, route.length);
    propCursor = 0;
    fire(0, toS);
  }
}

// ------------------------------------------------------------------- canvas

const canvas = document.querySelector('#stage');
const g2 = canvas.getContext('2d');
// Everything is drawn at sprite resolution into this buffer and blown up with
// nearest-neighbour afterwards. Drawing the scenery at screen resolution and
// the sprite at 1:1 would put two different pixel sizes in one picture, which
// reads instantly as a sprite pasted over a vector drawing.
const buf = document.createElement('canvas');
const g = buf.getContext('2d');
let scale = 3;

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  scale = Math.max(2, Math.min(4, Math.round(w / 520)));
  buf.width = Math.ceil(w / scale);
  buf.height = Math.ceil(h / scale);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  g.imageSmoothingEnabled = false;
  g2.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
resize();

const sheet = new Image();
const shadowSheet = new Image();
let loaded = 0;
sheet.onload = shadowSheet.onload = () => { loaded++; };
sheet.src = sheetUrl;
shadowSheet.src = shadowUrl;

// -------------------------------------------------------------------- drawing

let camX = 0;
let camY = 0;

const poly = (pts, fill, stroke) => {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
};

const pt = (x, y, z = 0) => [projX(x, y), projY(x, y, z)];

// An isometric box, three faces, top lightest. The two visible sides are always
// the same two: the camera is fixed, so there is no need to work out which.
function box(x, y, w, d, h, ramp, lift = 0) {
  const x0 = x - w / 2, x1 = x + w / 2;
  const y0 = y - d / 2, y1 = y + d / 2;
  const z0 = lift, z1 = lift + h;
  poly([pt(x0, y0, z1), pt(x1, y0, z1), pt(x1, y1, z1), pt(x0, y1, z1)], ramp[3], INK);
  poly([pt(x0, y0, z0), pt(x0, y1, z0), pt(x0, y1, z1), pt(x0, y0, z1)], ramp[1], INK);
  poly([pt(x0, y0, z0), pt(x1, y0, z0), pt(x1, y0, z1), pt(x0, y0, z1)], ramp[2], INK);
}

function drawTree(p) {
  // Sized against the cottages rather than against the bike. A tree that only
  // just clears a bicycle reads as a sapling, and a verge of saplings reads as
  // a lollipop farm.
  const h = 50 + p.r * 34;
  const spread = 22 + p.r2 * 14;
  const [tx, ty] = pt(p.x, p.y, 0);
  const [cx, cy] = pt(p.x, p.y, h);
  g.strokeStyle = P.wood[1];
  g.lineWidth = 2 + Math.round(p.r2);
  g.beginPath();
  g.moveTo(tx, ty);
  g.lineTo(cx, cy + spread * 0.4);
  g.stroke();
  const blob = (dx, dy, r, fill) => {
    g.beginPath();
    g.ellipse(cx + dx, cy + dy, r, r * 0.78, 0, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
  };
  blob(0, 0, spread, '#1d2a1c');
  blob(-spread * 0.28, -spread * 0.2, spread * 0.78, '#2a3a26');
  blob(-spread * 0.42, -spread * 0.38, spread * 0.44, '#3a4d31');
  if (p.ping > 0) {
    g.strokeStyle = `rgba(255,211,107,${(p.ping * 0.7).toFixed(3)})`;
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(cx, cy, spread + (1 - p.ping) * 16, (spread + (1 - p.ping) * 16) * 0.78, 0, 0, Math.PI * 2);
    g.stroke();
  }
}

function drawCottage(p) {
  // A house has to dwarf a bicycle or the village reads as a row of sheds —
  // the first pass had them 34 units across, three quarters of the bike's own
  // length, and the whole scene looked like a model of itself.
  const w = 72 + p.r * 24;
  const d = 58 + p.r2 * 18;
  const h = 36 + p.r * 12;
  box(p.x, p.y, w, d, h, [INK, '#4a3a2c', '#5a4634', '#6b5440']);
  // Thatch: a ridge above the walls, drawn as two slopes meeting on a line
  // that runs along the box's long axis.
  const rz = h + 26;
  const [a] = [pt(p.x - w / 2, p.y - d / 2, h)];
  const b = pt(p.x + w / 2, p.y - d / 2, h);
  const c = pt(p.x + w / 2, p.y + d / 2, h);
  const dd = pt(p.x - w / 2, p.y + d / 2, h);
  const r0 = pt(p.x - w / 2 + 6, p.y, rz);
  const r1 = pt(p.x + w / 2 - 6, p.y, rz);
  poly([a, b, r1, r0], P.wood[2], INK);
  poly([b, c, r1], P.wood[1], INK);
  poly([dd, a, r0, r1, c], P.wood[1], INK);
  if (p.ping > 0) {
    g.fillStyle = `rgba(255,211,107,${(p.ping * 0.4).toFixed(3)})`;
    poly([a, b, r1, r0], g.fillStyle, null);
  }
}

function drawChapel(p) {
  box(p.x, p.y, 74, 58, 62, [INK, '#3c4048', '#474c55', '#565c66']);
  const [sx, sy] = pt(p.x, p.y, 62);
  const [tx, ty] = pt(p.x, p.y, 132);
  poly([[sx - 20, sy], [sx + 20, sy], [tx, ty]], P.iron[1], INK);
  g.fillStyle = p.ping > 0 ? C.glow : P.brass[2];
  g.fillRect(Math.round(sx) - 2, Math.round(sy) - 20, 5, 6);
  if (p.ping > 0) {
    g.strokeStyle = `rgba(255,211,107,${(p.ping * 0.8).toFixed(3)})`;
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(sx, sy - 16, 14 + (1 - p.ping) * 60, (14 + (1 - p.ping) * 60) * 0.5, 0, 0, Math.PI * 2);
    g.stroke();
  }
}

function drawStone(p) {
  // A milestone, not a monolith: squat enough that a row of them along the
  // verge reads as mile markers rather than as standing stones.
  box(p.x, p.y, 9, 8, 10 + p.r * 4, C.stone);
  if (p.ping > 0) {
    const [x, y] = pt(p.x, p.y, 13);
    g.strokeStyle = `rgba(255,211,107,${(p.ping * 0.8).toFixed(3)})`;
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(x, y, 4 + (1 - p.ping) * 22, (4 + (1 - p.ping) * 22) * 0.5, 0, 0, Math.PI * 2);
    g.stroke();
  }
}

function drawPost(p, railTo) {
  box(p.x, p.y, 3, 3, 9 + p.r * 4, P.wood);
  if (railTo) {
    g.strokeStyle = P.wood[1];
    g.lineWidth = 1;
    for (const z of [6, 10]) {
      const a = pt(p.x, p.y, z);
      const b = pt(railTo.x, railTo.y, z);
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }
  }
}

function drawHaystack(p) {
  const [x, y] = pt(p.x, p.y, 0);
  const h = 26 + p.r * 14;
  const w = 17 + p.r2 * 8;
  // A cone gets its volume from having a lit side and a shaded one; a single
  // flat triangle reads as a tent.
  poly([[x - w, y], [x + w, y], [x, y - h]], P.wood[1], INK);
  poly([[x - w, y], [x, y + w * 0.3], [x, y - h]], P.wood[2], null);
  poly([[x - w * 0.45, y - h * 0.15], [x - w * 0.1, y - h * 0.1], [x, y - h * 0.62]], P.wood[3], null);
}

function drawProp(p, next) {
  switch (p.kind) {
    case 'tree': return drawTree(p);
    case 'cottage': return drawCottage(p);
    case 'chapel': return drawChapel(p);
    case 'stone': return drawStone(p);
    case 'haystack': return drawHaystack(p);
    // A rail only reaches the next post if there is one within a post's reach.
    // Without the distance check a lone fence at one end of the village ran a
    // rail two hundred units to the next one and looked like a telegraph line.
    case 'fence': return drawPost(p, next && next.kind === 'fence' && next.side === p.side && next.s - p.s < 46 ? next : null);
    case 'post': return drawPost(p, null);
    default: return undefined;
  }
}

// The carriageway, built as a ribbon of quads from the same samples the bike
// rides. Drawing it from the centreline rather than from a texture is what
// keeps the wheels on the road when the road bends.
function drawRoad(sNow) {
  const back = 460;
  const ahead = 900;
  const stepS = route.step * 2;
  let prev = null;
  for (let d = -back; d <= ahead; d += stepS) {
    const s = sNow + d;
    const p = at(route, s);
    const nx = Math.cos(p.heading + Math.PI / 2);
    const ny = Math.sin(p.heading + Math.PI / 2);
    const cur = {
      l: [p.x + nx * ROAD_HALF, p.y + ny * ROAD_HALF],
      r: [p.x - nx * ROAD_HALF, p.y - ny * ROAD_HALF],
      s,
    };
    if (prev) {
      poly([
        pt(prev.l[0], prev.l[1]), pt(cur.l[0], cur.l[1]),
        pt(cur.r[0], cur.r[1]), pt(prev.r[0], prev.r[1]),
      ], C.road[1], null);
      // Cobbles: two deterministic specks per segment. A hash of the sample
      // index rather than a random, or the road would crawl.
      const seed = Math.floor(s / stepS);
      for (let k = 0; k < 3; k++) {
        const hx = ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
        const hy = ((Math.sin(seed * 39.346 + k * 11.135) * 24634.6345) % 1 + 1) % 1;
        const f = hx * 2 - 1;
        const px = prev.l[0] + (prev.r[0] - prev.l[0]) * (f * 0.5 + 0.5);
        const py = prev.l[1] + (prev.r[1] - prev.l[1]) * (f * 0.5 + 0.5);
        const [cx, cy] = pt(px, py, 0);
        g.fillStyle = hy > 0.5 ? C.road[0] : C.road[2];
        g.fillRect(Math.round(cx), Math.round(cy), 1, 1);
      }
    }
    prev = cur;
  }
}

function drawRiver() {
  const dx = -river.ny;
  const dy = river.nx;
  const corner = (a, b) => pt(
    river.x + dx * a * river.half + river.nx * b * river.width,
    river.y + dy * a * river.half + river.ny * b * river.width,
  );
  // Banks first, so the water sits inside a shore rather than being cut
  // straight out of the grass.
  poly([corner(-1, -1.16), corner(1, -1.16), corner(1, 1.16), corner(-1, 1.16)], '#3a3f31', null);
  poly([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], C.water[1], null);
  poly([corner(-1, -0.86), corner(1, -0.86), corner(1, -0.62), corner(-1, -0.62)], C.water[0], null);
  poly([corner(-1, 0.2), corner(1, 0.2), corner(1, 0.42), corner(-1, 0.42)], C.water[2], null);
}

function drawBridge() {
  const half = bridge.halfLength;
  for (let i = 0; i <= bridge.planks; i++) {
    const s = bridge.s - half + (i / bridge.planks) * half * 2;
    const p = at(route, s);
    const nx = Math.cos(p.heading + Math.PI / 2) * ROAD_HALF;
    const ny = Math.sin(p.heading + Math.PI / 2) * ROAD_HALF;
    const a = pt(p.x + nx, p.y + ny, 2);
    const b = pt(p.x - nx, p.y - ny, 2);
    g.strokeStyle = i % 2 ? P.wood[1] : P.wood[2];
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
  }
  for (const side of [1, -1]) {
    g.strokeStyle = P.wood[1];
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= 10; i++) {
      const s = bridge.s - half + (i / 10) * half * 2;
      const p = at(route, s);
      const nx = Math.cos(p.heading + Math.PI / 2) * ROAD_HALF * side;
      const ny = Math.sin(p.heading + Math.PI / 2) * ROAD_HALF * side;
      const [x, y] = pt(p.x + nx, p.y + ny, 12);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
}

// ---------------------------------------------------------------------- loop

// Taken from the first frame rather than from module evaluation. A rAF
// timestamp is the time the frame *began*, which can predate a performance.now()
// called later in the same task — so seeding this here produced a negative
// first dt, drove the distance backwards through zero, and clocked up a lap
// before the bike had left the village.
let last = null;
let clock = 0;
const hud = {
  zone: document.querySelector('#zone'),
  speed: document.querySelector('#speed'),
  bpm: document.querySelector('#bpm'),
  lap: document.querySelector('#lap'),
  bar: document.querySelector('#bar span'),
  voices: [...document.querySelectorAll('#voices b')],
  sound: document.querySelector('#sound'),
  note: document.querySelector('#note'),
};

function step(dt) {
  if (ride.pedalling) ride.v += ACCEL * dt;
  ride.v -= ride.v * DRAG * dt + ROLLING * dt;
  ride.v = Math.max(0, Math.min(V_MAX, ride.v));

  const ds = ride.v * dt;
  const before = ((ride.s % route.length) + route.length) % route.length;
  ride.s += ds;
  const after = ((ride.s % route.length) + route.length) % route.length;
  if (ds > 0) {
    if (after < before) ride.lap++;
    passProps(before, after);
  }

  // The clock the music runs on. Distance, not time.
  ride.beats += ds / DIST_PER_BEAT;
  const t = setTier(ride.v);
  // The sequencer needs a tempo to scale its envelopes by, and the honest one
  // is whatever tempo the legs are currently producing.
  const bpm = Math.max(40, Math.min(200, (ride.v / DIST_PER_BEAT) * 60));
  pattern.bpm += (bpm - pattern.bpm) * Math.min(1, dt * 4);

  audio.update(clock, ride.beats);

  for (const p of props) if (p.ping > 0) p.ping = Math.max(0, p.ping - dt * 1.6);
  return t;
}

function draw() {
  const p = at(route, ride.s);
  // A little look-ahead down the road, so a bend shows you what you are riding
  // into rather than what you have just left.
  const lx = p.x + Math.cos(p.heading) * 46;
  const ly = p.y + Math.sin(p.heading) * 46;
  const tx = projX(lx, ly) - buf.width / 2;
  const ty = projY(lx, ly, 0) - buf.height * 0.56;
  camX += (tx - camX) * 0.09;
  camY += (ty - camY) * 0.09;

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = C.sky;
  g.fillRect(0, 0, buf.width, buf.height);
  // Whole-pixel camera. A fractional translate resamples every edge in the
  // picture and the pixel art stops being pixel art.
  g.setTransform(1, 0, 0, 1, -Math.round(camX), -Math.round(camY));

  // The field itself is a flat fill with no world position, so it is laid down
  // with the camera transform off and the scatter goes on top of it with the
  // transform back on.
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = C.grass[1];
  g.fillRect(0, 0, buf.width, buf.height);
  g.restore();
  for (const t of tufts) {
    const x = projX(t.x, t.y) - camX;
    const y = projY(t.x, t.y) - camY;
    if (x < -4 || y < -4 || x > buf.width + 4 || y > buf.height + 4) continue;
    g.fillStyle = t.r > 0.6 ? C.grass[2] : C.grass[0];
    g.fillRect(Math.round(projX(t.x, t.y)), Math.round(projY(t.x, t.y)), t.r > 0.9 ? 2 : 1, 1);
  }

  drawRiver();
  drawRoad(ride.s);
  drawBridge();

  // Everything that stands up, the bike included, in one depth-sorted pass.
  const near = [];
  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    if (prop.kind === 'plank') continue;
    const x = projX(prop.x, prop.y) - camX;
    const y = projY(prop.x, prop.y) - camY;
    if (x < -140 || y < -160 || x > buf.width + 140 || y > buf.height + 140) continue;
    near.push({ d: depth(prop.x, prop.y), prop, next: props[i + 1] });
  }
  near.push({ d: depth(p.x, p.y), bike: p });
  near.sort((a, b) => b.d - a.d);

  const facing = facingFor(p.heading);
  // The roll phase comes from distance, never from a timer: at 11.78 units to
  // the cycle this is the wheel actually turning against the ground, and a
  // clock here would have the bike skating whenever the speed changed.
  const row = Math.floor(((ride.s / ROLL.travelPerCycle) % ROLL.phases + ROLL.phases)) % ROLL.phases;
  ride.facing = facing;
  ride.row = row;
  // Up onto the deck at the ford. Signed distance round the loop, so it works
  // at the seam as well as in the middle.
  const half = route.length / 2;
  const toBridge = ((ride.s - bridge.s) % route.length + route.length + half) % route.length - half;
  const bikeZ = Math.abs(toBridge) < bridge.halfLength ? 2 : 0;
  for (const item of near) {
    if (item.bike) {
      if (loaded < 2) continue;
      const bx = Math.round(projX(p.x, p.y)) - PIVOT.x;
      const by = Math.round(projY(p.x, p.y, bikeZ)) - PIVOT.y;
      g.drawImage(shadowSheet, facing * SPRITE, 0, SPRITE, SPRITE, bx, by, SPRITE, SPRITE);
      g.drawImage(sheet, facing * SPRITE, row * SPRITE, SPRITE, SPRITE, bx, by, SPRITE, SPRITE);
      // The lantern, answering the pad. It is the one thing on the bike the
      // sprite renders as emissive, so it is the one thing allowed to bloom.
      const glow = 0.35 + audio.bands[2] * 0.65;
      const gx = bx + PIVOT.x + Math.cos(p.heading) * 26 * 0.7;
      const gy = by + PIVOT.y - 24;
      const rad = 7 + glow * 9;
      const grad = g.createRadialGradient(gx, gy, 0, gx, gy, rad);
      grad.addColorStop(0, `rgba(255,211,107,${(0.30 * glow).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255,211,107,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(gx, gy, rad, 0, Math.PI * 2);
      g.fill();
    } else {
      // Anything standing between the camera and the bike goes half
      // transparent while it is over it. In the wood the canopies hang across
      // the lane, which is the right look right up until an oak swallows the
      // thing you are steering.
      const sx = projX(item.prop.x, item.prop.y) - projX(p.x, p.y);
      const sy = projY(item.prop.x, item.prop.y) - projY(p.x, p.y);
      const over = item.d < depth(p.x, p.y) && Math.abs(sx) < 46 && sy > -26 && sy < 84;
      if (over) g.globalAlpha = 0.45;
      drawProp(item.prop, item.next);
      g.globalAlpha = 1;
    }
  }

  g2.setTransform(1, 0, 0, 1, 0, 0);
  g2.imageSmoothingEnabled = false;
  g2.clearRect(0, 0, canvas.width, canvas.height);
  g2.drawImage(buf, 0, 0, canvas.width, canvas.height);
}

let hudClock = 0;
function updateHud(t, dt) {
  hudClock += dt;
  if (hudClock < 0.1) return;
  hudClock = 0;
  const f = (((ride.s % route.length) + route.length) % route.length) / route.length;
  hud.zone.textContent = zoneAt(route, ride.s).name;
  hud.speed.textContent = Math.round(ride.v);
  hud.bpm.textContent = ride.v > 1 ? Math.round(pattern.bpm) : '—';
  hud.lap.textContent = ride.lap;
  hud.bar.style.width = `${(f * 100).toFixed(1)}%`;
  hud.voices.forEach((el, i) => el.classList.toggle('on', i < tier));
}

function frame(now) {
  const t = now / 1000;
  if (last === null) last = t;
  const dt = Math.max(0, Math.min(0.05, t - last));
  last = t;
  clock += dt;
  step(dt);
  draw();
  updateHud(clock, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --------------------------------------------------------------------- input

const pedal = (on) => { ride.pedalling = on; document.body.classList.toggle('pedalling', on); };

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); pedal(true); }
  if (e.key === 's' || e.key === 'S') toggleSound();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') pedal(false);
});
window.addEventListener('blur', () => pedal(false));
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pedal(true); });
canvas.addEventListener('pointerup', () => pedal(false));
canvas.addEventListener('pointercancel', () => pedal(false));

async function toggleSound() {
  const on = audio.mode !== 'tone';
  await audio.setMode(on ? 'tone' : 'field');
  hud.sound.classList.toggle('on', audio.mode === 'tone');
  hud.sound.textContent = audio.mode === 'tone' ? 'sound on' : 'sound off';
  hud.note.textContent = audio.error || (audio.mode === 'tone' ? 'the wheel is turning the bar' : '');
}
hud.sound.addEventListener('click', toggleSound);

// The tests reach for this rather than for the module internals, so that what
// they assert on is the ride as the page understands it.
window.errand = { ride, route, props, pattern, audio, tiers: () => tier };
