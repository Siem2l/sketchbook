// message noise — a hidden message deterministically seeds a living
// top-down perlin noise map. Same message + same shown time t = same
// image, so a frozen frame can always be found again. The message is
// hashed client-side and never rendered, stored, or put in the URL.
import p5 from 'p5';

const SIZE = 720;
const CELL = 4;              // sampling resolution of the field (topo raster)
const Z_SPEED = 0.0035;      // how fast the terrain breathes
const LEVELS = 12;           // colour bands in topo mode
const CONTOUR_LEVELS = 22;   // iso-lines in contour mode (~21 nested lines)
const INDEX_EVERY = 4;       // every Nth line is a thick, labelled index contour

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
function drawLabel(g, x, y, seg, txt, f) {
  // Rotate to follow the contour, kept upright, with a white break in the
  // line behind it — exactly how surveyed contours are annotated.
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
  g.fill(250);
  g.rect(-wLbl / 2 - 2 * f, -6 * f, wLbl + 4 * f, 12 * f);
  g.fill(24);
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
  let seed = cyrb128('…');
  let t = 0;               // field time, advances only while unfrozen
  let frozen = false;
  let contourMode = false;
  let scale;               // noise zoom, derived from the message
  let warp;                // domain-warp strength, derived from the message

  function applySeed(message) {
    seed = cyrb128(message || '…');
    p.noiseSeed(seed[0]);
    p.randomSeed(seed[1]);
    // Few octaves + gentle falloff = big, smooth rolling terrain (surveyed
    // contour look) instead of high-frequency speckle.
    p.noiseDetail(2, 0.5);
    // Let the message shape the terrain's character, not just its layout.
    // Low frequency → a handful of large hill systems span the canvas; light
    // warp keeps the lines flowing rather than jittery.
    scale = 0.003 + (seed[2] % 1000) / 1000 * 0.003;
    warp = 0.2 + (seed[3] % 1000) / 1000 * 0.5;
    t = 0;
    frozen = false;
    document.getElementById('freeze').textContent = 'freeze';
  }

  function field(x, y, z) {
    // Domain-warped 3D noise: warp offsets sampled from a second octave
    // make the map read as organic terrain rather than smooth blobs.
    const wx = p.noise(x * scale * 2 + 40, y * scale * 2 + 40, z) * warp;
    const wy = p.noise(x * scale * 2 + 90, y * scale * 2 + 90, z) * warp;
    return p.noise(x * scale + wx, y * scale + wy, z);
  }

  function render(g, cell) {
    const f = g.width / SIZE; // keep the world identical at export resolution
    if (contourMode) drawContours(g, f);
    else drawTopo(g, cell, f);

    // Time stamp: with the same message, this t reproduces this exact frame.
    g.noStroke();
    g.fill(contourMode ? 24 : 245);
    g.textFont('monospace');
    g.textSize(11 * f);
    g.textAlign(g.LEFT, g.BASELINE);
    g.text(`t=${t.toFixed(3)}`, 10 * f, g.height - 10 * f);
  }

  // Filled colour relief — deep water → shore → highland.
  function drawTopo(g, cell, f) {
    const w = g.width, h = g.height;
    g.noStroke();
    const c1 = g.color(16, 28, 42);
    const c2 = g.color(127, 179, 163);
    const c3 = g.color(240, 234, 214);
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const band = Math.floor(field(x / f, y / f, t) * LEVELS) / LEVELS;
        g.fill(band < 0.5 ? g.lerpColor(c1, c2, band * 2) : g.lerpColor(c2, c3, (band - 0.5) * 2));
        g.rect(x, y, cell, cell);
      }
    }
  }

  // Clean nested iso-lines on white via marching squares, with a handful of
  // rotated elevation labels on the thicker index contours.
  function drawContours(g, f) {
    const w = g.width, h = g.height;
    const step = Math.max(3, Math.round(4 * f)); // finer grid → smoother curves
    const cols = Math.floor(w / step) + 2;
    const rows = Math.floor(h / step) + 2;

    // Sample the field once; every level reuses this grid.
    const grid = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        grid[j * cols + i] = field((i * step) / f, (j * step) / f, t);
      }
    }

    g.background(250);
    g.noFill();
    const placed = [];

    for (let l = 1; l < CONTOUR_LEVELS; l++) {
      const level = l / CONTOUR_LEVELS;
      const isIndex = l % INDEX_EVERY === 0;
      g.stroke(24);
      g.strokeWeight((isIndex ? 1.6 : 0.85) * f);
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

          if (isIndex && placed.length < 14) {
            sinceLabel++;
            if (sinceLabel > 50) {
              const seg = firstSeg(idx, T, R, B, L);
              const mx = (seg[0][0] + seg[1][0]) / 2;
              const my = (seg[0][1] + seg[1][1]) / 2;
              if (mx > 34 * f && mx < w - 34 * f && my > 24 * f && my < h - 24 * f &&
                  farFrom(placed, mx, my, 84 * f)) {
                const meters = (l / INDEX_EVERY) * 50;
                drawLabel(g, mx, my, seg, `${meters}m`, f);
                placed.push([mx, my]);
                sinceLabel = 0;
              }
            }
          }
        }
      }
    }
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
    document.getElementById('mode').onclick = (e) => {
      contourMode = !contourMode;
      e.target.textContent = contourMode ? 'topo' : 'contour';
    };
    document.getElementById('save').onclick = () => {
      // Re-render the exact current frame at 3x for print/tattoo reference.
      const g = p.createGraphics(SIZE * 3, SIZE * 3);
      render(g, CELL); // finer relative cell size at 3x = smoother detail
      p.saveCanvas(g, `message-noise-t${t.toFixed(3)}${contourMode ? '-contour' : ''}`, 'png');
      g.remove();
    };
  };

  function toggleFreeze() {
    frozen = !frozen;
    document.getElementById('freeze').textContent = frozen ? 'resume' : 'freeze';
  }

  p.keyPressed = () => {
    if (p.key === ' ') { toggleFreeze(); return false; }
  };

  p.draw = () => {
    if (!frozen) t += Z_SPEED;
    render(p, CELL);
  };
});
