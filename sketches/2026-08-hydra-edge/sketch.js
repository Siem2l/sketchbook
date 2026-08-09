// hydra edge — the same four operators as the rig next door, wired into a
// Hydra synth so they can be composed with everything else Hydra does:
// feedback, modulation, oscillators, live re-evaluation.
//
// The point of the pairing is that shared/kernels.glsl is imported here
// verbatim. Nothing is reimplemented for Hydra. If an operator is wrong it is
// wrong in both places, and if it is fixed it is fixed in both — which is the
// only version of "portable kernel" that actually holds up.
//
// Two things about Hydra had to be worked out to make that possible.
//
// First, each operator is registered as a 'src' taking a sampler2D. A 'color'
// function only ever receives the single vec4 that came before it, which is
// not enough to look at a pixel's neighbours — so neighbourhood operators
// cannot be colour transforms in Hydra at all, they have to be sources that
// are handed a texture.
//
// Second, setFunction is not where shared helpers can live. It wraps whatever
// glsl you give it in `returnType name(args) { ... }`, and GLSL forbids
// nested function definitions, so pasting the kernel file into an operator's
// body is a syntax error at the first `float luma(vec3 c) {`. See below for
// where they go instead.
import KERNELS from '../../shared/kernels.glsl?raw';

// hydra-synth reaches for Node's `global` through raf-loop -> right-now while
// its module body is still evaluating, and in a browser bundle that is a
// ReferenceError before a single line of this sketch runs. The shim has to
// land before the import, and a static import would be hoisted above it, so
// this one is dynamic — see boot(), where it is awaited inside an async
// function rather than at the top level. Top level would read better and does
// work in dev, but vite builds to es2020, where top-level await does not
// exist; the failure only appears at build time.
//
// Kept local rather than a vite `define: {global: 'globalThis'}`, which would
// rewrite that identifier across every sketch in the repo to fix one of them.
let Hydra = null;

const SIZE = 720;

// Hydra emits each registered transform's glsl verbatim at the top level of
// the fragment shader, and only wraps it in a function signature if it went
// through setFunction. `_addMethod` is the step underneath that, taking a
// transform whose glsl is already complete — so passing a string that holds
// the shared kernels *and* the operator gets both out at top level, where
// GLSL will accept them.
//
// The include guard is what makes it safe to attach the kernels to every
// operator: the preprocessor runs over the concatenated source in order, so
// whichever operator a patch happens to use first defines them and the rest
// skip. That in turn means the kernels are always declared before any use of
// them, whatever order Hydra walks the chain in.
//
// The tidier-looking route — mutating hydra's utility-function map, which is
// emitted before all transforms — does not survive the bundler. Vite
// pre-bundles hydra-synth into .vite/deps, so a sketch importing that module
// by path gets a different object from the one hydra's shader builder reads,
// and the injection silently lands nowhere. Excluding hydra from
// pre-bundling fixes the identity and breaks its CJS deps instead: hydra does
// `import Meyda from 'meyda'` and meyda is a UMD bundle with no default
// export to give. This way needs no bundler configuration at all.
const GUARD = 'SKETCHBOOK_KERNELS';

function wrap(name, inputs, body) {
  const args = [{ type: 'vec2', name: '_st' }, ...inputs]
    .map((i) => `${i.type} ${i.name}`).join(', ');
  return `
#ifndef ${GUARD}
#define ${GUARD}
${KERNELS}
#endif
vec4 ${name}(${args}) {
  ${body}
}`;
}

// Registers a Hydra source the same way setFunction would, minus the wrapping
// it does — which is the whole point, since that wrapping is what makes
// top-level function definitions impossible.
function addSrc(generator, name, inputs, body) {
  generator._addMethod(name, { name, type: 'src', inputs, glsl: wrap(name, inputs, body) });
}

const OPS = [
  { name: 'sobelEdge', call: 'sobel(tex, _st, texel)' },
  { name: 'robertsEdge', call: 'roberts(tex, _st, texel)' },
  { name: 'laplacianEdge', call: 'laplacian(tex, _st, texel)' },
  { name: 'dogEdge', call: 'dog(tex, _st, texel, ratio)' },
];

// Every operator's `res` input already defaults to the canvas size, so the
// presets leave it off; pass it only to lie to a kernel about its own
// resolution, which is a legitimate thing to want.
const PRESETS = [
  {
    name: 'card',
    // The shared test card, so this page and the rig agree on what a source is.
    code: `card().out(o1)\nsobelEdge(o1, 1, 2).out(o0)`,
  },
  {
    name: 'osc',
    code: `osc(24, 0.05, 0.9).kaleid(5).rotate(0, 0.08).out(o1)\nsobelEdge(o1, 1, 2.4).out(o0)`,
  },
  {
    name: 'feedback',
    // Edges fed back into the source is where this stops being a filter and
    // starts being a synth: each pass finds the edges of the last pass's
    // edges, and the picture keeps eating itself.
    code: `osc(8, 0.02, 1.2).modulate(o0, 0.3).out(o1)\nlaplacianEdge(o1, 1.4, 6).blend(o0, 0.55).out(o0)`,
  },
  {
    name: 'disagree',
    // The comparison from the rig next door, but composed rather than laid out
    // in quadrants: subtract the two operators and only what they disagree
    // about survives. Hard edges cancel to black because both find them; the
    // noise patch and the soft middle edge stay bright because Sobel answers
    // them and the Laplacian does not. Rendering them side by side buries
    // that — both draw white lines, so both halves look alike.
    code: `card().out(o1)
sobelEdge(o1, 1, 2).diff(laplacianEdge(o1, 1, 6)).out(o0)`,
  },
];

