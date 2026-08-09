# Hendriklaan Beat Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hardcoded sequencer in `2026-08-hendriklaan` editable from the page — a 16-step grid for kick, bass and hat, a four-cell bass-note row, BPM and swing — in a top-right overlay that ghosts the built-in pattern under the edited one, persisted to the URL hash.

**Architecture:** The pattern is currently *implied* by modulo arithmetic (`beat % 2` **is** "kick on 1 and 3"). It becomes three 16-bit masks plus metadata, living in a new `beat.js` alongside `sketch.js`. `beat.js` owns the pattern model, a generalised `sequence()`, the hash codec, and the panel DOM; `sketch.js` keeps rendering, camera, `Listener` and wiring. Everything downstream of `sequence()` — the two consumers, the synth voices, the AGC, the shader — is untouched.

**Tech Stack:** Vanilla ES modules, Vite 6, WebGL2, Web Audio API, Playwright + `node:assert/strict` via `test.mjs`. No new dependencies.

## Global Constraints

- **No new dependencies.** `package.json` gains nothing.
- **`beat.js` must import cleanly in plain node.** `test.mjs` imports it directly for pure-function tests, exactly as the lab block imports `./lab/variants.mjs`. No `document`, `window` or `location` access at module scope — only inside `mountEditor`.
- **The default page is unchanged.** With no hash: `field` mode, no `AudioContext`, panel closed, nothing written to `location.hash`. The eight existing hendriklaan assertions and the thumbnail grabber (1500 ms, `scripts/gen-thumbnails.js`) both depend on this.
- **`sequence(t, beats, DEFAULT)` must be numerically indistinguishable from today's `sequence(t)`** — asserted to 1e-9 in Task 1.
- **Prose voice.** `sketch.js` carries essayistic comments recording *why* each decision went the way it did. `beat.js` matches that register. Comments explain reasoning, not mechanics.
- **Commit after every task**, message in the repo's existing `type(scope): lowercase summary` form.
- Spec: `docs/superpowers/specs/2026-08-09-hendriklaan-beat-editor-design.md`.

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `sketches/2026-08-hendriklaan/beat.js` | create | Pattern model, `sequence()`, hash codec, panel DOM. The whole editor. |
| `sketches/2026-08-hendriklaan/sketch.js` | modify | Loses `BPM`/`BEAT`/`BASS_NOTES`/`sequence`; gains the pattern, the `beats` accumulator, editor wiring, new test probes. |
| `sketches/2026-08-hendriklaan/index.html` | modify | `[beat]` button, `#beat` panel markup, panel CSS, one `#hint` line. |
| `sketches/2026-08-hendriklaan/meta.json` | modify | Description gains a clause about the beat being editable. |
| `test.mjs` | modify | A node block for `beat.js` pure functions; new browser assertions in the hendriklaan block; `shot()` also hides `#beat`. |
| `README.md` | modify | Sketch list entry, if it describes the sketch's controls. |

---

### Task 1: The pattern model and a generalised `sequence()`

The core. Everything else depends on the masks reproducing today's music exactly.

**Files:**
- Create: `sketches/2026-08-hendriklaan/beat.js`
- Test: `test.mjs` (new node block, inserted immediately before the `// ---- lab` block at line ~1290)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `NOTES: Array<{name: string, hz: number}>` — seven entries, C3..B3
  - `STEPS: 16`, `LANES: ['kick','bass','hat']`
  - `DEFAULT: {bpm:96, swing:0, kick:0x0101, bass:0x1111, hat:0x5555, notes:[2,1,4,0]}`
  - `sequence(t: number, beats: number, p: pattern) => {kick, bass, pad, hat, note}` — all numbers; `note` is a frequency in Hz
  - `same(a, b) => boolean`
  - `changes(p) => number`

- [ ] **Step 1: Write the failing test**

Insert into `test.mjs` immediately before the `// --------------------------------------------------------------------- lab` comment:

```js
  // ------------------------------------------------------------------- beat
  // The pattern model is pure, so it is tested in node rather than through a
  // browser. The equivalence test is the important one: the masks in DEFAULT
  // are only correct if they reproduce the arithmetic they replaced.
  {
    const { DEFAULT, NOTES, sequence, same, changes } =
      await import('./sketches/2026-08-hendriklaan/beat.js');

    // Verbatim copy of the sequencer as it stood before the editor existed.
    // Kept here, not imported, precisely so that changing beat.js cannot
    // quietly change what "the built-in tune" means.
    const OLD_BPM = 96, OLD_BEAT = 60 / OLD_BPM;
    const OLD_NOTES = [164.81, 146.83, 196.00, 130.81];
    const oldSequence = (t) => {
      const beat = t / OLD_BEAT;
      const inBar = beat % 4;
      const bar = Math.floor(beat / 4);
      const env = (since, decay) => (since < 0 ? 0 : Math.exp(-since / decay));
      return {
        kick: env((inBar % 2) * OLD_BEAT, 0.13),
        hat: env((beat % 0.5) * OLD_BEAT, 0.035) * (0.55 + 0.45 * Math.sin(beat * 1.7)),
        bass: env((beat % 1) * OLD_BEAT, 0.22) * (0.6 + 0.4 * Math.sin(beat * 0.37)),
        pad: 0.16 + 0.34 * (0.5 + 0.5 * Math.sin(t * 0.29))
                  + 0.30 * (0.5 + 0.5 * Math.sin(t * 0.107 + 1.3)),
        note: OLD_NOTES[bar % 4],
      };
    };

    await test('the default masks reproduce the built-in tune exactly', () => {
      for (let i = 0; i < 4000; i++) {
        const t = i * 0.0137;                    // 55 s, not a multiple of the bar
        const a = oldSequence(t);
        const b = sequence(t, t / OLD_BEAT, DEFAULT);
        for (const k of ['kick', 'bass', 'hat', 'pad', 'note']) {
          assert.ok(Math.abs(a[k] - b[k]) < 1e-9,
            `${k} diverged at t=${t.toFixed(3)}: ${a[k]} vs ${b[k]}`);
        }
      }
    });

    await test('an empty lane is silent, and an empty pattern is silence', () => {
      const noKick = { ...DEFAULT, kick: 0 };
      for (let i = 0; i < 400; i++) {
        const t = i * 0.0137;
        assert.equal(sequence(t, t / OLD_BEAT, noKick).kick, 0);
        // The hat is untouched, so it must still be moving.
      }
      const hats = [];
      for (let i = 0; i < 400; i++) hats.push(sequence(i * 0.0137, i * 0.0137 / OLD_BEAT, noKick).hat);
      assert.ok(Math.max(...hats) > 0.4, 'clearing the kick silenced the hat too');

      const empty = { ...DEFAULT, kick: 0, bass: 0, hat: 0 };
      for (let i = 0; i < 400; i++) {
        const s = sequence(i * 0.0137, i * 0.0137 / OLD_BEAT, empty);
        assert.equal(s.kick, 0);
        assert.equal(s.bass, 0);
        assert.equal(s.hat, 0);
      }
    });

    await test('swing delays the offbeats and leaves the downbeats alone', () => {
      // A hat on step 1 with swing 0.5 fires half a sixteenth later, so at the
      // unswung moment of step 1 it has not happened yet.
      const p = { ...DEFAULT, kick: 0, bass: 0, hat: 0b10 };
      const stepDur = OLD_BEAT / 4;
      const at = (steps) => sequence(0, steps / 4, p).hat;
      assert.ok(at(1.0) > 0.5, 'unswung hat did not fire on its own step');
      const sw = { ...p, swing: 0.5 };
      const atSw = (steps) => sequence(0, steps / 4, sw).hat;
      assert.ok(atSw(1.0) < 0.05, `swung hat fired early: ${atSw(1.0)}`);
      assert.ok(atSw(1.5) > 0.5, `swung hat never fired: ${atSw(1.5)}`);
      assert.ok(stepDur > 0);
    });

    await test('tempo scales the envelopes, not the pad', () => {
      // Same phase, double the tempo: the plucks decay over half as much wall
      // time, but the pad's swells are in seconds and must not move.
      const fast = { ...DEFAULT, bpm: 192 };
      const a = sequence(3.0, 1.3, DEFAULT);
      const b = sequence(3.0, 1.3, fast);
      assert.equal(a.pad, b.pad);
      assert.ok(b.kick < a.kick, 'a faster tempo did not shorten the decay');
    });

    await test('the note row walks the pool one note a bar', () => {
      const notes = [0, 1, 2, 3, 4, 5, 6];
      const p = { ...DEFAULT, notes: [3, 5, 0, 6] };
      const noteAt = (bar) => sequence(0, bar * 4 + 0.5, p).note;
      assert.equal(noteAt(0), NOTES[3].hz);
      assert.equal(noteAt(1), NOTES[5].hz);
      assert.equal(noteAt(2), NOTES[0].hz);
      assert.equal(noteAt(3), NOTES[6].hz);
      assert.equal(noteAt(4), NOTES[3].hz, 'the note cycle did not wrap after four bars');
      assert.equal(NOTES.length, notes.length);
    });

    await test('same() and changes() measure the distance from the built-in tune', () => {
      assert.ok(same(DEFAULT, { ...DEFAULT, notes: [...DEFAULT.notes] }));
      assert.equal(changes(DEFAULT), 0);
      assert.ok(!same(DEFAULT, { ...DEFAULT, kick: 0x0103 }));
      assert.equal(changes({ ...DEFAULT, kick: 0x0103 }), 1);   // one bit added
      assert.equal(changes({ ...DEFAULT, kick: 0 }), 2);        // two bits removed
      assert.equal(changes({ ...DEFAULT, bpm: 120 }), 1);
      assert.equal(changes({ ...DEFAULT, notes: [2, 1, 4, 1] }), 1);
    });
  }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | grep -A2 "beat\|Cannot find"`
