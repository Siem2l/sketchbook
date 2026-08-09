// message noise — a hidden message deterministically seeds a living
// top-down perlin noise map. Same message + same stamp = same image, so a
// frozen frame can always be found again. The message is hashed
// client-side and never rendered, stored, or put in the URL.
//
// The message picks the terrain's character *and* its palette; everything
// after that is yours to move. Whatever you move is printed in the stamp
// along the bottom edge, so the image stays reproducible from the stamp
// plus the words in your head.
import p5 from 'p5';

const SIZE = 720;
const CELL = 4;              // device-px resolution of the sampled field
const Z_SPEED = 0.0035;      // how fast the terrain breathes
const INDEX_EVERY = 4;       // every Nth line is a thick, labelled index contour
const HATCH_PASSES = 4;
// All four obliques, none axis-aligned: a horizontal or vertical pass breaks
// along the same axis as the sample grid, and the map ends up printing its
// own rasteriser as staircases.
const HATCH_ANGLES = [-Math.PI / 4, Math.PI / 4, Math.PI / 12, -5 * Math.PI / 12];

const MODES = ['topo', 'contour', 'hybrid', 'hatch'];

// p5's perlin never spans 0..1: it lands in a narrow band low in the range,
// and that band drifts upward as octaves are added. Left raw, a seven-stop
// ramp only ever shows its middle three — measured, a default map used 5 of
// its 12 bands. These are the 1st/99th percentiles measured per octave count
// across the scale and warp the controls can reach; stretching between them
// is what puts deep water and summits back on the map. The ~1% clipped at
// each end becomes flat ocean floor and summit plateau, which is what a
// surveyed sheet shows there anyway.
const NORM = [null, [0.06, 0.44], [0.15, 0.60], [0.20, 0.67], [0.23, 0.70], [0.24, 0.71]];

// Seven-stop ramps, deep to high, with the shoreline deliberately on the
// middle stop — the sea-level control slides the terrain across that stop,
// so flooding and draining stay legible in every theme. `paper`/`ink` are
// what the line modes draw on and with; `stamp` has to survive being laid
// over the ramp's dark end in topo mode.
const PALETTES = [
  { name: 'bathyal', paper: '#faf8f2', ink: '#1a1a18', stamp: '#f0ead6',
    ramp: ['#0b1626', '#132b42', '#1f5361', '#7fb3a3', '#bfcfa8', '#ded7b4', '#f0ead6'] },
  { name: 'oxide', paper: '#fbf5e9', ink: '#2a1206', stamp: '#f7e6c8',
    ramp: ['#2a1206', '#57230c', '#8f4415', '#c9803a', '#dfa964', '#eecb96', '#f7e6c8'] },
  { name: 'ordnance', paper: '#f8f4e4', ink: '#22332e', stamp: '#f8f4e4',
    ramp: ['#2f4a44', '#4f6f62', '#7b9682', '#adc0a4', '#d3d6bc', '#e9e5cb', '#f8f4e4'] },
  // The one to export when the map is going to a tattooist as line reference.
  { name: 'graphite', paper: '#f7f7f5', ink: '#0d0d0d', stamp: '#f4f4f4',
    ramp: ['#0d0d0d', '#2a2a2a', '#4a4a4a', '#7a7a7a', '#a8a8a8', '#d2d2d2', '#f4f4f4'] },
  // Riso duotone: the shore lands on unprinted paper between the two inks.
  { name: 'risograph', paper: '#f6f2e8', ink: '#151a5e', stamp: '#f8a6c0',
    ramp: ['#151a5e', '#2b3ba8', '#5a6fd8', '#f2eee6', '#f8a6c0', '#f2618e', '#e0225f'] },
  { name: 'thermal', paper: '#faf7ef', ink: '#0d0716', stamp: '#fdf0a0',
    ramp: ['#05030f', '#2b0b4a', '#6b1160', '#b32152', '#e35d2b', '#f2a72a', '#fdf0a0'] },
];

