# Vectorheart shared library

Date: 2026-07-31
Status: approved, not yet implemented

## Problem

Two sketches now work in the same idiom — `2026-07-inconstructions` (804
lines) and `2026-07-splinter` (1190 lines). Both are Vectorheart generators:
flat-filled hairline vector art on a paper field, a poster title block,
on-canvas buttons, a printed parameter line, and a 3x PNG export. They were
written independently and duplicate that surface.

Concretely duplicated today:

| Concern | inconstructions | splinter |
| --- | --- | --- |
| Letterspaced type | `spaced`, `spacedWidth` | `spaced` (byte-identical) |
| Buttons | `button()` into `hudHits[]` | `chip()` into `uiHits[]` |
| Panel bounds | none (two disjoint regions) | `uiBounds` + `insidePanel` |
| Title block | title, sub, hairline rule | title, sub, hairline rule |
| Scale factor | `u` | `k` |
| PNG export | `exportPng()`, 3x buffer | `exportPng()`, 3x buffer |
| Test seam | `window.__inconstructions` | `window.__splinter` + `buttonAt` |
| Page chrome | `<style>` block in index.html | same block, forked values |

The cost is not the line count. It is that a third sketch in this idiom
starts by copying 200 lines of someone else's HUD, and that the two existing
sketches have already drifted (one has a readout column, the other a help
line; one has `buttonAt` for tests, the other hardcodes pixels).

## Scope

**In:** UI chrome and plumbing — type, panel primitives, key registry, PNG
export, test probe, page chrome CSS. Both existing sketches are refactored
onto it.

**Out:** visual identity (palettes stay per-sketch), 3D and projection maths
(the two camera models are genuinely different), and the p5 lifecycle.

## Approach

Small, flat ES modules under `sketches/_lib/`, imported relatively:

```js
import { spaced, titleBlock } from '../_lib/type.js';
```

Vite already builds each sketch folder as its own page and resolves relative
module imports, so this needs no build changes.

Each sketch keeps its own `new p5(...)` and `p.draw`. The library supplies
primitives; it never owns control flow. This is deliberate: inconstructions
redraws every frame off a `dirty` flag, while splinter calls `noLoop()` when
the scene is still and `loop()` from roughly fifteen call sites. A shared
lifecycle would have to model both, and every future sketch would inherit
that complexity. The draw loop is where standardization stops paying.

Two conventions run through every module:

- Every drawing function takes `(g, k, ...)` — `g` is the graphics target,
  `k` the scale factor. This is what makes 3x PNG export work everywhere.
  Today it is `u` in one sketch and `k` in the other: the same idea spelled
  two ways.
- Colour is passed in as a `theme` object, never defined by the library.

## Modules

### `_lib/type.js`

```js
export function spaced(g, str, x, y, tracking)       // returns width drawn
export function spacedWidth(g, str, tracking)        // measure without drawing
export function titleBlock(g, k, { x, y, title, sub, rule, width, theme })
export function readout(g, k, { x, y, rows, align, theme })
export function regMarks(g, k, w, h, margin, theme)
export function footer(g, k, w, h, text, theme)
```

`titleBlock` absorbs both existing headers — they have the same anatomy
(display title, mono subtitle, hairline rule) with different content.
`readout` is inconstructions' top-right `CELL / PARTS / BEARING / MODE`
column, taking `rows` as `[[label, value], ...]`.

### `_lib/panel.js`

```js
export function hitLayer()
// { add(rect, action, label), region(rect), hit(x, y), swallows(x, y),
//   find(label), clear() }

export function button(g, k, x, y, w, h, label, opts)
// opts: { on, action, live, layer, theme }
export function heading(g, k, x, y, text, theme)
export function strip(g, k, x, y, defs, opts)    // left to right, returns end x
export function stack(g, k, x, y, w, defs, opts) // top to bottom, returns end y
```

`hitLayer` unifies `hudHits` and `uiHits`. `region()`/`swallows()`
generalizes splinter's single `uiBounds` rect: inconstructions has two
disjoint control areas, so a union of declared regions is the honest model.
`swallows(x, y)` is what stops a drag from orbiting the camera through a
button.

Layout stays per-sketch. Both sketches compose the same primitives at the
same sizes and tracking, but inconstructions keeps its left legend plus
bottom strip and splinter keeps its single left column.

### `_lib/keys.js`

