# Eclipse Horizon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A globe that plots every greatest-eclipse point in NASA's Five Millennium Catalog, accumulating across 5,000 years, so that the two polar rings of Sun-on-the-horizon eclipses appear on their own.

**Architecture:** A manual fetch script parses 50 century pages of the catalog into one committed JSON file of parallel arrays. The sketch is a plain 2D canvas — no p5, no WebGL, no d3 — because an orthographic projection is six lines of trig and 11,898 points is a rounding error for `fillRect`. Rotation, time and rendering are separated into `globe.js` (projection + chrome), `points.js` (marks + encoding) and `sketch.js` (state, input, readout, loop).

**Tech Stack:** Node 22 (fetch script, ESM), vanilla ES modules + Canvas 2D (sketch), Vite (existing dev/build), Playwright via `test.mjs` (existing).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-13-eclipse-horizon-design.md`. Read it before Task 1.
- Sketch slug: `sketches/2026-08-eclipse-horizon`. Data: `public/data/eclipses.json`.
- **No new npm dependencies.** Not p5, not d3. The sketch imports nothing.
- House palette, exact values: surface `#0e0e11`, primary ink `#e8e6e0`, muted ink `#8a877e`, accent `#7fb3a3`, note/amber `#e0a316`.
- Validated altitude ramp, dim→bright, use verbatim: `#32554b`, `#467466`, `#5d9383`, `#77b3a1`, `#90d4c0`.
- The ramp encodes **horizon-ness (`90 − alt`), not altitude** — alt 90° gets `#32554b`, alt 1° gets `#90d4c0`. Legend labels read in degrees of altitude. This inversion is deliberate and must be stated in the sketch header comment; it is the thing the page is about.
- `alt === 0` is **not on the ramp**. It is a reserved categorical mark: `#e0a316`, drawn as a hollow ring (stroke, no fill).
- Every sketch file opens with a house-style comment explaining *why*, not *what* — see `sketches/2026-08-edge/sketch.js` for the register.
- Test names in `test.mjs` are sentences describing behaviour, not `test_x_works`.
- Commit after every task. Conventional commits, lowercase scope: `feat(eclipse-horizon): …`.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/fetch-eclipses.mjs` | Create. Fetch + parse 50 catalog pages → `public/data/eclipses.json`. Manual run only. |
| `public/data/eclipses.json` | Create (committed). Parallel arrays of the catalog. |
| `sketches/2026-08-eclipse-horizon/meta.json` | Create. Gallery metadata. |
| `sketches/2026-08-eclipse-horizon/index.html` | Create. Canvas, controls, hint block, styles. |
| `sketches/2026-08-eclipse-horizon/globe.js` | Create. Orthographic projection, graticule, sphere chrome. |
| `sketches/2026-08-eclipse-horizon/points.js` | Create. Colour ramp, mark drawing, z-ordering. |
| `sketches/2026-08-eclipse-horizon/sketch.js` | Create. Data load, state, input, time, readout, render loop. |
| `test.mjs` | Modify. Add one node-side and one browser-side section. |

---

### Task 1: The fetch script and the data

**Files:**
- Create: `scripts/fetch-eclipses.mjs`
- Create: `public/data/eclipses.json` (generated, then committed)
- Test: `test.mjs` (new node-side section, inserted before the `// --- geotiff` section)

**Interfaces:**
- Consumes: nothing.
- Produces: `public/data/eclipses.json` with exactly these keys —
  `{ year: number[], lat: number[], lon: number[], alt: number[], gamma: number[], type: string, count: number }`.
  `lat`/`lon` signed integer degrees (N/E positive), `alt` integer degrees 0–90, `gamma` signed float 4dp, `type` one char per eclipse (`T`/`A`/`H`/`P`) in a single string of length `count`. All arrays length `count`, chronological.

- [ ] **Step 1: Write the failing test**

Insert into `test.mjs` immediately after the `const failures = [];` / `async function test(...)` block and before the geotiff section:

```js
// ----------------------------------------------------------------- eclipses
// Node-side: the data is on disk and the claim this sketch makes is a claim
// about the data, so neither the server nor a page is involved.
{
  const raw = JSON.parse(readFileSync(new URL('./public/data/eclipses.json', import.meta.url), 'utf8'));

  await test('the catalog parsed whole, with every column the same length', async () => {
    assert.ok(raw.count > 11000, `only ${raw.count} eclipses — pages are missing`);
    for (const k of ['year', 'lat', 'lon', 'alt', 'gamma']) {
      assert.equal(raw[k].length, raw.count, `${k} is ${raw[k].length}, count is ${raw.count}`);
    }
    assert.equal(raw.type.length, raw.count);
    assert.ok(raw.year[0] < -1900, `starts at ${raw.year[0]}, not the BCE end`);
    assert.ok(raw.year[raw.count - 1] > 2900, `ends at ${raw.year[raw.count - 1]}`);
  });

  // The design's central claim, asserted against its own source. If a refetch
  // ever changes this, the build fails loudly rather than the page quietly
  // telling a story that is no longer true.
  await test('every horizon eclipse lands between 60 and 72 degrees of latitude', async () => {
    const horizon = [];
    for (let i = 0; i < raw.count; i++) if (raw.alt[i] === 0) horizon.push(Math.abs(raw.lat[i]));
    assert.ok(horizon.length / raw.count > 0.3, `only ${horizon.length} at the horizon`);
    assert.equal(Math.min(...horizon), 60, `the band's low edge moved to ${Math.min(...horizon)}`);
    assert.equal(Math.max(...horizon), 72, `the band's high edge moved to ${Math.max(...horizon)}`);
  });

  // Every partial is a horizon eclipse; the converse is false, and the
  // exceptions are the interesting ones. 68 annular and 26 total eclipses also
  // peak at 0° — the "non-central" ones the catalog marks A- and T+, where the
  // shadow axis misses the Earth but the antumbra still grazes the polar limb.
  // They are the same near-miss geometry as the partials, caught one notch
  // closer in. Asserting the biconditional would delete them.
  await test('a partial always peaks on the horizon, and it is not alone there', async () => {
    let partials = 0, nonCentral = 0;
    for (let i = 0; i < raw.count; i++) {
      if (raw.type[i] === 'P') { partials++; assert.equal(raw.alt[i], 0, `partial in ${raw.year[i]} peaks at ${raw.alt[i]}°`); }
      else if (raw.alt[i] === 0) {
        nonCentral++;
        assert.ok('AT'.includes(raw.type[i]), `alt 0 in ${raw.year[i]} is type ${raw.type[i]}`);
        assert.ok(Math.abs(raw.gamma[i]) > 0.99, `a non-central ${raw.type[i]} in ${raw.year[i]} at gamma ${raw.gamma[i]}`);
      }
    }
    assert.ok(partials > 4000, `only ${partials} partials`);
    assert.ok(nonCentral > 50 && nonCentral < 200, `${nonCentral} non-central eclipses at the horizon`);
  });
}
```

`readFileSync` is already imported at the top of `test.mjs`. Confirm it is; if not, add it to the existing `node:fs` import.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | head -30`
Expected: it throws while loading `public/data/eclipses.json` — the file does not exist yet. That is the correct failure.

