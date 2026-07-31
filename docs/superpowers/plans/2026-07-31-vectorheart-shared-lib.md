# Vectorheart Shared Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the duplicated HUD, type, export and page-chrome code from
`2026-07-inconstructions` and `2026-07-splinter` into `sketches/_lib/`, with no
change to a single rendered pixel.

**Architecture:** Five flat ES modules under `sketches/_lib/`, imported
relatively. They supply drawing primitives and plumbing; each sketch keeps its
own `new p5(...)` and `p.draw`. Colour never lives in the library — every
sketch passes a `theme` object in, which is what lets both keep their exact
current appearance while sharing the code that draws it.

**Tech Stack:** Vanilla ES modules, p5 1.11, Vite 6, Playwright 1.62 (already a
devDependency), plain `node:assert` — no test framework, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-31-vectorheart-shared-lib-design.md`

## Global Constraints

- **No new dependencies.** `package.json` gains scripts only.
- **Pixel-identical.** Every task must leave both sketches rendering byte-identical
  screenshots. `node scripts/pixels.js` (built in Task 1) is the gate.
- **`(g, k)` convention.** Every library drawing function takes the graphics
  target first and the scale factor second: `fn(g, k, ...)`. `k` is `1` on
  screen and `3` in a PNG export. Never read a module-level `scale` inside the
  library.
- **Theme shape.** `{ ink, paper, accent, onAccent, muted }` — all CSS colour
  strings. The library defines no colours of its own.
- **Reserved keys.** `s`=PNG, `z`=UNDO, `y`=REDO, `c`=CLEAR, `space`=NEW,
  `?`=HELP. Both sketches already satisfy this; no binding moves.
- **Module style.** Match the existing files: `// ---- section` rules, comments
  that explain *why*, no semicolonless style, 2-space indent, single quotes.
- **Commit after every task**, message in the repo's existing form
  (`feat(lib): …`, `refactor(splinter): …`, `test: …`, `docs: …`).

## A correction to the spec

The spec says a changed `thumb.png` proves the refactor changed something. That
holds for inconstructions, whose opening assembly is a fixed sequence, but
**not** for splinter: `p.setup` calls `generate(Math.floor(p.random(1, 4294967295)) >>> 0)`,
so every load is a different composition and `npm run thumbs` produces a
different image every time. Task 1 fixes this by giving splinter a `?seed=`
URL parameter and building a deterministic capture harness. The thumbnails
remain a coarse net; `scripts/pixels.js` is the real one.

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `scripts/pixels.js` | Deterministic screenshot capture + baseline comparison |
| `sketches/_lib/type.js` | Letterspaced type, title block, readout column, registration marks, footer |
| `sketches/_lib/panel.js` | Button style, button drawing, hit layer, strip/stack layout |
| `sketches/_lib/keys.js` | Reserved key table, key registry, hint line, `?` overlay |
| `sketches/_lib/export.js` | 3x PNG export lifecycle |
| `sketches/_lib/probe.js` | `window.__<name>` test seam + `buttonAt` |
| `sketches/_lib/chrome.css` | Page reset and back-link, driven by CSS custom properties |
| `.pixels/` | Gitignored baseline screenshots (local to one machine) |

**Modified:** both sketches' `sketch.js` and `index.html`, `test.mjs`,
`package.json`, `.gitignore`, `sketches/_template/*`, `README.md`.

---

### Task 1: Deterministic pixel-regression harness

Nothing else in this plan is safe without this. It also adds `?seed=` to
splinter, which is a real feature — the sketch already prints its seed as the
thing that reproduces a composition, and this makes that claim actionable.

**Files:**
- Create: `scripts/pixels.js`
- Modify: `sketches/2026-07-splinter/sketch.js:1091-1095` (`p.setup`)
- Modify: `package.json` (scripts), `.gitignore`
- Test: `test.mjs` (new splinter seed test)

**Interfaces:**
- Consumes: nothing.
- Produces: `node scripts/pixels.js [--update]`, exit 0 on match. Every later
  task runs it. Splinter accepts `?seed=<hex>`.

- [ ] **Step 1: Write the failing test**

In `test.mjs`, inside the splinter section (after the existing
`'splinter loads and settles without errors'` test), add:

