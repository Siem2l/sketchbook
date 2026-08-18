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

// A wallpaper is personal, so the sheet is configurable from the URL alone:
// ?hue=145 (or a name below, or 'graphite'), ?sat=60, ?icon=🌲 or ?icon=none.
const NAMED_HUES = { red: 2, orange: 28, gold: 45, green: 145, teal: 175, blue: 230, purple: 275, pink: 330 };
const BASE_HUE = 230;
const icon = qs.get('icon');
let hue = BASE_HUE;
let satMul = 1;
{
  const raw = qs.get('hue');
  if (raw === 'graphite') satMul = 0.12;
  else if (raw !== null) {
    const n = raw in NAMED_HUES ? NAMED_HUES[raw] : parseFloat(raw);
    if (Number.isFinite(n)) hue = ((n % 360) + 360) % 360;
  }
  const s = parseFloat(qs.get('sat'));
  if (Number.isFinite(s)) satMul *= Math.max(0, Math.min(1.5, s / 100));
}
const hueDelta = hue - BASE_HUE;
const tinted = hueDelta !== 0 || satMul !== 1;

function hslToRgb(h, s, l) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

// The ground's five stops, as the blue original's hue/sat/lightness — a new
// hue keeps the ramp and swaps the paper.
const GROUND = [
  [229, 0.65, 0.58, '0%'], [230, 0.62, 0.49, '38%'], [232, 0.70, 0.43, '68%'],
  [233, 0.75, 0.37, '88%'], [234, 0.79, 0.32, '100%'],
];
if (tinted) {
  // Equal HSL lightness reads paler once the hue leaves blue, so a shifted
  // hue gives a little lightness back to keep the paper's depth.
  const lightMul = hueDelta === 0 ? 1 : 0.86;
  const stops = GROUND.map(([gh, gs, gl, at]) =>
    `hsl(${(gh + hueDelta + 360) % 360} ${Math.round(gs * satMul * 100)}% ${Math.round(gl * lightMul * 100)}%) ${at}`);
  document.body.style.background = `radial-gradient(120% 90% at 50% 44%, ${stops.join(', ')})`;
}
// The shade the canopy casts, re-derived from the same shift.
const LEAF = hslToRgb((237 + hueDelta + 360) % 360, Math.min(1, 0.85 * satMul), 0.205);

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