- [ ] **Step 3: Write the fetch script**

Create `scripts/fetch-eclipses.mjs`:

```js
// Pulls Fred Espenak's Five Millennium Catalog of Solar Eclipses (-1999 to
// +3000) into one JSON file. Run by hand, never by `make dev` — the sketch
// reads the committed output, so a page load never depends on NASA being up.
//
//   node scripts/fetch-eclipses.mjs
//
// Parsing the catalog resists both obvious approaches. Whitespace splitting
// fails because partial eclipses leave Path Width and Central Duration blank,
// so a row is 17 fields or 15 depending on whether the Moon's shadow touched
// the Earth. Fixed-column slicing fails because the BCE pages carry a negative
// year one character wider than the CE pages. What every row does have is a
// 5-digit catalog number at the front and NN[NS]/NNN[EW] hemisphere letters
// near the back, so the regex anchors on those and counts the columns between.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://eclipse.gsfc.nasa.gov/SEcat5';

// -1999 -> "-1999", -99 -> "-0099", 0 -> "0000", 1 -> "0001", 2901 -> "2901".
const fmt = (y) => (y < 0 ? '-' + String(-y).padStart(4, '0') : String(y).padStart(4, '0'));

function pages() {
  const out = [];
  for (let a = -1999; a < 0; a += 100) out.push([a, a + 99]);   // ...-0099..0000
  for (let a = 1; a <= 2901; a += 100) out.push([a, a + 99]);   // 0001-0100...
  return out.map(([a, b]) => `${BASE}/SE${fmt(a)}-${fmt(b)}.html`);
}

// catnum  year mon day  time  dT luna saros type QLE gamma mag lat lon alt ...
const ROW = /^(\d{5})\s+(-?\d{1,4})\s+(\w{3})\s+(\d+)\s+\S+\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(-?\d\.\d+)\s+(\d\.\d+)\s+(\d+)([NS])\s+(\d+)([EW])\s+(\d+)/;
// A line that starts like a row but does not match is a parse failure, not a
// line to skip. This is what tells the difference.
const LOOKS_LIKE_ROW = /^\d{5}\s+-?\d{1,4}\s+\w{3}\s/;

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.text();
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (i === tries - 1) throw new Error(`${url}: ${e.message}`);
      await new Promise((s) => setTimeout(s, 1000 * (i + 1)));
    }
  }
}

const rows = [];
let unmatched = 0;
const urls = pages();
console.log(`fetching ${urls.length} century pages`);

for (const url of urls) {
  const html = await get(url);
  for (const block of html.match(/<pre>[\s\S]*?<\/pre>/g) ?? []) {
    const text = block.replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    for (const line of text.split('\n')) {
      if (!LOOKS_LIKE_ROW.test(line)) continue;
      const m = ROW.exec(line);
      if (!m) { unmatched++; console.error(`unmatched: ${line.slice(0, 90)}`); continue; }
      rows.push({
        year: Number(m[2]),
        type: m[9][0],
        gamma: Number(m[11]),
        lat: Number(m[13]) * (m[14] === 'N' ? 1 : -1),
        lon: Number(m[15]) * (m[16] === 'E' ? 1 : -1),
        alt: Number(m[17]),
      });
    }
  }
  process.stdout.write('.');
}
console.log();

if (unmatched) throw new Error(`${unmatched} rows looked like data and did not parse`);
if (rows.length < 11000) throw new Error(`only ${rows.length} eclipses — a page came back empty`);

const out = {
  count: rows.length,
  year: rows.map((r) => r.year),
  lat: rows.map((r) => r.lat),
  lon: rows.map((r) => r.lon),
  alt: rows.map((r) => r.alt),
  gamma: rows.map((r) => r.gamma),
  type: rows.map((r) => r.type).join(''),
};

mkdirSync(resolve(root, 'public', 'data'), { recursive: true });
writeFileSync(resolve(root, 'public', 'data', 'eclipses.json'), JSON.stringify(out));

const horizon = rows.filter((r) => r.alt === 0);
const lats = horizon.map((r) => Math.abs(r.lat));
console.log(`${rows.length} eclipses, ${rows[0].year} to ${rows[rows.length - 1].year}`);
console.log(`${horizon.length} at the horizon (${(100 * horizon.length / rows.length).toFixed(1)}%), `
  + `|lat| ${Math.min(...lats)}-${Math.max(...lats)}`);
```

- [ ] **Step 4: Run the script**

Run: `node scripts/fetch-eclipses.mjs`
Expected: 50 dots, then a summary reading `11898 eclipses, -1999 to 3000` and `4294 at the horizon (36.1%), |lat| 60-72`.

