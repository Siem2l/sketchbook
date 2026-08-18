// blueprint — the macOS blueprint wallpaper rebuilt from four flat layers:
// a blue ground, drifting bands of light and shade, a grid of glass tiles,
// and the draughtsman's dashed construction marks with the mark being
// constructed at the centre. The grid is an SVG pattern anchored so that a
// line crossing always lands exactly on the middle of the screen, which is
// what makes the crosshair read as part of the grid rather than drawn over it.

const NS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('geometry');
const qs = new URLSearchParams(location.search);
if (qs.has('bare')) document.body.classList.add('bare');

// FontAwesome's apple glyph, viewBox 0 0 384 512.
const APPLE =
  'M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 ' +
  '20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 ' +
  '81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 ' +
  '17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 ' +
  '24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 ' +
  '49.9-11.4 69.5-34.3z';

function el(name, attrs, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function cellSize(w, h) {
  return Math.max(48, Math.min(120, Math.round(Math.min(w, h) / 17)));
}

function rebuild() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cx = w / 2;
  const cy = h / 2;
  const cell = cellSize(w, h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.replaceChildren();

  const defs = el('defs', {}, svg);

  // Each tile is faintly brighter along its top — that bevel is what turns a
  // ruled grid into a wall of glass tiles.
  const bevel = el('linearGradient', { id: 'bevel', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0', 'stop-color': 'rgba(255,255,255,0.05)' }, bevel);
  el('stop', { offset: '0.35', 'stop-color': 'rgba(255,255,255,0)' }, bevel);
  el('stop', { offset: '1', 'stop-color': 'rgba(0,0,40,0.03)' }, bevel);

  const pat = el('pattern', {
    id: 'grid', width: cell, height: cell, patternUnits: 'userSpaceOnUse',
    // Anchor the pattern so line crossings land on the exact centre.
    x: cx % cell, y: cy % cell,
  }, defs);
  el('rect', { width: cell, height: cell, fill: 'url(#bevel)' }, pat);
  el('rect', {
    x: 2.5, y: 2.5, width: cell - 5, height: cell - 5, rx: 5,
    fill: 'none', stroke: 'rgba(255,255,255,0.06)', 'stroke-width': 1,
  }, pat);
  // Two strokes per line: a wide faint one underneath reads as glow.
  el('path', {
    d: `M ${cell} 0 H 0 V ${cell}`,
    fill: 'none', stroke: 'rgba(255,255,255,0.18)', 'stroke-width': 3.5,
  }, pat);
  el('path', {
    d: `M ${cell} 0 H 0 V ${cell}`,
    fill: 'none', stroke: 'rgba(255,255,255,0.65)', 'stroke-width': 1.3,
  }, pat);

  el('rect', { width: w, height: h, fill: 'url(#grid)' }, svg);

  // Construction marks: corner-to-corner diagonals, two concentric circles,
  // and a crosshair that runs a little past the outer circle.
  const marks = el('g', {
    fill: 'none', stroke: 'rgba(255,255,255,0.55)',
    'stroke-width': 1.1, 'stroke-dasharray': '7 7',
  }, svg);
  el('line', { x1: 0, y1: 0, x2: w, y2: h }, marks);
  el('line', { x1: w, y1: 0, x2: 0, y2: h }, marks);
  el('circle', { cx, cy, r: 2.5 * cell }, marks);
  el('circle', { cx, cy, r: 4.5 * cell }, marks);
  const reach = 5.5 * cell;
  el('line', { x1: cx - reach, y1: cy, x2: cx + reach, y2: cy }, marks);
  el('line', { x1: cx, y1: cy - reach, x2: cx, y2: cy + reach }, marks);

  const logoH = 1.6 * cell;
  const s = logoH / 512;
  el('path', {
    d: APPLE, fill: 'rgba(235,240,255,0.9)',
    transform: `translate(${cx - (384 * s) / 2} ${cy - (512 * s) / 2}) scale(${s})`,
  }, svg);

  // A whisper of grain keeps the flat fields from banding on big displays.
  const filt = el('filter', { id: 'grain' }, defs);
  el('feTurbulence', { type: 'fractalNoise', baseFrequency: 0.8, numOctaves: 2, stitchTiles: 'stitch' }, filt);
  el('feColorMatrix', {
    values: '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.04 0',
  }, filt);
  el('rect', { width: w, height: h, filter: 'url(#grain)' }, svg);

  return cell;
}

// The drift. Two layers wander on incommensurate sine periods, so the weather
// never visibly loops. Peak speed is a few pixels a second — the desk should
// breathe, not scroll.
const light = document.querySelector('.streak.light');
const dark = document.querySelector('.streak.dark');
let t = 0;
let paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function applyDrift() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  light.style.transform =
    `translate3d(${(Math.sin(t / 23) * 0.045 * w).toFixed(2)}px, ` +
    `${(Math.sin(t / 15.5 + 1.7) * 0.03 * h).toFixed(2)}px, 0)`;
  dark.style.transform =
    `translate3d(${(Math.sin(t / 29 + 3.1) * 0.05 * w).toFixed(2)}px, ` +
    `${(Math.cos(t / 19) * 0.035 * h).toFixed(2)}px, 0)`;
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    t += dt;
    applyDrift();
  }
  requestAnimationFrame(frame);
}

let cell = rebuild();
applyDrift();
requestAnimationFrame(frame);

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { cell = rebuild(); applyDrift(); }, 120);
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    paused = !paused;
  }
});

window.blueprint = {
  get t() { return t; },
  get paused() { return paused; },
  setPaused(v) { paused = !!v; },
  get cell() { return cell; },
};
