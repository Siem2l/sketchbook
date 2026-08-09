// hendriklaan — 240 metres of Utrecht, surveyed from a plane, played by ear.
//
// The geometry is not invented. It is AHN5, the 2023–24 national LiDAR survey
// of the Netherlands, windowed to a 240 m square around Prins Hendriklaan 17
// and thinned to an even 0.7 m spacing: 201,635 real returns off real roofs,
// real trees and real asphalt. scripts/extract-hendriklaan.py cuts it, and the
// cut is cheap because the tile is a COPC — the octree index lives in the file
// header, so PDAL asks for a bounding box over HTTP range requests and never
// downloads the other 227 MB.
//
// What the audio does to it comes from the survey itself. AHN ships every
// return with a classification, and in this window the classes fall out as
// 62% unclassified (which here is almost entirely canopy and street furniture),
// 21% ground, 16% building. That is already a three-way split of the street, so
// it is used as one: ground answers the sub and low bands, canopy answers the
// mids, roofs and facades answer the highs. Put music through it and the block
// separates the spectrum for you — the road heaves on the kick, the trees
// churn through the pads, the roofs fizz on the hats.
//
// Two things had to be decided rather than assumed.
//
// The rest state is the truth. Displacement is a pure function of band energy
// with no integration anywhere, so silence puts every point back on its
// surveyed coordinate exactly, not approximately. A particle system with
// velocity would have drifted, and then the page would be showing you a smear
// of Utrecht rather than Utrecht. Freeze at any moment and what you are looking
// at is measurable.
//
// The noise is simplex, not classic Perlin. Perlin's gradients are fixed to a
// cubic lattice, and this dataset is a street grid — buildings whose walls run
// north–south and east–west for 240 m. Axis-aligned noise on axis-aligned
// geometry produces beating: whole facades pulse together because they sample
// the same lattice plane. Simplex has no preferred direction and the facades
// break up.
//
// The tune is editable and the survey is not. That asymmetry is the point.
// Every control on the page that touches the geometry — gain, point size,
// projection, colour — changes how the measurement is *drawn*; the beat editor
// changes what it is *answering to*, and nothing anywhere changes where a point
// is. Empty the grid and the block does not go still gradually, it goes still
// exactly, because with no band energy the displacement term is identically
// zero. That is the same claim this comment opens with, made clickable rather
// than argued. The pad needed a switch before it was true — see beat.js.
//
// One thing that turned out not to be worth doing: colouring by height above a
// fitted ground surface rather than by NAP. The ground under this window rises
// 1.08 m across 240 m against a 32 m vertical range, so a per-cell ground grid
// moves the ramp by 3% and costs a load-time pass. Utrecht is flat. NAP it is.

import { DEFAULT, clone, decode, encode, mountEditor, same, sequence } from './beat.js';

const DATA = '/data/hendriklaan.json';
const BIN = '/data/hendriklaan.bin';

const REVEAL_MS = 1100;    // under the 1500 ms the thumbnail grabber waits
const COLOURS = ['height', 'class', 'intensity', 'response'];
const SOURCES = ['field', 'tone', 'mic'];

// ---------------------------------------------------------------- mat4
// Four functions, column-major, no library. Nothing here needs inversion.
const perspective = (fovy, aspect, near, far) => {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
};

const ortho = (h, aspect, near, far) => {
  const w = h * aspect, nf = 1 / (near - far);
  return new Float32Array([
    1 / w, 0, 0, 0,
    0, 1 / h, 0, 0,
    0, 0, 2 * nf, 0,
    0, 0, (far + near) * nf, 1,
  ]);
};

const lookAt = (eye, at, up) => {
  const z = norm(sub(eye, at));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------- shaders
// Ashima's simplex noise, unmodified. It is here rather than in shared/
// because nothing else in the sketchbook wants a 3D gradient field yet; the
// day a second sketch does, this moves to shared/kernels.glsl.
const NOISE = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 nrm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= nrm.x; p1 *= nrm.y; p2 *= nrm.z; p3 *= nrm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}`;

const POINT_VS = `#version 300 es
precision highp float;

in vec3 aPos;        // uint16 per axis, normalised — 3.7 mm horizontally
in float aCls;       // raw AHN classification code
in float aInt;       // log-scaled return intensity, 0..1