Expected: the run aborts on `Cannot find module .../beat.js` — the import is at block scope, so it throws before any assertion.

- [ ] **Step 3: Write the implementation**

Create `sketches/2026-08-hendriklaan/beat.js`:

```js
// beat — the pattern the street is answering to.
//
// Until this file existed the tune was implied rather than stored. `beat % 2`
// was not a convenient way of expressing "kick on one and three"; it *was*
// "kick on one and three", and there was nothing to hand a click. Making it
// editable means giving the pattern a representation, and the representation
// chosen is three 16-bit masks — one bit per sixteenth, one integer per voice.
//
// Masks rather than note events, for two reasons. The sketch's whole claim is
// that displacement is a pure function of band energy with nothing integrating
// anywhere, so freezing is exact and silence returns all 201,635 points to
// their surveyed coordinates. An event list would have needed a scheduler with
// state, and state is the thing this page is careful not to have. And a mask
// is four hex characters, so a whole pattern fits in a URL without a codec
// worth the name.
//
// The pad has no lane. It is a swell on two periods, 21.7 s and 58.7 s, that do
// not divide into each other or into the bar — that is what keeps the canopy
// finding new shapes instead of looping — and putting it on a sixteenth grid
// would be drawing a control that lies about what the sound does.
//
// The amplitude wobbles on hat and bass stay tied to absolute beat count rather
// than becoming per-cell velocity. Per-cell velocity is more controllable and
// much flatter: every pass through the bar comes out identical, and a
// sixteen-step loop starts to sound like one. sin(beat * 1.7) has a period of
// 3.70 beats against a four-beat bar, so an edited pattern still breathes.

export const STEPS = 16;
export const LANES = ['kick', 'bass', 'hat'];

// One octave, no accidentals. Free pitch entry would want a keyboard and this
// is a four-cell row; a diatonic pool means every click lands somewhere the
// bass can go.
export const NOTES = [
  { name: 'C3', hz: 130.81 },
  { name: 'D3', hz: 146.83 },
  { name: 'E3', hz: 164.81 },
  { name: 'F3', hz: 174.61 },
  { name: 'G3', hz: 196.00 },
  { name: 'A3', hz: 220.00 },
  { name: 'B3', hz: 246.94 },
];

// Bit i is step i, so bit 0 is the downbeat. These three constants are the
// music that was hardcoded here before, written down: 0x0101 is beats one and
// three, 0x1111 is every beat, 0x5555 is every eighth.
export const DEFAULT = Object.freeze({
  bpm: 96,
  swing: 0,                              // fraction of a sixteenth, 0..0.75
  kick: 0x0101,
  bass: 0x1111,
  hat: 0x5555,
  notes: Object.freeze([2, 1, 4, 0]),    // E3 D3 G3 C3
});

export const clone = (p) => ({ ...p, notes: [...p.notes] });

// Time since this lane last fired, in steps.
//
// The obvious implementation walks backwards from the current step and returns
// the first set bit it finds. That is wrong once swing is non-zero: a swung
// step that has not arrived yet reads as a bar old, and shadows an earlier
// step that genuinely did just fire. Scanning all sixteen and taking the
// smallest non-negative distance costs 48 iterations a frame across three
// lanes and cannot get that wrong.
const since = (mask, pos, swing) => {
  let best = Infinity;
  for (let i = 0; i < STEPS; i++) {
    if (!(mask & (1 << i))) continue;
    let d = pos - (i + (i % 2 ? swing : 0));
    if (d < 0) d += STEPS;               // it fired a bar ago, not in the future
    if (d < best) best = d;
  }
  return best;                           // Infinity for an empty lane
};

// `t` is seconds and `beats` is a tempo-relative phase, and they are separate
// arguments on purpose. Deriving beats from t would mean that dragging the
// tempo slider rescales all elapsed history at once and the playhead teleports
// mid-bar. The pad keeps using t, because its swells are deliberately unrelated
// to the bar and should not stretch when the tempo changes.
export function sequence(t, beats, p) {
  const step = 60 / p.bpm / 4;                    // seconds in a sixteenth
  const pos = ((beats % 4) + 4) % 4 * 4;          // step position inside the bar
  const bar = Math.floor(beats / 4);
  // An empty lane gives `since` = Infinity, and exp(-Infinity) is 0, so
  // clearing a lane silences it without a branch.
  const env = (d, decay) => Math.exp(-d * step / decay);

  const kick = env(since(p.kick, pos, p.swing), 0.13);
  const bass = env(since(p.bass, pos, p.swing), 0.22) * (0.6 + 0.4 * Math.sin(beats * 0.37));
  const hat = env(since(p.hat, pos, p.swing), 0.035) * (0.55 + 0.45 * Math.sin(beats * 1.7));
  const pad = 0.16 + 0.34 * (0.5 + 0.5 * Math.sin(t * 0.29))
                   + 0.30 * (0.5 + 0.5 * Math.sin(t * 0.107 + 1.3));

  return { kick, bass, pad, hat, note: NOTES[p.notes[((bar % 4) + 4) % 4]].hz };
}

export const same = (a, b) =>
  a.bpm === b.bpm && a.swing === b.swing &&
  a.kick === b.kick && a.bass === b.bass && a.hat === b.hat &&
  a.notes.every((v, i) => v === b.notes[i]);

const popcount = (n) => { let c = 0; while (n) { n &= n - 1; c++; } return c; };

// How far this pattern has been dragged from the built-in one. Drives the
// readout under the grid; the ghosts show *where*, this shows *how much*.
export const changes = (p) =>
  LANES.reduce((a, k) => a + popcount((p[k] ^ DEFAULT[k]) & 0xffff), 0)
  + p.notes.reduce((a, v, i) => a + (v === DEFAULT.notes[i] ? 0 : 1), 0)
  + (p.bpm === DEFAULT.bpm ? 0 : 1)
  + (p.swing === DEFAULT.swing ? 0 : 1);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | grep -E "^  (ok|FAIL)" | head -40`