**If the count differs from 11,898, the parser is right and the spec's number was wrong** — say so in the commit message and move on. If any line reports `unmatched`, stop: read the offending line and widen `ROW` to cover it. Do not loosen `LOOKS_LIKE_ROW` to make the error disappear.

**The numbers below are measured over all 50 pages and are the ones to use.**
An earlier draft of this plan carried `60`/`80` and 35.3%, read off a 10°-bin
histogram of 20 centuries. The bin edge was not the extremum. The full run says:

```
11,898 eclipses          -1999 to +3000, exactly the published count
 4,294 at alt 0 (36.1%)  |lat| 60-72, exact — nothing outside the band
       of those: 4,200 partial, 68 non-central annular, 26 non-central total
45.1%  of all eclipses peak with the Sun 30° or lower
91.8%  of eclipses inside |lat| 15 peak with the Sun 60° or higher
```

If your run disagrees with any of these, the run is the authority and something
is wrong with this plan — report the discrepancy rather than editing the numbers
to match, because three later tasks and the spec now quote them.

A band that is not a band at all — horizon eclipses near the equator — would
falsify the sketch's premise. Stop and report BLOCKED with the offending rows.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test 2>&1 | grep -A2 -i eclipse`
Expected: the three eclipse tests print `ok`.

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-eclipses.mjs public/data/eclipses.json test.mjs
git commit -m "feat(eclipse-horizon): the five millennium catalog, parsed and pinned"
```

---

### Task 2: The globe, empty

**Files:**
- Create: `sketches/2026-08-eclipse-horizon/meta.json`
- Create: `sketches/2026-08-eclipse-horizon/index.html`
- Create: `sketches/2026-08-eclipse-horizon/globe.js`
- Create: `sketches/2026-08-eclipse-horizon/sketch.js`
- Test: `test.mjs` (new browser section at the end, before the final `await page.close()` / `finally`)

**Interfaces:**
- Consumes: `public/data/eclipses.json` from Task 1 (loaded but not yet drawn).
- Produces:
  - `globe.js` exports `project(latDeg, lonDeg, view)` → `{ x, y, z }` in unit-sphere coordinates, `z < 0` meaning the far side; and `drawGlobe(ctx, view, r, cx, cy)` which paints disc + graticule.
  - `view` is `{ lambda, phi }` in **degrees** throughout the sketch.
  - `sketch.js` sets `window.eclipse` with `{ view: () => ({...}), inkCount: () => number, ready: () => boolean }`. Later tasks extend this object; they must not rename these three.

- [ ] **Step 1: Write the failing test**

Add near the other `const X = \`${BASE}/sketches/...\`` declarations:

```js
const ECLIPSE = `${BASE}/sketches/2026-08-eclipse-horizon/`;
```

Add a new section at the end of the browser tests, following the `ERRAND` section's shape:

```js
// ------------------------------------------------------------ eclipse-horizon
{
  const p = await browser.newPage();
  await p.goto(ECLIPSE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.eclipse?.ready(), null, { timeout: 15000 });
  await p.waitForTimeout(400);

  await test('the globe draws itself with no gesture', async () => {
    const ink = await p.evaluate(() => window.eclipse.inkCount());
    assert.ok(ink > 2000, `only ${ink} lit pixels — the canvas is effectively blank`);
  });

  await p.close();
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | grep -B2 -A2 globe`
Expected: FAIL — the page 404s, so `window.eclipse` never appears and `waitForFunction` times out.

- [ ] **Step 3: Write meta.json**

```json
{
  "title": "eclipse horizon",
  "date": "2026-08-13",
  "tags": ["nasa", "eclipses", "globe", "canvas", "deep-time"],
  "description": "All 11,898 solar eclipses from 1999 BC to 3000 AD, plotted where each one peaked. 36% of them peak with the Sun exactly on the horizon, and every single one of those lands in two rings between 60 and 72 degrees of latitude — because the Moon's shadow misses the Earth entirely about a third of the time, and a near miss is only visible from the sunrise line."
}
```

- [ ] **Step 4: Write index.html**