const state = { presetIx: 0, running: false, error: '' };
let hydra = null;

function registerKernels(h) {
  const g = h.generator;

  // The card as a Hydra source, so a patch can start from it like any osc().
  // Named `card`, not `testCard`: the kernel file already has a testCard that
  // returns vec3, and a Hydra function of the same name would shadow it and
  // then call itself — which reads as "constructor: too many arguments", not
  // as a name clash.
  // `speed`, not `time`, for the same class of reason: Hydra declares a
  // `uniform float time`, and an input of that name shadows it inside the
  // body, leaving no way to reach the clock the rest of the patch runs on.
  // Flipped in y for the same reason the p5 host flips: the card is stored in
  // one canonical orientation and both of these hosts happen to put it on
  // screen upside down. Without this the two sketches mirror each other and
  // the comparison stops being one.
  addSrc(g, 'card', [{ type: 'float', name: 'speed', default: 1 }],
    'return vec4(testCard(vec2(_st.x, 1.0 - _st.y), time * speed), 1.0);');

  for (const op of OPS) {
    addSrc(g, op.name, [
      // A sampler2D input is what makes neighbourhood sampling possible; this
      // is the one Hydra input type that hands over a whole texture.
      { type: 'sampler2D', name: 'tex' },
      { type: 'float', name: 'spread', default: 1 },
      { type: 'float', name: 'gain', default: 2 },
      { type: 'float', name: 'res', default: SIZE },
      { type: 'float', name: 'ratio', default: 1.6 },
    ], `
      vec2 texel = vec2(spread) / vec2(res);
      float e = clamp(${op.call} * gain, 0.0, 1.0);
      return vec4(vec3(e), 1.0);`);
  }
}

function run(code) {
  state.error = '';
  try {
    // Hydra's sources and operators are globals it installs on window; the
    // editor's text is evaluated against them exactly as hydra's own editor
    // does. This is a page that runs code you typed into it, and nothing else
    // has access to that box.
    // eslint-disable-next-line no-new-func
    new Function(code)();
    state.running = true;
  } catch (e) {
    state.error = e.message;
    state.running = false;
  }
  sync();
}

function sync() {
  document.getElementById('preset').textContent = `preset ${PRESETS[state.presetIx].name}`;
  const err = document.getElementById('error');
  err.textContent = state.error;
  err.style.display = state.error ? 'block' : 'none';
}

async function boot() {
  globalThis.global ??= globalThis;
  ({ default: Hydra } = await import('hydra-synth'));

  const canvas = document.getElementById('c');
  canvas.width = SIZE;
  canvas.height = SIZE;
  hydra = new Hydra({
    canvas,
    detectAudio: false,     // meyda comes along with hydra; nothing here wants it
    enableStreamCapture: false,
    makeGlobal: true,       // the editor evaluates osc()/out() as bare globals
    width: SIZE,
    height: SIZE,
  });
  registerKernels(hydra);

  const editor = document.getElementById('code');
  const load = (i) => {
    state.presetIx = i;
    editor.value = PRESETS[i].code;
    run(editor.value);
  };

  document.getElementById('preset').onclick = () => load((state.presetIx + 1) % PRESETS.length);
  document.getElementById('run').onclick = () => run(editor.value);
  editor.addEventListener('keydown', (e) => {
    // ctrl/cmd+enter is the universal live-coding gesture; plain typing must
    // never re-evaluate, or a half-written line throws on every keystroke.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(editor.value); }
    e.stopPropagation();
  });
  document.getElementById('save').onclick = () => {
    const a = document.createElement('a');
    a.download = `hydra-edge-${PRESETS[state.presetIx].name}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };

  load(0);
}

boot();

// Read-only view for the behaviour tests.
if (typeof window !== 'undefined') {
  window.__hydraEdge = {
    preset: () => PRESETS[state.presetIx].name,
    presets: () => PRESETS.map((p) => p.name),
    running: () => state.running,
    error: () => state.error,
    ops: () => OPS.map((o) => o.name),
    // Mean luminance of the output — enough to assert that a kernel compiled
    // and drew something rather than leaving a black canvas behind.
    //
    // readPixels off hydra's own context, not drawImage into a 2D canvas:
    // regl does not ask for preserveDrawingBuffer, so by the time a copy runs
    // the buffer is already gone and every reading is a confident zero. Call
    // it from inside a rAF, while the frame just drawn is still the back
    // buffer.
    coverage: () => {
      const c = document.getElementById('c');
      const gl = c.getContext('webgl') || c.getContext('webgl2');
      if (!gl) return -1;
      // The whole frame, not a corner: readPixels starts at the lower-left,
      // so a capped window silently reports on one quadrant and reads as a
      // near-black frame whenever that quadrant happens to be empty.
      const w = c.width, h = c.height;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += px[i];
      return sum / (px.length / 4) / 255;
    },
  };
}