function rebuild() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cx = w / 2;
  const cy = h / 2;
  // The sheet holds exactly 20 heavy-bounded 2x2 blocks across and 14 down —
  // 40 columns, 28 rows — so the cells give up perfect squareness to keep
  // the count on every screen. Everything round is sized off the row height.
  const cellX = w / 40;
  const cellY = h / 28;
  const cell = cellY;
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
    id: 'grid', width: cellX, height: cellY, patternUnits: 'userSpaceOnUse',
    // Anchor the pattern so tile seams land on the exact centre.
    x: cx % cellX, y: cy % cellY,
  }, defs);
  el('rect', { width: cellX, height: cellY, fill: 'url(#bevel)' }, pat);

  el('rect', { width: w, height: h, fill: 'url(#grid)' }, svg);

  // The lines are drawn whole, not as pattern-tile edges: a stroke on a tile
  // edge gets its glow clipped by the tile boundary and every line comes out
  // lopsided. The grid carries two weights like the original — every other
  // rule is heavy, anchored so the two through the centre are heavy.
  // Those two centre rules are the crosshair, and like everything drawn near
  // the middle they stop short of the mark.
  // The rules cross partway into the innermost cell — past the last grid
  // crossing, stopped before the logo — so the clearing hugs the mark and
  // the mark touches not a single line. Custom icons vary in reach, so
  // they keep a wider clearing than the apple.
  const hole = icon === null ? 1.0 * cell : icon === 'none' ? 0 : 1.8 * cell;
  const minor = el('g', { stroke: 'rgba(255,255,255,0.34)', 'stroke-width': 1 }, svg);
  const majorGlow = el('g', { stroke: 'rgba(255,255,255,0.15)', 'stroke-width': 6 }, svg);
  const major = el('g', { stroke: 'rgba(255,255,255,0.65)', 'stroke-width': 2.6 }, svg);
  const rule = (fixed, vertical, group, gap) => {
    const [a, b, mid] = vertical ? ['x', 'y', cy] : ['y', 'x', cx];
    const line = (from, to) =>
      el('line', { [`${a}1`]: fixed, [`${a}2`]: fixed, [`${b}1`]: from, [`${b}2`]: to }, group);
    if (gap) {
      line(0, mid - gap);
      line(mid + gap, vertical ? h : w);
    } else {
      line(0, vertical ? h : w);
    }
  };
  // Minor rules stop inside the circles: where one would cross the outer
  // circle it is drawn only up to the rim, so the middle holds nothing but
  // the heavy rules, the dashes, and the mark.
  const rim = 7 * cell;
  for (const vertical of [true, false]) {
    const [centre, extent, step] = vertical ? [cx, w, cellX] : [cy, h, cellY];
    for (let k = -Math.ceil(centre / step); centre + k * step <= extent; k++) {
      const at = centre + k * step;
      if (k % 2 === 0) {
        const gap = k === 0 ? hole : 0;
        rule(at, vertical, majorGlow, gap);
        rule(at, vertical, major, gap);
      } else {
        const d = Math.abs(at - centre);
        rule(at, vertical, minor, d < rim ? Math.sqrt(rim * rim - d * d) : 0);
      }
    }
  }

  // Construction marks — only the diagonals and circles, and only dashed:
  // the crosshair is the pair of heavy grid rules above. The diagonals stop
  // short of the mark the same way those do.
  const marks = el('g', {
    fill: 'none', stroke: 'rgba(255,255,255,0.55)',
    'stroke-width': 1.1, 'stroke-dasharray': '7 7',
  }, svg);
  const diag = (x, y) => {
    const len = Math.hypot(cx - x, cy - y);
    const ux = (cx - x) / len;
    const uy = (cy - y) / len;
    el('line', { x1: x, y1: y, x2: cx - ux * hole, y2: cy - uy * hole }, marks);
    el('line', { x1: cx + ux * hole, y1: cy + uy * hole, x2: 2 * cx - x, y2: 2 * cy - y }, marks);
  };
  diag(0, 0);
  diag(w, 0);
  el('circle', { cx, cy, r: 4 * cell }, marks);
  el('circle', { cx, cy, r: 7 * cell }, marks);

  if (icon === null) {
    const logoH = 1.65 * cell;
    const s = logoH / 512;
    el('path', {
      d: APPLE, fill: 'rgba(235,240,255,0.9)',
      transform: `translate(${cx - (384 * s) / 2} ${cy - (512 * s) / 2}) scale(${s})`,
    }, svg);
  } else if (/\.(svg|png|jpe?g|webp)$/i.test(icon) || icon.includes('/')) {
    // An image URL — resolved against the page, so a file shipped next to
    // the sketch is just ?icon=boid.svg. It keeps its own colours.
    const box = 3.2 * cell;
    el('image', {
      x: cx - box / 2, y: cy - box / 2, width: box, height: box,
      href: icon, preserveAspectRatio: 'xMidYMid meet',
    }, svg);
  } else if (icon !== 'none') {
    const glyph = el('text', {
      x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': 2.6 * cell, fill: 'rgba(235,240,255,0.9)',
      'font-family': "system-ui, 'Apple Color Emoji', 'Noto Color Emoji', sans-serif",
    }, svg);
    glyph.textContent = icon;
  }

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
uniform vec3 uLeaf;

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
  vec3 leaf = uLeaf * shade * 0.38;
  gl_FragColor = vec4(sun + leaf, light * 0.34 + shade * 0.38);
}`;

const VERT = 'attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }';

const shadeCanvas = document.getElementById('shade');
const gl = shadeCanvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
let glOn = false;
let uT, uRes;

if (gl) {
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
  // A driver that will not link this shader is a driver we fall back on,
  // same as no WebGL at all — the CSS layers are behind the canvas anyway.
  if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    glOn = true;
    document.body.classList.add('gl');
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    uT = gl.getUniformLocation(prog, 'uT');
    uRes = gl.getUniformLocation(prog, 'uRes');
    gl.uniform3f(gl.getUniformLocation(prog, 'uLeaf'), LEAF[0], LEAF[1], LEAF[2]);
    shadeCanvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      glOn = false;
      document.body.classList.remove('gl');
      applyDrift();
    });
  }
}

function sizeShade() {
  if (!glOn) return;
  shadeCanvas.width = Math.ceil(window.innerWidth / 3);
  shadeCanvas.height = Math.ceil(window.innerHeight / 3);
  gl.viewport(0, 0, shadeCanvas.width, shadeCanvas.height);
  gl.uniform2f(uRes, shadeCanvas.width, shadeCanvas.height);
}

function renderShade() {
  if (!glOn) return;
  gl.uniform1f(uT, t);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// Fallback drift for the CSS layers when WebGL is missing. Their gradients
// are authored in blue, so a tint re-aims them the cheap way.
const light = document.querySelector('.streak.light');
const dark = document.querySelector('.streak.dark');
if (tinted) {
  for (const layer of [light, dark]) {
    layer.style.filter = `hue-rotate(${hueDelta}deg) saturate(${satMul})`;
  }
}
let t = 0;
let paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function applyDrift() {
  if (glOn) return;
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
let lastShade = -1e9;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    t += dt;
    // A wallpaper does not need 60fps: ~20 is plenty for weather, and pacing
    // by time rather than frame count keeps a 120Hz display at 20, not 40.
    if (now - lastShade >= 48) {
      lastShade = now;
      renderShade();
    }
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
