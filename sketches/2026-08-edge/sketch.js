// edge — a comparison rig for edge-detection operators. Four kernels, one
// source, side by side, because the only way to have an opinion about Sobel
// vs Roberts vs Laplacian vs DoG is to watch them fail on the same input.
//
// The operators themselves live in shared/kernels.glsl and are not written
// here. That file is imported verbatim by this sketch, by the Hydra sketch
// next door, and pastes into a TouchDesigner GLSL TOP with only its header
// swapped — so what this page is really testing is a kernel that runs
// wherever you want to work.
//
// The source is always rendered to a texture before an operator touches it,
// even when it is procedural and could have been evaluated inline. Sampling a
// sampler2D is the contract every host shares; evaluating a function inline
// would be faster here and would not survive the move to TD.
import p5 from 'p5';
import KERNELS from '../../shared/kernels.glsl?raw';

const SIZE = 720;
const OPS = ['sobel', 'roberts', 'laplacian', 'dog'];
const SOURCES = ['card', 'webcam', 'td frame'];
const TD_FRAME = 'td-frame.png';   // drop a TouchDesigner export here

// p5's WEBGL quad hands the shader aPosition in 0..1; this is the standard
// remap to clip space that every p5 filter shader carries.
const VERT = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  vec4 pos = vec4(aPosition, 1.0);
  pos.xy = pos.xy * 2.0 - 1.0;
  gl_Position = pos;
}`;

// Source pass: nothing but the shared test card, written into a texture.
const CARD_FRAG = `
precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
${KERNELS}
void main() {
  // p5's aTexCoord is y-down and the card is laid out y-up; the flip belongs
  // here rather than in the shared file, which every other host agrees with.
  gl_FragColor = vec4(testCard(vec2(vTexCoord.x, 1.0 - vTexCoord.y), uTime), 1.0);
}`;

// Operator pass. One shader covers both layouts: in grid mode it works out
// which quadrant it is in and remaps uv, so all four operators run over the
// whole source rather than over a quarter of it each.
const EDGE_FRAG = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uSpread;
uniform float uThreshold;
uniform float uGain;
uniform float uRatio;
uniform int uOp;        // 0..3, or 4 for the 2x2 grid
uniform int uInvert;
uniform int uAngle;
uniform int uRaw;       // 1 = show the source instead, to see what it is judging
${KERNELS}

float runOp(int op, vec2 uv, vec2 texel) {
  if (op == 0) return sobel(uSrc, uv, texel);
  if (op == 1) return roberts(uSrc, uv, texel);
  if (op == 2) return laplacian(uSrc, uv, texel);
  return dog(uSrc, uv, texel, uRatio);
}

// Gradient direction as hue. Only Sobel carries a direction — the Laplacian
// is rotationally symmetric and has none — so this stays on the one operator
// that can honestly answer it.
vec3 hue(float h) {
  vec3 k = fract(vec3(h) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0));
  return clamp(abs(k * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}

void main() {
  vec2 uv = vTexCoord;
  int op = uOp;
  if (uOp == 4) {
    vec2 cell = floor(uv * 2.0);
    op = int(cell.x + (1.0 - cell.y) * 2.0);   // reading order, top-left first
    uv = fract(uv * 2.0);
  }

  if (uRaw == 1) {
    gl_FragColor = vec4(texture2D(uSrc, uv).rgb, 1.0);
    return;
  }

  vec2 texel = vec2(uSpread) / uRes;
  float e = clamp(runOp(op, uv, texel) * uGain, 0.0, 1.0);
  // A soft knee rather than step(): a hard threshold hides exactly the thing
  // the rig exists to show, which is how each operator rolls off.
  e = smoothstep(uThreshold, uThreshold + 0.06, e);

  vec3 col = vec3(e);
  if (uAngle == 1 && op == 0) {
    float a = sobelAngle(uSrc, uv, texel);
    col = hue(a / 6.2831853 + 0.5) * e;
  }
  if (uInvert == 1) col = 1.0 - col;
  gl_FragColor = vec4(col, 1.0);
}`;