```js
export const RESERVED = {
  s: 'PNG', z: 'UNDO', y: 'REDO', c: 'CLEAR', ' ': 'NEW', '?': 'HELP',
};
export function keymap(bindings)  // { handle(p), hints(), overlay(g, k, w, h) }
```

Each binding is `{ key, label, run, hint }`. `handle(p)` is called from
`p.keyPressed`; `hints()` returns the one-line hint string; `overlay()` draws
the `?` help panel.

Both sketches already satisfy `RESERVED` — `s`, `z` and `c` agree, splinter's
`space` (reseed) matches NEW, and inconstructions' `y` matches REDO. So the
reserved set costs no behaviour change. Sketch-specific verbs stay free:
splinter's `x` (detonate) and `r` (rate) do not move.

`keymap()` throws at construction if a binding claims a reserved key for a
different verb. That is a dev-time guardrail so a third sketch cannot quietly
diverge.

The payoff is generated hints. inconstructions currently draws a hardcoded
`'1-7 SELECT · R ROTATE · Q/E VIEW'` string that has to be maintained by hand
alongside the bindings; splinter draws none. Both gain a `?` overlay.

### `_lib/export.js`

```js
export function exportPng(p, { name, k = 3, render })
```

Owns `createGraphics` -> `render(g, k)` -> `saveCanvas` -> deferred
`remove()`. The caller's `render` owns the scale gymnastics: inconstructions
swaps `originX`/`originY`/`scale`, splinter swaps `unit`. The library has no
business knowing about those globals.

### `_lib/probe.js`

```js
export function probe(name, fields, layer)   // sets window.__<name>
```

Merges `fields` with a `buttonAt(label)` derived from the `layer` passed in,
so inconstructions' tests gain the pixel-free button targeting splinter
already has. Guarded by `typeof window !== 'undefined'`, as both sketches do
today.

### `_lib/chrome.css`

The `.back` link and body reset, driven by `--paper` and `--ink` custom
properties that each `index.html` sets on `:root`. Imported from `sketch.js`;
Vite inlines it into the page bundle. Deletes the duplicated `<style>` blocks
from both sketch pages.

## Themes

```js
const THEME = { ink, paper, accent, onAccent, muted };
```

Each sketch supplies its own. inconstructions passes a constant
(`#16160f` / `#eceae1` / `#fabd2f` / `#16160f` / `#8a8a80`); splinter derives
one per frame from its active palette (`onAccent: '#ffffff'`). Because the
theme carries the differences, both sketches keep their exact current
appearance.

## No visual change

This refactor must be pixel-identical. That is the acceptance criterion, and
it is what makes the existing artifacts a safety net rather than a liability:

- `test.mjs` holds roughly fifty Playwright behaviour tests across both
  sketches. They must pass unmodified except where a test is rewritten to use
  `buttonAt` in place of a hardcoded pixel.
- `public/sketches/*/thumb.png` are committed screenshots. If a thumbnail
  changes, the refactor changed something it should not have.

The two additions that are visible by design — a `?` help overlay and
inconstructions' generated hint line — are drawn only on demand or in place
of existing text, and neither is in the thumbnail viewport.

## Migration order

One module at a time, `npm test` after each, inconstructions first because it
is smaller:

1. `type.js` — extract `spaced`/`spacedWidth`, then `titleBlock`, `readout`,
   `regMarks`, `footer`.
2. `export.js` — both `exportPng` functions collapse into one call.
3. `chrome.css` — delete both `<style>` blocks.
4. `panel.js` — the largest step; `hudHits`/`uiHits` become hit layers.
5. `keys.js` — bindings become data; hint line and `?` overlay generated.
6. `probe.js` — both `window.__*` objects go through it.

Then:

7. Update `sketches/_template/` to demonstrate the library.
8. Add a "Vectorheart house rules" section to `README.md`: the `(g, k)`
   convention, the reserved keys, the theme object, and the rule that the
   library never owns the draw loop.

## Risks

- **Step 4 is the real one.** The panel refactor touches every control in
  both sketches, and a mistake shows up as a dead button rather than a crash.
  Mitigation: the Playwright suite drives buttons by label after this step.
- **Thumbnail drift.** Anything that changes text metrics changes the
  thumbnails. `npm run thumbs` and a `git diff --stat` on `public/sketches/`
  after each step catches it.
- **Over-abstraction.** `titleBlock` and `readout` are shared on the strength
  of two examples. If a third sketch needs a materially different header, the
  right move is to add a parameter or let it call `spaced` directly — not to
  grow the signature until it can express anything.