// Marching-squares helpers — trace clean iso-lines like a real topo map
// instead of the old per-pixel band trick. Each grid cell emits 0-2 line
// segments depending on which of its 4 corners sit above the level.
function inv(a, b, level) {
  const d = b - a;
  return d === 0 ? 0.5 : (level - a) / d;
}
function line2(g, a, b) {
  g.line(a[0], a[1], b[0], b[1]);
}
function segFor(g, idx, T, R, B, L) {
  switch (idx) {
    case 1: line2(g, L, B); break;
    case 2: line2(g, B, R); break;
    case 3: line2(g, L, R); break;
    case 4: line2(g, T, R); break;
    case 5: line2(g, T, L); line2(g, B, R); break; // saddle
    case 6: line2(g, T, B); break;
    case 7: line2(g, T, L); break;
    case 8: line2(g, T, L); break;
    case 9: line2(g, T, B); break;
    case 10: line2(g, T, R); line2(g, B, L); break; // saddle
    case 11: line2(g, T, R); break;
    case 12: line2(g, L, R); break;
    case 13: line2(g, B, R); break;
    case 14: line2(g, L, B); break;
  }
}
// One representative segment per case, used to anchor + orient a label.
function firstSeg(idx, T, R, B, L) {
  switch (idx) {
    case 1: case 14: return [L, B];
    case 2: case 13: return [B, R];
    case 3: case 12: return [L, R];
    case 4: case 11: return [T, R];
    case 6: case 9: return [T, B];
    case 7: case 8: return [T, L];
    case 10: return [T, R];
    default: return [T, L]; // 5 and fallback
  }
}
function farFrom(placed, x, y, d) {
  for (const p of placed) {
    if (Math.hypot(p[0] - x, p[1] - y) < d) return false;
  }
  return true;
}
function drawLabel(g, x, y, seg, txt, f, paper, ink) {
  // Rotate to follow the contour, kept upright, with a paper-coloured break
  // in the line behind it — exactly how surveyed contours are annotated.
  let ang = Math.atan2(seg[1][1] - seg[0][1], seg[1][0] - seg[0][0]);
  if (ang > Math.PI / 2) ang -= Math.PI;
  if (ang < -Math.PI / 2) ang += Math.PI;
  g.push();
  g.translate(x, y);
  g.rotate(ang);
  g.textFont('serif');
  g.textSize(9 * f);
  g.textAlign(g.CENTER, g.CENTER);
  const wLbl = g.textWidth(txt);
  g.noStroke();
  g.fill(paper);
  g.rect(-wLbl / 2 - 2 * f, -6 * f, wLbl + 4 * f, 12 * f);
  g.fill(ink);
  g.text(txt, 0, 0);
  g.pop();
}

// cyrb128 — small, well-distributed 128-bit string hash. We only need
// determinism, not cryptography: the message is never transmitted.
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