uniform mat4 uView, uProj;
uniform vec3 uCorner, uExtent;
uniform vec4 uBands;      // sub, low, mid, high — each 0..1
uniform float uTime, uGain, uPointScale, uZTop, uOrtho;
uniform int uColour;

out vec3 vCol;
out float vFade;

${NOISE}

vec3 ramp(float t) {
  // deep indigo → teal → sand → white, the sketchbook's usual four stops
  vec3 a = vec3(0.09, 0.10, 0.19);
  vec3 b = vec3(0.20, 0.44, 0.47);
  vec3 c = vec3(0.85, 0.72, 0.42);
  vec3 d = vec3(1.00, 0.98, 0.94);
  t = clamp(t, 0.0, 1.0);
  if (t < 0.38) return mix(a, b, t / 0.38);
  if (t < 0.76) return mix(b, c, (t - 0.38) / 0.38);
  return mix(c, d, (t - 0.76) / 0.24);
}

void main() {
  int cls = int(aCls + 0.5);

  // Survey coordinates → scene metres, address at the origin, y up. Northing
  // is negated so the result is right-handed with north away from the camera
  // at the default heading.
  vec3 p = uCorner + vec3(aPos.x, aPos.z, aPos.y) * uExtent;
  vec3 home = p;

  // Which bands this point answers to, straight off the classification.
  vec4 bw;
  if (cls == 2 || cls == 9)      bw = vec4(1.00, 0.55, 0.05, 0.00);   // ground, water
  else if (cls == 6)             bw = vec4(0.00, 0.15, 0.30, 1.00);   // building
  else if (cls == 26)            bw = vec4(0.45, 0.25, 0.20, 0.50);   // civil structure
  else                           bw = vec4(0.05, 0.35, 1.00, 0.25);   // everything else: canopy
  // Gain closes the whole channel, not just the displacement. At zero the
  // colour lift and the size pulse go with it, so gain 0 is not "a still of the
  // animation" — it is the survey, drawn as measured, and you can put the two
  // side by side.
  float energy = clamp(dot(bw, uBands), 0.0, 1.4) * clamp(uGain, 0.0, 1.0);

  float hag = clamp(home.y / 14.0, 0.0, 1.0);   // roughly: how far off the deck

  // Ground: a wave leaving number 17 at about 18 m/s and dying with distance,
  // so the sub band reads as something crossing the street rather than as the
  // whole surface breathing in phase.
  float r = length(home.xz);
  float wave = sin(r * 0.17 - uTime * 3.1) * exp(-r * 0.011);
  vec3 disp = vec3(0.0, wave * uBands.x * bw.x * 2.6, 0.0);

  // Canopy: three decorrelated samples of the same field, advected upward, so
  // leaves swirl instead of sliding. Trunks barely move; crowns move a lot.
  vec3 q = home * 0.055 + vec3(0.0, uTime * 0.16, uTime * 0.05);
  vec3 turb = vec3(snoise(q), snoise(q + 37.13), snoise(q + 91.77));
  disp += turb * uBands.z * bw.z * (0.35 + 2.0 * hag) * 1.5;

  // Facades: high-frequency, small, and biased horizontally — roofs stay flat
  // and walls shimmer, which is what the high band sounds like.
  vec3 f = home * 0.9 + vec3(uTime * 1.7, 0.0, 0.0);
  vec3 fizz = vec3(snoise(f), snoise(f + 5.1) * 0.35, snoise(f + 12.7));
  disp += fizz * uBands.w * bw.w * 0.55;

  // Low band pushes everything outward from the address a little — the block
  // inhales. Applied last so it reads on top of the per-class motion.
  disp += normalize(vec3(home.x, 0.2, home.z) + 1e-4) * uBands.y * bw.y * 1.1;

  p += disp * uGain;

  vec4 eye = uView * vec4(p, 1.0);
  gl_Position = uProj * eye;

  float t = home.y / uZTop;
  vec3 col;
  if (uColour == 0) {
    col = ramp(t);
  } else if (uColour == 1) {
    if (cls == 2)       col = vec3(0.33, 0.36, 0.41);
    else if (cls == 6)  col = vec3(0.88, 0.64, 0.09);
    else if (cls == 9)  col = vec3(0.29, 0.50, 0.70);
    else if (cls == 26) col = vec3(0.77, 0.42, 0.29);
    else                col = vec3(0.50, 0.70, 0.64);
    col *= 0.55 + 0.75 * t;
  } else if (uColour == 2) {
    col = ramp(pow(aInt, 0.7));
  } else {
    // response: paint the mapping itself, so the page can explain its own rule.
    // This mode already carries the energy in its brightness, so it opts out of
    // the global lift below — applying both clipped the canopy to white.
    col = vec3(0.06) + bw.x * vec3(0.72, 0.24, 0.20)
                     + bw.z * vec3(0.20, 0.56, 0.32)
                     + bw.w * vec3(0.72, 0.60, 0.18);
    col *= 0.30 + 0.75 * energy;
  }
  vCol = uColour == 3 ? col : col * (0.72 + 0.85 * energy);
  vFade = energy;

  float d = max(-eye.z, 1.0);
  float size = uPointScale * mix(340.0 / d, 3.4, uOrtho) * (1.0 + 1.3 * energy);
  gl_PointSize = clamp(size, 1.0, 22.0);
}`;

const POINT_FS = `#version 300 es
precision highp float;
in vec3 vCol;
in float vFade;
out vec4 frag;
void main() {
  // Round dots with a soft rim. Discarding rather than blending the edge keeps
  // depth writes honest, so near roofs actually occlude far ones.
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float edge = 1.0 - smoothstep(0.13, 0.25, r2);
  frag = vec4(vCol * (0.65 + 0.35 * edge), 1.0);
}`;

const LINE_VS = `#version 300 es
precision highp float;
in vec3 aPos;
in vec3 aCol;
uniform mat4 uView, uProj;
out vec3 vCol;
void main() { vCol = aCol; gl_Position = uProj * uView * vec4(aPos, 1.0); }`;

const LINE_FS = `#version 300 es
precision highp float;
in vec3 vCol;
out vec4 frag;
void main() { frag = vec4(vCol, 1.0); }`;

// ---------------------------------------------------------------- gl helpers
function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

const uniforms = (gl, p, names) =>
  Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));

// ---------------------------------------------------------------- audio
// One sequencer drives all three sources. In `field` it drives the band values
// directly with no AudioContext at all, which is what makes the page move on
// load with no gesture and no permission — the thumbnail grabber and the tests
// both depend on that. In `tone` the same envelopes drive real oscillators and
// the bands come back out of an FFT of the result, so the two modes look
// identical and only one of them is audible. `mic` swaps the FFT's input.
//
// The sequencer itself now lives in beat.js, because the pattern it plays is
// editable and a mask is a thing you can hand a click. What is left here is
// the part that could never be pure: the oscillators, the FFT, and the
// automatic gain that makes a room mic and a synth bank comparable.
const TONE_LEVEL = 0.28;   // bus level for the built-in pattern

class Listener {
  constructor(pattern) {
    this.pattern = pattern;   // live reference — the editor mutates it in place
    this.mode = 'field';
    this.bands = new Float32Array(4);
    this.ctx = null;
    this.analyser = null;
    this.bins = null;
    this.nodes = null;
    this.stream = null;
    this.error = '';
    this.peak = new Float32Array([0.2, 0.2, 0.2, 0.2]);
    this.floor = new Float32Array([0.2, 0.2, 0.2, 0.2]);
  }

  // Per-band automatic gain. FFT magnitudes are absolute, and the three
  // sources are nowhere near each other in level: a room mic at conversation
  // volume sits near the floor of the byte range while the built-in bank sits
  // near the ceiling. A fixed gain and gamma had the synth pinning every band
  // above 0.79 — the street stayed at full displacement and stopped answering
  // the music at all. Each band instead carries a peak and a floor that chase
  // the signal fast and fall back slowly, so what drives the geometry is where
  // this band is inside its own recent range: structure, not level.
  agc(raw) {
    const out = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      this.peak[i] = Math.max(raw[i], this.peak[i] * 0.998);
      this.floor[i] = Math.min(raw[i], this.floor[i] * 0.998 + 0.002);
      const span = Math.max(0.04, this.peak[i] - this.floor[i]);
      out[i] = clamp((raw[i] - this.floor[i]) / span, 0, 1);
    }
    return out;
  }

  // Attack fast, release slow — the eye wants the hit and then the decay, and
  // a symmetric filter turns every transient into mush.
  smooth(target) {
    for (let i = 0; i < 4; i++) {
      const k = target[i] > this.bands[i] ? 0.55 : 0.09;
      this.bands[i] += (target[i] - this.bands[i]) * k;
    }
  }

  update(t, beats) {
    if (this.mode === 'field' || !this.analyser) {
      const s = sequence(t, beats, this.pattern);
      this.smooth([
        clamp(s.kick * 1.05, 0, 1),
        clamp(s.bass * 1.0, 0, 1),
        clamp(s.pad, 0, 1),
        clamp(s.hat * 0.9, 0, 1),
      ]);
      return;
    }
    if (this.mode === 'tone' && this.nodes) this.drive(t, beats);

    this.analyser.getByteFrequencyData(this.bins);
    const hz = this.ctx.sampleRate / this.analyser.fftSize;
    const band = (lo, hi) => {
      const a = Math.max(1, Math.floor(lo / hz));
      const b = Math.min(this.bins.length - 1, Math.ceil(hi / hz));
      let sum = 0;
      for (let i = a; i <= b; i++) sum += this.bins[i];
      return sum / (b - a + 1) / 255;
    };
    this.smooth(this.agc([band(20, 120), band(120, 500), band(500, 2200), band(2200, 9000)]));
  }

  ensureCtx() {
    if (this.ctx) return this.ctx;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.55;
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    return this.ctx;
  }

  buildTone() {
    const ctx = this.ensureCtx();
    const out = ctx.createGain();
    out.gain.value = TONE_LEVEL;
    out.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    const osc = (type, freq, to) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = 0;
      o.connect(g); g.connect(to); o.start();
      return { o, g };
    };

    // Each voice is written into the band it is supposed to drive, because the
    // FFT does not care what the parts are called. The first pass put the bass
    // fundamental at 55 Hz, which parked it in the sub band on top of the kick
    // and pinned the ground to maximum for the whole loop. 110 Hz was no better
    // — the sub band runs to 120. At E3 it lands in 120–500 where it belongs
    // and the sub band is the kick alone, which is what makes the road heave
    // on the beat instead of just staying up.
    const kick = osc('sine', 55, out);

    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'lowpass'; bassFilter.frequency.value = 420;
    bassFilter.connect(out);
    const bass = osc('sawtooth', 164.8, bassFilter);

    // The pad's cutoff is swept by the same envelope as its level. Level alone
    // moved the mid band by 0.03 out of 1 — a saw's harmonics above 500 Hz are
    // there whether it is loud or quiet — and the canopy barely stirred. The
    // filter is what the mid band can actually see.
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass'; padFilter.frequency.value = 900;
    padFilter.Q.value = 3;
    padFilter.connect(out);
    const padA = osc('sawtooth', 246.9, padFilter);
    const padB = osc('sawtooth', 370.0, padFilter);

    // Hats: two seconds of white noise on a loop through a highpass. Cheaper
    // and steadier than a per-hit buffer, and the FFT cannot tell.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 5200;
    const hatGain = ctx.createGain();
    hatGain.gain.value = 0;
    noise.connect(hp); hp.connect(hatGain); hatGain.connect(out);
    noise.start();

    this.nodes = { kick, bass, padA, padB, hatGain, padFilter, out };
  }

  drive(t, beats) {
    const s = sequence(t, beats, this.pattern);
    const n = this.nodes;
    const now = this.ctx.currentTime;
    const set = (p, v) => p.setTargetAtTime(v, now, 0.02);
    set(n.kick.g.gain, s.kick * 0.75);
    set(n.kick.o.frequency, 40 + s.kick * 78);      // the pitch drop that makes it a kick
    set(n.bass.g.gain, s.bass * 0.26);
    set(n.bass.o.frequency, s.note);
    set(n.padA.g.gain, s.pad * 0.055);
    set(n.padB.g.gain, s.pad * 0.045);
    set(n.padFilter.frequency, 480 + s.pad * 2600);
    set(n.hatGain.gain, s.hat * 0.10);
  }

  async setMode(mode) {
    this.error = '';
    if (mode === this.mode) return;
    if (this.stream && mode !== 'mic') {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      if (this.micNode) { this.micNode.disconnect(); this.micNode = null; }
    }
    if (mode === 'tone') {
      this.ensureCtx();
      if (!this.nodes) this.buildTone();
      if (this.nodes) this.nodes.out.gain.value = TONE_LEVEL;
      await this.ctx.resume();
    } else if (this.nodes) {
      this.nodes.out.gain.value = 0;
    }
    if (mode === 'mic') {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        this.ensureCtx();
        this.micNode = this.ctx.createMediaStreamSource(this.stream);
        this.micNode.connect(this.analyser);
        // Deliberately not connected to destination: monitoring a room mic
        // through the room's own speakers is a feedback loop.
        await this.ctx.resume();
      } catch (e) {
        this.error = 'no microphone — staying on the built-in field';
        this.mode = 'field';
        return;
      }
    }
    this.mode = mode;
  }
}

// ---------------------------------------------------------------- main
const $ = (id) => document.getElementById(id);
const note = (msg) => { $('note').textContent = msg || ''; };

async function main() {
  const canvas = document.createElement('canvas');
  document.body.insertBefore(canvas, document.body.firstChild);

  const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: false });
  if (!gl) {
    $('veil').textContent = 'this sketch needs WebGL2';
    return;
  }

  const [header, buf] = await Promise.all([
    fetch(DATA).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
    fetch(BIN).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }),
  ]).catch((e) => {
    $('veil').textContent = 'could not read the point cloud: ' + e.message;
    return [];
  });
  if (!header) return;

  const count = header.count;
  const [minx, miny, minz, maxx, maxy, maxz] = header.bounds;
  const [cx, cy] = header.centre;
  // Ground under this block sits at NAP +1.9 m; putting the scene origin there
  // means y is metres above the street, which is what every readout wants.
  const ZREF = 1.9;
  const corner = [minx - cx, minz - ZREF, -(miny - cy)];
  const extent = [maxx - minx, maxz - minz, -(maxy - miny)];
  // Ramp reference. The tallest return in the window is 32 m — a mast on the
  // Waterlinieweg side — while the roof ridges and the plane trees top out
  // around 18. Dividing by the maximum put the entire street in the bottom
  // third of the ramp and rendered Utrecht as one shade of teal, so the ramp
  // tops out at the 99th percentile instead and the last percent clamps.
  const u16 = new Uint16Array(buf);
  const hist = new Uint32Array(65536);
  for (let i = 0; i < count; i++) hist[u16[i * 4 + 2]]++;
  let acc = 0, q = 0;
  for (; q < 65535 && acc < count * 0.99; q++) acc += hist[q];
  const zTop = minz + q * header.scale[2] - ZREF;

  $('m-count').textContent = count.toLocaleString('en-US');
  $('m-tile').textContent = header.tile.replace('AHN5_C_', '');
  $('m-addr').textContent = header.address;
  $('m-win').textContent = `${Math.round(maxx - minx)} m`;

  // One interleaved buffer, 8 bytes a point, uploaded once and never touched
  // again. Every frame after this is uniforms only.
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);

  const pointProg = program(gl, POINT_VS, POINT_FS);
  const pu = uniforms(gl, pointProg, ['uView', 'uProj', 'uCorner', 'uExtent', 'uBands',
    'uTime', 'uGain', 'uPointScale', 'uZTop', 'uOrtho', 'uColour']);

  const pointVao = gl.createVertexArray();
  gl.bindVertexArray(pointVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  const aPos = gl.getAttribLocation(pointProg, 'aPos');
  const aCls = gl.getAttribLocation(pointProg, 'aCls');
  const aInt = gl.getAttribLocation(pointProg, 'aInt');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.UNSIGNED_SHORT, true, 8, 0);
  gl.enableVertexAttribArray(aCls);
  gl.vertexAttribPointer(aCls, 1, gl.UNSIGNED_BYTE, false, 8, 6);
  gl.enableVertexAttribArray(aInt);
  gl.vertexAttribPointer(aInt, 1, gl.UNSIGNED_BYTE, true, 8, 7);
  gl.bindVertexArray(null);

  // Marker and frame: a mast at number 17 and the outline of the window that
  // was cut, so the scale of what you are looking at is never a guess.
  const lines = [];
  const push = (x1, y1, z1, x2, y2, z2, c) => lines.push(x1, y1, z1, ...c, x2, y2, z2, ...c);
  const amber = [0.88, 0.64, 0.09], dim = [0.20, 0.20, 0.24];
  const hx = (maxx - minx) / 2, hz = (maxy - miny) / 2;
  const gy = -0.6;   // just under the road surface, so it does not z-fight
  push(-hx, gy, -hz, hx, gy, -hz, dim);
  push(hx, gy, -hz, hx, gy, hz, dim);
  push(hx, gy, hz, -hx, gy, hz, dim);
  push(-hx, gy, hz, -hx, gy, -hz, dim);
  push(0, gy, 0, 0, 26, 0, amber);
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2, b = ((i + 1) / 32) * Math.PI * 2;
    push(Math.cos(a) * 4, gy, Math.sin(a) * 4,
         Math.cos(b) * 4, gy, Math.sin(b) * 4, amber);
  }
  const lineProg = program(gl, LINE_VS, LINE_FS);
  const lu = uniforms(gl, lineProg, ['uView', 'uProj']);
  const lineVao = gl.createVertexArray();
  gl.bindVertexArray(lineVao);
  const lbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, lbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STATIC_DRAW);
  const lPos = gl.getAttribLocation(lineProg, 'aPos');
  const lCol = gl.getAttribLocation(lineProg, 'aCol');
  gl.enableVertexAttribArray(lPos);
  gl.vertexAttribPointer(lPos, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(lCol);
  gl.vertexAttribPointer(lCol, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null);
  const lineVerts = lines.length / 6;   // six floats a vertex, not a segment

  // ------------------------------------------------------------ state
  const cam = { yaw: 0.72, pitch: 0.40, dist: 240, target: [0, 11, 0] };
  const view = {
    colour: 0, ortho: false, spin: true, frozen: false,
    gain: 1, pointScale: 1.2, start: performance.now(),
    clock: 0, beats: 0, revealed: 0,
  };
  // One object, mutated in place. The editor writes into it and the Listener
  // reads it on the next frame; there is no copy to keep in step.
  //
  // A hash is only read here, at load. Anything malformed is refused whole —
  // half-reading it would hand someone a tune that is neither the one they
  // were sent nor the built-in one, with nothing on screen to say which.
  const fromLink = location.hash ? decode(location.hash) : null;
  const badLink = Boolean(location.hash) && !fromLink;
  const pattern = fromLink || clone(DEFAULT);
  const audio = new Listener(pattern);

  // ------------------------------------------------------------ input
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    view.spin = false;
    syncButtons();
    canvas.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cam.yaw -= (e.clientX - drag.x) * 0.006;
    cam.pitch = clamp(cam.pitch + (e.clientY - drag.y) * 0.005, -0.12, 1.45);
    drag = { x: e.clientX, y: e.clientY };
  });
  const endDrag = () => { drag = null; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.0011), 22, 520);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'a') cycleAudio();
    else if (k === 'b') editor.toggle();
    else if (k === 'c') setColour((view.colour + 1) % COLOURS.length);
    else if (k === 'o') setOrtho(!view.ortho);
    else if (k === ' ') { e.preventDefault(); setFrozen(!view.frozen); }
    else if (k === 's') savePNG();
    else if (k === 'h') document.querySelectorAll('#ui, #meta, #hint').forEach((n) => {
      n.style.display = n.style.display === 'none' ? '' : 'none';
    });
    else if (k === 'r') { view.spin = true; syncButtons(); }
  });

  // ------------------------------------------------------------ ui
  const setColour = (i) => { view.colour = i; $('colour').textContent = 'colour: ' + COLOURS[i]; };
  const setOrtho = (v) => { view.ortho = v; $('ortho').textContent = v ? 'ortho' : 'persp'; syncButtons(); };
  const setFrozen = (v) => { view.frozen = v; syncButtons(); };

  function syncButtons() {
    $('spin').classList.toggle('on', view.spin);
    $('freeze').classList.toggle('on', view.frozen);
    $('ortho').classList.toggle('on', view.ortho);
    $('audio').classList.toggle('on', audio.mode !== 'field');
  }

  async function cycleAudioTo(next) {
    note(next === 'mic' ? 'asking for the microphone…' : '');
    await audio.setMode(next);
    $('audio').textContent = 'listen: ' + audio.mode;
    note(audio.error || (audio.mode === 'tone' ? 'the built-in pattern, now audible' :
      audio.mode === 'mic' ? 'listening to the room' : ''));
    syncButtons();
  }

  const cycleAudio = () =>
    cycleAudioTo(SOURCES[(SOURCES.indexOf(audio.mode) + 1) % SOURCES.length]);

  $('audio').onclick = cycleAudio;
  $('colour').onclick = () => setColour((view.colour + 1) % COLOURS.length);
  $('ortho').onclick = () => setOrtho(!view.ortho);
  $('freeze').onclick = () => setFrozen(!view.frozen);
  $('spin').onclick = () => { view.spin = !view.spin; syncButtons(); };
  $('save').onclick = savePNG;
  $('gain').oninput = (e) => { view.gain = +e.target.value; $('gain-v').textContent = view.gain.toFixed(2); };
  $('size').oninput = (e) => { view.pointScale = +e.target.value; $('size-v').textContent = view.pointScale.toFixed(1); };
  syncButtons();

  // replaceState rather than pushState: an edit is not a navigation, and a
  // drag across a lane would otherwise bury the back button under sixteen
  // entries. Stripped entirely when the pattern is the built-in one, so the
  // canonical URL stays clean and the thumbnail grabber never sees a hash.
  let hashTimer = 0;
  const writeHash = () => {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const h = same(pattern, DEFAULT) ? '' : '#' + encode(pattern);
      history.replaceState(null, '', location.pathname + location.search + h);
    }, 250);
  };

  const editor = mountEditor($('beat'), {
    pattern,
    onChange: writeHash,
    // Opening the panel is a gesture, so it is allowed to start the audio.
    // Editing a beat you cannot hear is a worse default than a page that
    // starts making noise when you ask it for a beat editor.
    onOpen: () => { if (audio.mode === 'field') cycleAudioTo('tone'); },
  });
  $('beat-open').onclick = () => editor.toggle();
  $('beat-close').onclick = () => editor.close();
  $('beat-clear').onclick = () => {
    // The pad goes with the lanes. Leaving it droning would make "clear" mean
    // "clear the rhythm", and the street would keep moving with an empty grid.
    pattern.kick = pattern.bass = pattern.hat = pattern.pad = 0;
    editor.repaint();
    writeHash();
  };
  $('beat-reset').onclick = () => {
    Object.assign(pattern, clone(DEFAULT));
    editor.repaint();
    writeHash();
  };
  $('beat-link').onclick = async () => {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      note('link copied');
    } catch {
      // Clipboard access is origin- and permission-gated, and a control that
      // silently does nothing is worse than one that hands you the text.
      note(url);
    }
  };

  // ------------------------------------------------------------ draw
  function matrices(w, h) {
    const eye = [
      cam.target[0] + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist,
      cam.target[1] + Math.sin(cam.pitch) * cam.dist,
      cam.target[2] + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist,
    ];
    const aspect = w / h;
    const proj = view.ortho
      ? ortho(cam.dist * 0.42, aspect, 1, 1400)
      : perspective(0.86, aspect, 0.6, 1400);
    return { view: lookAt(eye, cam.target, [0, 1, 0]), proj };
  }

  function render(w, h, drawn) {
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.055, 0.055, 0.067, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    const m = matrices(w, h);

    gl.useProgram(lineProg);
    gl.uniformMatrix4fv(lu.uView, false, m.view);
    gl.uniformMatrix4fv(lu.uProj, false, m.proj);
    gl.bindVertexArray(lineVao);
    gl.drawArrays(gl.LINES, 0, lineVerts);

    gl.useProgram(pointProg);
    gl.uniformMatrix4fv(pu.uView, false, m.view);
    gl.uniformMatrix4fv(pu.uProj, false, m.proj);
    gl.uniform3fv(pu.uCorner, corner);
    gl.uniform3fv(pu.uExtent, extent);
    gl.uniform4fv(pu.uBands, audio.bands);
    gl.uniform1f(pu.uTime, view.clock);
    gl.uniform1f(pu.uGain, view.gain);
    gl.uniform1f(pu.uPointScale, view.pointScale * (w / 1200));
    gl.uniform1f(pu.uZTop, zTop);
    gl.uniform1f(pu.uOrtho, view.ortho ? 1 : 0);
    gl.uniform1i(pu.uColour, view.colour);
    gl.bindVertexArray(pointVao);
    gl.drawArrays(gl.POINTS, 0, drawn);
    gl.bindVertexArray(null);
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!view.frozen) {
      view.clock += dt;
      // Tempo-relative, accumulated rather than derived. Deriving beats from
      // the clock would mean a tempo change rescales all elapsed history at
      // once, and the playhead jumps mid-bar.
      view.beats += dt * pattern.bpm / 60;
      // Freeze holds the band values too. Letting the smoother keep converging
      // on a stopped clock meant a frozen frame kept drifting for a second
      // afterwards, which is not what freeze promises.
      audio.update(view.clock, view.beats);
    }
    if (view.spin && !view.frozen) cam.yaw += dt * 0.055;
    for (let i = 0; i < 4; i++) $('b' + i).style.width = (audio.bands[i] * 100).toFixed(0) + '%';
    editor.draw(view.beats, audio.bands[2], audio.mode === 'mic');

    // Reveal: the file is shuffled, so the first N points are an even sparse
    // survey of the whole block rather than one corner of it, and the street
    // arrives everywhere at once.
    view.revealed = clamp((now - view.start) / REVEAL_MS, 0, 1);
    if (view.revealed >= 1) $('veil').classList.add('gone');

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

    render(w, h, Math.floor(count * (view.revealed ** 0.7)));
    requestAnimationFrame(frame);
  }

  function savePNG() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(window.innerWidth * 3), h = Math.round(window.innerHeight * 3);
    canvas.width = w; canvas.height = h;
    render(w, h, Math.floor(count * (view.revealed ** 0.7)));
    // Read it back in the same tick: without preserveDrawingBuffer the
    // composite is discarded the moment the frame yields.
    const url = canvas.toDataURL('image/png');
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hendriklaan-${COLOURS[view.colour]}-${Date.now()}.png`;
    a.click();
    note('saved at ×3');
  }

  if (fromLink) editor.open();
  if (badLink) note('unreadable pattern in that link — showing the built-in one');

  requestAnimationFrame(frame);

  const drawnNow = () => Math.floor(count * (view.revealed ** 0.7));

  // Test/debug surface. Mirrors what the other sketches expose.
  window.__hendriklaan = {
    count,
    header,
    bands: () => Array.from(audio.bands),
    // Fraction of a centred crop that is not background. A shader that failed
    // to link still leaves a canvas; it just leaves a black one, so coverage is
    // the only assertion that catches it.
    coverage: () => {
      render(canvas.width, canvas.height, drawnNow());
      const s = Math.min(600, canvas.width, canvas.height);
      const px = new Uint8Array(s * s * 4);
      gl.readPixels((canvas.width - s) >> 1, (canvas.height - s) >> 1, s, s,
        gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lit = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 60) lit++;
      return lit / (s * s);
    },
    state: () => ({ ...view, colour: COLOURS[view.colour], audio: audio.mode }),
    camera: () => ({ ...cam }),
    pattern: () => clone(pattern),
    setPattern: (partial) => {
      Object.assign(pattern, partial);
      if (partial.notes) pattern.notes = [...partial.notes];
      editor.repaint();
      writeHash();
    },
    resetPattern: () => {
      Object.assign(pattern, clone(DEFAULT));
      editor.repaint();
      writeHash();
    },
    editorOpen: () => editor.isOpen(),
    toggleEditor: () => editor.toggle(),
    setAudio: (mode) => cycleAudioTo(mode),
    setColour, setOrtho, setFrozen,
    audioMode: () => audio.mode,
  };
}

main();