new p5((p) => {
  let gfx, src;            // WEBGL buffers: operator output, and the source
  let cardShader, edgeShader;
  let cap = null;          // webcam, created only on request
  let tdFrame = null;      // bundled TouchDesigner export, if one is present
  let sourceIx = 0, requestIx = 0, opIx = 4;
  let spread = 1, threshold = 0.08, gain = 2, ratio = 1.6;
  let invert = false, angle = false, raw = false;
  let frozen = false, t = 0;
  let note = '';           // surfaced to the user when a source is unavailable

  const op = () => (opIx === 4 ? 'grid' : OPS[opIx]);
  const source = () => SOURCES[sourceIx];

  // Renders whatever the current source is into `target`, which is the only
  // thing an operator ever sees.
  function drawSource(target, shader) {
    if (sourceIx === 0) {
      target.shader(shader);
      shader.setUniform('uTime', t);
      target.rect(0, 0, target.width, target.height);
      return;
    }
    const tex = sourceIx === 1 ? cap : tdFrame;
    target.resetShader();
    target.background(20);
    if (!tex) return;
    // Cover-fit: an operator's response depends on scale, and letterboxing
    // would put hard black bars in frame for it to score as edges.
    const ar = (tex.width || 1) / (tex.height || 1);
    const w = ar >= 1 ? target.width * ar : target.width;
    const h = ar >= 1 ? target.height : target.height / ar;
    target.image(tex, -w / 2, -h / 2, w, h);
  }

  function runOperator(target, shader, texture, res, sp) {
    target.shader(shader);
    shader.setUniform('uSrc', texture);
    shader.setUniform('uRes', [res, res]);
    shader.setUniform('uSpread', sp);
    shader.setUniform('uThreshold', threshold);
    shader.setUniform('uGain', gain);
    shader.setUniform('uRatio', ratio);
    shader.setUniform('uOp', opIx);
    shader.setUniform('uInvert', invert ? 1 : 0);
    shader.setUniform('uAngle', angle ? 1 : 0);
    shader.setUniform('uRaw', raw ? 1 : 0);
    target.rect(0, 0, target.width, target.height);
  }

  // Labels and the stamp are drawn in 2D over the shader output, so they come
  // out crisp and land in the export. Doing this in WEBGL would mean bundling
  // a font for the sake of six words.
  function annotate(g, f) {
    g.push();
    g.textFont('monospace');
    g.noStroke();
    if (opIx === 4 && !raw) {
      g.textSize(12 * f);
      g.textAlign(g.LEFT, g.TOP);
      for (let i = 0; i < 4; i++) {
        const x = (i % 2) * (SIZE / 2) * f, y = Math.floor(i / 2) * (SIZE / 2) * f;
        const label = OPS[i] + (i === 3 ? ` ${ratio.toFixed(2)}` : '');
        g.fill(invert ? 255 : 0, invert ? 200 : 170);
        g.rect(x + 6 * f, y + 6 * f, g.textWidth(label) + 10 * f, 18 * f);
        g.fill(invert ? 20 : 240);
        g.text(label, x + 11 * f, y + 10 * f);
      }
      g.stroke(invert ? 0 : 255, 40);
      g.strokeWeight(1 * f);
      g.line(SIZE * f / 2, 0, SIZE * f / 2, SIZE * f);
      g.line(0, SIZE * f / 2, SIZE * f, SIZE * f / 2);
      g.noStroke();
    }
    // Same idea as message noise: the recipe is on the image, so a frame you
    // like can be found again.
    const stamp = `${source()} · ${op()} · sp${spread.toFixed(2)} th${threshold.toFixed(2)} ` +
      `g${gain.toFixed(1)}${opIx === 3 || opIx === 4 ? ` r${ratio.toFixed(2)}` : ''}${raw ? ' · raw' : ''}`;
    g.textSize(11 * f);
    g.textAlign(g.LEFT, g.BASELINE);
    const y = SIZE * f - 10 * f;
    g.fill(invert ? 255 : 0, 170);
    g.rect(7 * f, y - 12 * f, g.textWidth(stamp) + 6 * f, 16 * f);
    g.fill(invert ? 20 : 240);
    g.text(stamp, 10 * f, y);
    g.pop();
  }

  // `requestIx` is what the button has cycled to; `sourceIx` is what is
  // actually on screen. They come apart when a source cannot load, and keeping
  // them separate is what stops a dead source from trapping the cycle — with
  // one index, a machine without a camera could never reach the frame past it.
  async function setSource(i) {
    requestIx = i;
    note = '';
    if (i === 1 && !cap) {
      // Webcam is opt-in and never the default: `npm run thumbs` and the
      // behaviour tests run without a camera, and a permission prompt at load
      // would leave both capturing a black frame.
      if (!navigator.mediaDevices?.getUserMedia) {
        note = 'this browser exposes no camera api';
        syncControls();
        return;
      }
      // Ask what exists before asking for permission. A machine with no camera
      // can be answered immediately and truthfully; racing getUserMedia
      // against a timeout instead would give up on a real camera while its
      // permission prompt was still sitting there waiting to be clicked.
      let hasCam = false;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        hasCam = devices.some((d) => d.kind === 'videoinput');
      } catch { hasCam = false; }
      if (!hasCam) {
        note = 'no camera on this device';
        syncControls();
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        s.getTracks().forEach((tr) => tr.stop());
      } catch {
        note = 'camera refused';
        syncControls();
        return;
      }
      cap = p.createCapture(p.VIDEO);
      cap.size(SIZE, SIZE);
      cap.hide();
    }
    if (i === 2 && !tdFrame) {
      const ok = await new Promise((res) => {
        p.loadImage(TD_FRAME, (img) => { tdFrame = img; res(true); }, () => res(false));
      });
      if (!ok) {
        note = `no ${TD_FRAME} yet — export one from TouchDesigner into public/sketches/2026-08-edge/`;
        syncControls();
        return;
      }
    }
    sourceIx = i;
    syncControls();
  }

  const CONTROLS = [
    { id: 'spread', get: () => spread, set: (v) => { spread = v; }, fmt: (v) => v.toFixed(2) },
    { id: 'threshold', get: () => threshold, set: (v) => { threshold = v; }, fmt: (v) => v.toFixed(2) },
    { id: 'gain', get: () => gain, set: (v) => { gain = v; }, fmt: (v) => v.toFixed(1) },
    { id: 'ratio', get: () => ratio, set: (v) => { ratio = v; }, fmt: (v) => v.toFixed(2) },
  ];

  function syncControls() {
    for (const c of CONTROLS) {
      const el = document.getElementById(c.id);
      if (!el) continue;
      el.value = String(c.get());
      document.getElementById(`${c.id}-val`).textContent = c.fmt(c.get());
    }
    document.getElementById('op').textContent = `op ${op()}`;
    document.getElementById('source').textContent = `src ${source()}`;
    document.getElementById('invert').textContent = invert ? 'on black' : 'on white';
    document.getElementById('angle').textContent = angle ? 'angle on' : 'angle off';
    document.getElementById('raw').textContent = raw ? 'showing source' : 'show source';
    document.getElementById('freeze').textContent = frozen ? 'resume' : 'freeze';
    document.getElementById('note').textContent = note;
  }

  // p5 1.11's Graphics.remove() throws on its own bookkeeping — it reaches for
  // _elements on the buffer rather than the sketch. Same workaround as message
  // noise: unhook it, detach the canvas, let it be collected.
  function dispose(g) {
    const i = p._elements.indexOf(g);
    if (i !== -1) p._elements.splice(i, 1);
    if (g.elt) g.elt.remove();
  }

  p.setup = () => {
    p.createCanvas(SIZE, SIZE);            // 2D: the shader output is composited in
    p.pixelDensity(1);
    gfx = p.createGraphics(SIZE, SIZE, p.WEBGL);
    src = p.createGraphics(SIZE, SIZE, p.WEBGL);
    gfx.noStroke();
    src.noStroke();
    cardShader = src.createShader(VERT, CARD_FRAG);
    edgeShader = gfx.createShader(VERT, EDGE_FRAG);

    document.getElementById('op').onclick = () => { opIx = (opIx + 1) % 5; syncControls(); };
    document.getElementById('source').onclick = () => setSource((requestIx + 1) % SOURCES.length);
    document.getElementById('invert').onclick = () => { invert = !invert; syncControls(); };
    document.getElementById('angle').onclick = () => { angle = !angle; syncControls(); };
    document.getElementById('raw').onclick = () => { raw = !raw; syncControls(); };
    document.getElementById('freeze').onclick = () => { frozen = !frozen; syncControls(); };
    for (const c of CONTROLS) {
      const el = document.getElementById(c.id);
      el.addEventListener('input', () => {
        c.set(parseFloat(el.value));
        document.getElementById(`${c.id}-val`).textContent = c.fmt(c.get());
      });
    }

    document.getElementById('save').onclick = () => {
      // Genuinely rendered at 2x rather than upscaled: the source is redrawn
      // at the larger size and `spread` is doubled with it, which keeps texel
      // the same step in uv — so the operator sees the same neighbourhood and
      // the image is the same image, with twice the samples in it.
      const S = SIZE * 2;
      const s2 = p.createGraphics(S, S, p.WEBGL);
      const g2 = p.createGraphics(S, S, p.WEBGL);
      const out = p.createGraphics(S, S);
      s2.noStroke(); g2.noStroke();
      drawSource(s2, s2.createShader(VERT, CARD_FRAG));
      runOperator(g2, g2.createShader(VERT, EDGE_FRAG), s2, S, spread * 2);
      out.image(g2, 0, 0);
      annotate(out, 2);
      p.saveCanvas(out, `edge-${source().replace(/ /g, '-')}-${op()}`, 'png');
      dispose(s2); dispose(g2); dispose(out);
    };

    syncControls();
  };

  p.keyPressed = () => {
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
    if (p.key === ' ') { frozen = !frozen; syncControls(); return false; }
    if (p.key === 'o' || p.key === 'O') { opIx = (opIx + 1) % 5; syncControls(); return false; }
    if (p.key === 's' || p.key === 'S') { setSource((requestIx + 1) % SOURCES.length); return false; }
    if (p.key === 'i' || p.key === 'I') { invert = !invert; syncControls(); return false; }
    if (p.key === 'r' || p.key === 'R') { raw = !raw; syncControls(); return false; }
  };

  p.draw = () => {
    if (!frozen) t += 0.016;
    drawSource(src, cardShader);
    runOperator(gfx, edgeShader, src, SIZE, spread);
    p.image(gfx, 0, 0);
    annotate(p, 1);
  };

  // Read-only view of what the stamp already prints, for the behaviour tests.
  if (typeof window !== 'undefined') {
    window.__edge = {
      op: () => op(),
      ops: () => [...OPS, 'grid'],
      source: () => source(),
      requested: () => SOURCES[requestIx],
      sources: () => SOURCES.slice(),
      params: () => ({ spread, threshold, gain, ratio }),
      flags: () => ({ invert, angle, raw, frozen }),
      note: () => note,
      // Mean luminance of the operator output — how much of the frame the
      // operator called an edge. Lets a test assert that a kernel actually
      // fired, and that raising the threshold quiets it down.
      coverage: () => {
        gfx.loadPixels();
        let sum = 0;
        const px = gfx.pixels;
        for (let i = 0; i < px.length; i += 4) sum += px[i];
        return sum / (px.length / 4) / 255;
      },
    };
  }
});
