// message noise — a hidden message deterministically seeds a living
// top-down perlin noise map. Same message + same shown time t = same
// image, so a frozen frame can always be found again. The message is
// hashed client-side and never rendered, stored, or put in the URL.
import p5 from 'p5';

const SIZE = 720;
const CELL = 4;            // sampling resolution of the field
const Z_SPEED = 0.0035;    // how fast the terrain breathes
const LEVELS = 12;         // contour bands

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
    // Let the message shape the terrain's character, not just its layout.
    scale = 0.004 + (seed[2] % 1000) / 1000 * 0.008;
    warp = 0.5 + (seed[3] % 1000) / 1000 * 2.0;
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
    const w = g.width, h = g.height;
    const f = w / SIZE; // keep the world identical at export resolution
    g.noStroke();
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const v = field(x / f, y / f, t);
        if (contourMode) {
          // Quantize into bands; paint thin dark lines at band edges.
          const band = v * LEVELS;
          const edge = Math.abs(band - Math.round(band)) < 0.07;
          g.fill(edge ? 20 : 245);
        } else {
          const band = Math.floor(v * LEVELS) / LEVELS;
          // Deep water → shore → highland palette.
          const c1 = g.color(16, 28, 42);
          const c2 = g.color(127, 179, 163);
          const c3 = g.color(240, 234, 214);
          g.fill(band < 0.5 ? g.lerpColor(c1, c2, band * 2) : g.lerpColor(c2, c3, (band - 0.5) * 2));
        }
        g.rect(x, y, cell, cell);
      }
    }
    // Time stamp: with the same message, this t reproduces this exact frame.
    g.fill(contourMode ? 20 : 245);
    g.textFont('monospace');
    g.textSize(11 * f);
    g.text(`t=${t.toFixed(3)}`, 10 * f, h - 10 * f);
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
