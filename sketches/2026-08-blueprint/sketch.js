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
    // Anchor the pattern so tile seams land on the exact centre.
    x: cx % cell, y: cy % cell,
  }, defs);
  el('rect', { width: cell, height: cell, fill: 'url(#bevel)' }, pat);

  el('rect', { width: w, height: h, fill: 'url(#grid)' }, svg);

  // The lines are drawn whole, not as pattern-tile edges: a stroke on a tile
  // edge gets its glow clipped by the tile boundary and every line comes out
  // lopsided. Walking out from the centre also makes the crosshair share its
  // coordinates with the grid exactly.
  const glow = el('g', { stroke: 'rgba(255,255,255,0.15)', 'stroke-width': 3.2 }, svg);
  const core = el('g', { stroke: 'rgba(255,255,255,0.6)', 'stroke-width': 1.2 }, svg);
  for (const g of [glow, core]) {
    for (let x = cx % cell; x <= w; x += cell) el('line', { x1: x, y1: 0, x2: x, y2: h }, g);
    for (let y = cy % cell; y <= h; y += cell) el('line', { x1: 0, y1: y, x2: w, y2: y }, g);
  }

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

// The dapple is a canopy shadow, not a gradient: two anisotropic fbm fields —
// one coarse for the leaf masses, one stretched hard across the diagonal so it
// breaks into quasi-parallel branch streaks — thresholded softly into light
// and shade. It renders at 1/3 resolution and ~20fps; the softness of the
// thing is what makes the upscale invisible.
const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uT;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  // Flip y so the diagonal runs top-left to bottom-right like the reference.
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uRes.y;
  float c = cos(0.56), s = sin(0.56);
  vec2 q = mat2(c, -s, s, c) * p;
  // Leaf masses drift along the diagonal; branch streaks evolve against them
  // at a different speed, so the interference never repeats. The mask gates
  // the streaks into clusters — a canopy has groups of branches, then sky.
  float blob   = fbm(vec2(q.x * 1.6, q.y * 2.6) + vec2(uT * 0.014, uT * 0.005));
  float streak = fbm(vec2(q.x * 2.0, q.y * 8.0) + vec2(-uT * 0.020, uT * 0.008));
  float m = smoothstep(0.34, 0.62, fbm(vec2(q.x * 0.8, q.y * 1.4) + vec2(uT * 0.006, 0.0)));
  float n = 0.6 * blob + mix(0.2, 0.55, m) * streak + 0.05;
  n = 0.5 + (n - 0.5) * 1.35;
  float light = smoothstep(0.50, 0.78, n);
  float shade = smoothstep(0.48, 0.22, n);
  vec3 sun = vec3(0.94, 0.96, 1.0) * light * 0.34;
  vec3 leaf = vec3(0.03, 0.05, 0.38) * shade * 0.38;
  gl_FragColor = vec4(sun + leaf, light * 0.34 + shade * 0.38);
}`;

const VERT = 'attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }';

const shadeCanvas = document.getElementById('shade');
const gl = shadeCanvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
let uT, uRes;

if (gl) {
  document.body.classList.add('gl');
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  uT = gl.getUniformLocation(prog, 'uT');
  uRes = gl.getUniformLocation(prog, 'uRes');
}

function sizeShade() {
  if (!gl) return;
  shadeCanvas.width = Math.ceil(window.innerWidth / 3);
  shadeCanvas.height = Math.ceil(window.innerHeight / 3);
  gl.viewport(0, 0, shadeCanvas.width, shadeCanvas.height);
  gl.uniform2f(uRes, shadeCanvas.width, shadeCanvas.height);
}

function renderShade() {
  if (!gl) return;
  gl.uniform1f(uT, t);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// Fallback drift for the CSS layers when WebGL is missing.
const light = document.querySelector('.streak.light');
const dark = document.querySelector('.streak.dark');
let t = 0;
let paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function applyDrift() {
  if (gl) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  light.style.transform =
    `rotate(32deg) translate3d(${(Math.sin(t / 23) * 0.045 * w).toFixed(2)}px, ` +
    `${(Math.sin(t / 15.5 + 1.7) * 0.03 * h).toFixed(2)}px, 0)`;
  dark.style.transform =
    `rotate(32deg) translate3d(${(Math.sin(t / 29 + 3.1) * 0.05 * w).toFixed(2)}px, ` +
    `${(Math.cos(t / 19) * 0.035 * h).toFixed(2)}px, 0)`;
}

let last = performance.now();
let tick = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    t += dt;
    // A wallpaper does not need 60fps: every third frame is plenty for
    // weather, and Plash keeps the page alive all day.
    if (tick++ % 3 === 0) renderShade();
    applyDrift();
  }
  requestAnimationFrame(frame);
}

let cell = rebuild();
sizeShade();
renderShade();
applyDrift();
requestAnimationFrame(frame);

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { cell = rebuild(); sizeShade(); renderShade(); applyDrift(); }, 120);
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