```js
  await test('a seed in the URL reproduces an exact composition', async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`${SPLINTER}?seed=1234abcd`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    assert.equal(await state(page, () => window.__splinter.seed()), 0x1234abcd);
    await page.close();
  });

  await test('a nonsense seed falls back to a random one rather than breaking', async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`${SPLINTER}?seed=nonsense`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    assert.ok(await state(page, () => window.__splinter.seed()) > 0);
    assert.deepEqual(page.errors ?? [], []);
    await page.close();
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL — `Expected values to be strictly equal` with a random seed on
the left, because nothing reads the URL yet.

- [ ] **Step 3: Implement the minimal code to make the test pass**

In `sketches/2026-07-splinter/sketch.js`, immediately above `new p5((p) => {`:

```js
// The poster prints its seed because the seed is the composition. Accepting one
// back through the URL is what makes that promise true — and it is what lets a
// screenshot test capture the same image twice.
function seedFromUrl() {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search).get('seed');
  if (!q) return null;
  const n = Number.parseInt(q, 16);
  return Number.isFinite(n) && n > 0 ? n >>> 0 : null;
}
```

Then change `p.setup`'s last line from:

```js
    generate(Math.floor(p.random(1, 4294967295)) >>> 0, {});
```

to:

```js
    generate(seedFromUrl() ?? (Math.floor(p.random(1, 4294967295)) >>> 0), {});
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS, and every pre-existing test still passes.

- [ ] **Step 5: Write the capture harness**

Create `scripts/pixels.js`:

```js
// Pixel-regression net for the Vectorheart shared-library refactor. Captures
// each sketch at a fixed viewport, seed and settle point, and compares the PNG
// against a baseline taken before the refactor began.
//
//   node scripts/pixels.js --update   capture or overwrite the baselines
//   node scripts/pixels.js            compare against them
//
// Baselines live in .pixels/ and are deliberately NOT committed: they are
// specific to one Chromium build and one machine. They exist to prove that a
// particular refactor moved no pixels, not to be a permanent fixture.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, '.pixels');
const PORT = 5179;
const BASE = `http://localhost:${PORT}`;
const VIEWPORT = { width: 1200, height: 900 };
const update = process.argv.includes('--update');

// Each target has to reach a state that is a pure function of its inputs: the
// demo finished, or the seeded composition fully revealed and not in motion.
const TARGETS = [
  {
    slug: 'inconstructions',
    url: '/sketches/2026-07-inconstructions/',
    ready: (p) => p.waitForFunction(
      () => window.__inconstructions && window.__inconstructions.demoDone() === true,
      null, { timeout: 20000 }),
  },
  {
    slug: 'splinter',
    url: '/sketches/2026-07-splinter/?seed=1234abcd',
    ready: (p) => p.waitForFunction(
      () => window.__splinter && window.__splinter.settled() === true,
      null, { timeout: 20000 }),
  },
];

async function waitForServer(url, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`dev server never came up at ${url}`);
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore', detached: false });
const browser = await chromium.launch();
let failed = 0;

try {
  await waitForServer(BASE);
  mkdirSync(OUT, { recursive: true });

  for (const t of TARGETS) {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    await page.goto(BASE + t.url, { waitUntil: 'networkidle' });
    await t.ready(page);
    // inconstructions tracks the pointer, so park it somewhere fixed before
    // capturing or the hover highlight lands wherever the last test left it.
    await page.mouse.move(2, 2);
    await page.waitForTimeout(600);
    const shot = await page.screenshot({ type: 'png' });
    await page.close();

    const baseline = resolve(OUT, `${t.slug}.png`);
    if (update || !existsSync(baseline)) {
      writeFileSync(baseline, shot);
      console.log(`  base ${t.slug}  (${shot.length} bytes)`);
      continue;
    }
    const want = readFileSync(baseline);
    if (want.equals(shot)) {
      console.log(`  ok   ${t.slug}`);
    } else {
      failed++;
      const actual = resolve(OUT, `${t.slug}.actual.png`);
      writeFileSync(actual, shot);
      console.log(`  DIFF ${t.slug}  baseline ${want.length}B vs ${shot.length}B`);
      console.log(`       wrote ${actual} — open both to see what moved`);
    }
  }
} finally {
  await browser.close();
  server.kill();
}

if (failed) { console.log(`\n${failed} sketch(es) changed`); process.exit(1); }
console.log('\nno pixels moved');
```

- [ ] **Step 6: Wire it up**

In `package.json`, add to `scripts`:

```json
    "pixels": "node scripts/pixels.js",
```

In `.gitignore`, add:

```
.pixels/
```

- [ ] **Step 7: Capture the baselines and prove the harness detects a change**

Run: `npm run pixels -- --update`
Expected: `base inconstructions` and `base splinter`, two files in `.pixels/`.

Run: `npm run pixels`
Expected: `ok inconstructions`, `ok splinter`, `no pixels moved`, exit 0.

Now prove it is not vacuous. Temporarily change `sketches/2026-07-splinter/sketch.js`
line 879 from `spaced(g, '»SPLINTER', bx, by - 16 * k, 1.4 * k);` to
`spaced(g, '»SPLINTERX', bx, by - 16 * k, 1.4 * k);` and run `npm run pixels`.
Expected: `DIFF splinter`, exit 1. Revert the edit and confirm `ok` returns.

- [ ] **Step 8: Commit**

```bash
git add scripts/pixels.js package.json .gitignore test.mjs sketches/2026-07-splinter/sketch.js
git commit -m "test: deterministic pixel harness and a seed URL for splinter"
```

---

### Task 2: `_lib/type.js` — the letterspacing primitives

The smallest possible first cut of the library: two functions that are already
byte-identical in one sketch and near-identical in the other.

**Files:**
- Create: `sketches/_lib/type.js`
- Modify: `sketches/2026-07-inconstructions/sketch.js:475-488` (delete `spaced`, `spacedWidth`), `:18` (import)
- Modify: `sketches/2026-07-splinter/sketch.js:848-852` (delete `spaced`), `:22` (import)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `spaced(g, str, x, y, tracking) -> number` — draws `str` one glyph at a time
    with `tracking` extra pixels between glyphs; returns the advance width.
  - `spacedWidth(g, str, tracking) -> number` — the same width without drawing.

- [ ] **Step 1: Write the failing test**

Add to `test.mjs`, in the inconstructions section after the existing
`'the interface stays within a narrow viewport'` test:

```js
  await test('the shared type module measures what it draws', async () => {
    const p = await openSketch();
    const [drawn, measured] = await state(p, async () => {
      const m = await import('/sketches/_lib/type.js');
      const g = window.__inconstructions.graphics();
      g.textFont('monospace');
      g.textSize(12);
      return [m.spaced(g, 'ABCDE', 0, 20, 2), m.spacedWidth(g, 'ABCDE', 2)];
    });
    // spaced() advances past the final glyph; spacedWidth() stops at its edge.
    assert.ok(Math.abs(drawn - measured - 2) < 0.001,
      `spaced ${drawn} vs spacedWidth ${measured}`);
    await p.close();
  });
```

This needs a graphics handle on the probe. Add to
`sketches/2026-07-inconstructions/sketch.js`'s `window.__inconstructions` object:

```js
    // A scratch buffer so a test can exercise the shared type module against
    // the same p5 text metrics the sketch itself uses.
    graphics: () => P.createGraphics(200, 60),
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL — `Failed to fetch dynamically imported module: /sketches/_lib/type.js`.

- [ ] **Step 3: Implement the minimal code to make the test pass**

Create `sketches/_lib/type.js`:

```js
// Type for the Vectorheart sketches. Everything here draws into an arbitrary
// graphics target at an arbitrary scale, because the 3x PNG export is the same
// code path as the screen.
//
// p5 has no letterspacing, and letterspacing is most of the house style, so
// every string is drawn one glyph at a time.

// Draw `str` from (x, y) with `tracking` extra pixels after each glyph.
// Returns the total advance, including the trailing tracking.
export function spaced(g, str, x, y, tracking) {
  let cx = x;
  for (const ch of str) {
    g.text(ch, cx, y);
    cx += g.textWidth(ch) + tracking;
  }
  return cx - x;
}

// The width `spaced` would occupy, minus the trailing tracking — this is the
// number you centre with.
export function spacedWidth(g, str, tracking) {
  let w = 0;
  for (const ch of str) w += g.textWidth(ch) + tracking;
  return w - tracking;
}
```

- [ ] **Step 4: Port both sketches**

In `sketches/2026-07-inconstructions/sketch.js`: delete lines 475-488 (the local
`spaced` and `spacedWidth`) and add below the p5 import at line 18:

```js
import { spaced, spacedWidth } from '../_lib/type.js';
```

In `sketches/2026-07-splinter/sketch.js`: delete lines 848-852 (the local
`spaced`) and add below the p5 import at line 22:

```js
import { spaced, spacedWidth } from '../_lib/type.js';
```

Splinter does not use `spacedWidth` yet; Task 6 needs it. Import it now and
leave it — Vite tree-shakes the build, so an unused named import costs nothing.

- [ ] **Step 5: Run the tests and the pixel gate**

Run: `npm test`
Expected: PASS, including the new type test.

Run: `npm run pixels`
Expected: `ok inconstructions`, `ok splinter`, `no pixels moved`.

- [ ] **Step 6: Commit**

```bash
git add sketches/_lib/type.js sketches/2026-07-inconstructions/sketch.js sketches/2026-07-splinter/sketch.js test.mjs
git commit -m "refactor(lib): share the letterspacing primitives"
```

---

### Task 3: `_lib/type.js` — title block, readout, registration marks, footer

**Files:**
- Modify: `sketches/_lib/type.js`
- Modify: `sketches/2026-07-inconstructions/sketch.js` — `drawHud` title block and
  readout rows (currently `:509-546` before Task 2's deletions shift them)
- Modify: `sketches/2026-07-splinter/sketch.js` — `drawType` header (`:867-890`)
  and the footer line in `render` (`:1019-1027`)

**Interfaces:**
- Consumes: `spaced`, `spacedWidth` from Task 2.
- Produces:
  - `titleBlock(g, k, opts)` where `opts` is
    `{ x, y, title, titleSize, titleTracking, titleFont, sub, subSize, subTracking, subColor, subDy, rule, ruleColor, ruleDy, ruleWeight, theme }`
    and returns the rule width
  - `readout(g, k, opts)` where `opts` is `{ x, y, rows, gap, rowH, size, theme }`
  - `regMarks(g, k, w, h, opts)` where `opts` is `{ margin, arm, weight, theme }`
  - `footer(g, k, opts)` where `opts` is `{ x, y, text, size, tracking, theme }`

The option lists look long. They are long because the two headers genuinely
differ — inconstructions sets its subtitle in ink, splinter in muted grey;
inconstructions rules in ink, splinter in `#bdbdb6`. Defaults cover the common
case, and every option that exists exists because a real call site needs it.

- [ ] **Step 1: Write the failing test**

Add to `test.mjs` in the inconstructions section:

```js
  await test('the shared title block reports the width it ruled', async () => {
    const p = await openSketch();
    const w = await state(p, async () => {
      const m = await import('/sketches/_lib/type.js');
      const g = window.__inconstructions.graphics();
      g.textFont('monospace');
      return m.titleBlock(g, 1, {
        x: 10, y: 20, title: 'TEST', sub: 'SUB', rule: 120,
        theme: { ink: '#000', paper: '#fff', accent: '#f00', onAccent: '#fff', muted: '#888' },
      });
    });
    assert.equal(w, 120);
    await p.close();
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL — `m.titleBlock is not a function`.

- [ ] **Step 3: Implement the minimal code to make the test pass**

Append to `sketches/_lib/type.js`:

```js
// The poster header both sketches wear: a display title, a mono subtitle, and a
// hairline rule under them. Returns the rule width so a caller can lay content
// against it.
export function titleBlock(g, k, {
  x, y, title, sub, rule, theme,
  titleSize = 20, titleTracking = 2.4, titleFont = 'monospace',
  subSize = 8, subTracking = 1.6, subColor = null, subDy = 14,
  ruleColor = null, ruleDy = 20, ruleWeight = 1,
}) {
  g.push();
  g.textAlign(g.LEFT, g.BASELINE);
  g.noStroke();
  g.fill(theme.ink);
  g.textFont(titleFont);
  g.textSize(titleSize * k);
  spaced(g, title, x, y, titleTracking * k);
  if (sub) {
    g.textFont('monospace');
    g.textSize(subSize * k);
    g.fill(subColor ?? theme.muted);
    spaced(g, sub, x, y + subDy * k, subTracking * k);
  }
  if (rule) {
    g.stroke(ruleColor ?? theme.ink);
    g.strokeWeight(ruleWeight * k);
    g.line(x, y + ruleDy * k, x + rule * k, y + ruleDy * k);
  }
  g.pop();
  return rule ?? 0;
}

// A right-aligned label/value column — CELL, PARTS, BEARING and so on. `x` is
// the right edge that values flush to; labels flush to `x - gap`.
export function readout(g, k, { x, y, rows, theme, gap = 52, rowH = 13, size = 8 }) {
  g.push();
  g.noStroke();
  g.textFont('monospace');
  g.textAlign(g.RIGHT, g.BASELINE);
  g.textSize(size * k);
  rows.forEach(([label, value], i) => {
    const ry = y + i * rowH * k;
    g.fill(theme.muted);
    g.text(label, x - gap * k, ry);
    g.fill(theme.ink);
    g.text(value, x, ry);
  });
  g.pop();
}

// Corner registration ticks. Print-shop furniture that also does the honest job
// of showing where the frame is on any viewport.
export function regMarks(g, k, w, h, { theme, margin = 20, arm = 9, weight = 1 }) {
  const m = margin * k;
  const r = arm * k;
  g.push();
  g.stroke(theme.ink);
  g.strokeWeight(weight * k);
  for (const [cx, cy, sx, sy] of
    [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) {
    g.line(cx, cy, cx + sx * r, cy);
    g.line(cx, cy, cx, cy + sy * r);
  }
  g.pop();
}

// The SKETCHBOOK · SIEM2L.NL line. Small enough to inline, shared so that every
// sketch signs itself the same way.
export function footer(g, k, { x, y, text, theme, size = 7, tracking = 1.2 }) {
  g.push();
  g.noStroke();
  g.fill(theme.muted);
  g.textFont('monospace');
  g.textAlign(g.LEFT, g.BASELINE);
  g.textSize(size * k);
  spaced(g, text, x, y, tracking * k);
  g.pop();
}
```

- [ ] **Step 4: Port inconstructions**

Add near the other constants in `sketches/2026-07-inconstructions/sketch.js`,
under the `TONE` block:

```js
// The library takes colour as data so it can stay colour-blind. This sketch's
// palette is fixed; splinter's changes with its active palette.
const THEME = { ink: INK, paper: PAPER, accent: '#fabd2f', onAccent: INK, muted: '#8a8a80' };
```

Extend the import at the top:

```js
import { spaced, spacedWidth, titleBlock, readout, regMarks } from '../_lib/type.js';
```

In `drawHud`, replace the `// corner registration marks` block with:

```js
  regMarks(g, u, w, h, { theme: THEME, margin: 20 });
```

Replace the `// title block` block with:

```js
  titleBlock(g, u, {
    x: M + 14 * u, y: M + 20 * u,
    title: 'INCONSTRUCTIONS', titleSize: narrow ? 15 : 20, titleTracking: 2.4,
    sub: 'DELTA INC · MC-202 / Λ3', subColor: INK, subDy: 14,
    rule: narrow ? 176 : 246, ruleDy: 20,
    theme: THEME,
  });
```

The rule ran from `M + 14u` to `M + (narrow ? 190 : 260)u`, so its width is
`190 - 14 = 176` narrow and `260 - 14 = 246` wide. Check this against the
original line before deleting it.

Replace the `// readouts, top right` block (keep the `rows` array exactly as it
is) with:

```js
  readout(g, u, { x: w - M - 14 * u, y: M + 14 * u, rows, gap: 52, rowH: 13, size: 8, theme: THEME });
```

- [ ] **Step 5: Port splinter**

Add above `drawType` in `sketches/2026-07-splinter/sketch.js`:

```js
// Rebuilt each frame because the palette is a control, not a constant.
const theme = () => {
  const p = pal();
  return { ink: p.ink, paper: p.bg, accent: p.accent, onAccent: '#ffffff', muted: '#6d6d66' };
};
```

Extend the import:

```js
import { spaced, spacedWidth, titleBlock, footer } from '../_lib/type.js';
```

In `drawType`, replace everything from `g.textAlign(g.LEFT, g.BASELINE);` down to
`g.noStroke();` (the block that draws `»SPLINTER`, the parameter line and the
rule — lines 874-890) with:

```js
  titleBlock(g, k, {
    x: bx, y: by - 16 * k,
    title: '»SPLINTER', titleSize: 23, titleTracking: 1.4, titleFont: DISPLAY,
    sub: `${view().name} · ${MIXES[mixIx].name} · ${p.name} · ${cam.ortho ? 'ORTHO' : 'PERSP'} · ${seed.toString(16).toUpperCase().padStart(8, '0')}`,
    subSize: 7.2, subTracking: 0.9, subDy: 12,
    rule: bw, ruleColor: '#bdbdb6', ruleDy: 20,
    theme: theme(),
  });
```

The subtitle baseline was `by - 4 * k` against a title baseline of `by - 16 * k`,
so `subDy` is 12. The rule was at `by + 4 * k`, so `ruleDy` is 20.

`titleBlock` sets `g.textStyle` nowhere, and the original wrapped the title in
`g.textStyle(g.BOLD)`. Set it around the call:

```js
  g.textStyle(g.BOLD);
  titleBlock(g, k, { /* as above */ });
  g.textStyle(g.NORMAL);
```

This makes the subtitle bold too, which the original did not. To keep the
subtitle regular, split into two calls: one `titleBlock` with `sub: null` and
`rule: 0` inside the BOLD wrapper, and a second with `title: ''` for the
subtitle and rule. If the pixel gate in Step 6 shows a diff on splinter, this is
the cause.

In `render`, replace the footer block (lines 1019-1027) with:

```js
  footer(g, k, {
    x: 36 * k, y: h - 28 * k,
    text: `SKETCHBOOK · SIEM2L.NL · ${strokes.length} STROKE${strokes.length === 1 ? '' : 'S'}`,
    theme: theme(),
  });
```

- [ ] **Step 6: Run the tests and the pixel gate**

Run: `npm test`
Expected: PASS.

Run: `npm run pixels`
Expected: `no pixels moved`. If splinter diffs, open `.pixels/splinter.actual.png`
against `.pixels/splinter.png` — the likely cause is the bold subtitle described
in Step 5, or a rule width off by the margin arithmetic.

- [ ] **Step 7: Commit**

```bash
git add sketches/_lib/type.js sketches/2026-07-inconstructions/sketch.js sketches/2026-07-splinter/sketch.js test.mjs
git commit -m "refactor(lib): share the poster header, readout and registration marks"
```

---

### Task 4: `_lib/export.js`

**Files:**
- Create: `sketches/_lib/export.js`
- Modify: `sketches/2026-07-inconstructions/sketch.js:639-652` (`exportPng`)
- Modify: `sketches/2026-07-splinter/sketch.js:1035-1044` (`exportPng`)

**Interfaces:**
- Consumes: nothing.
- Produces: `exportPng(p, { name, k = 3, render })` where `render(g, k)` draws the
  whole poster into `g`. Returns nothing.

- [ ] **Step 1: Write the failing test**

`test.mjs` already has a `'PNG export produces a download'` test for
inconstructions. Add the matching one for splinter, in the splinter section:

```js
  await test('splinter exports a PNG named after its seed', async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`${SPLINTER}?seed=1234abcd`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const download = page.waitForEvent('download', { timeout: 10000 });
    await page.keyboard.press('s');
    const file = await download;
    assert.match(file.suggestedFilename(), /^splinter-1234abcd\.png$/);
    await page.close();
  });
```

- [ ] **Step 2: Run it to make sure it fails or passes for the wrong reason**

Run: `npm test`
Expected: PASS already — splinter's existing `exportPng` produces exactly this
name. That is fine: this test exists to *pin* the behaviour before the refactor
moves it. Record that it passes, then continue.

- [ ] **Step 3: Write the module**

Create `sketches/_lib/export.js`:

```js
// The 3x PNG export both sketches offer. The poster is the artefact; the panel
// is a tool and does not belong in it, which is why `render` is the caller's
// function rather than the sketch's live draw.
//
// The library deliberately knows nothing about how a sketch scales itself.
// inconstructions swaps its module-level origin and scale; splinter swaps its
// world-to-pixel `unit`. Both do that inside their own `render`.

export function exportPng(p, { name, k = 3, render }) {
  const g = p.createGraphics(p.width * k, p.height * k);
  render(g, k);
  p.saveCanvas(g, name, 'png');
  // saveCanvas reads the buffer asynchronously; removing it immediately can
  // race the download on slower machines.
  setTimeout(() => g.remove(), 200);
}
```

- [ ] **Step 4: Port both sketches**

In `sketches/2026-07-inconstructions/sketch.js`, add to the imports:

```js
import { exportPng as exportPngTo } from '../_lib/export.js';
```

and replace the whole `exportPng` function with:

```js
function exportPng() {
  exportPngTo(P, {
    name: 'inconstructions',
    render: (g, u) => {
      g.background(PAPER);
      const ox = originX, oy = originY, sc = scale;
      originX *= u; originY *= u; scale *= u;
      rebuildAt(g, u);
      originX = ox; originY = oy; scale = sc;
      drawHud(g, u, P.width * u, P.height * u, false);
    },
  });
  dirty = true;
}
```

In `sketches/2026-07-splinter/sketch.js`, add to the imports:

```js
import { exportPng as exportPngTo } from '../_lib/export.js';
```

and replace the whole `exportPng` function with:

```js
function exportPng() {
  const su = unit;
  updateCamera(P.width, P.height);
  exportPngTo(P, {
    name: `splinter-${seed.toString(16)}`,
    render: (g, k) => render(g, k, P.width * k, P.height * k, 1.1, false),
  });
  unit = su;
}
```

Note the original removed splinter's buffer after 200ms and inconstructions'
after 100ms. The library uses 200ms for both, which is strictly safer and
changes no rendered pixel.

- [ ] **Step 5: Run the tests and the pixel gate**

Run: `npm test`
Expected: PASS, both export tests included.

Run: `npm run pixels`
Expected: `no pixels moved`.

- [ ] **Step 6: Commit**

```bash
git add sketches/_lib/export.js sketches/2026-07-inconstructions/sketch.js sketches/2026-07-splinter/sketch.js test.mjs
git commit -m "refactor(lib): share the 3x PNG export"
```

---

### Task 5: `_lib/chrome.css`

**Files:**
- Create: `sketches/_lib/chrome.css`
- Modify: `sketches/2026-07-inconstructions/index.html`, `sketches/2026-07-splinter/index.html`
- Modify: both `sketch.js` (import the stylesheet)

**Interfaces:**
- Consumes: nothing.
- Produces: a stylesheet driven by `--paper`, `--ink`, `--back-opacity` and
  `--back-bottom` custom properties set on `:root` by each page.

- [ ] **Step 1: Write the failing test**

Add to `test.mjs`, inconstructions section:

```js
  await test('the back link is present and points at the gallery', async () => {
    const p = await openSketch();
    const link = p.locator('a.back');
    assert.equal(await link.getAttribute('href'), '/');
    // Positioned chrome, not inline text — proves the shared stylesheet loaded.
    assert.equal(await link.evaluate((el) => getComputedStyle(el).position), 'fixed');
    await p.close();
  });
```

- [ ] **Step 2: Run it to make sure it passes for the wrong reason**

Run: `npm test`
Expected: PASS — the inline `<style>` block already does this. As in Task 4,
this pins behaviour before moving it.

- [ ] **Step 3: Write the stylesheet**

Create `sketches/_lib/chrome.css`:

```css
/* Page chrome every Vectorheart sketch wears: a full-bleed canvas on a paper
   field, and one way back to the gallery. Colours come from custom properties
   the page sets, so the stylesheet carries no palette of its own. */
html, body {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: var(--paper);
}
body {
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}
canvas { display: block; }

a.back {
  position: fixed;
  right: 1rem;
  bottom: var(--back-bottom, 1rem);
  z-index: 2;
  color: var(--ink);
  font: 11px ui-monospace, monospace;
  letter-spacing: 0.12em;
  text-decoration: none;
  opacity: var(--back-opacity, 0.5);
}
a.back:hover { opacity: 1; }
```

- [ ] **Step 4: Port both pages**

`sketches/2026-07-inconstructions/index.html` — replace the entire `<style>`
block with:

```html
  <style>
    /* Two rows of controls on narrow screens; the back link keeps clear. */
    :root { --paper: #eceae1; --ink: #16160f; --back-opacity: 0.55; }
    @media (max-width: 560px) { :root { --back-bottom: 4.4rem; } }
  </style>
```

`sketches/2026-07-splinter/index.html` — replace the entire `<style>` block with:

```html
  <style>
    :root { --paper: #f7f7f4; --ink: #141412; --back-opacity: 0.5; }
  </style>
```

Add to the top of both `sketch.js` files, above the p5 import:

```js
import '../_lib/chrome.css';
```

- [ ] **Step 5: Run the tests and the pixel gate**

Run: `npm test`
Expected: PASS.

Run: `npm run pixels`
Expected: `no pixels moved`. The back link is inside the 1200x900 capture, so
any drift in its position, colour or opacity shows up here.

- [ ] **Step 6: Verify the production build inlines the CSS**

Run: `npm run build`
Expected: exit 0. Then confirm the stylesheet reached both pages:

```bash
grep -l "a.back" dist/sketches/2026-07-inconstructions/*.css dist/assets/*.css 2>/dev/null | head
```

Expected: at least one file. If the CSS is missing entirely, the import is in
the wrong file — it must be in `sketch.js`, which is the page's module entry.

- [ ] **Step 7: Commit**

```bash
git add sketches/_lib/chrome.css sketches/2026-07-inconstructions/ sketches/2026-07-splinter/ test.mjs
git commit -m "refactor(lib): share the page chrome"
```

---

### Task 6: `_lib/panel.js` — button style, button, hit layer

The largest step. A mistake here shows up as a dead button rather than a crash,
so the tests come first and drive controls by label.

**Files:**
- Create: `sketches/_lib/panel.js`
- Modify: `sketches/2026-07-inconstructions/sketch.js` — `button` (`:490-500`),
  `hudHits`, `hudClick`
- Modify: `sketches/2026-07-splinter/sketch.js` — `chip` (`:920-934`), `uiHits`,
  `uiBounds`, `insidePanel`, `beginDrag`

**Interfaces:**
- Consumes: `spaced`, `spacedWidth` from Task 2.
- Produces:
  - `buttonStyle(opts) -> style` — freezes the per-sketch look once:
    `{ size, tracking, dy, align: 'center'|'baseline', shape: 'rect'|'poly', weight, theme }`
  - `button(g, k, x, y, w, h, label, { on, action, live, layer, style }) -> number`
    returns `x + w`, so callers can chain along a row.
  - `hitLayer() -> layer` with
    `add(x, y, w, h, action, label)`, `region(x, y, w, h)`, `hit(x, y) -> boolean`
    (runs the action and returns whether one fired), `swallows(x, y) -> boolean`,
    `find(label) -> {x, y, w, h} | null`, `clear()`.

Two knobs exist purely to preserve pixels: `align` and `shape`. inconstructions
centres its labels by measuring with `spacedWidth` and drawing on a baseline,
and draws its frame with `beginShape`/`vertex`; splinter uses p5's
`textAlign(CENTER, CENTER)` and `rect()`. Those rasterize differently. Unifying
them is a deliberate visual change and is explicitly not part of this refactor.

- [ ] **Step 1: Write the failing test**

Add to `test.mjs`, inconstructions section:

```js
  await test('inconstructions controls can be found by label, not by pixel', async () => {
    const p = await openSketch();
    await settle(p);
    const at = await state(p, () => window.__inconstructions.buttonAt('DELETE'));
    assert.ok(at && at.x > 0 && at.y > 0, `no DELETE button: ${JSON.stringify(at)}`);
    await p.mouse.click(at.x, at.y);
    assert.equal(await state(p, () => window.__inconstructions.mode()), 'delete');
    await p.close();
  });

  await test('a click on a control does not also place a part', async () => {
    const p = await openSketch();
    await settle(p);
    const before = await parts(p);
    const at = await state(p, () => window.__inconstructions.buttonAt('R0'));
    await p.mouse.click(at.x, at.y);
    assert.equal(await parts(p), before);
    await p.close();
  });
```

`buttonAt` does not exist on the inconstructions probe yet. Add it to the
`window.__inconstructions` object alongside `graphics`:

```js
    buttonAt: (label) => {
      const b = hud.find(label);
      return b ? { x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) } : null;
    },
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL — `hud is not defined`, because the hit layer does not exist yet.

- [ ] **Step 3: Write the module**

Create `sketches/_lib/panel.js`:

```js
// On-canvas controls. The interface is drawn in the same idiom as the thing it
// makes, which means it is pixels — so it needs its own hit-testing, and tests
// need a way to find a control without hardcoding a coordinate.
import { spaced, spacedWidth } from './type.js';

// Freeze a sketch's button look once, rather than passing six numbers per call.
//
// `align` and `shape` exist because the two existing sketches rasterize their
// controls differently and this library was extracted under a no-visual-change
// rule. 'baseline'/'poly' is inconstructions; 'center'/'rect' is splinter.
export function buttonStyle({
  theme, size = 8, tracking = 0, dy = 0, align = 'center', shape = 'rect', weight = 1,
}) {
  return { theme, size, tracking, dy, align, shape, weight };
}

export function button(g, k, x, y, w, h, label, { on = false, action, live = true, layer, style }) {
  const { theme, size, tracking, dy, align, shape, weight } = style;
  g.push();
  g.fill(on ? theme.accent : 'rgba(0,0,0,0)');
  g.stroke(theme.ink);
  g.strokeWeight(weight * k);
  if (shape === 'poly') {
    g.beginShape();
    for (const [px, py] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) g.vertex(px, py);
    g.endShape(g.CLOSE);
  } else {
    g.rect(x, y, w, h);
  }
  g.noStroke();
  g.fill(on ? theme.onAccent : theme.ink);
  g.textFont('monospace');
  g.textSize(size * k);
  if (align === 'baseline') {
    g.textAlign(g.LEFT, g.BASELINE);
    const tw = spacedWidth(g, label, tracking * k);
    spaced(g, label, x + (w - tw) / 2, y + h / 2 + dy * k, tracking * k);
  } else {
    g.textAlign(g.CENTER, g.CENTER);
    g.text(label, x + w / 2, y + h / 2 + dy * k);
  }
  g.pop();
  if (live && layer) layer.add(x, y, w, h, action, label);
  return x + w;
}

// Collects this frame's clickable rects. Rebuilt every frame, because the panel
// reflows with the viewport and with its own contents.
//
// `region` is separate from `add`: a panel needs to swallow a drag that lands on
// its background as well as on a control, or you orbit the camera through it.
// inconstructions has two disjoint control areas, so this is a list of regions
// rather than splinter's single bounding rect.
export function hitLayer() {
  let hits = [];
  let regions = [];
  const within = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  return {
    add(x, y, w, h, action, label) { hits.push({ x, y, w, h, action, label }); },
    region(x, y, w, h) { regions.push({ x, y, w, h }); },
    hit(x, y) {
      for (const b of hits) {
        if (within(b, x, y)) { if (b.action) b.action(); return true; }
      }
      return false;
    },
    swallows(x, y) {
      return hits.some((b) => within(b, x, y)) || regions.some((r) => within(r, x, y));
    },
    find(label) {
      return hits.find((b) => b.label === label || (b.label && b.label.startsWith(label))) ?? null;
    },
    clear() { hits = []; regions = []; },
  };
}
```

- [ ] **Step 4: Port inconstructions**

Replace `let hudHits = [];` with:

```js
const hud = hitLayer();
```

Add to the imports:

```js
import { buttonStyle, button, hitLayer } from '../_lib/panel.js';
```

Add beside `THEME`:

```js
const BTN = buttonStyle({ theme: THEME, size: 9, tracking: 1.1, dy: 3.2, align: 'baseline', shape: 'poly' });
```

Delete the local `button` function. In `drawHud`, the `row` helper becomes:

```js
  const row = (y, defs) => {
    let x = M + 14 * u;
    for (const d of defs) {
      x = button(g, u, x, y, d[0] * u, bh, d[1],
        { on: d[3], action: d[2], live, layer: hud, style: BTN }) + gap;
    }
  };
```

The two `hudHits.push(...)` calls in the parts legend become `hud.add(...)`:

```js
      if (live) hud.add(x, ly, sw, 20 * u, () => { activePart = i; }, part.id);
```

```js
      if (live) hud.add(lx - 6 * u, ly - 2 * u, 156 * u, rowH, () => { activePart = i; }, part.id);
```

Replace `hudHits = [];` in `p.draw` with `hud.clear();`, and delete the
`hudClick` function, changing its call site in `act` from:

```js
  if (hudClick(mx, my)) return;
```

to:

```js
  if (hud.hit(mx, my)) return;
```

Note that the legend rows now carry a label (`part.id`), which they did not
before. That is data on the hit layer, not a drawn glyph — no pixel moves.

- [ ] **Step 5: Port splinter**

Add to the imports:

```js
import { buttonStyle, button, hitLayer } from '../_lib/panel.js';
```

Replace `let uiHits = [];` and `let uiBounds = {...}` with:

```js
const ui = hitLayer();
```

Splinter's theme changes with the palette, so its style has to be rebuilt each
frame. Replace the `chip` function with:

```js
const chipStyle = () => buttonStyle({ theme: theme(), size: 7.2, dy: 0.5, align: 'center', shape: 'rect' });

function chip(g, k, x, y, w, h, label, on, action, live) {
  button(g, k, x, y, w, h, label, { on, action, live, layer: ui, style: chipStyle() });
}
```

Keeping the `chip` wrapper means the thirty-odd call sites in `drawPanel` do not
change at all, which is the whole point of doing this step separately from the
layout work.

At the end of `drawPanel`, replace the `uiBounds = {...}` assignment with:

```js
  ui.region(M - 10 * k, top, panelW + 20 * k, y - top + 6 * k);
```

Delete `insidePanel`. In `beginDrag`, replace the hit loop and the
`insidePanel` check with:

```js
    // The panel swallows the gesture — you cannot orbit or draw through a button.
    if (ui.hit(p.mouseX, p.mouseY)) { p.loop(); return; }
    if (ui.swallows(p.mouseX, p.mouseY)) { p.loop(); return; }
```

In `render`, replace `uiHits = [];` with `ui.clear();`.

In the `window.__splinter` probe, replace the `buttonAt` implementation with:

```js
    buttonAt: (label) => {
      const b = ui.find(label);
      return b ? { x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) } : null;
    },
```

- [ ] **Step 6: Run the tests and the pixel gate**

Run: `npm test`
Expected: PASS, including the two new `buttonAt` tests. Every existing splinter
test that drives a control by label exercises the new hit layer.

Run: `npm run pixels`
Expected: `no pixels moved`. If inconstructions diffs, the cause is almost
certainly `shape` or `align` — its buttons must stay `poly`/`baseline`.

- [ ] **Step 7: Commit**

```bash
git add sketches/_lib/panel.js sketches/2026-07-inconstructions/sketch.js sketches/2026-07-splinter/sketch.js test.mjs
git commit -m "refactor(lib): share the on-canvas controls and hit testing"
```

---

### Task 7: `_lib/panel.js` — heading, strip and stack layout

**Files:**
- Modify: `sketches/_lib/panel.js`
- Modify: `sketches/2026-07-splinter/sketch.js` — `drawPanel` (`:936-1003`)
- Modify: `sketches/2026-07-inconstructions/sketch.js` — the control rows in `drawHud`

**Interfaces:**
- Consumes: `button`, `buttonStyle` from Task 6; `spaced` from Task 2.
- Produces:
  - `heading(g, k, x, y, text, { theme, size = 6.8 })`
  - `strip(g, k, x, y, h, defs, { gap, layer, style }) -> number` (returns end x)
  - `stack(g, k, x, y, w, h, defs, { gap, layer, style }) -> number` (returns end y)

  A `def` is `[label, action, on]` for `stack`, and `[width, label, action, on]`
  for `strip`, matching inconstructions' existing tuple shape.

- [ ] **Step 1: Write the failing test**

Add to `test.mjs`, splinter section:

```js
  await test('every panel control the layout draws is clickable', async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`${SPLINTER}?seed=1234abcd`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    // Labels drawn by stack() in COMPOSITION and PHYSICS, one from each group.
    for (const label of ['LOOK', 'SHARD', 'VIEW', 'DETONATE', 'CLEAR']) {
      const at = await state(page, (l) => window.__splinter.buttonAt(l), label);
      assert.ok(at, `no hit rect for ${label}`);
    }
    await page.close();
  });
```

Note `state` takes only a function today. Extend the helper near the top of
`test.mjs` from:

```js
  const state = (p, fn) => p.evaluate(fn);
```

to:

```js
  const state = (p, fn, arg) => p.evaluate(fn, arg);
```

This is backward-compatible: `evaluate(fn, undefined)` behaves as before.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL on the first label, because `state` ignored its third argument
and `l` arrives `undefined`.

Fix the `state` helper as above and re-run. Expected: PASS — the labels already
exist from Task 6. This test is a net for the layout rewrite in Step 4, not a
driver for it.

- [ ] **Step 3: Write the layout helpers**

Append to `sketches/_lib/panel.js`:

```js
// A section label above a run of controls.
export function heading(g, k, x, y, text, { theme, size = 6.8 }) {
  g.push();
  g.noStroke();
  g.fill(theme.muted);
  g.textFont('monospace');
  g.textAlign(g.LEFT, g.BASELINE);
  g.textSize(size * k);
  g.text(text, x, y);
  g.pop();
}

// A run of controls left to right. `defs` are [width, label, action, on] with
// width in unscaled units. Returns the x just past the last control.
export function strip(g, k, x, y, h, defs, { gap = 5, layer, style }) {
  let cx = x;
  for (const [w, label, action, on] of defs) {
    cx = button(g, k, cx, y, w * k, h, label, { on, action, live: true, layer, style }) + gap * k;
  }
  return cx;
}

// A column of full-width controls. `defs` are [label, action, on]. Returns the y
// just past the last control.
export function stack(g, k, x, y, w, h, defs, { gap = 4, layer, style }) {
  let cy = y;
  for (const [label, action, on] of defs) {
    button(g, k, x, cy, w, h, label, { on, action, live: true, layer, style });
    cy += h + gap * k;
  }
  return cy;
}
```

- [ ] **Step 4: Port splinter's panel**

Add `heading, stack` to the panel import. Delete the local `heading` closure
inside `drawPanel` and rewrite the body's section calls. The COMPOSITION block
becomes:

```js
  heading(g, k, M, y - 6 * k, 'COMPOSITION', { theme: theme() });
  y += 2 * k;
  y = stack(g, k, M, y, panelW, bh, [
    [`VIEW ${view().name}`, () => { viewIx = (viewIx + 1) % VIEWS.length; regenerate(); }, false],
    [`MIX ${MIXES[mixIx].name}`, () => { mixIx = (mixIx + 1) % MIXES.length; regenerate(); }, false],
    [`PAL ${pal().name}`, () => { paletteIx = (paletteIx + 1) % PALETTES.length; regenerate(); }, false],
    [`CAM ${cam.ortho ? 'ORTHO' : 'PERSP'}`, () => { cam.ortho = !cam.ortho; P.loop(); }, false],
    [`TIME ${MOTIONS[motionIx].name}`, () => { motionIx = (motionIx + 1) % MOTIONS.length; P.loop(); }, false],
    [`RATE ${SPEEDS[speedIx].name}`, () => { speedIx = (speedIx + 1) % SPEEDS.length; }, false],
  ], { gap: 4, layer: ui, style: chipStyle() });
```

The original loop was `for (const [label, action] of cyc) { chip(...); y += bh + gap; }`
with `gap = 4 * k`, so `stack` reproduces it exactly. Apply the same treatment to
the MODE, COMPONENTS and PHYSICS sections, keeping every `y +=` spacer between
sections byte-for-byte as it is. Leave the two-column rows (MODE, COMPONENTS,
GRAVITY/FLOOR, ISO VIEW/CLEAR) as direct `chip` calls — `stack` is
single-column, and forcing a two-column mode into it would be the
over-abstraction the spec warns about.

- [ ] **Step 5: Port inconstructions' control rows**

Add `strip` to the panel import and replace the local `row` helper with:

```js
  const row = (y, defs) => strip(g, u, M + 14 * u, y, bh, defs, { gap: 5, layer: hud, style: BTN });
```

The `defs` tuples (`PLACE`, `DELETE`, `ROT`, …) already have the
`[width, label, action, on]` shape `strip` expects and need no change.

- [ ] **Step 6: Run the tests and the pixel gate**

Run: `npm test`
Expected: PASS.

Run: `npm run pixels`
Expected: `no pixels moved`.

- [ ] **Step 7: Commit**

```bash
git add sketches/_lib/panel.js sketches/2026-07-inconstructions/sketch.js sketches/2026-07-splinter/sketch.js test.mjs
git commit -m "refactor(lib): share the panel layout helpers"
```

---

### Task 8: `_lib/keys.js` — key registry, generated hints, `?` overlay

**Files:**
- Create: `sketches/_lib/keys.js`
- Modify: `sketches/2026-07-inconstructions/sketch.js` — `p.keyPressed` (`:789-803`),
  the hardcoded hint string in `drawHud`
- Modify: `sketches/2026-07-splinter/sketch.js` — `p.keyPressed` (`:1172-1189`)

**Interfaces:**
- Consumes: `spaced` from Task 2.
- Produces:
  - `RESERVED` — `{ s: 'PNG', z: 'UNDO', y: 'REDO', c: 'CLEAR', ' ': 'NEW', '?': 'HELP' }`
  - `keymap(bindings) -> { handle(p), hints(), overlay(g, k, w, h, opts), visible, toggle() }`
    where a binding is `{ key, label, hint, run }`. `key` may be a single
    character or the string `'1-7'` for a documented range (hint only, not
    dispatched). Throws on construction if a binding claims a reserved key for a
    different label.

- [ ] **Step 1: Write the failing test**

Add to `test.mjs`, inconstructions section:

```js
  await test('the key registry refuses to redefine a reserved key', async () => {
    const p = await openSketch();
    const message = await state(p, async () => {
      const m = await import('/sketches/_lib/keys.js');
      try {
        m.keymap([{ key: 's', label: 'SAVE ALL', run: () => {} }]);
        return null;
      } catch (e) { return e.message; }
    });
    assert.match(message ?? '', /reserved/i);
    await p.close();
  });

  await test('? opens the help overlay and escape closes it', async () => {
    const p = await openSketch();
    await settle(p);
    await p.keyboard.press('?');
    assert.equal(await state(p, () => window.__inconstructions.helpOpen()), true);
    await p.keyboard.press('Escape');
    assert.equal(await state(p, () => window.__inconstructions.helpOpen()), false);
    await p.close();
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL — the module does not exist, and `helpOpen` is not on the probe.

- [ ] **Step 3: Write the module**

Create `sketches/_lib/keys.js`:

```js
// Key bindings as data. Two things follow from that: the on-screen hint line
// cannot drift from what the keys actually do, and a `?` overlay comes free.
import { spaced } from './type.js';

// Verbs every Vectorheart sketch spells the same way. Both existing sketches
// already agree on these; the table exists so a third one cannot quietly
// disagree. Sketch-specific verbs stay free — splinter's `x` (detonate) and
// `r` (rate) are not here and do not need to be.
export const RESERVED = {
  s: 'PNG', z: 'UNDO', y: 'REDO', c: 'CLEAR', ' ': 'NEW', '?': 'HELP',
};

export function keymap(bindings) {
  for (const b of bindings) {
    const want = RESERVED[b.key];
    if (want && b.label !== want) {
      throw new Error(
        `key "${b.key}" is reserved for ${want}, not ${b.label} — see _lib/keys.js`);
    }
  }
  const byKey = new Map(bindings.filter((b) => b.key.length === 1).map((b) => [b.key, b]));
  let visible = false;

  return {
    get visible() { return visible; },
    toggle() { visible = !visible; },

    // Call from p.keyPressed. Returns true when a binding fired, so the sketch
    // can decide what to do with everything else.
    handle(p) {
      if (p.key === '?') { visible = !visible; return true; }
      if (p.keyCode === p.ESCAPE && visible) { visible = false; return true; }
      const b = byKey.get(p.key.toLowerCase()) ?? byKey.get(p.key);
      if (!b) return false;
      b.run(p);
      return true;
    },

    // The one-line hint strip, built from the bindings that asked for one.
    hints() {
      return bindings.filter((b) => b.hint)
        .map((b) => `${b.key === ' ' ? 'SPACE' : b.key.toUpperCase()} ${b.hint}`)
        .join(' · ');
    },

    // The full card, shown on `?`. Drawn in the sketch's own idiom.
    overlay(g, k, w, h, { theme, title = 'KEYS' }) {
      if (!visible) return;
      const rows = bindings.filter((b) => b.hint ?? b.label);
      const bw = 300 * k;
      const bh = (rows.length + 3) * 16 * k;
      const x = (w - bw) / 2;
      const y = (h - bh) / 2;
      g.push();
      g.noStroke();
      g.fill(theme.paper);
      g.rect(x, y, bw, bh);
      g.noFill();
      g.stroke(theme.ink);
      g.strokeWeight(1 * k);
      g.rect(x, y, bw, bh);
      g.noStroke();
      g.fill(theme.ink);
      g.textFont('monospace');
      g.textAlign(g.LEFT, g.BASELINE);
      g.textSize(9 * k);
      spaced(g, title, x + 16 * k, y + 24 * k, 1.6 * k);
      g.textSize(8 * k);
      rows.forEach((b, i) => {
        const ry = y + 46 * k + i * 16 * k;
        g.fill(theme.muted);
        g.text(b.key === ' ' ? 'SPACE' : b.key.toUpperCase(), x + 16 * k, ry);
        g.fill(theme.ink);
        g.text(b.hint ?? b.label, x + 70 * k, ry);
      });
      g.pop();
    },
  };
}
```

- [ ] **Step 4: Port inconstructions**

Add to the imports:

```js
import { keymap } from '../_lib/keys.js';
```

Add above the p5 constructor. The first three entries are ordered and worded so
that `hints()` reproduces the existing hint line character for character —
`q` and `e` dispatch separately but share one documented `q/e` entry, because
the drawn line says `Q/E VIEW`:

```js
const KEYS = keymap([
  { key: '1-7', hint: 'SELECT' },
  { key: 'r', label: 'ROTATE', hint: 'ROTATE', run: () => { activeRot = (activeRot + 1) % 4; } },
  { key: 'q/e', hint: 'VIEW' },
  { key: 'q', label: 'VIEW LEFT', run: () => turn(-1) },
  { key: 'e', label: 'VIEW RIGHT', run: () => turn(1) },
  { key: 'x', label: 'MODE', hint: 'PLACE / DELETE', run: () => { mode = mode === 'place' ? 'delete' : 'place'; } },
  { key: 'c', label: 'CLEAR', hint: 'CLEAR', run: () => swapWorld([]) },
  { key: 'z', label: 'UNDO', hint: 'UNDO', run: (p) => (p.keyIsDown(p.SHIFT) && (p.keyIsDown(p.CONTROL) || p.keyIsDown(91)) ? redo() : undo()) },
  { key: 'y', label: 'REDO', hint: 'REDO', run: () => redo() },
  { key: 's', label: 'PNG', hint: 'PNG', run: () => exportPng() },
]);
```

Replace `p.keyPressed` with:

```js
  p.keyPressed = () => {
    if (!demoDone) { finishDemo(); return false; }
    const k = p.key.toLowerCase();
    if (k >= '1' && k <= String(PARTS.length)) { activePart = Number(k) - 1; return false; }
    KEYS.handle(p);
    return false;
  };
```

The number-key range is handled before the registry because it is a range, not a
binding; the registry documents it via the `'1-7'` entry that carries a hint and
no `run`.

Replace the hardcoded hint line in `drawHud`:

```js
    spaced(g, '1-7 SELECT · R ROTATE · Q/E VIEW', lx, ly + 12 * u, 0.8 * u);
```

with the generated one, truncated to the three entries the line has always
shown. This line sits inside the 1200x900 capture, so the full hint string would
move pixels:

```js
    spaced(g, KEYS.hints().split(' · ').slice(0, 3).join(' · '), lx, ly + 12 * u, 0.8 * u);
```

With the binding list above, `hints()` starts
`1-7 SELECT · R ROTATE · Q/E VIEW · X PLACE / DELETE · …`, so the first three
entries are exactly the original text. Confirm that in the browser before
running the pixel gate — if the first three do not match, the binding order or a
`hint` string is wrong, not the slice.

Add the overlay at the end of `p.draw`, after `drawHud`:

```js
    KEYS.overlay(p, 1, p.width, p.height, { theme: THEME, title: 'INCONSTRUCTIONS · KEYS' });
```

Add to the probe:

```js
    helpOpen: () => KEYS.visible,
```

- [ ] **Step 5: Port splinter**

Add the same import, and above the p5 constructor:

```js
const KEYS = keymap([
  { key: ' ', label: 'NEW', hint: 'NEW COMPOSITION', run: () => reseed() },
  { key: 'v', label: 'VIEW', hint: 'VIEW', run: () => { viewIx = (viewIx + 1) % VIEWS.length; regenerate(); } },
  { key: 'm', label: 'MIX', hint: 'MIX', run: () => { mixIx = (mixIx + 1) % MIXES.length; regenerate(); } },
  { key: 'k', label: 'PALETTE', hint: 'PALETTE', run: () => { paletteIx = (paletteIx + 1) % PALETTES.length; regenerate(); } },
  { key: 't', label: 'TIME', hint: 'MOTION', run: (p) => { motionIx = (motionIx + 1) % MOTIONS.length; p.loop(); } },
  { key: 'r', label: 'RATE', hint: 'RATE', run: (p) => { speedIx = (speedIx + 1) % SPEEDS.length; p.loop(); } },
  { key: 'o', label: 'ORTHO', hint: 'ORTHO / PERSP', run: (p) => { cam.ortho = !cam.ortho; p.loop(); } },
  { key: 'd', label: 'DRAW', hint: 'DRAW / LOOK', run: (p) => { mode = mode === 'DRAW' ? 'LOOK' : 'DRAW'; p.loop(); } },
  { key: 'z', label: 'UNDO', hint: 'UNDO STROKE', run: (p) => { strokes.pop(); p.loop(); } },
  { key: 'c', label: 'CLEAR', hint: 'CLEAR STROKES', run: (p) => { strokes = []; p.loop(); } },
  { key: 'x', label: 'DETONATE', hint: 'DETONATE', run: () => detonate() },
  { key: 'g', label: 'GRAVITY', hint: 'GRAVITY', run: (p) => { sim.gravity = !sim.gravity; if (!sim.live) detonate(); p.loop(); } },
  { key: 'b', label: 'COLLIDE', hint: 'COLLIDE', run: (p) => { sim.collide = !sim.collide; p.loop(); } },
  { key: 's', label: 'PNG', hint: 'PNG', run: () => exportPng() },
]);
```

Replace `p.keyPressed` with:

```js
  p.keyPressed = () => (KEYS.handle(p) ? false : true);
```

`strokes` is reassigned by the `c` binding, so it must remain a `let` at module
scope — it already is.

Add the overlay in `render`, after the panel and before the footer, so it sits
above the controls but is still excluded from the export (the export passes
`withPanel: false`; guard the overlay the same way):

```js
  if (withPanel) KEYS.overlay(g, k, w, h, { theme: theme(), title: 'SPLINTER · KEYS' });
```

Add to the probe:

```js
    helpOpen: () => KEYS.visible,
```

- [ ] **Step 6: Run the tests and the pixel gate**

Run: `npm test`
Expected: PASS. Every existing key test in `test.mjs` (`r` cycling rotation,
`x` toggling delete mode, the bearing cycle, `s` exporting) now goes through the
registry.

Run: `npm run pixels`
Expected: `no pixels moved`. The overlay is closed at capture time and the hint
line reproduces its original text.

- [ ] **Step 7: Commit**

```bash
git add sketches/_lib/keys.js sketches/2026-07-inconstructions/sketch.js sketches/2026-07-splinter/sketch.js test.mjs
git commit -m "feat(lib): key registry with generated hints and a ? overlay"
```

---

### Task 9: `_lib/probe.js`

**Files:**
- Create: `sketches/_lib/probe.js`
- Modify: both sketches' `window.__*` blocks

**Interfaces:**
- Consumes: `hitLayer` instances from Task 6.
- Produces: `probe(name, fields, layer)` — assigns `window.__<name>` with
  `fields` plus a `buttonAt(label)` derived from `layer`. No-op when `window` is
  undefined.

- [ ] **Step 1: Write the failing test**

Add to `test.mjs`, inconstructions section:

```js
  await test('buttonAt returns null for a control that does not exist', async () => {
    const p = await openSketch();
    await settle(p);
    assert.equal(await state(p, () => window.__inconstructions.buttonAt('NOPE')), null);
    await p.close();
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test`
Expected: PASS — Task 6's `find` already returns `null`. Pin it, then continue.

- [ ] **Step 3: Write the module**

Create `sketches/_lib/probe.js`:

```js
// The one external seam a sketch has: a read-only view of exactly what the
// interface already shows. Nothing here can drive the sketch — a test clicks
// and types like a person, and reads state like a viewer.

export function probe(name, fields, layer) {
  if (typeof window === 'undefined') return;
  window[`__${name}`] = {
    ...fields,
    // Where a named control actually is, so a test never hardcodes a pixel and
    // breaks the moment the panel gains a row.
    buttonAt: (label) => {
      const b = layer.find(label);
      return b ? { x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) } : null;
    },
  };
}
```

- [ ] **Step 4: Port both sketches**

In `sketches/2026-07-inconstructions/sketch.js`, add the import and replace the
`if (typeof window !== 'undefined') { window.__inconstructions = {...}; }` block
with:

```js
probe('inconstructions', {
  parts: () => cells.size,
  bearing: () => bearing(),
  mode: () => mode,
  activePart: () => PARTS[activePart].id,
  rot: () => activeRot,
  demoDone: () => demoDone,
  helpOpen: () => KEYS.visible,
  cell: () => (hover ? [hover.x, hover.y, hover.ground ? 0 : hover.z] : null),
  // The cell the ghost preview is currently occupying, or null when a click
  // here would be refused. Exactly what the ghost already shows on screen.
  target: () => { const t = target(); return t ? [t.x, t.y, t.z] : null; },
  undoDepth: () => past.length,
  redoDepth: () => future.length,
  // A scratch buffer so a test can exercise the shared type module against the
  // same p5 text metrics the sketch itself uses.
  graphics: () => P.createGraphics(200, 60),
}, hud);
```

Do the same for splinter: keep every existing field verbatim, drop the local
`buttonAt`, and pass `ui` as the layer.

- [ ] **Step 5: Run the tests and the pixel gate**

Run: `npm test`
Expected: PASS — the whole suite reads through the new probes.

Run: `npm run pixels`
Expected: `no pixels moved`.

- [ ] **Step 6: Commit**

```bash
git add sketches/_lib/probe.js sketches/2026-07-inconstructions/sketch.js sketches/2026-07-splinter/sketch.js test.mjs
git commit -m "refactor(lib): share the test probe"
```

---

### Task 10: Template and house rules

The library only pays off if the next sketch starts from it.

**Files:**
- Modify: `sketches/_template/sketch.js`, `sketches/_template/index.html`
- Modify: `README.md`

**Interfaces:**
- Consumes: every module.
- Produces: a working scaffold and the written convention.

- [ ] **Step 1: Write the template page**

Replace `sketches/_template/index.html` with:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <title>TITLE</title>
  <style>
    :root { --paper: #eceae1; --ink: #16160f; --back-opacity: 0.55; }
  </style>
</head>
<body>
  <a class="back" href="/">← SKETCHBOOK</a>
  <script type="module" src="./sketch.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write the template sketch**

Replace `sketches/_template/sketch.js` with:

```js
// TITLE — one sentence on what this is.
//
// Say why it works the way it does, not what the code does.
import '../_lib/chrome.css';
import p5 from 'p5';
import { titleBlock, regMarks, footer } from '../_lib/type.js';
import { buttonStyle, hitLayer, heading, stack } from '../_lib/panel.js';
import { keymap } from '../_lib/keys.js';
import { exportPng as exportPngTo } from '../_lib/export.js';
import { probe } from '../_lib/probe.js';

// Colour never lives in the library — it lives here.
const THEME = { ink: '#16160f', paper: '#eceae1', accent: '#fabd2f', onAccent: '#16160f', muted: '#8a8a80' };
const BTN = buttonStyle({ theme: THEME });

const ui = hitLayer();
let P = null;
let count = 0;

const KEYS = keymap([
  { key: 'c', label: 'CLEAR', hint: 'CLEAR', run: () => { count = 0; } },
  { key: 's', label: 'PNG', hint: 'PNG', run: () => exportPng() },
]);

// Everything draws into an arbitrary target at an arbitrary scale, so the 3x
// export is the same code path as the screen. Never read a global scale here.
function render(g, k, w, h, withPanel) {
  g.background(THEME.paper);
  regMarks(g, k, w, h, { theme: THEME });
  titleBlock(g, k, { x: 34 * k, y: 40 * k, title: 'TITLE', sub: 'SUBTITLE', rule: 200, theme: THEME });
  footer(g, k, { x: 34 * k, y: h - 28 * k, text: 'SKETCHBOOK · SIEM2L.NL', theme: THEME });
  if (withPanel) {
    ui.clear();
    heading(g, k, 34 * k, 96 * k, 'CONTROLS', { theme: THEME });
    const end = stack(g, k, 34 * k, 104 * k, 120 * k, 17 * k,
      [['COUNT UP', () => { count++; }, false]], { layer: ui, style: BTN });
    ui.region(34 * k, 96 * k, 120 * k, end - 96 * k);
    KEYS.overlay(g, k, w, h, { theme: THEME, title: 'TITLE · KEYS' });
  }
}

function exportPng() {
  exportPngTo(P, { name: 'TITLE', render: (g, k) => render(g, k, P.width * k, P.height * k, false) });
}

probe('TITLE', { count: () => count, helpOpen: () => KEYS.visible }, ui);

new p5((p) => {
  P = p;
  p.setup = () => p.createCanvas(p.windowWidth, p.windowHeight);
  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);
  p.draw = () => render(p, 1, p.width, p.height, true);
  p.mousePressed = () => { ui.hit(p.mouseX, p.mouseY); return false; };
  p.keyPressed = () => (KEYS.handle(p) ? false : true);
});
```

- [ ] **Step 3: Prove the template runs**

Run: `make new NAME=lib-smoke`
Then: `npm run dev` and open the new sketch. Confirm the title block, the
registration marks, the COUNT UP button, `?` for the overlay, and `s` for a PNG.

Then remove it so it never reaches the gallery — `rsync --delete` publishing
means an unwanted sketch folder is a live page:

```bash
rm -rf sketches/2026-07-lib-smoke
```

- [ ] **Step 4: Write the house rules**

Add to `README.md`, after the "Sketches" section:

```markdown
## Vectorheart house rules

Sketches in the Vectorheart idiom (`splinter`, `inconstructions`) share
`sketches/_lib/`. The template starts from it.

- **`(g, k)` first.** Every drawing function takes the graphics target and the
  scale factor. `k` is 1 on screen and 3 in a PNG export; that single convention
  is what makes export a re-render rather than an upscale. Never read a
  module-level scale inside a shared function.
- **Colour is data.** The library defines none. Each sketch passes a
  `{ ink, paper, accent, onAccent, muted }` theme in — a constant if its palette
  is fixed, a function of the active palette if not.
- **Reserved keys.** `s` PNG, `z` undo, `y` redo, `c` clear, space new, `?` help.
  Everything else is yours. `keymap()` throws if you take one for something else.
- **The library never owns the draw loop.** Sketches differ too much — one
  redraws every frame off a dirty flag, another parks in `noLoop()`. Primitives
  and plumbing are shared; control flow is not.
- **The probe is read-only.** `probe(name, fields, layer)` exposes what the
  interface already shows. Tests click and type like a person.
- **Reproducibility is a feature.** If a composition has a seed, print it and
  accept it back through `?seed=`.
```

- [ ] **Step 5: Full verification**

Run: `npm test`
Expected: PASS, no failures.

Run: `npm run pixels`
Expected: `no pixels moved`.

Run: `npm run build`
Expected: exit 0.

Run: `git status --short`
Expected: no stray `sketches/2026-07-lib-smoke` directory.

- [ ] **Step 6: Confirm the thumbnails are unchanged**

Run: `npm run thumbs`
Then: `git diff --stat public/sketches/`
Expected: `2026-07-inconstructions/thumb.png` unchanged. **`2026-07-splinter/thumb.png`
will differ** — its composition is random per load and the thumbnail generator
does not pass a seed. Check the new splinter thumbnail looks right and restore
the committed one rather than committing churn:

```bash
git checkout -- public/sketches/2026-07-splinter/thumb.png
```

Any change to the inconstructions thumbnail means the refactor moved something
the pixel harness did not cover; investigate before committing.

- [ ] **Step 7: Commit**

```bash
git add sketches/_template/ README.md
git commit -m "docs: Vectorheart house rules and a template that uses the library"
```

---

## Follow-ups, deliberately not in this plan

- **Give the thumbnail generator a seed per sketch** so splinter's thumbnail
  stops being random. Small, and it would make Step 6 above unnecessary.
- **Unify the button rasterization.** `align` and `shape` exist only to preserve
  pixels. Once someone is willing to accept a visual diff on inconstructions,
  both sketches can use `center`/`rect` and those two options disappear.
- **A two-column `stack`.** Four call sites in splinter still place chips by
  hand. Worth doing when a third sketch wants the same thing, not before.