new p5((p) => {
  let t = 0;               // field time, advances only while unfrozen
  let frozen = false;
  let modeIx = 0;
  let palIx = 0;
  let baseScale;           // noise zoom the message asked for
  let baseWarp;            // domain-warp strength the message asked for
  let bands, zoom, warp, octaves, sea;  // live controls, seeded then yours
  let lut = [];            // band index → colour, rebuilt on palette/bands change
  let showStamp = true;    // the harness in lab/ turns this off to rank blind

  const pal = () => PALETTES[palIx];
  const mode = () => MODES[modeIx];

  function rampColor(ramp, u) {
    const n = ramp.length - 1;
    const x = Math.min(0.999999, Math.max(0, u)) * n;
    const i = Math.floor(x);
    return p.lerpColor(p.color(ramp[i]), p.color(ramp[i + 1]), x - i);
  }

  // Quantising to `bands` first means the ramp is only ever sampled a few
  // dozen times per change, instead of once per cell per frame.
  function buildLut() {
    const ramp = pal().ramp;
    lut = [];
    for (let i = 0; i < bands; i++) {
      lut.push(rampColor(ramp, bands === 1 ? 0.5 : i / (bands - 1)));
    }
  }

  function applySeed(message) {
    const seed = cyrb128(message || '…');
    p.noiseSeed(seed[0]);
    p.randomSeed(seed[1]);
    // Let the message shape the terrain's character, not just its layout.
    // Low frequency → a handful of large hill systems span the canvas; light
    // warp keeps the lines flowing rather than jittery.
    baseScale = 0.003 + (seed[2] % 1000) / 1000 * 0.003;
    baseWarp = 0.2 + (seed[3] % 1000) / 1000 * 0.5;
    palIx = seed[1] % PALETTES.length;   // the words choose their own colours
    resetParams();
    t = 0;
    frozen = false;
    document.getElementById('freeze').textContent = 'freeze';
  }

  function resetParams() {
    bands = 12;
    zoom = 1;
    warp = baseWarp;
    // Few octaves + gentle falloff = big, smooth rolling terrain (surveyed
    // contour look) instead of high-frequency speckle.
    octaves = 2;
    sea = 0.5;
    buildLut();
    syncControls();
  }

  // Sea level slides the terrain across the ramp's middle stop without ever
  // moving the shoreline off it, so a flooded map still reads as a map — but
  // only after the raw field has been stretched out (see NORM).
  function shape(v) {
    const [lo, hi] = NORM[octaves];
    const n = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    return n < sea ? 0.5 * n / sea : 0.5 + 0.5 * (n - sea) / (1 - sea);
  }

  function field(x, y, z) {
    // Domain-warped 3D noise: warp offsets sampled from a second octave
    // make the map read as organic terrain rather than smooth blobs.
    const s = baseScale * zoom;
    const wx = p.noise(x * s * 2 + 40, y * s * 2 + 40, z) * warp;
    const wy = p.noise(x * s * 2 + 90, y * s * 2 + 90, z) * warp;
    return p.noise(x * s + wx, y * s + wy, z);
  }

  // One shaped elevation grid per frame, shared by every mode. Sampling in
  // device pixels means an export samples 3x finer, which is what makes the
  // contours smooth and the bands clean at print size.
  function sampleGrid(g, f) {
    const step = CELL;
    const cols = Math.floor(g.width / step) + 2;
    const rows = Math.floor(g.height / step) + 2;
    const grid = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        grid[j * cols + i] = shape(field((i * step) / f, (j * step) / f, t));
      }
    }
    return { grid, cols, rows, step };
  }

  function render(g) {
    const f = g.width / SIZE; // keep the world identical at export resolution
    p.noiseDetail(octaves, 0.5);
    const G = sampleGrid(g, f);
    const m = mode();

    if (m === 'topo' || m === 'hybrid') drawTopo(g, G);
    if (m === 'contour' || m === 'hybrid') {
      // In hybrid the lines have to land on the band edges, or the map reads
      // as two drawings stacked rather than one surveyed sheet.
      drawContours(g, G, f, m === 'hybrid' ? bands : bands * 2, m === 'hybrid');
    }
    if (m === 'hatch') drawHatch(g, G, f);

    drawStamp(g, f, m);
  }

  // The whole recipe, minus the words: enough to find this image again.
  function drawStamp(g, f, m) {
    if (!showStamp) return;
    g.noStroke();
    g.textFont('monospace');
    g.textSize(11 * f);
    g.textAlign(g.LEFT, g.BASELINE);
    const recipe = `b${bands} z${zoom.toFixed(2)} w${warp.toFixed(2)} o${octaves} s${sea.toFixed(2)}`;
    const txt = `t=${t.toFixed(3)} · ${pal().name} · ${m} · ${recipe}`;
    const x = 10 * f, y = g.height - 10 * f;
    if (m !== 'topo') {
      // The same break the contour labels get: over dense hatching, ink on
      // ink is not a stamp you can read back.
      g.fill(pal().paper);
      g.rect(x - 3 * f, y - 11 * f, g.textWidth(txt) + 6 * f, 15 * f);
    }
    g.fill(m === 'topo' ? pal().stamp : pal().ink);
    g.text(txt, x, y);
  }

  // Filled colour relief — deep water → shore → highland.
  function drawTopo(g, G) {
    g.noStroke();
    for (let j = 0; j < G.rows - 1; j++) {
      for (let i = 0; i < G.cols - 1; i++) {
        const v = G.grid[j * G.cols + i];
        const b = Math.min(bands - 1, Math.max(0, Math.floor(v * bands)));
        g.fill(lut[b]);
        g.rect(i * G.step, j * G.step, G.step, G.step);
      }
    }
  }

  // Rec. 601 luma of the band a contour edges, used to decide whether that
  // line should be drawn in ink or in paper. Cheap: once per level, not per
  // cell.
  function edgeStroke(l) {
    const c = lut[Math.min(bands - 1, l)];
    const lum = 0.299 * p.red(c) + 0.587 * p.green(c) + 0.114 * p.blue(c);
    return p.color((lum > 128 ? pal().ink : pal().paper) + 'aa');
  }

  // Clean nested iso-lines via marching squares, with a handful of rotated
  // elevation labels on the thicker index contours. Over a filled relief the
  // lines go on unlabelled and thinner — the colour is already saying it.
  function drawContours(g, G, f, levels, over) {
    const w = g.width, h = g.height;
    const { grid, cols, rows, step } = G;
    if (!over) g.background(pal().paper);
    g.noFill();
    const placed = [];

    for (let l = 1; l < levels; l++) {
      const level = l / levels;
      const isIndex = l % INDEX_EVERY === 0;
      // Over a filled relief a fixed dark line disappears into the ramp's
      // dark end, so the line takes whichever of ink/paper the band it edges
      // is not — the contour stays visible from ocean floor to summit.
      g.stroke(over ? edgeStroke(l) : pal().ink);
      g.strokeWeight((isIndex ? 1.6 : 0.85) * (over ? 0.6 : 1) * f);
      let sinceLabel = 30;

      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const tl = grid[j * cols + i];
          const tr = grid[j * cols + i + 1];
          const br = grid[(j + 1) * cols + i + 1];
          const bl = grid[(j + 1) * cols + i];
          let idx = 0;
          if (tl > level) idx |= 8;
          if (tr > level) idx |= 4;
          if (br > level) idx |= 2;
          if (bl > level) idx |= 1;
          if (idx === 0 || idx === 15) continue;

          const x0 = i * step, y0 = j * step, x1 = x0 + step, y1 = y0 + step;
          const T = [x0 + step * inv(tl, tr, level), y0];
          const R = [x1, y0 + step * inv(tr, br, level)];
          const B = [x0 + step * inv(bl, br, level), y1];
          const L = [x0, y0 + step * inv(tl, bl, level)];
          segFor(g, idx, T, R, B, L);

          if (isIndex && !over && placed.length < 14) {
            sinceLabel++;
            if (sinceLabel > 50) {
              const seg = firstSeg(idx, T, R, B, L);
              const mx = (seg[0][0] + seg[1][0]) / 2;
              const my = (seg[0][1] + seg[1][1]) / 2;
              if (mx > 34 * f && mx < w - 34 * f && my > 24 * f && my < h - 24 * f &&
                  farFrom(placed, mx, my, 84 * f)) {
                const meters = (l / INDEX_EVERY) * 50;
                drawLabel(g, mx, my, seg, `${meters}m`, f, pal().paper, pal().ink);
                placed.push([mx, my]);
                sinceLabel = 0;
              }
            }
          }
        }
      }
    }
  }

  // Engraved relief: four cross-hatch passes at rising tone thresholds, so
  // the deep water carries all four and the highland carries none. Lines run
  // continuously and break where the tone drops, the way a burin cuts —
  // per-cell dashes would just print the sampling grid.
  function drawHatch(g, G, f) {
    const w = g.width, h = g.height;
    const { grid, cols, rows, step } = G;
    // Bilinear, not nearest: the hatch breaks wherever tone crosses a
    // threshold, so a stepped lookup would put every break on a 4px cell edge
    // and the strokes would end in a visible staircase. Deep water is the
    // dark end, so it carries all four passes and the summits carry none.
    const toneAt = (x, y) => {
      const gx = Math.min(cols - 1.001, Math.max(0, x / step));
      const gy = Math.min(rows - 1.001, Math.max(0, y / step));
      const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j;
      const top = grid[j * cols + i] + (grid[j * cols + i + 1] - grid[j * cols + i]) * fx;
      const bot = grid[(j + 1) * cols + i] + (grid[(j + 1) * cols + i + 1] - grid[(j + 1) * cols + i]) * fx;
      return 1 - (top + (bot - top) * fy);
    };

    g.background(pal().paper);
    g.stroke(pal().ink);
    g.strokeWeight(0.9 * f);
    g.noFill();

    const cx = w / 2, cy = h / 2;
    const diag = Math.hypot(w, h);
    const spacing = 7 * f;
    const walk = 3 * f;

    for (let k = 0; k < HATCH_PASSES; k++) {
      const level = (k + 1) / (HATCH_PASSES + 1);
      const a = HATCH_ANGLES[k], ca = Math.cos(a), sa = Math.sin(a);
      for (let u = -diag / 2; u <= diag / 2; u += spacing) {
        let on = false, sx = 0, sy = 0, lx = 0, ly = 0;
        for (let v = -diag / 2; v <= diag / 2; v += walk) {
          const x = cx + ca * v - sa * u;
          const y = cy + sa * v + ca * u;
          const hit = x >= 0 && y >= 0 && x < w && y < h && toneAt(x, y) > level;
          if (hit && !on) { sx = x; sy = y; on = true; }
          else if (!hit && on) { g.line(sx, sy, lx, ly); on = false; }
          lx = x; ly = y;
        }
        if (on) g.line(sx, sy, lx, ly);
      }
    }
  }

  // ------------------------------------------------------------------ ui

  const CONTROLS = [
    { id: 'bands', get: () => bands, set: (v) => { bands = v; buildLut(); }, fmt: (v) => v },
    { id: 'zoom', get: () => zoom, set: (v) => { zoom = v; }, fmt: (v) => v.toFixed(2) },
    { id: 'warp', get: () => warp, set: (v) => { warp = v; }, fmt: (v) => v.toFixed(2) },
    { id: 'octaves', get: () => octaves, set: (v) => { octaves = v; }, fmt: (v) => v },
    { id: 'sea', get: () => sea, set: (v) => { sea = v; }, fmt: (v) => v.toFixed(2) },
  ];

  function syncControls() {
    for (const c of CONTROLS) {
      const el = document.getElementById(c.id);
      if (!el) continue;
      el.value = String(c.get());
      document.getElementById(`${c.id}-val`).textContent = c.fmt(c.get());
    }
    const pb = document.getElementById('palette');
    if (pb) pb.textContent = `pal ${pal().name}`;
    const mb = document.getElementById('mode');
    if (mb) mb.textContent = `mode ${mode()}`;
  }

  function cyclePalette(d) {
    palIx = (palIx + d + PALETTES.length) % PALETTES.length;
    buildLut();
    syncControls();
  }

  function cycleMode(d) {
    modeIx = (modeIx + d + MODES.length) % MODES.length;
    syncControls();
  }

  // p5 1.11's Graphics.remove() throws on its own bookkeeping — it looks for
  // `_elements` on the buffer rather than on the sketch that owns it — so the
  // export buffer gets dropped by hand instead: unhook it from the sketch,
  // detach the canvas, let it be collected.
  function dispose(g) {
    const i = p._elements.indexOf(g);
    if (i !== -1) p._elements.splice(i, 1);
    if (g.elt) g.elt.remove();
  }

  function toggleFreeze() {
    frozen = !frozen;
    document.getElementById('freeze').textContent = frozen ? 'resume' : 'freeze';
  }

  // Stepping is how you land on a frame you glimpsed, so it freezes first —
  // resuming from a step you had to hunt for would throw the frame away.
  function step(dir, big) {
    if (!frozen) toggleFreeze();
    t = Math.max(0, t + dir * Z_SPEED * (big ? 10 : 1));
  }

  p.setup = () => {
    p.createCanvas(SIZE, SIZE);
    applySeed('…');

    const msgEl = document.getElementById('message');
    document.getElementById('apply').onclick = () => applySeed(msgEl.value);
    msgEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applySeed(msgEl.value);
      e.stopPropagation();
    });
    document.getElementById('reveal').onclick = () => {
      msgEl.type = msgEl.type === 'password' ? 'text' : 'password';
    };
    document.getElementById('freeze').onclick = toggleFreeze;
    document.getElementById('mode').onclick = () => cycleMode(1);
    document.getElementById('palette').onclick = () => cyclePalette(1);
    document.getElementById('reset').onclick = resetParams;

    for (const c of CONTROLS) {
      const el = document.getElementById(c.id);
      el.addEventListener('input', () => {
        c.set(parseFloat(el.value));
        document.getElementById(`${c.id}-val`).textContent = c.fmt(c.get());
      });
    }

    document.getElementById('save').onclick = () => {
      // Re-render the exact current frame at 3x for print/tattoo reference.
      const g = p.createGraphics(SIZE * 3, SIZE * 3);
      render(g);
      p.saveCanvas(g, `message-noise-${mode()}-${pal().name}-t${t.toFixed(3)}`, 'png');
      dispose(g);
    };

    syncControls();
  };

  p.keyPressed = () => {
    // A focused slider owns its own arrow keys; don't scrub time underneath it.
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;

    if (p.key === ' ') { toggleFreeze(); return false; }
    if (p.key === 'c' || p.key === 'C') { cyclePalette(p.key === 'C' ? -1 : 1); return false; }
    if (p.key === 'm' || p.key === 'M') { cycleMode(p.key === 'M' ? -1 : 1); return false; }
    if (p.key === 'r' || p.key === 'R') { resetParams(); return false; }
    if (p.keyCode === p.LEFT_ARROW) { step(-1, p.keyIsDown(p.SHIFT)); return false; }
    if (p.keyCode === p.RIGHT_ARROW) { step(1, p.keyIsDown(p.SHIFT)); return false; }
  };

  p.draw = () => {
    if (!frozen) t += Z_SPEED;
    render(p);
  };

  // Read-only view of what the stamp already prints, for the behaviour tests —
  // plus one setter, for the ranking harness in lab/. The message itself is
  // never readable from here; it can be set, but not asked for.
  if (typeof window !== 'undefined') {
    window.__messageNoise = {
      // Puts the sketch in an exact state and freezes it. The harness needs
      // this because a variant has to be reproducible: driving the sliders and
      // pressing the arrow key 350 times to arrive at t=1.234 is an
      // approximation, not a reproduction.
      //
      // `stamp: false` is what makes blind ranking possible at all — the stamp
      // prints the palette, the mode and every parameter onto the image, so a
      // ranker looking at a stamped frame is reading the recipe, not judging
      // the picture.
      //
      // Returns the resulting state so the caller records what the sketch
      // actually did rather than what it was asked to do. `message` is in the
      // argument and absent from the return, which is the same asymmetry the
      // rest of the sketch keeps.
      apply: (spec = {}) => {
        if (spec.message !== undefined) applySeed(spec.message);
        if (spec.palette !== undefined) {
          const i = PALETTES.findIndex((q) => q.name === spec.palette);
          if (i >= 0) palIx = i;
        }
        if (spec.mode !== undefined) {
          const i = MODES.indexOf(spec.mode);
          if (i >= 0) modeIx = i;
        }
        if (spec.bands !== undefined) bands = Math.round(spec.bands);
        if (spec.zoom !== undefined) zoom = spec.zoom;
        if (spec.warp !== undefined) warp = spec.warp;
        if (spec.octaves !== undefined) octaves = Math.round(spec.octaves);
        if (spec.sea !== undefined) sea = spec.sea;
        if (spec.t !== undefined) t = spec.t;
        if (spec.stamp !== undefined) showStamp = !!spec.stamp;
        // A variant is a still, not a moment in a loop.
        frozen = true;
        document.getElementById('freeze').textContent = 'resume';
        buildLut();
        syncControls();
        return {
          t, mode: mode(), palette: pal().name, bands, zoom, warp, octaves, sea,
        };
      },
      t: () => t,
      frozen: () => frozen,
      mode: () => mode(),
      palette: () => pal().name,
      modes: () => MODES.slice(),
      palettes: () => PALETTES.map((q) => q.name),
      params: () => ({ bands, zoom, warp, octaves, sea }),
      // The shaped field the renderer bands, sampled on the canvas grid —
      // enough to assert that a ramp is actually being spanned.
      spread: () => {
        const G = sampleGrid(p, 1);
        let lo = 1, hi = 0;
        const used = new Set();
        for (const v of G.grid) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
          used.add(Math.min(bands - 1, Math.max(0, Math.floor(v * bands))));
        }
        return { lo, hi, bandsUsed: used.size };
      },
    };
  }
});
