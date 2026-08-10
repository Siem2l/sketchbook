# shared/ extraction — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the four things that now have two consumers into `shared/`, and make `elsewhere` audio-reactive — which is the second consumer that proves the audio seam rather than guessing it.

**Architecture:** `shared/` already exists for exactly this and holds `kernels.glsl`. Sketches import it as `../../shared/x.js`; `scripts/` as `../shared/x.js`; `test.mjs` as `./shared/x.js`. Everything moved is plain ESM with no Vite-specific syntax, so Node imports it directly and the existing Node-side tests keep working.

**Tech stack:** No new dependencies. No build changes. The three scanners only look at `sketches/*/`, so nothing under `shared/` needs a `meta.json`.

## Global constraints

- `shared/` is for code used by **more than one sketch** (repo README). Every task below either has two consumers on the day it lands or creates the second one in the same plan. Nothing moves on speculation.
- Do not change behaviour while moving code. Each extraction task must leave `npm test` at the same count it started at, except where a task explicitly adds tests.
- `npm test` is the gate before every commit. It takes ~4 minutes on a quiet machine and ~10 under load. **Check no other session is driving a browser before believing a red run** — six failures across `edge`, `hendriklaan` and `splinter` turned out to be contention, and all pass alone.
- Baseline at the time of writing: **148 passed, 0 failed**, commit `cf7d475`.
- Import paths: sketches `../../shared/`, scripts `../shared/`, tests `./shared/`.
- Do not touch `sketches/2026-08-hendriklaan/index.html` or its CSS. Tasks 3 and 4 move JS out from under a working sketch; the DOM contract stays exactly as it is.

---

### Task 1: `shared/pdok.js`

Two consumers today: `sketches/2026-08-elsewhere/pdok.js` and `scripts/bake-place.js` hard-code the same three endpoints and both parse `centroide_rd`. Adding `geotiff:compression=None` already had to be done in both, and missing it is a silent 55-second decode.

**Files:**
- Create: `shared/pdok.js` (moved from `sketches/2026-08-elsewhere/pdok.js`)
- Delete: `sketches/2026-08-elsewhere/pdok.js`
- Modify: `sketches/2026-08-elsewhere/sketch.js` (import path)
- Modify: `scripts/bake-place.js` (drop its duplicate constants and geocoder)
- Modify: `test.mjs` (import path)

**Interfaces:**
- Produces: unchanged exports — `FETCH_SPAN`, `FETCH_SIZE`, `fetchTileKey`, `fetchTileBbox`, `coverageUrl`, `orthoUrl`, `journey`, `geocode`, `cachedFetch` — with one signature change:
  `coverageUrl(id, bbox, size, { compressed = false } = {})`. Uncompressed stays the default because that is what the browser needs; `--compress` is a bake-script-only concern.

- [ ] **Step 1: Move the file, unchanged**

```bash
git mv sketches/2026-08-elsewhere/pdok.js shared/pdok.js
```

- [ ] **Step 2: Add the compression option**

In `shared/pdok.js`, replace `coverageUrl` with:

```js
// geotiff:compression=None costs 35% more bytes — 923 KB against 683 KB — and
// is 3,900 times faster to decode in a browser: 14 ms against 55 seconds,
// measured on the same tile. Deflate is not slow because inflating is slow. It
// is slow because a striped TIFF has 120 strips, each needing its own
// DecompressionStream, and each of those yields to the event loop. Against a
// render loop those yields never come back. Bandwidth is cheap and the main
// thread is not.
//
// The bake script passes compressed:true for one small fixture, so the
// decoder's predictor branch stays under test.
export const coverageUrl = (id, bbox, size, { compressed = false } = {}) =>
  `${WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${id}`
  + `&subset=x(${bbox[0]},${bbox[2]})&subset=y(${bbox[1]},${bbox[3]})`
  + `&scalesize=x(${size}),y(${size})&format=image/tiff`
  + (compressed ? '' : '&geotiff:compression=None');
```

- [ ] **Step 3: Point the sketch and the tests at it**

In `sketches/2026-08-elsewhere/sketch.js`, change `from './pdok.js'` to `from '../../shared/pdok.js'`.
In `test.mjs`, change `'./sketches/2026-08-elsewhere/pdok.js'` to `'./shared/pdok.js'`.

- [ ] **Step 4: Gut the bake script's duplicates**

In `scripts/bake-place.js`, delete the local `GEOCODE`, `WCS`, `WMS` constants, the local `geocode` function, and the local `cov` and `ortho` builders. Add at the top:

```js
import { coverageUrl, orthoUrl, geocode } from '../shared/pdok.js';
```

and replace the two builder call sites with:

```js
const cov = (id) => coverageUrl(id, bbox, size, { compressed });
const ortho = orthoUrl(bbox, size);
```

Keep `LICENCE`, `slugify`, `grab`, the CLI parsing and the `place.json` writing — those are the script's own job.

- [ ] **Step 5: Add a test for the option**

In `test.mjs`, in the pdok block, after `coverage urls carry the subset and the scalesize`:

```js
    await test('coverage urls are uncompressed unless the caller asks otherwise', async () => {
      const fast = P.coverageUrl('dsm_05m', [138240, 455280, 138480, 455520], 480);
      assert.match(fast, /geotiff:compression=None/,
        'the browser path must not be handed a striped deflate tiff');
      const baked = P.coverageUrl('dsm_05m', [138240, 455280, 138480, 455520], 64, { compressed: true });
      assert.ok(!baked.includes('compression=None'), 'the fixture must stay on the predictor path');
    });
```

- [ ] **Step 6: Verify the bake script still works end to end**

Run: `node scripts/bake-place.js "Prins Hendriklaan 17, Utrecht" --span 480 --size 64 --slug _scratch`
Expected: three files. `dsm` and `dtm` about 14 KB, `ortho` about 3 KB.
Then: `node scripts/bake-place.js "Prins Hendriklaan 17, Utrecht" --span 480 --size 64 --slug _scratch --compress`
Expected: smaller `dsm`/`dtm` — that is the deflate path.
Then: `rm -rf public/data/elsewhere/_scratch`

- [ ] **Step 7: Run the suite and commit**

Run: `npm test` — expected 149 passed, 0 failed (one test added).

```bash
git add shared/pdok.js sketches/2026-08-elsewhere scripts/bake-place.js test.mjs
git commit -m "refactor(shared): one pdok client for the sketch and the bake script"
```

---

### Task 2: `shared/geotiff.js`

A general float32 GeoTIFF reader with no coupling to any sketch, already imported by both the sketch and `test.mjs`.

**Files:**
- Create: `shared/geotiff.js` (moved)
- Delete: `sketches/2026-08-elsewhere/geotiff.js`
- Modify: `sketches/2026-08-elsewhere/sketch.js`, `test.mjs`

- [ ] **Step 1: Move it**

```bash
git mv sketches/2026-08-elsewhere/geotiff.js shared/geotiff.js
```

- [ ] **Step 2: Repoint the two importers**

`sketch.js`: `from './geotiff.js'` → `from '../../shared/geotiff.js'`.
`test.mjs`: both occurrences of `'./sketches/2026-08-elsewhere/geotiff.js'` → `'./shared/geotiff.js'`.

- [ ] **Step 3: Run the suite and commit**

Run: `npm test` — expected 149 passed, 0 failed. The two decoder tests still assert against the same fixtures; if they fail, the import path is wrong, not the decoder.

```bash
git add shared/geotiff.js sketches/2026-08-elsewhere test.mjs
git commit -m "refactor(shared): the geotiff reader is not this sketch's"
```

---

### Task 3: `shared/beat.js`

The pattern model and sequencer are generic; `mountEditor` is DOM styled by hendriklaan's CSS. The file already marks its own seam at line 168: *"Everything below touches the DOM, and nothing above it does, which is what lets test.mjs import this module in plain node and check the arithmetic without a browser."* This is a cut, not a refactor.

**Files:**
- Create: `shared/beat.js` — everything above that comment
- Create: `sketches/2026-08-hendriklaan/beat-editor.js` — `mountEditor`, `NOTE_BARS`, the `el` helper
- Delete: `sketches/2026-08-hendriklaan/beat.js`
- Modify: `sketches/2026-08-hendriklaan/sketch.js`, `test.mjs`

**Interfaces:**
- `shared/beat.js` produces: `STEPS`, `LANES`, `NOTES`, `DEFAULT`, `clone`, `sequence(t, beats, p)`, `same`, `changes`, `encode`, `decode`. Unchanged signatures.
- `beat-editor.js` produces: `mountEditor(root, { pattern, onChange, onOpen })`. Unchanged.

- [ ] **Step 1: Split the file at the comment**

Everything from the top of `beat.js` down to (not including) the `// Everything below touches the DOM` comment becomes `shared/beat.js`. From that comment to the end becomes `sketches/2026-08-hendriklaan/beat-editor.js`, with this at its top:

```js
// The editor. The pattern it edits lives in shared/beat.js, because a
// sixteen-step mask with a tempo and a swing is not specific to one street —
// the elsewhere sketch plays the same one. What is specific is this: sixteen
// columns in a corner, drawn against hendriklaan's own CSS.
import { STEPS, LANES, NOTES, DEFAULT, changes } from '../../shared/beat.js';
```

Those five are exactly what the editor half references — `clone`, `sequence`,
`same`, `encode` and `decode` are not among them.

- [ ] **Step 2: Repoint hendriklaan's sketch**

In `sketches/2026-08-hendriklaan/sketch.js`, split the single `./beat.js` import:

The current line is `import { DEFAULT, clone, decode, encode, mountEditor, same, sequence } from './beat.js';`. It becomes:

```js
import { DEFAULT, clone, decode, encode, same, sequence } from '../../shared/beat.js';
import { mountEditor } from './beat-editor.js';
```

- [ ] **Step 3: Repoint the tests**

In `test.mjs`, change `'./sketches/2026-08-hendriklaan/beat.js'` to `'./shared/beat.js'`. No test imports `mountEditor`, so nothing needs to point at the editor file — the editor is covered through the browser tests instead.

- [ ] **Step 4: Run the suite and commit**

Run: `npm test` — expected 149 passed, 0 failed. hendriklaan's beat tests are the ones that prove this; if the editor is broken the browser tests will say so.

```bash
git add shared/beat.js sketches/2026-08-hendriklaan test.mjs
git commit -m "refactor(shared): the pattern is not the editor"
```

---

### Task 4: `shared/audio.js`

`class Listener` sits at roughly lines 327–514 of `sketches/2026-08-hendriklaan/sketch.js`. It depends on exactly four things outside itself: `clamp` (a one-line util), `TONE_LEVEL` (its own constant, immediately above it), `sequence` (from beat.js), and the pattern handed to its constructor. No DOM, no globals.

**Files:**
- Create: `shared/audio.js`
- Modify: `sketches/2026-08-hendriklaan/sketch.js` (remove the class, import it)

**Interfaces:**
- Produces `class Listener`, unchanged public surface: `new Listener(pattern)`, `update(t, beats)`, `bands` (a `Float32Array(4)`, each 0..1), `mode` (`'field' | 'tone' | 'mic'`), `async setMode(mode)`, `error` (a string, empty when fine).
- **The engine emits four numbers and decides nothing about what they mean.** hendriklaan maps them to its survey classification; `elsewhere` will map them to its own derived categories. That is the whole interface, and Task 5 is what proves it.

- [ ] **Step 1: Move the class**

Cut `TONE_LEVEL` and `class Listener` out of hendriklaan's `sketch.js` into `shared/audio.js`, with this header:

```js
// The part of an audio-reactive sketch that could never be pure: the
// oscillators, the FFT, and the automatic gain that makes a room mic and a
// synth bank comparable.
//
// Three sources. `field` runs the sequencer straight into the bands with no
// AudioContext at all, which is what lets a page move on load with no gesture
// and no permission — the thumbnail grabber and the tests both depend on that.
// `tone` drives real oscillators from the same envelopes and reads the bands
// back out of an FFT of the result, so the two look identical and only one is
// audible. `mic` swaps the FFT's input.
//
// It emits four numbers in 0..1 and decides nothing about what they mean.
import { sequence } from './beat.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
```

Add `export` to the class. Leave every comment inside it intact — particularly the one on `agc`, which records why a fixed gain pinned every band above 0.79 and stopped the street answering the music.

- [ ] **Step 2: Import it back into hendriklaan**

```js
import { Listener } from '../../shared/audio.js';
```

Check whether `clamp` is still referenced elsewhere in that file before deleting it — it is a general util and probably is.

- [ ] **Step 3: Run the suite and commit**

Run: `npm test` — expected 149 passed, 0 failed. hendriklaan's audio tests cover the mic fallback and the field sequencer; those are what prove the move.

```bash
git add shared/audio.js sketches/2026-08-hendriklaan
git commit -m "refactor(shared): lift the listener out of the street it was built for"
```

---

### Task 5: `elsewhere` becomes audio-reactive

The second consumer. Until this lands, `shared/audio.js` has one user and the interface is a claim rather than a demonstration.

**Files:**
- Modify: `sketches/2026-08-elsewhere/sketch.js`, `shaders.js`, `index.html`
- Modify: `test.mjs`

**The mapping.** hendriklaan splits its street by the survey's own classification. `elsewhere` has no classification — but its shader already derives the same three categories from the height field, in `lookup()`: `hag` for how far off the deck a cell is, `rough` (curvature) for vegetation, `drop` for a facade. So:

| band | drives | already computed as |
| --- | --- | --- |
| sub | the ground heaving | `hag < 0.5` |
| low | the whole square breathing | all |
| mid | the canopy churning | `hag > 2.5 && rough > 0.35` |
| high | roofs and facades fizzing | `drop > 1.2` |

Same idea as hendriklaan, reached from derived geometry instead of a survey label. Worth saying in the sketch's header comment, because it is the finding that makes the shared module worth having.

**Audio is off by default.** `elsewhere`'s whole claim is that what you see is the survey as measured, and there is a passing test — `at rest nothing moves at all` — that pins two frames a second apart as byte-identical. An always-on audio source breaks that and the property is worth more than the default. A button turns it on; `gain` at 0 is the rest state, exactly as in hendriklaan.

- [ ] **Step 1: Write the failing test**

In `test.mjs`, in the elsewhere block:

```js
    await test('sound moves the square, and silence puts it back', async () => {
      await p.waitForFunction(() => window.__elsewhere.loading() === 0, null, { timeout: 120000 });
      // off by default: the survey as measured, and the rest-state test depends on it
      assert.equal(await el(() => window.__elsewhere.audioMode()), 'off');
      const still = await el(() => window.__elsewhere.coverage());

      await p.click('#audio');                       // -> field, no gesture needed, no permission
      assert.equal(await el(() => window.__elsewhere.audioMode()), 'field');
      const seen = [];
      for (let i = 0; i < 14; i++) {
        seen.push(await el(() => window.__elsewhere.bands()));
        await p.waitForTimeout(120);
      }
      for (const v of seen.flat()) assert.ok(v >= 0 && v <= 1, `band out of range: ${v}`);
      const sub = seen.map((b) => b[0]);
      assert.ok(Math.max(...sub) - Math.min(...sub) > 0.15,
        `the sub band never moved (${Math.min(...sub)}..${Math.max(...sub)})`);

      // and turning it off returns the square to the survey
      await el(() => window.__elsewhere.setAudio('off'));
      await p.waitForTimeout(400);
      const back = await el(() => window.__elsewhere.coverage());
      assert.ok(Math.abs(back - still) < 0.03,
        `silence did not put the square back (${still.toFixed(3)} -> ${back.toFixed(3)})`);
      assert.deepEqual(errors, []);
    });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test 2>&1 | grep -A3 "sound moves the square"`
Expected: FAIL — `window.__elsewhere.audioMode` is not a function.

- [ ] **Step 3: Add the uniforms to the shader**

In `shaders.js`, add `uniform vec4 uBands;` and `uniform float uAudio;` (0 when off, so every term below vanishes and the rest state is exact).

Inside `lookup()`, after `drop` and `rough` are computed, before the wall and canopy branches:

```glsl
  // The same three-way split hendriklaan gets from the survey's classification,
  // reached here from the height field instead: how far off the deck a cell is,
  // how rough it is in every direction at once, and whether it stands on a drop.
  float ground = 1.0 - smoothstep(0.2, 0.8, s.hag);
  float canopy = step(2.5, s.hag) * smoothstep(0.25, 0.5, rough);
  float built  = smoothstep(1.0, 1.6, drop);
  float energy = uAudio * (uBands.x * ground * 1.0
                         + uBands.y * 0.35
                         + uBands.z * canopy
                         + uBands.w * built);
  s.y += energy * 1.6 * (0.4 + hash1(w * 0.61));
```

`uAudio` at 0 makes `energy` exactly zero, so the rest state is bit-identical — the same reason hendriklaan's gain closes the whole channel rather than just the displacement.

- [ ] **Step 4: Wire it in the sketch**

In `sketch.js`:

```js
import { Listener } from '../../shared/audio.js';
import { DEFAULT, clone } from '../../shared/beat.js';
```

```js
  // Off by default. What this square shows is the survey as measured, and there
  // is a test pinning two frames a second apart as byte-identical; an always-on
  // source would break a property worth more than the default.
  const audio = new Listener(clone(DEFAULT));
  let audioOn = false;
  let beats = 0;
```

In `frame()`, before `render`:

```js
    if (audioOn) {
      beats += dt * (audio.pattern.bpm / 60);
      audio.update(view.clock, beats);
    }
```

In `render()`:

```js
    gl.uniform4fv(u.uBands, audio.bands);
    gl.uniform1f(u.uAudio, audioOn ? 1 : 0);
```

Add `uBands` and `uAudio` to the uniform name list in `field.js`.

In `index.html`, add the button immediately before `<button id="colour">`:

```html
      <button id="audio">listen: off</button>
```

and in `sketch.js`:

```js
  const SOURCES = ['off', 'field', 'tone', 'mic'];
  async function setAudio(mode) {
    if (mode === 'off') {
      audioOn = false;
      audio.bands.fill(0);            // so the rest state is exact, not merely still
      $('audio').textContent = 'listen: off';
      $('audio').classList.remove('on');
      note('');
      return;
    }
    await audio.setMode(mode);        // falls back to 'field' if the mic is refused
    audioOn = true;
    $('audio').textContent = 'listen: ' + audio.mode;
    $('audio').classList.add('on');
    note(audio.error || (audio.mode === 'mic' ? 'listening to the room'
      : audio.mode === 'tone' ? 'the built-in pattern, now audible' : ''));
  }
  $('audio').onclick = () => {
    const now = audioOn ? audio.mode : 'off';
    setAudio(SOURCES[(SOURCES.indexOf(now) + 1) % SOURCES.length]);
  };
```

and on `window.__elsewhere`:

```js
    audioMode: () => (audioOn ? audio.mode : 'off'),
    bands: () => Array.from(audio.bands),
    setAudio,
```

- [ ] **Step 5: Run the test and the rest-state test together**

Run: `npm test 2>&1 | grep -E "sound moves the square|at rest nothing moves|passed,"`
Expected: both `ok`, 150 passed, 0 failed.

If `at rest nothing moves` fails, `uAudio` is not reaching zero — check that the button starts at `off` and that `energy` has no additive constant.

- [ ] **Step 6: Commit**

```bash
git add sketches/2026-08-elsewhere test.mjs shared
git commit -m "feat(elsewhere): let the square listen, on the shared engine"
```

---

## Notes for the implementer

- Tasks 1 and 2 are independent and low-risk. Tasks 3 and 4 move code out from under a sketch you did not write; it is fully covered by browser tests, so breakage is loud rather than silent. Task 5 is the only one that adds behaviour.
- After Task 4, `sketches/2026-08-elsewhere/place.js` and `slots.js` remain sketch-local on purpose. They are this sketch's architecture, and generalising them would be inventing an abstraction for a consumer that does not exist.
- Every performance number quoted in these files came from headless Chromium on SwiftShader. Do not optimise against them without measuring on hardware first.