Follow `sketches/2026-08-edge/index.html` exactly for the chrome — same back link, same `#ui` panel rules, same fonts and colours. The controls are added in Task 5; leave the panel in place with only the hint block populated.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>eclipse horizon</title>
  <style>
    body { margin: 0; padding-bottom: 7rem; box-sizing: border-box; background: #0e0e11; color: #e8e6e0; font: 14px ui-monospace, monospace; display: grid; place-items: center; min-height: 100vh; }
    a.back { position: fixed; top: 1rem; left: 1rem; color: #8a877e; text-decoration: none; }
    canvas { touch-action: none; cursor: grab; }
    canvas.dragging { cursor: grabbing; }
    #ui { position: fixed; bottom: 0.75rem; left: 0; right: 0; margin: 0 auto; width: fit-content; max-width: calc(100vw - 2rem); display: flex; flex-direction: column; gap: 0.4rem; background: #17171cdd; padding: 0.5rem 0.7rem; border-radius: 8px; }
    .row { display: flex; gap: 0.4rem; align-items: center; justify-content: center; flex-wrap: wrap; }
    button { background: #26262e; color: #e8e6e0; border: 1px solid #444; border-radius: 4px; padding: 0.3rem 0.55rem; font: inherit; font-size: 13px; cursor: pointer; }
    button:hover { border-color: #7fb3a3; }
    label { display: flex; gap: 0.3rem; align-items: center; color: #8a877e; font-size: 11px; }
    label .val { color: #e8e6e0; min-width: 3.5rem; }
    input[type=range] { accent-color: #7fb3a3; }
    #hint { position: fixed; top: 1rem; right: 1rem; color: #8a877e; text-align: right; line-height: 1.5; font-size: 12px; max-width: 22rem; }
    #hint b { color: #e0a316; font-weight: normal; }
  </style>
</head>
<body>
  <a class="back" href="/">← sketchbook</a>
  <div id="hint">
    drag to turn · space = play/pause<br />
    <b>a sphere is horizon-heavy for free:</b> half of all<br />
    daylight anywhere is below 30° too. the rings<br />
    are what eclipses add to that.
  </div>
  <div id="ui"><div class="row" id="controls"></div></div>
  <script type="module" src="./sketch.js"></script>
</body>
</html>
```

- [ ] **Step 5: Write globe.js**

```js
// Orthographic projection and the sphere's furniture. Six lines of trig, which
// is why this sketch imports no drawing library: p5's WEBGL mode would mean
// fighting a camera to arrive back here, and d3-geo would charge per-frame path
// generation for a projection that is three cosines.
const RAD = Math.PI / 180;

// view.lambda = longitude at the centre, view.phi = latitude at the centre.
// z < 0 is the far side of the sphere and should not be drawn.
export function project(latDeg, lonDeg, view) {
  const lat = latDeg * RAD, dl = (lonDeg - view.lambda) * RAD, phi = view.phi * RAD;
  const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
  const cosDl = Math.cos(dl);
  return {
    x: cosLat * Math.sin(dl),
    y: Math.cos(phi) * sinLat - Math.sin(phi) * cosLat * cosDl,
    z: Math.sin(phi) * sinLat + Math.cos(phi) * cosLat * cosDl,
  };
}

function strokeParallel(ctx, latDeg, view, r, cx, cy) {
  ctx.beginPath();
  let drawing = false;
  for (let lon = -180; lon <= 180; lon += 2) {
    const q = project(latDeg, lon, view);
    if (q.z < 0) { drawing = false; continue; }
    const px = cx + q.x * r, py = cy - q.y * r;
    if (drawing) ctx.lineTo(px, py); else { ctx.moveTo(px, py); drawing = true; }
  }
  ctx.stroke();
}

function strokeMeridian(ctx, lonDeg, view, r, cx, cy) {
  ctx.beginPath();
  let drawing = false;
  for (let lat = -90; lat <= 90; lat += 2) {
    const q = project(lat, lonDeg, view);
    if (q.z < 0) { drawing = false; continue; }
    const px = cx + q.x * r, py = cy - q.y * r;
    if (drawing) ctx.lineTo(px, py); else { ctx.moveTo(px, py); drawing = true; }
  }
  ctx.stroke();
}

export function drawGlobe(ctx, view, r, cx, cy) {
  ctx.fillStyle = '#15151a';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

  ctx.lineWidth = 1;
  ctx.strokeStyle = '#26262e';
  for (let lat = -75; lat <= 75; lat += 15) if (lat % 15 === 0) strokeParallel(ctx, lat, view, r, cx, cy);
  for (let lon = -180; lon < 180; lon += 15) strokeMeridian(ctx, lon, view, r, cx, cy);

  // 60 and 72 are drawn heavier because they are exactly what the horizon
  // eclipses refuse to cross — measured over all 11,898, not rounded to the
  // graticule. Drawing them is the difference between a pattern a viewer
  // notices and one they can check.
  ctx.strokeStyle = '#3c4a46';
  ctx.lineWidth = 1.5;
  for (const lat of [-72, -60, 60, 72]) strokeParallel(ctx, lat, view, r, cx, cy);

  ctx.strokeStyle = '#2e2e38';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
}
```

- [ ] **Step 6: Write sketch.js**

```js
// Every solar eclipse NASA has computed, from 1999 BC to 3000 AD, plotted at
// the point where it peaked. The claim the page makes is not subtle and is not
// argued: a third of them have the Sun at exactly 0°, and every one of those
// lands between 60° and 80° of latitude. Turn the globe and the two rings are
// simply there.
//
// Why gamma: the Moon's shadow axis misses the Earth's centre by a distance
// that, over 5,000 years, is uniformly distributed from 0 to about 1.55 Earth
// radii. The Earth stops at 1.0. So a third of the range is the shadow sailing
// past the planet entirely, and those eclipses are visible only from the sliver
// of surface curving away toward the terminator — sunrise, high latitude, Sun
// on the horizon, all three by construction rather than by coincidence.
//
// The colour ramp runs on horizon-ness (90 − alt), not altitude, so the low Sun
// is the bright end. That is backwards for an altitude scale and correct for
// this page, whose subject is the horizon.
//
// No p5 and no import at all: see globe.js for why the projection does not
// need one.
import { project, drawGlobe } from './globe.js';

const SIZE = 720;
const canvas = document.createElement('canvas');
canvas.width = SIZE; canvas.height = SIZE;
document.body.insertBefore(canvas, document.getElementById('ui'));
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const view = { lambda: 20, phi: 25 };
let data = null;

function render() {
  ctx.fillStyle = '#0e0e11';
  ctx.fillRect(0, 0, SIZE, SIZE);
  drawGlobe(ctx, view, SIZE * 0.44, SIZE / 2, SIZE / 2);
}

function loop() { render(); requestAnimationFrame(loop); }

window.eclipse = {
  view: () => ({ ...view }),
  ready: () => data !== null,
  // Cheap "is anything actually drawn" probe for the tests. Counts pixels that
  // differ from the page background on a coarse grid.
  inkCount: () => {
    const d = ctx.getImageData(0, 0, SIZE, SIZE).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 4) {
      if (d[i] !== 14 || d[i + 1] !== 14 || d[i + 2] !== 17) n++;
    }
    return n;
  },
};

fetch('/data/eclipses.json')
  .then((r) => r.json())
  .then((j) => { data = j; })
  .catch((e) => { console.error('eclipses.json did not load', e); });

loop();
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test 2>&1 | grep -B2 -A2 globe`
Expected: `ok   the globe draws itself with no gesture`

- [ ] **Step 8: Commit**

```bash
git add sketches/2026-08-eclipse-horizon test.mjs
git commit -m "feat(eclipse-horizon): a sphere, its graticule, and the two circles that matter"
```

---

### Task 3: The points, and what colour they are

**Files:**
- Create: `sketches/2026-08-eclipse-horizon/points.js`
- Modify: `sketches/2026-08-eclipse-horizon/sketch.js`
- Test: `test.mjs` (eclipse-horizon browser section)

**Interfaces:**
- Consumes: `project` from `globe.js`; `data` shape from Task 1.
- Produces:
  - `points.js` exports `RAMP` (the five hex strings, dim→bright), `HORIZON_COLOR` (`'#e0a316'`), `colorFor(alt)` → hex string, and `drawPoints(ctx, data, upTo, view, r, cx, cy)`.
  - `drawPoints` returns the number of marks actually painted (front hemisphere only).
  - `window.eclipse.drawn()` → that number.

- [ ] **Step 1: Write the failing test**

Add to the eclipse-horizon browser section, before `await p.close()`:

```js
await test('an overhead eclipse and a horizon eclipse are not the same mark', async () => {
  const c = await p.evaluate(() => [
    window.eclipse.colorFor(0), window.eclipse.colorFor(1),
    window.eclipse.colorFor(45), window.eclipse.colorFor(90),
  ]);
  assert.equal(c[0], '#e0a316', 'the horizon spike is not on its reserved colour');
  assert.equal(c[3], '#32554b', 'overhead is not the dim end');
  assert.equal(c[1], '#90d4c0', 'a 1-degree Sun is not the bright end');
  assert.notEqual(c[1], c[2], 'the ramp is flat');
});

await test('it draws the front hemisphere and not the back', async () => {
  const drawn = await p.evaluate(() => window.eclipse.drawn());
  const total = await p.evaluate(() => window.eclipse.total());
  assert.ok(drawn > 1000, `only ${drawn} marks drawn`);
  assert.ok(drawn < total * 0.75, `${drawn} of ${total} drawn — the far side is being painted`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | grep -A2 "same mark"`
Expected: FAIL — `window.eclipse.colorFor is not a function`.

- [ ] **Step 3: Write points.js**

```js
// The altitude encoding. Two things share this globe and they are not the same
// kind of thing, so they do not share a scale.
//
// The 3,000-odd central eclipses spread across every altitude and get a
// sequential ramp. The 1,600-odd horizon eclipses are not the bottom of that
// ramp — they are a third of the data stacked on one value, and a sequential
// scale renders a categorical spike as a merely-dark end. So they get a
// reserved colour and a different mark: a hollow ring against filled dots.
// The bands then survive greyscale, colour-blindness, and thumbnail size,
// which is where most people meet this page.
//
// Ramp validated dim→bright against the #0e0e11 surface: monotone lightness,
// adjacent OKLCH ΔL ≥ 0.06, dim end 2.33:1, single hue (1° spread). Amber
// against the ramp clears CVD ΔE 15.4 (protan) and 18.5 unsimulated.
import { project } from './globe.js';

export const RAMP = ['#32554b', '#467466', '#5d9383', '#77b3a1', '#90d4c0'];
export const HORIZON_COLOR = '#e0a316';

// Horizon-ness, not altitude: alt 90 is the dim end, alt 1 the bright one.
export function colorFor(alt) {
  if (alt === 0) return HORIZON_COLOR;
  const t = 1 - (alt - 1) / 89;                       // 0 at overhead, 1 at the horizon
  return RAMP[Math.min(RAMP.length - 1, Math.max(0, Math.round(t * (RAMP.length - 1))))];
}

export function drawPoints(ctx, data, upTo, view, r, cx, cy) {
  // Back-to-front by z so the near hemisphere is drawn over the limb rather
  // than the far side being painted at all. One pass collects, one sorts.
  const vis = [];
  for (let i = 0; i < upTo; i++) {
    const q = project(data.lat[i], data.lon[i], view);
    if (q.z <= 0) continue;
    vis.push([q.z, cx + q.x * r, cy - q.y * r, data.alt[i]]);
  }
  vis.sort((a, b) => a[0] - b[0]);

  for (const [, px, py, alt] of vis) {
    if (alt === 0) {
      ctx.strokeStyle = HORIZON_COLOR;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(px, py, 2.6, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = colorFor(alt);
      ctx.beginPath(); ctx.arc(px, py, 1.9, 0, Math.PI * 2); ctx.fill();
    }
  }
  return vis.length;
}
```

- [ ] **Step 4: Wire it into sketch.js**

Add the import, track the count, and extend the exposed object:

```js
import { project, drawGlobe } from './globe.js';
import { drawPoints, colorFor } from './points.js';
```

Replace `render()` with:

```js
let drawn = 0;

function render() {
  ctx.fillStyle = '#0e0e11';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const r = SIZE * 0.44;
  drawGlobe(ctx, view, r, SIZE / 2, SIZE / 2);
  drawn = data ? drawPoints(ctx, data, data.count, view, r, SIZE / 2, SIZE / 2) : 0;
}
```

Add to `window.eclipse`:

```js
  drawn: () => drawn,
  total: () => (data ? data.count : 0),
  colorFor,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test 2>&1 | grep -A2 -E "same mark|front hemisphere"`
Expected: both `ok`.

- [ ] **Step 6: Look at it**

Run: `npm run dev`, open the sketch, and confirm by eye that two amber rings are visible near the poles and the teal dots crowd the tropics. The validator checks colour, not layout. If the rings are not obvious, the marks are too small — raise both radii by 0.5 and re-check, but do not change the colours.

- [ ] **Step 7: Commit**

```bash
git add sketches/2026-08-eclipse-horizon test.mjs
git commit -m "feat(eclipse-horizon): a ramp for the sun's height and a ring for the ones at zero"
```

---

### Task 4: Turning it

**Files:**
- Modify: `sketches/2026-08-eclipse-horizon/sketch.js`
- Test: `test.mjs` (eclipse-horizon browser section)

**Interfaces:**
- Consumes: `view` and `window.eclipse.view()` from Task 2.
- Produces: pointer drag rotates; idle spin resumes after 3 s; no new exports.

- [ ] **Step 1: Write the failing test**

```js
await test('dragging turns the globe, and letting go hands it back to the drift', async () => {
  const before = await p.evaluate(() => window.eclipse.view());
  const box = await p.locator('canvas').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 40, { steps: 8 });
  await p.mouse.up();
  const after = await p.evaluate(() => window.eclipse.view());
  assert.ok(Math.abs(after.lambda - before.lambda) > 10, `lambda barely moved (${before.lambda} → ${after.lambda})`);
  assert.ok(Math.abs(after.phi - before.phi) > 3, `phi barely moved (${before.phi} → ${after.phi})`);
  assert.ok(after.phi <= 90 && after.phi >= -90, `phi escaped its clamp at ${after.phi}`);

  await p.waitForTimeout(3800);
  const drifted = await p.evaluate(() => window.eclipse.view());
  assert.notEqual(drifted.lambda, after.lambda, 'the idle drift never resumed');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | grep -A2 "hands it back"`
Expected: FAIL — lambda barely moved; there is no drag handler yet.

- [ ] **Step 3: Implement drag and drift**

Add to `sketch.js` above `loop()`:

```js
// Pointer events rather than mouse events: one code path covers trackpad and
// touch, and setPointerCapture means a drag that leaves the canvas still ends
// on this element rather than being dropped mid-gesture.
let dragging = false, lastX = 0, lastY = 0, idleSince = performance.now();

canvas.addEventListener('pointerdown', (e) => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  view.lambda = ((view.lambda - (e.clientX - lastX) * 0.35 + 180) % 360 + 360) % 360 - 180;
  view.phi = Math.max(-90, Math.min(90, view.phi + (e.clientY - lastY) * 0.35));
  lastX = e.clientX; lastY = e.clientY;
  idleSince = performance.now();
});

for (const ev of ['pointerup', 'pointercancel']) {
  canvas.addEventListener(ev, () => {
    dragging = false;
    canvas.classList.remove('dragging');
    idleSince = performance.now();
  });
}
```

In `loop()`, drift when idle:

```js
function loop(now) {
  if (!dragging && now - idleSince > 3000) {
    view.lambda = ((view.lambda + 0.08 + 180) % 360 + 360) % 360 - 180;
  }
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
```

Remove the old bare `loop()` call at the bottom of the file — `requestAnimationFrame` supplies `now`, and calling `loop()` directly would pass `undefined`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | grep -A2 "hands it back"`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add sketches/2026-08-eclipse-horizon test.mjs
git commit -m "feat(eclipse-horizon): turn it by hand, and it drifts on when you stop"
```

---

### Task 5: Deep time

**Files:**
- Modify: `sketches/2026-08-eclipse-horizon/index.html` (populate `#controls`)
- Modify: `sketches/2026-08-eclipse-horizon/sketch.js`
- Test: `test.mjs` (eclipse-horizon browser section)

**Interfaces:**
- Consumes: `data`, `drawPoints`, `view`.
- Produces: `window.eclipse` gains `year()`, `setIndex(i)`, `index()`, `playing()`, `stats()`.
  `stats()` → `{ n, pctLow, pctZero, latMin, latMax }` computed over the first `index()` eclipses only — `pctLow` is the share with `alt <= 30`, `pctZero` the share with `alt === 0`, `latMin`/`latMax` the `|lat|` extremes of the `alt === 0` subset (both `null` when none have landed yet).

- [ ] **Step 1: Write the failing test**

```js
await test('the past is a prefix: scrubbing back draws strictly fewer eclipses', async () => {
  await p.evaluate(() => window.eclipse.setIndex(window.eclipse.total()));
  await p.waitForTimeout(120);
  const all = await p.evaluate(() => window.eclipse.drawn());
  await p.evaluate(() => window.eclipse.setIndex(Math.floor(window.eclipse.total() / 4)));
  await p.waitForTimeout(120);
  const quarter = await p.evaluate(() => window.eclipse.drawn());
  assert.ok(quarter < all, `${quarter} drawn at a quarter, ${all} at the end`);
  assert.ok(quarter > 100, `only ${quarter} drawn at a quarter of the catalog`);
});

await test('the readout earns its numbers as the points land', async () => {
  await p.evaluate(() => window.eclipse.setIndex(window.eclipse.total()));
  await p.waitForTimeout(150);
  const s = await p.evaluate(() => window.eclipse.stats());
  assert.ok(Math.abs(s.pctZero - 36.1) < 1, `${s.pctZero}% at the horizon, expected 36.1`);
  assert.ok(Math.abs(s.pctLow - 45.1) < 1, `${s.pctLow}% below 30 degrees, expected 45.1`);
  assert.equal(s.latMin, 60, `horizon eclipses reach down to ${s.latMin}`);
  assert.equal(s.latMax, 72, `horizon eclipses reach up to ${s.latMax}`);

  // Early on the claim has not been earned yet, and the page should show that
  // rather than a settled number computed from data not yet on screen.
  await p.evaluate(() => window.eclipse.setIndex(12));
  await p.waitForTimeout(120);
  const early = await p.evaluate(() => window.eclipse.stats());
  assert.equal(early.n, 12, `stats read ${early.n} with 12 eclipses placed`);
  assert.notEqual(early.pctZero, s.pctZero, 'the readout is not tracking what has landed');
});

await test('space plays and pauses the five thousand years', async () => {
  await p.evaluate(() => window.eclipse.setIndex(0));
  await p.keyboard.press('Space');
  await p.waitForTimeout(700);
  assert.equal(await p.evaluate(() => window.eclipse.playing()), true);
  const moving = await p.evaluate(() => window.eclipse.index());
  assert.ok(moving > 0, 'play did not advance the catalog');
  await p.keyboard.press('Space');
  await p.waitForTimeout(300);
  const held = await p.evaluate(() => window.eclipse.index());
  await p.waitForTimeout(500);
  assert.equal(await p.evaluate(() => window.eclipse.index()), held, 'pause did not hold');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | grep -A2 -E "past is a prefix|earns its numbers|plays and pauses"`
Expected: all three FAIL — `window.eclipse.setIndex is not a function`.

- [ ] **Step 3: Add the controls to index.html**

Replace `<div id="ui"><div class="row" id="controls"></div></div>` with:

```html
  <div id="ui">
    <div class="row">
      <button id="play">play</button>
      <button id="reset">rewind</button>
      <label>year <input id="scrub" type="range" min="0" max="1" step="1" value="1" style="width: 18rem" /><span class="val" id="year">—</span></label>
      <label>speed <input id="speed" type="range" min="1" max="60" step="1" value="18" style="width: 5rem" /></label>
    </div>
    <div class="row" id="readout"></div>
  </div>
```

Add to the `<style>` block:

```css
    #readout { color: #8a877e; font-size: 11px; gap: 1.1rem; }
    #readout b { color: #e8e6e0; font-weight: normal; }
    #readout .zero { color: #e0a316; }
```

- [ ] **Step 4: Implement time in sketch.js**

Add state and controls:

```js
let index = 0;            // eclipses placed so far
let playing = false;
let carry = 0;            // fractional eclipses between frames
let lastFrame = performance.now();

const $ = (id) => document.getElementById(id);

function stats() {
  let low = 0, zero = 0, latMin = null, latMax = null;
  for (let i = 0; i < index; i++) {
    if (data.alt[i] <= 30) low++;
    if (data.alt[i] === 0) {
      zero++;
      const a = Math.abs(data.lat[i]);
      if (latMin === null || a < latMin) latMin = a;
      if (latMax === null || a > latMax) latMax = a;
    }
  }
  return {
    n: index,
    pctLow: index ? +(100 * low / index).toFixed(1) : 0,
    pctZero: index ? +(100 * zero / index).toFixed(1) : 0,
    latMin, latMax,
  };
}

const yearLabel = (y) => (y < 0 ? `${-y} BC` : `${y} AD`);

function paintReadout() {
  const s = stats();
  const band = s.latMin === null ? '—' : `${s.latMin}–${s.latMax}°`;
  $('readout').innerHTML =
    `<span>placed <b>${s.n}</b></span>`
    + `<span>sun ≤30° <b>${s.pctLow}%</b></span>`
    + `<span class="zero">sun exactly 0° <b>${s.pctZero}%</b></span>`
    + `<span class="zero">their latitudes <b>${band}</b></span>`;
}

function setIndex(i) {
  index = Math.max(0, Math.min(data.count, Math.round(i)));
  $('scrub').value = String(index);
  $('year').textContent = index > 0 ? yearLabel(data.year[index - 1]) : '—';
  paintReadout();
}
```

Recomputing `stats()` over the full prefix on every scrub is 11,898 iterations — under a millisecond, and running it fresh means there is no incremental counter to drift out of sync with what is drawn. Do not optimise this into an accumulator.

Wire the controls once the data has loaded, inside the `.then((j) => { … })` callback:

```js
    data = j;
    $('scrub').max = String(j.count);
    $('scrub').addEventListener('input', (e) => { playing = false; $('play').textContent = 'play'; setIndex(+e.target.value); });
    $('play').addEventListener('click', togglePlay);
    $('reset').addEventListener('click', () => { setIndex(0); });
    setIndex(j.count);
```

Add play control and keyboard:

```js
function togglePlay() {
  playing = !playing;
  if (playing && index >= data.count) setIndex(0);
  $('play').textContent = playing ? 'pause' : 'play';
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || !data) return;
  e.preventDefault();
  togglePlay();
});
```

Advance in `loop(now)`, before `render()`:

```js
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (playing && data) {
    carry += dt * (+$('speed').value) * 12;
    if (carry >= 1) {
      setIndex(index + Math.floor(carry));
      carry %= 1;
      if (index >= data.count) { playing = false; $('play').textContent = 'play'; }
    }
  }
```

Change `render()` to draw the prefix: `drawPoints(ctx, data, index, view, r, SIZE / 2, SIZE / 2)`.

Extend `window.eclipse`:

```js
  year: () => (index > 0 ? data.year[index - 1] : null),
  index: () => index,
  setIndex,
  playing: () => playing,
  stats,
```

`setIndex` and `stats` reference `data`, so guard the exposed `stats` for the pre-load case by keeping `ready()` as the gate the tests already wait on.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test 2>&1 | grep -A2 -E "past is a prefix|earns its numbers|plays and pauses"`
Expected: all three `ok`.

- [ ] **Step 6: Watch it run**

Run `npm run dev`, rewind, and press play. Confirm the rings precipitate out of scatter rather than appearing all at once, and that the readout's percentages visibly wobble early and settle late. If it finishes too fast to read, lower the `speed` slider's default `value` in `index.html`.

- [ ] **Step 7: Commit**

```bash
git add sketches/2026-08-eclipse-horizon test.mjs
git commit -m "feat(eclipse-horizon): five thousand years, and a readout that earns its numbers"
```

---

### Task 6: The legend, and leaving it findable

**Files:**
- Modify: `sketches/2026-08-eclipse-horizon/index.html`
- Modify: `sketches/2026-08-eclipse-horizon/sketch.js`
- Modify: `README.md`
- Create: `public/sketches/2026-08-eclipse-horizon/thumb.png` (generated)

**Interfaces:**
- Consumes: `RAMP` and `HORIZON_COLOR` from `points.js`.
- Produces: nothing new on `window.eclipse`.

- [ ] **Step 1: Write the failing test**

```js
await test('the page says what its colours mean, in degrees', async () => {
  const txt = await p.evaluate(() => document.getElementById('legend').innerText);
  assert.match(txt, /0°/, 'the horizon mark is unlabelled');
  assert.match(txt, /90°/, 'the overhead end is unlabelled');
  const swatches = await p.evaluate(() =>
    [...document.querySelectorAll('#legend i')].map((el) => getComputedStyle(el).backgroundColor));
  assert.ok(swatches.length >= 5, `only ${swatches.length} swatches`);

  // The horizon key must be hollow like the mark it stands for. Asserting on
  // the border rather than the fill is the point: a filled amber dot here
  // would advertise an encoding the globe does not use.
  const ring = await p.evaluate(() => {
    const s = getComputedStyle(document.querySelector('#legend i.ring'));
    return { border: s.borderTopColor, fill: s.backgroundColor };
  });
  assert.equal(ring.border, 'rgb(224, 163, 22)', 'the horizon key is not on its reserved colour');
  assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(ring.fill),
    `the horizon key is filled (${ring.fill}) — it should be hollow`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | grep -A2 "what its colours mean"`
Expected: FAIL — `document.getElementById('legend')` is null.

- [ ] **Step 3: Add the legend**

Add a row to `#ui` in `index.html`, after the readout row:

```html
    <div class="row" id="legend"></div>
```

Add to the `<style>` block:

```css
    #legend { color: #8a877e; font-size: 11px; gap: 0.35rem; align-items: center; }
    #legend i { display: inline-block; width: 12px; height: 12px; border-radius: 50%; }
    #legend i.ring { background: transparent; border: 1.5px solid #e0a316; }
```

Build it in `sketch.js`, importing `RAMP` and `HORIZON_COLOR`:

```js
// The legend is built from the same constants the marks are drawn from, so a
// palette change cannot leave the key describing the old one.
function buildLegend() {
  const swatch = (c) => `<i style="background:${c}"></i>`;
  $('legend').innerHTML =
    '<span>sun 90°</span>'
    + RAMP.map(swatch).reverse().join('')
    + '<span>1°</span>'
    + '<span style="margin-left:0.8rem">on the horizon, 0°</span>'
    + `<i class="ring" style="border-color:${HORIZON_COLOR}"></i>`;
}
```

The horizon swatch is styled through `border-color`, never `background` — it has
to be hollow, because it stands for a hollow mark. Setting a background here
would make the key advertise a filled dot the globe never draws. Call
`buildLegend()` in the load callback.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | grep -A2 "what its colours mean"`
Expected: `ok`.

- [ ] **Step 5: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: every test passes and `build-index.js` reports one more sketch. A `meta.json` failure here means Task 2's file is malformed.

- [ ] **Step 6: Generate the thumbnail**

Run: `npm run thumbs`
Expected: `public/sketches/2026-08-eclipse-horizon/thumb.png` appears. Open it: the rings should be legible at thumbnail size. If they are not, that is the mark-size problem from Task 3 Step 6 showing up where it matters most — fix it there, in `points.js`, and regenerate.

- [ ] **Step 7: Add the sketch to the README**

Add an entry to the `## Sketches` list in `README.md`, matching the register of the existing entries — what the data is, where it came from, and the one non-obvious thing. Roughly:

> - **eclipse horizon** (`2026-08-eclipse-horizon`) — all 11,898 solar eclipses from 1999 BC to 3000 AD, at the point where each one peaked, out of Espenak's Five Millennium Catalog. 4,294 of them — 36% — have the Sun at exactly 0°, and every one of those lands between 60° and 72° of latitude with nothing outside the band, because gamma, the miss distance of the Moon's shadow axis from the Earth's centre, is uniform out to about 1.55 Earth radii while the Earth stops at 1.0. A third of the range is the shadow missing the planet, and a near miss is only visible from the sunrise line. Mostly those are partial eclipses, but 94 are not: the non-central annulars and totals the catalog marks `A-` and `T+`, where the axis misses and the antumbra grazes the limb anyway. The ramp runs on horizon-ness rather than altitude, so the low Sun is the bright end; the 0° eclipses are off the ramp entirely, on a reserved colour and a hollow mark, because a third of the data stacked on one value is a category and not the bottom of a scale. `scripts/fetch-eclipses.mjs` pulls the 50 century pages by hand and the result is committed, so a page load never depends on NASA being up.

- [ ] **Step 8: Commit**

```bash
git add sketches/2026-08-eclipse-horizon README.md public/sketches/2026-08-eclipse-horizon test.mjs
git commit -m "feat(eclipse-horizon): a key for the colours and a line in the index"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Data: fetch script, regex rationale, 50 pages, zero unmatched | 1 |
| Data: parallel arrays, type first-char only, committed JSON | 1 |
| Test: record count, columns agree, `alt===0 → 60..80` | 1 |
| Globe: orthographic, plain canvas, no library, header explains why | 2 |
| Globe: graticule at 15°, 60/80 heavier | 2 |
| Globe: z-sort, far side culled | 3 |
| Encoding: validated ramp, hollow rings for the 0° spike | 3 |
| Rotation: drag, idle spin | 4 |
| Deep time: play/pause/scrub/speed, accumulation | 5 |
| Readout: n, ≤30%, exactly-0%, horizon latitude band, early wobble | 5 |
| Caveat line on screen | 2 (`#hint`) |
| Test: canvas non-blank, mid-year fewer points, drag changes frame | 2, 4, 5 |
| Not doing: paths, second chart, population weighting | absent by construction |

The spec's "newest arrival flashes and settles over ~400 ms" is **not** implemented in any task. Dropped deliberately: at the speeds that make 11,898 points watchable, dozens land per frame and a per-point flash is noise rather than emphasis. The accumulation itself carries the arrival. Noted here rather than silently skipped.

**Placeholder scan:** none — every code step carries its actual content, and the README entry is written out rather than described.

**Type consistency:** `view` is `{ lambda, phi }` in degrees in Tasks 2, 4 and 5. `project()` returns `{ x, y, z }` in Tasks 2 and 3. `drawPoints(ctx, data, upTo, view, r, cx, cy)` returns a count in Tasks 3 and 5. `colorFor(alt)` returns a hex string in Task 3 and is re-exported through `window.eclipse` for the same task's test. `stats()` returns `{ n, pctLow, pctZero, latMin, latMax }` in Task 5's implementation and its test. `setIndex` is the name in Task 5 throughout — not `setYear`, which the spec's prose used loosely and which no code here refers to.