Expected: six new `ok` lines, and the final count unchanged apart from `+6`. All pre-existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add sketches/2026-08-hendriklaan/beat.js test.mjs
git commit -m "feat(hendriklaan): give the tune a representation

The pattern was implied by modulo arithmetic rather than stored, so there
was nothing to hand a click. Three 16-bit masks now say the same thing,
and the equivalence test pins them to the arithmetic they replaced."
```

---

### Task 2: The hash codec

**Files:**
- Modify: `sketches/2026-08-hendriklaan/beat.js` (append)
- Test: `test.mjs` (extend the beat block from Task 1)

**Interfaces:**
- Consumes: `DEFAULT`, `LANES`, `clone` from Task 1.
- Produces:
  - `encode(p) => string` — no leading `#`, e.g. `b=010111115555&n=2140&t=96&s=0`
  - `decode(str) => pattern | null` — accepts with or without a leading `#`; `null` on anything malformed

- [ ] **Step 1: Write the failing test**

Add inside the beat block in `test.mjs`, after the `same()`/`changes()` test. Change the block's import line to also pull `encode` and `decode`:

```js
    const { encode, decode } = await import('./sketches/2026-08-hendriklaan/beat.js');

    await test('the built-in pattern encodes to the documented hash', () => {
      assert.equal(encode(DEFAULT), 'b=010111115555&n=2140&t=96&s=0');
    });

    await test('any pattern survives a round trip through the hash', () => {
      const cases = [
        DEFAULT,
        { ...DEFAULT, kick: 0xffff, bass: 0, hat: 0x8001, notes: [0, 6, 3, 3], bpm: 174, swing: 0.5 },
        { ...DEFAULT, kick: 0, bass: 0, hat: 0, bpm: 40, swing: 0 },
        { ...DEFAULT, bpm: 200, swing: 0.75 },
      ];
      for (const p of cases) {
        const back = decode(encode(p));
        assert.ok(back, `decode refused its own output for ${encode(p)}`);
        assert.ok(same(p, back), `round trip changed ${encode(p)} into ${encode(back)}`);
      }
    });

    await test('a leading hash is optional', () => {
      assert.ok(same(DEFAULT, decode('#' + encode(DEFAULT))));
      assert.ok(same(DEFAULT, decode(encode(DEFAULT))));
    });

    await test('a malformed hash is refused whole rather than half-read', () => {
      const bad = [
        '', '#', 'b=zzzz&n=2140&t=96&s=0',           // not hex
        'b=010111115555&n=2140&t=96',                 // missing swing
        'b=01011111555&n=2140&t=96&s=0',              // 11 hex chars
        'b=010111115555&n=2740&t=96&s=0',             // note index out of pool
        'b=010111115555&n=214&t=96&s=0',              // three notes
        'b=010111115555&n=2140&t=39&s=0',             // tempo below the floor
        'b=010111115555&n=2140&t=201&s=0',            // tempo above the ceiling
        'b=010111115555&n=2140&t=96&s=76',            // swing past three quarters
        'b=010111115555&n=2140&t=-96&s=0',            // negative tempo
        'n=2140&t=96&s=0',                            // no lanes at all
      ];
      for (const s of bad) assert.equal(decode(s), null, `accepted ${JSON.stringify(s)}`);
    });

    await test('a decoded pattern is detached, so editing it cannot poison DEFAULT', () => {
      const p = decode(encode(DEFAULT));
      p.notes[0] = 6;
      p.kick = 0;
      assert.equal(DEFAULT.notes[0], 2);
      assert.equal(DEFAULT.kick, 0x0101);
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | grep -E "hash|round trip|malformed|detached"`
Expected: `FAIL` on each of the five, reporting `encode is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `sketches/2026-08-hendriklaan/beat.js`:

```js
// ---------------------------------------------------------------- the hash
// Fixed-width and regex-checkable, so a mangled link fails loudly at the field
// level instead of decoding into a pattern that is half someone else's.
//
//   b=010111115555&n=2140&t=96&s=0
//     └kick┘└bass┘└hat─┘   E D G C
//
// Rejection is all-or-nothing on purpose. Half-reading a broken link would
// hand someone a tune that is neither the one they were sent nor the built-in
// one, and they would have no way to tell which parts were which.

const hex4 = (n) => (n & 0xffff).toString(16).padStart(4, '0');

export const encode = (p) =>
  `b=${hex4(p.kick)}${hex4(p.bass)}${hex4(p.hat)}`
  + `&n=${p.notes.join('')}`
  + `&t=${Math.round(p.bpm)}`
  + `&s=${Math.round(p.swing * 100)}`;

export function decode(str) {
  const q = new URLSearchParams(String(str || '').replace(/^#/, ''));
  const b = q.get('b') || '', n = q.get('n') || '';
  const t = q.get('t') || '', s = q.get('s') || '';
  if (!/^[0-9a-f]{12}$/.test(b)) return null;
  if (!/^[0-6]{4}$/.test(n)) return null;
  if (!/^\d{2,3}$/.test(t)) return null;
  if (!/^\d{1,2}$/.test(s)) return null;
  const bpm = +t, swing = +s;
  if (bpm < 40 || bpm > 200 || swing > 75) return null;
  return {
    bpm,
    swing: swing / 100,
    kick: parseInt(b.slice(0, 4), 16),
    bass: parseInt(b.slice(4, 8), 16),
    hat: parseInt(b.slice(8, 12), 16),
    notes: n.split('').map(Number),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | grep -E "^  (ok|FAIL)"`
Expected: eleven `ok` lines in the beat block, no `FAIL` anywhere.

- [ ] **Step 5: Commit**

```bash
git add sketches/2026-08-hendriklaan/beat.js test.mjs
git commit -m "feat(hendriklaan): put a pattern in a link

Twelve hex characters, four note indices, a tempo and a swing. A field that
fails its regex rejects the whole hash rather than half-reading it — a
half-read link is a tune that is neither the one you were sent nor the
built-in one, with nothing on screen to say which parts are which."
```

---

### Task 3: Wire the pattern through the sketch, with no UI yet

The pattern reaches the geometry before anything is drawn to edit it. This is the task that must not break the eight existing assertions.

**Files:**
- Modify: `sketches/2026-08-hendriklaan/sketch.js:302-333` (delete `TONE_LEVEL`'s neighbours), `:335-519` (`Listener`), `:626-631` (view state), `:748-774` (`frame`), `:798-819` (probes)
- Test: `test.mjs` hendriklaan block

**Interfaces:**
- Consumes: `DEFAULT`, `sequence`, `clone`, `NOTES` from Tasks 1–2.
- Produces:
  - `window.__hendriklaan.pattern() => pattern` (a detached copy)
  - `window.__hendriklaan.setPattern(partial) => void` — shallow-merges into the live pattern
  - `view.beats: number` on the state object returned by `state()`

- [ ] **Step 1: Write the failing test**

Add to the hendriklaan block in `test.mjs`, after the `silence leaves the survey exactly where it was measured` test:

```js
    await test('the pattern reaches the geometry, not just the page', async () => {
      // The proof that the grid is wired to anything. Clearing the kick lane
      // must collapse the sub band — which is what the road answers — while
      // leaving the hat lane, and therefore the roofs, exactly as busy.
      await hl(() => window.__hendriklaan.setPattern({ kick: 0 }));
      await p.waitForTimeout(3000);
      const quiet = [];
      for (let i = 0; i < 12; i++) {
        quiet.push(await hl(() => window.__hendriklaan.bands()));
        await p.waitForTimeout(90);
      }
      const sub = quiet.map((b) => b[0]);
      const high = quiet.map((b) => b[3]);
      assert.ok(Math.max(...sub) < 0.02, `the sub band survived an empty kick lane: ${Math.max(...sub)}`);
      assert.ok(Math.max(...high) > 0.1, `clearing the kick silenced the hats too: ${Math.max(...high)}`);

      // And an empty pattern is the sketch's own thesis, reachable by clicking:
      // nothing to answer to, so every point sits on its surveyed coordinate.
      await hl(() => window.__hendriklaan.setPattern({ bass: 0, hat: 0 }));
      await p.waitForTimeout(3000);
      const dead = await hl(() => window.__hendriklaan.bands());
      for (const b of dead) assert.ok(b < 0.02, `a band was still moving in silence: ${b}`);
      assert.ok((await hl(() => window.__hendriklaan.coverage())) > 0.05,
        'the survey vanished instead of coming to rest');

      await hl(() => window.__hendriklaan.resetPattern());
      await p.waitForTimeout(1200);
    });

    await test('tempo changes the phase without teleporting it', async () => {
      // beats accumulates rather than being derived from the clock, so a tempo
      // change is continuous. Deriving it would rescale all elapsed history at
      // once and jump the playhead mid-bar.
      const a = await hl(() => window.__hendriklaan.state().beats);
      await hl(() => window.__hendriklaan.setPattern({ bpm: 200 }));
      const b = await hl(() => window.__hendriklaan.state().beats);
      assert.ok(b - a >= 0 && b - a < 1, `the phase jumped by ${b - a} beats`);
      await p.waitForTimeout(500);
      assert.ok((await hl(() => window.__hendriklaan.state().beats)) > b,
        'the phase stopped advancing after a tempo change');
      await hl(() => window.__hendriklaan.resetPattern());
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | grep -E "reaches the geometry|teleporting"`
Expected: both `FAIL` with `window.__hendriklaan.setPattern is not a function`.

- [ ] **Step 3: Write the implementation**

**3a.** At the top of `sketch.js`, after the `const BIN = ...` line (`sketch.js:42`), add the import:

```js
import { DEFAULT, NOTES, clone, sequence } from './beat.js';
```

**3b.** Replace `sketch.js:309-333` — that is, from `const TONE_LEVEL = 0.28;` through the closing brace of `function sequence(t) { ... }` — with just:

```js
const TONE_LEVEL = 0.28;   // bus level for the built-in pattern
```

The header comment above it (`// ---- audio` through `// ... 'mic' swaps the FFT's input.`) stays, with its last paragraph extended:

```js
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
```

**3c.** `Listener` takes the live pattern. Change the constructor (`sketch.js:336`) and the two methods that call `sequence`:

```js
class Listener {
  constructor(pattern) {
    this.pattern = pattern;      // live reference — the editor mutates it in place
    this.mode = 'field';
```

```js
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
    // ... rest unchanged
  }
```

```js
  drive(t, beats) {
    const s = sequence(t, beats, this.pattern);
    // ... rest unchanged
  }
```

**3d.** In `main()`, replace `sketch.js:627-632` (the `view` object and `const audio = new Listener();`) with:

```js
  const cam = { yaw: 0.72, pitch: 0.40, dist: 240, target: [0, 11, 0] };
  const view = {
    colour: 0, ortho: false, spin: true, frozen: false,
    gain: 1, pointScale: 1.2, start: performance.now(),
    clock: 0, beats: 0, revealed: 0,
  };
  // One object, mutated in place. The editor writes into it and the Listener
  // reads it on the next frame; there is no copy to keep in step.
  const pattern = clone(DEFAULT);
  const audio = new Listener(pattern);
```

**3e.** In `frame()` (`sketch.js:752-758`), advance the phase:

```js
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
```

**3f.** Extend the probe object (`sketch.js:798-819`) with three entries, placed after `camera`:

```js
    pattern: () => clone(pattern),
    setPattern: (partial) => {
      Object.assign(pattern, partial);
      if (partial.notes) pattern.notes = [...partial.notes];
    },
    resetPattern: () => { Object.assign(pattern, clone(DEFAULT)); },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -30`
Expected: `0 failed`. Specifically both new assertions pass **and** all eight pre-existing hendriklaan assertions still pass — `the built-in field moves the bands with no gesture and no audio context` is the one that proves the rewrite did not change the tune.

- [ ] **Step 5: Commit**

```bash
git add sketches/2026-08-hendriklaan/sketch.js test.mjs
git commit -m "feat(hendriklaan): run the street off an editable pattern

The Listener holds a live pattern reference and the frame loop accumulates
a tempo-relative phase instead of deriving one from the clock, so a tempo
change is continuous rather than a jump. No UI yet — but clearing the kick
lane now collapses the sub band, which is the whole claim."
```

---

### Task 4: The panel

**Files:**
- Modify: `sketches/2026-08-hendriklaan/beat.js` (append `mountEditor`)
- Modify: `sketches/2026-08-hendriklaan/index.html` (button, panel markup, CSS, hint line)
- Modify: `sketches/2026-08-hendriklaan/sketch.js` (mount it, key `b`, per-frame `draw`)
- Test: `test.mjs` hendriklaan block

**Interfaces:**
- Consumes: `DEFAULT`, `LANES`, `NOTES`, `STEPS`, `changes`, `sequence` from Tasks 1–2; `window.__hendriklaan.setPattern` from Task 3.
- Produces:
  - `mountEditor(root, opts) => {open, close, toggle, isOpen, repaint, draw}` where `opts` is `{pattern, onChange, onOpen}` and `draw(beats, pad, inert)` is called once a frame.
  - `window.__hendriklaan.editorOpen() => boolean`, `.toggleEditor() => void`

- [ ] **Step 1: Write the failing test**

First, update the existing `shot()` helper in the hendriklaan block so a left-open panel cannot poison the screenshot comparisons:

```js
    const shot = async () => {
      await p.evaluate(() => {
        document.getElementById('ui').style.visibility = 'hidden';
        document.getElementById('beat').style.visibility = 'hidden';
      });
      const png = await p.locator('canvas').screenshot();
      await p.evaluate(() => {
        document.getElementById('ui').style.visibility = '';
        document.getElementById('beat').style.visibility = '';
      });
      return png;
    };
```

Then add, after the two tests from Task 3:

```js
    await test('the grid opens closed, and opening it turns the sound on', async () => {
      assert.equal(await hl(() => window.__hendriklaan.editorOpen()), false);
      assert.equal(await p.locator('#beat').isVisible(), false);
      await p.click('#beat-open');
      assert.equal(await hl(() => window.__hendriklaan.editorOpen()), true);
      await p.locator('#beat').waitFor({ state: 'visible' });
      // Opening is a gesture, so it is allowed to start the AudioContext.
      // If a headless Chromium ever refuses to resume, this is the assertion
      // that will say so rather than something downstream failing obscurely.
      await p.waitForFunction(() => window.__hendriklaan.audioMode() === 'tone',
        null, { timeout: 8000 });
      await p.click('#beat-close');
      assert.equal(await hl(() => window.__hendriklaan.editorOpen()), false);
      // Closing the panel leaves the source where it is.
      assert.equal(await hl(() => window.__hendriklaan.audioMode()), 'tone');
    });

    await test('the grid draws the built-in pattern as ghosts under the edited one', async () => {
      await hl(() => window.__hendriklaan.resetPattern());
      await p.click('#beat-open');
      const cls = (lane, step) =>
        p.locator(`#beat-grid .cell[data-lane="${lane}"][data-step="${step}"]`).getAttribute('class');

      // Untouched: the built-in hits are solid, everything else is empty.
      assert.match(await cls('kick', 0), /\bon\b/);
      assert.match(await cls('kick', 8), /\bon\b/);
      assert.doesNotMatch(await cls('kick', 3), /\bon\b|\bghost\b/);
      assert.equal(await p.locator('#beat-diff').textContent(), 'unchanged');

      // Add a hit and remove one: added gets its own mark, removed leaves a ghost.
      await p.locator('#beat-grid .cell[data-lane="kick"][data-step="3"]').click();
      await p.locator('#beat-grid .cell[data-lane="kick"][data-step="8"]').click();
      assert.match(await cls('kick', 3), /\badded\b/);
      assert.match(await cls('kick', 8), /\bghost\b/);
      assert.doesNotMatch(await cls('kick', 8), /\bon\b/);
      assert.match(await p.locator('#beat-diff').textContent(), /2 changes/);
      assert.equal(await hl(() => window.__hendriklaan.pattern().kick), 0x0009);

      await p.click('#beat-reset');
      assert.equal(await hl(() => window.__hendriklaan.pattern().kick), 0x0101);
      assert.equal(await p.locator('#beat-diff').textContent(), 'unchanged');
    });

    await test('the note row cycles the pool in both directions', async () => {
      const cell = p.locator('#beat-notes .note[data-bar="0"]');
      assert.equal((await cell.textContent()).trim(), 'E3');
      await cell.click();
      assert.equal((await cell.textContent()).trim(), 'F3');
      await cell.click({ modifiers: ['Shift'] });
      await cell.click({ modifiers: ['Shift'] });
      assert.equal((await cell.textContent()).trim(), 'D3');
      assert.equal(await hl(() => window.__hendriklaan.pattern().notes[0]), 1);
      await p.click('#beat-reset');
    });

    await test('clear empties every lane and reset puts the tune back', async () => {
      await p.click('#beat-clear');
      const p1 = await hl(() => window.__hendriklaan.pattern());
      assert.deepEqual([p1.kick, p1.bass, p1.hat], [0, 0, 0]);
      assert.equal(p1.bpm, 96, 'clear should empty the lanes, not reset the tempo');
      await p.click('#beat-reset');
      const p2 = await hl(() => window.__hendriklaan.pattern());
      assert.deepEqual([p2.kick, p2.bass, p2.hat], [0x0101, 0x1111, 0x5555]);
    });

    await test('the tempo and swing sliders reach the pattern', async () => {
      await p.fill('#beat-bpm', '140');
      await p.dispatchEvent('#beat-bpm', 'input');
      assert.equal(await hl(() => window.__hendriklaan.pattern().bpm), 140);
      assert.equal(await p.locator('#beat-bpm-v').textContent(), '140');
      await p.fill('#beat-swing', '50');
      await p.dispatchEvent('#beat-swing', 'input');
      assert.equal(await hl(() => window.__hendriklaan.pattern().swing), 0.5);
      assert.equal(await p.locator('#beat-swing-v').textContent(), '50%');
      await p.click('#beat-reset');
    });

    await test('the playhead follows the phase and freeze stops it', async () => {
      const at = () => p.locator('#beat-grid .tick.now').getAttribute('data-step');
      const a = await at();
      await p.waitForFunction((was) =>
        document.querySelector('#beat-grid .tick.now')?.dataset.step !== was, a, { timeout: 4000 });
      await hl(() => window.__hendriklaan.setFrozen(true));
      const b = await at();
      await p.waitForTimeout(900);
      assert.equal(await at(), b, 'the playhead kept moving while frozen');
      await hl(() => window.__hendriklaan.setFrozen(false));
      await p.click('#beat-close');
    });

    await test('b toggles the grid from the keyboard', async () => {
      await p.locator('canvas').click({ position: { x: 40, y: 500 } });
      await p.keyboard.press('b');
      assert.equal(await hl(() => window.__hendriklaan.editorOpen()), true);
      await p.keyboard.press('b');
      assert.equal(await hl(() => window.__hendriklaan.editorOpen()), false);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | grep -E "grid opens|ghosts|note row|clear empties|sliders reach|playhead|b toggles"`
Expected: all seven `FAIL`, the first reporting `window.__hendriklaan.editorOpen is not a function`.

- [ ] **Step 3a: Add the markup and CSS**

In `index.html`, add `<button id="beat-open">beat</button>` to the first `.row`, immediately after the `#audio` button:

```html
    <div class="row">
      <button id="audio">listen: field</button>
      <button id="beat-open">beat</button>
      <button id="colour">colour: height</button>
```

Replace the `#hint` block with:

```html
  <div id="hint">
    drag = orbit · wheel = dolly<br />
    a = audio source · b = beat editor · c = colour · o = ortho<br />
    space = freeze · s = png ×3 · h = hide
  </div>
```

Add the panel immediately after the `#hint` block:

```html
  <div id="beat" hidden>
    <div class="bhead"><span>beat</span><button id="beat-close" title="close">×</button></div>
    <div id="beat-grid"></div>
    <div id="beat-notes"></div>
    <div class="brow"><span class="blab">pad</span><span class="padbar"><i id="beat-pad"></i></span><span class="bnote">free</span></div>
    <label class="brow"><span class="blab">bpm</span><input id="beat-bpm" type="range" min="40" max="200" step="1" value="96" /><span class="bval" id="beat-bpm-v">96</span></label>
    <label class="brow"><span class="blab">swing</span><input id="beat-swing" type="range" min="0" max="75" step="1" value="0" /><span class="bval" id="beat-swing-v">0%</span></label>
    <div class="blegend"><b class="k on"></b> yours <b class="k ghost"></b> built-in · <span id="beat-diff">unchanged</span></div>
    <div class="brow bbtns"><button id="beat-clear">clear</button><button id="beat-reset">reset</button><button id="beat-link">link</button></div>
    <div id="beat-mic">the room is driving the bands</div>
  </div>
```

Add to the `<style>` block, after the `#bands` rules:

```css
    /* The editor sits where the key hints do, and hides them while it is open:
       nobody reads a legend and edits at the same time, and the corner is the
       only place wide enough for sixteen columns that is not already taken. */
    #beat { position: fixed; top: 1rem; right: 1rem; z-index: 4; width: 20rem;
            background: #17171cf2; border: 1px solid #2c2c34; border-radius: 8px;
            padding: 0.55rem 0.7rem 0.6rem; display: flex; flex-direction: column; gap: 0.4rem; }
    #beat[hidden] { display: none; }
    #beat .bhead { display: flex; justify-content: space-between; align-items: center;
                   color: #8a877e; font-size: 11px; letter-spacing: 0.08em; }
    #beat .bhead button { padding: 0 0.35rem; line-height: 1.2; font-size: 13px; }

    #beat-grid { display: grid; grid-template-columns: 2.2rem repeat(16, 1fr); gap: 2px; align-items: center; }
    #beat-grid .lab { font-size: 10px; color: #8a877e; }
    #beat-grid .tick { height: 5px; border-radius: 1px; background: #1e1e25; }
    #beat-grid .tick.beat { background: #2c2c34; }
    #beat-grid .tick.now { background: #e0a316; }
    /* Four states, and the two that matter are the diff: a cell you added
       carries an accent, a built-in hit you removed stays on screen as an
       outline. The original is never more than a glance away. */
    #beat-grid .cell { height: 15px; padding: 0; border-radius: 2px; cursor: pointer;
                       background: #1e1e25; border: 1px solid transparent; }
    #beat-grid .cell.q { background: #23232b; }
    #beat-grid .cell.on { background: #7fb3a3; }
    #beat-grid .cell.added { background: #7fb3a3; border-color: #e0a316; }
    #beat-grid .cell.ghost { background: transparent; border: 1px dashed #4a4a55; }
    #beat-grid .cell:hover { border-color: #7fb3a3; }

    #beat-notes { display: grid; grid-template-columns: 2.2rem repeat(4, 1fr); gap: 2px; align-items: center; }
    #beat-notes .lab { font-size: 10px; color: #8a877e; }
    #beat-notes .note { font-size: 11px; padding: 0.15rem 0; }
    #beat-notes .note.moved { border-color: #e0a316; }

    #beat .brow { display: flex; gap: 0.4rem; align-items: center; }
    #beat .blab { font-size: 10px; color: #8a877e; width: 2.2rem; }
    #beat .bval { font-size: 10px; color: #e8e6e0; min-width: 2.2rem; text-align: right; }
    #beat .bnote { font-size: 10px; color: #555350; }
    #beat .brow input[type=range] { flex: 1; width: auto; }
    #beat .padbar { flex: 1; height: 4px; background: #26262e; border-radius: 2px; overflow: hidden; }
    #beat .padbar i { display: block; height: 100%; width: 0%; background: #7fb3a3; }
    #beat .bbtns button { flex: 1; font-size: 11px; padding: 0.25rem 0; }
    #beat .blegend { font-size: 10px; color: #8a877e; display: flex; gap: 0.3rem; align-items: center; }
    #beat .blegend .k { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
    #beat .blegend .k.on { background: #7fb3a3; }
    #beat .blegend .k.ghost { border: 1px dashed #4a4a55; }

    /* In mic mode the pattern is still there, it is just not what the bands
       are listening to. Saying so beats letting the grid look broken. */
    #beat-mic { display: none; font-size: 10px; color: #e0a316; }
    #beat.inert #beat-mic { display: block; }
    #beat.inert #beat-grid, #beat.inert #beat-notes { opacity: 0.35; }

    @media (max-width: 720px) {
      #meta, #hint { display: none; }
      #beat { top: 0; right: 0; left: 0; width: auto; border-radius: 0; border-width: 0 0 1px; }
    }
```

Delete the now-duplicated `@media (max-width: 720px) { #meta, #hint { display: none; } }` rule that was already there.

- [ ] **Step 3b: Write `mountEditor`**

Append to `sketches/2026-08-hendriklaan/beat.js`:

```js
// ---------------------------------------------------------------- the panel
// Everything below touches the DOM, and nothing above it does, which is what
// lets test.mjs import this module in plain node and check the arithmetic
// without a browser.

const NOTE_ROW = 4;

export function mountEditor(root, { pattern, onChange, onOpen }) {
  const grid = root.querySelector('#beat-grid');
  const noteRow = root.querySelector('#beat-notes');
  const diff = root.querySelector('#beat-diff');
  const padBar = root.querySelector('#beat-pad');
  const bpm = root.querySelector('#beat-bpm');
  const bpmV = root.querySelector('#beat-bpm-v');
  const swing = root.querySelector('#beat-swing');
  const swingV = root.querySelector('#beat-swing-v');

  // A playhead row, then one row a lane. The row of ticks doubles as the bar
  // ruler: every fourth is brighter, so you can count beats without labels.
  const ticks = [];
  grid.append(cellEl('div', 'lab', ''));
  for (let i = 0; i < STEPS; i++) {
    const t = cellEl('div', 'tick' + (i % 4 ? '' : ' beat'), '');
    t.dataset.step = String(i);
    ticks.push(t);
    grid.append(t);
  }
  const cells = [];
  for (const lane of LANES) {
    grid.append(cellEl('div', 'lab', lane));
    for (let i = 0; i < STEPS; i++) {
      const c = cellEl('button', 'cell', '');
      c.type = 'button';
      c.dataset.lane = lane;
      c.dataset.step = String(i);
      cells.push(c);
      grid.append(c);
    }
  }

  noteRow.append(cellEl('div', 'lab', 'bars'));
  const noteCells = [];
  for (let b = 0; b < NOTE_ROW; b++) {
    const n = cellEl('button', 'note', '');
    n.type = 'button';
    n.dataset.bar = String(b);
    noteCells.push(n);
    noteRow.append(n);
  }

  function cellEl(tag, cls, text) {
    const e = document.createElement(tag);
    e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function repaint() {
    for (const c of cells) {
      const bit = 1 << +c.dataset.step;
      const mine = !!(pattern[c.dataset.lane] & bit);
      const orig = !!(DEFAULT[c.dataset.lane] & bit);
      c.className = 'cell'
        + (mine ? ' on' : '')
        + (mine && !orig ? ' added' : '')
        + (!mine && orig ? ' ghost' : '')
        + (!mine && !orig && +c.dataset.step % 4 === 0 ? ' q' : '');
    }
    for (const n of noteCells) {
      const b = +n.dataset.bar;
      n.textContent = NOTES[pattern.notes[b]].name;
      n.className = 'note' + (pattern.notes[b] === DEFAULT.notes[b] ? '' : ' moved');
    }
    bpm.value = String(pattern.bpm);
    bpmV.textContent = String(pattern.bpm);
    swing.value = String(Math.round(pattern.swing * 100));
    swingV.textContent = Math.round(pattern.swing * 100) + '%';
    const n = changes(pattern);
    diff.textContent = n === 0 ? 'unchanged' : n === 1 ? '1 change' : `${n} changes`;
  }

  const changed = () => { repaint(); onChange(); };

  // Drag paints. A sixteen-step grid one click at a time is tedious, and the
  // value is taken from the first cell so a drag either fills or clears — it
  // does not toggle each cell it crosses into whatever it was not.
  let paint = null;
  const apply = (c) => {
    const bit = 1 << +c.dataset.step;
    const now = !!(pattern[c.dataset.lane] & bit);
    if (now === paint) return;
    pattern[c.dataset.lane] = paint ? pattern[c.dataset.lane] | bit : pattern[c.dataset.lane] & ~bit;
    changed();
  };
  grid.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.cell');
    if (!c) return;
    e.preventDefault();
    paint = !(pattern[c.dataset.lane] & (1 << +c.dataset.step));
    apply(c);
    grid.setPointerCapture(e.pointerId);
  });
  grid.addEventListener('pointermove', (e) => {
    if (paint === null) return;
    // The pointer is captured by the grid, so e.target is the grid itself and
    // hit-testing has to be done by hand.
    const c = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.cell');
    if (c && grid.contains(c)) apply(c);
  });
  const stop = () => { paint = null; };
  grid.addEventListener('pointerup', stop);
  grid.addEventListener('pointercancel', stop);

  noteRow.addEventListener('click', (e) => {
    const n = e.target.closest('.note');
    if (!n) return;
    const b = +n.dataset.bar;
    const d = e.shiftKey ? NOTES.length - 1 : 1;
    pattern.notes[b] = (pattern.notes[b] + d) % NOTES.length;
    changed();
  });

  bpm.addEventListener('input', () => { pattern.bpm = +bpm.value; changed(); });
  swing.addEventListener('input', () => { pattern.swing = +swing.value / 100; changed(); });

  let open = false;
  const hint = document.getElementById('hint');
  const api = {
    isOpen: () => open,
    open: () => {
      if (open) return;
      open = true;
      root.hidden = false;
      if (hint) hint.style.display = 'none';
      repaint();
      onOpen();
    },
    close: () => {
      open = false;
      root.hidden = true;
      if (hint) hint.style.display = '';
    },
    toggle: () => (open ? api.close() : api.open()),
    repaint,
    // Called once a frame. Cheap: one class swap when the sixteenth changes,
    // one width. Repainting 48 cells every frame to move a playhead would be
    // the most expensive thing on the page.
    draw(beats, pad, inert) {
      if (!open) return;
      const i = Math.floor(((beats % 4) + 4) % 4 * 4);
      if (i !== api._at) {
        ticks[api._at]?.classList.remove('now');
        ticks[i].classList.add('now');
        api._at = i;
      }
      padBar.style.width = (pad * 100).toFixed(0) + '%';
      root.classList.toggle('inert', inert);
    },
    _at: -1,
  };
  repaint();
  return api;
}
```

- [ ] **Step 3c: Wire it into the sketch**

In `sketch.js`, extend the import (added in Task 3):

```js
import { DEFAULT, NOTES, changes, clone, mountEditor, sequence } from './beat.js';
```

After `syncButtons();` in the UI section (`sketch.js:701`), mount it:

```js
  const editor = mountEditor($('beat'), {
    pattern,
    onChange: () => {},                 // the hash is wired in the next task
    // Opening the panel is a gesture, so it is allowed to start the audio.
    // Editing a beat you cannot hear is a worse default than a page that
    // starts making noise when you ask it for a beat editor.
    onOpen: async () => { if (audio.mode === 'field') await cycleAudioTo('tone'); },
  });
  $('beat-open').onclick = () => editor.toggle();
  $('beat-close').onclick = () => editor.close();
  $('beat-clear').onclick = () => {
    pattern.kick = pattern.bass = pattern.hat = 0;
    editor.repaint();
  };
  $('beat-reset').onclick = () => {
    Object.assign(pattern, clone(DEFAULT));
    editor.repaint();
  };
```

`cycleAudio` currently steps to the *next* source. Add a sibling that goes to a named one, and rewrite `cycleAudio` in terms of it, replacing `sketch.js:683-691`:

```js
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
```

Add `b` to the keydown handler (`sketch.js:660`), immediately after the `a` case:

```js
    if (k === 'a') cycleAudio();
    else if (k === 'b') editor.toggle();
```

In `frame()`, drive the panel once a frame, immediately after the band-meter loop:

```js
    for (let i = 0; i < 4; i++) $('b' + i).style.width = (audio.bands[i] * 100).toFixed(0) + '%';
    editor.draw(view.beats, audio.bands[2], audio.mode === 'mic');
```

Add the two probes to `window.__hendriklaan`, after `resetPattern`:

```js
    editorOpen: () => editor.isOpen(),
    toggleEditor: () => editor.toggle(),
```

Note that `mountEditor` is called after `syncButtons()` but the keydown handler above references `editor` — that handler only runs on a real keypress, long after `main()` has finished, so the `const` is initialised by then.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -30`
Expected: `0 failed`.

If `the grid opens closed, and opening it turns the sound on` times out on the `audioMode() === 'tone'` wait, headless Chromium is refusing to resume the `AudioContext`. In that case — and only then — relaunch the browser with `chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })` at `test.mjs:50` and re-run. Record the reason in a comment beside the flag.

- [ ] **Step 5: Check it by eye**

Run: `npm run dev`, open `http://localhost:5173/sketches/2026-08-hendriklaan/`, press `b`.
Confirm: the panel is top-right and the key hints are gone; the playhead steps through sixteen ticks; clicking a cell changes the sound; dragging across a lane fills it; `clear` stops the street dead with the points on their surveyed positions; `reset` brings the tune back; pressing `a` twice to reach `mic` dims the grid and shows the mic line.

- [ ] **Step 6: Commit**

```bash
git add sketches/2026-08-hendriklaan/beat.js sketches/2026-08-hendriklaan/sketch.js \
        sketches/2026-08-hendriklaan/index.html test.mjs
git commit -m "feat(hendriklaan): a grid in the corner you can play the street with

Sixteen steps across three lanes, a four-cell note row, tempo and swing.
The built-in pattern stays on screen underneath as dashed outlines, so a
hit you removed is still visible and the original is never more than a
glance away. Opening the panel is a gesture, so it starts the audio."
```

---

### Task 5: Persist to the hash

**Files:**
- Modify: `sketches/2026-08-hendriklaan/sketch.js` (`onChange`, load-time restore, `#beat-link`)
- Test: `test.mjs` hendriklaan block

**Interfaces:**
- Consumes: `encode`, `decode`, `same` from Task 2; `mountEditor`'s `onChange` and `repaint` from Task 4.
- Produces: no new probes — the hash is observable through `location.hash`.

- [ ] **Step 1: Write the failing test**

Add to the hendriklaan block, after the keyboard test. The last two need their own page, since a hash is only read at load:

```js
    await test('the default page writes no hash at all', async () => {
      await hl(() => window.__hendriklaan.resetPattern());
      await p.click('#beat-open');
      await p.click('#beat-close');
      await p.waitForTimeout(500);
      assert.equal(await p.evaluate(() => location.hash), '',
        'an untouched page put a pattern in the URL');
    });

    await test('editing writes a hash, and returning to the built-in tune strips it', async () => {
      await p.click('#beat-open');
      await p.locator('#beat-grid .cell[data-lane="hat"][data-step="1"]').click();
      await p.waitForFunction(() => location.hash.length > 0, null, { timeout: 3000 });
      assert.match(await p.evaluate(() => location.hash), /^#b=[0-9a-f]{12}&n=\d{4}&t=\d+&s=\d+$/);
      // The hat lane gains bit 1: 0x5555 -> 0x5557.
      assert.match(await p.evaluate(() => location.hash), /^#b=010111115557&/);
      await p.click('#beat-reset');
      await p.waitForFunction(() => location.hash === '', null, { timeout: 3000 });
      await p.click('#beat-close');
    });

    await test('a link carries the pattern, and arriving on one opens the grid', async () => {
      const q = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      await q.goto(`${HENDRIKLAAN}#b=0001000f5555&n=6543&t=140&s=25`, { waitUntil: 'networkidle' });
      await q.waitForFunction(() => window.__hendriklaan?.state().revealed >= 1, null, { timeout: 15000 });
      const pat = await q.evaluate(() => window.__hendriklaan.pattern());
      assert.equal(pat.kick, 0x0001);
      assert.equal(pat.bass, 0x000f);
      assert.equal(pat.hat, 0x5555);
      assert.deepEqual(pat.notes, [6, 5, 4, 3]);
      assert.equal(pat.bpm, 140);
      assert.equal(pat.swing, 0.25);
      assert.equal(await q.evaluate(() => window.__hendriklaan.editorOpen()), true);
      await q.close();
    });

    await test('an unreadable link falls back to the built-in tune and says so', async () => {
      const q = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      const oops = [];
      q.on('pageerror', (e) => oops.push(e.message));
      await q.goto(`${HENDRIKLAAN}#b=zzzz&n=99`, { waitUntil: 'networkidle' });
      await q.waitForFunction(() => window.__hendriklaan?.state().revealed >= 1, null, { timeout: 15000 });
      const pat = await q.evaluate(() => window.__hendriklaan.pattern());
      assert.equal(pat.kick, 0x0101);
      assert.equal(pat.bass, 0x1111);
      assert.equal(pat.hat, 0x5555);
      assert.equal(pat.bpm, 96);
      assert.match(await q.locator('#note').textContent(), /built-in/);
      assert.deepEqual(oops, [], `a bad hash threw: ${oops.join('; ')}`);
      await q.close();
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | grep -E "no hash at all|strips it|carries the pattern|unreadable link"`
Expected: `editing writes a hash…` FAILs on the `waitForFunction` timeout; `a link carries the pattern…` FAILs asserting `257 !== 1`; `an unreadable link…` FAILs on the `#note` match.

- [ ] **Step 3: Write the implementation**

In `sketch.js`, extend the import once more:

```js
import { DEFAULT, NOTES, changes, clone, decode, encode, mountEditor, same, sequence } from './beat.js';
```

Replace the `const pattern = clone(DEFAULT);` line from Task 3 with the restore:

```js
  // A hash is only read here, at load. Anything malformed is refused whole —
  // half-reading it would hand someone a tune that is neither the one they
  // were sent nor the built-in one, with nothing on screen to say which.
  const fromLink = location.hash ? decode(location.hash) : null;
  const badLink = Boolean(location.hash) && !fromLink;
  const pattern = fromLink || clone(DEFAULT);
  const audio = new Listener(pattern);
```

Replace the `onChange: () => {}` placeholder in the `mountEditor` call with the debounced writer, defining it just above the call:

```js
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
    onOpen: async () => { if (audio.mode === 'field') await cycleAudioTo('tone'); },
  });
```

The two panel buttons wired in Task 4 mutate the pattern outside `mountEditor`, so they must write the hash too:

```js
  $('beat-clear').onclick = () => {
    pattern.kick = pattern.bass = pattern.hat = 0;
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
      // Clipboard access is origin- and permission-gated, and a page that
      // silently does nothing is worse than one that hands you the text.
      note(url);
    }
  };
```

Finally, act on the restore at the end of `main()`, immediately before `requestAnimationFrame(frame);`:

```js
  if (fromLink) editor.open();
  if (badLink) note('unreadable pattern in that link — showing the built-in one');
```

Also make `setPattern` keep the hash honest, since the tests in Task 3 use it — extend the probe:

```js
    setPattern: (partial) => {
      Object.assign(pattern, partial);
      if (partial.notes) pattern.notes = [...partial.notes];
      editor.repaint();
      writeHash();
    },
    resetPattern: () => { Object.assign(pattern, clone(DEFAULT)); editor.repaint(); writeHash(); },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -30`
Expected: `0 failed`. `the default page writes no hash at all` is the one that protects the thumbnail grabber.

- [ ] **Step 5: Commit**

```bash
git add sketches/2026-08-hendriklaan/sketch.js test.mjs
git commit -m "feat(hendriklaan): a beat you can send someone

The pattern rides in the hash, written through replaceState so a drag does
not bury the back button, and stripped entirely once the pattern is the
built-in one again — which keeps the canonical URL clean and means the
thumbnail grabber never sees one."
```

---

### Task 6: Prose, metadata, and a build

**Files:**
- Modify: `sketches/2026-08-hendriklaan/meta.json`
- Modify: `sketches/2026-08-hendriklaan/sketch.js` (header comment)
- Modify: `README.md` (only if it describes this sketch)

**Interfaces:**
- Consumes: everything.
- Produces: nothing.

- [ ] **Step 1: Extend the sketch's header comment**

The header at `sketch.js:1-39` explains what the audio does to the geometry and states two decisions. Add a third, after the paragraph beginning "The noise is simplex":

```js
// The tune is editable and the survey is not. That asymmetry is the point.
// Every control on the page that touches the geometry — gain, point size,
// projection, colour — changes how the measurement is *drawn*; the beat editor
// changes what it is *answering to*, and nothing anywhere changes where a
// point is. Empty all three lanes and the block does not go still gradually,
// it goes still exactly, because with no band energy the displacement term is
// identically zero. That is the same claim the sketch opens with, made
// clickable rather than argued.
```

- [ ] **Step 2: Update the description**

In `meta.json`, extend `description` — keep `tags` as they are, since `audio` already covers it:

```json
  "description": "240 metres of Utrecht around Prins Hendriklaan 17, cut out of the AHN5 LiDAR survey and played by ear. The survey's own classification splits the street three ways, so ground answers the sub, canopy the mids, roofs the highs — and silence puts every point back exactly where it was measured. The beat driving it is a sixteen-step grid you can edit in the corner and send to someone in a link.",
```

- [ ] **Step 3: Update the README if it lists this sketch**

Run: `grep -n "hendriklaan" README.md`
If there is an entry describing the sketch or its keys, add `b` to the key list and mention the editable beat in the same register as the neighbouring entries. If `grep` finds nothing, skip this step.

- [ ] **Step 4: Run the full suite and build**

```bash
npm test
npm run build
```
Expected: `0 failed` from the suite, and a clean Vite build listing `sketches/2026-08-hendriklaan/index.html` among its inputs with no warnings about `beat.js`.

- [ ] **Step 5: Confirm the thumbnail is unaffected**

```bash
npm run thumbs
git status --short public/sketches/2026-08-hendriklaan/
```
Expected: the grabber waits 1500 ms and screenshots a page with no hash, so the panel is closed and the framing is unchanged. A regenerated thumbnail differing only by the usual frame-timing noise is fine; a thumbnail with a panel in the corner is a bug — the panel's `hidden` attribute is not being honoured.

- [ ] **Step 6: Commit**

```bash
git add sketches/2026-08-hendriklaan/meta.json sketches/2026-08-hendriklaan/sketch.js README.md
git commit -m "docs(hendriklaan): say what the editor is for

The sketch opens by claiming the rest state is the truth. The editor makes
that claim clickable instead of argued, and the header now says so."
```

---

## Self-Review

**Spec coverage.** Pattern model and masks → Task 1. Generalised step lookup and the clock split → Task 1 and Task 3. Hash codec and its validation table → Task 2. Panel layout, ghosts, drag-paint, note cycling, playhead, freeze, mic-inert, mobile → Task 4. Persistence, load-time restore, malformed fallback, clipboard fallback → Task 5. Prose, metadata → Task 6. All seven spec test cases appear: 1 → *the default page writes no hash at all*; 2 → *editing writes a hash…* plus the node round-trip; 3 → *a link carries the pattern…*; 4 and 5 → *the pattern reaches the geometry…*; 6 → *an unreadable link…*; 7 → the existing eight, re-run at every task.

**One correction to the spec.** The spec's `since()` sketch returns on the first set bit found walking backwards. That is wrong once swing is non-zero — a swung step that has not arrived yet reads as a full bar old and shadows an earlier step that genuinely fired. Task 1 scans all sixteen and takes the smallest non-negative distance instead, and the *swing delays the offbeats* test covers the case.

**Naming.** `pattern` is the live mutable object throughout; `DEFAULT` is frozen and never mutated (Task 2 tests that a decoded pattern is detached). `repaint()` is the editor's redraw and `draw()` is its per-frame tick — used consistently in Tasks 4 and 5. `cycleAudioTo(mode)` is introduced in Task 4 and reused in Task 5.

**Load order.** `mountEditor` is called during `main()`, after the audio and pattern exist and before the first `requestAnimationFrame`; `frame()` calls `editor.draw`, and `editor.draw` returns immediately when the panel is closed.
