# elsewhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 160 m square of the Netherlands drawn as particles, slid across the country with WASD and sent to any Dutch address, where the same particles rearrange into the new place.

**Architecture:** Eight small ES modules under `sketches/2026-08-elsewhere/`. Pure logic (GeoTIFF decoding, RD geometry, URL building, place assembly, slot bookkeeping) is separated from browser-only work (fetch, JPEG decode, WebGL) so most of it is unit-testable in Node inside the existing `test.mjs`. One vertex buffer is allocated once and never resized; every visual change is a write into it or a uniform.

**Tech Stack:** Raw WebGL2, no framework, no new npm dependencies. Native `DecompressionStream('deflate')` for GeoTIFF inflate. Native `createImageBitmap` + `OffscreenCanvas` for JPEG. Playwright via the existing `node test.mjs`.

## Global Constraints

- No new npm dependencies. `package.json` dependencies stay `hydra-synth` and `p5`; this sketch imports neither.
- Every sketch folder needs `index.html`, `sketch.js`, `meta.json`. `meta.json` must have `title` and `date` or `scripts/build-index.js` throws and the build fails.
- Do not touch `sketches/2026-08-hendriklaan/`, `scripts/extract-hendriklaan.py`, `public/data/hendriklaan.*`. That sketch stays exactly as published.
- Endpoints, exact:
  - geocode `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free`
  - surface/ground `https://service.pdok.nl/rws/ahn/wcs/v1_0`, coverage ids `dsm_05m` and `dtm_05m`
  - colour `https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0`, layer `Actueel_orthoHR`
- CRS is EPSG:28992 (Amersfoort / RD New) everywhere. WMS 1.3.0 bbox order for this CRS is `minx,miny,maxx,maxy` — **easting first**. Northing-first returns a valid blank 1.6 KB image, not an error.
- GeoTIFF NoData is `3.4028234663852886e+38`.
- Geometry constants: cell `0.5` m, render tile `32` cells (16 m), square `320` cells (`160` m), margin `1` render tile each side, ring `12 x 12 = 144` tiles, `147456` particles, vertex stride `32` bytes.
- Fetch tiles are 240 m, aligned to a global grid at `Math.floor(x / 240) * 240`, requested at `480 x 480`.
- Flight duration `Math.min(3.5, 0.9 + 0.55 * Math.log10(1 + km * 10))` seconds.
- Local changeover span `0.55` s, drop `11` m, per-particle born jitter up to `0.65` s.
- Default grain `0.55`.
- Never blank a slot on eviction. Never create or destroy a particle.
- Repo palette: bg `#0e0e11`, text `#e8e6e0`, muted `#8a877e`, accent `#7fb3a3`, amber `#e0a316`, panel `#17171cdd`.
- Verified reference values for `public/data/elsewhere/prins-hendriklaan/` (see Task 1): the 240 m 480x480 DSM of that window reads `0.36 .. 28.64` m NAP with centre cell `12.56`. Any decoder that disagrees is wrong.

**Commands.** `npm test` runs the whole suite and takes ~3 minutes; it is the gate before every commit. During a task, iterate faster with a scratch script at the repo root (Playwright only resolves there) and delete it before committing: `node ./scratch.mjs`. Dev server: `npx vite --port 5179 --strictPort`.

---

### Task 1: Bake script and the opening place

**Files:**
- Create: `scripts/bake-place.js`
- Create (generated): `public/data/elsewhere/prins-hendriklaan/{dsm.tif,dtm.tif,ortho.jpg,place.json}`
- Create (generated): `public/data/elsewhere/_fixture/{dsm.tif,dtm.tif,ortho.jpg,place.json}`

**Interfaces:**
- Consumes: nothing.
- Produces: on-disk places. `place.json` shape, relied on by Tasks 4 and 6:
  `{ name: string, address: string, centre: [number, number], bbox: [number,number,number,number], width: number, height: number, cell: number, source: "PDOK AHN dsm_05m/dtm_05m + Actueel_orthoHR", licence: string }`
  `bbox` is `[minx, miny, maxx, maxy]` in EPSG:28992.

The opening place is baked **coarse** — a 480 m window at 480x480, so 1 m cells — because that is ~1.2 MB rather than the ~4.8 MB four sharp fetch tiles would cost, and the sharp tiles stream over it anyway. `_fixture` is the same window at 64x64 for the test suite.

- [ ] **Step 1: Write the bake script**

Create `scripts/bake-place.js`:

```js
#!/usr/bin/env node
// Takes a place offline. Geocodes an address through the PDOK locatieserver,
// pulls the two AHN coverages and the orthophoto for a window around it, and
// writes PDOK's own bytes into public/data/elsewhere/<slug>/.
//
// The bytes are not repacked. A packed 8-bytes-a-cell format gzips to 1.65 MB
// against 1.21 MB for these three files: JPEG and deflate already win, so the
// cache format is "whatever PDOK sent".
//
//   node scripts/bake-place.js "Prins Hendriklaan 17, Utrecht" --span 480 --size 480
//   node scripts/bake-place.js "Prins Hendriklaan 17, Utrecht" --span 480 --size 64 --slug _fixture
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEOCODE = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';
const WCS = 'https://service.pdok.nl/rws/ahn/wcs/v1_0';
const WMS = 'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0';
const LICENCE = 'AHN CC BY 4.0 · orthophoto Beeldmateriaal.nl';

const args = process.argv.slice(2);
const query = args.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? dflt : args[i + 1];
};
if (!query) {
  console.error('usage: node scripts/bake-place.js "<address>" [--span 480] [--size 480] [--slug name]');
  process.exit(1);
}
const span = Number(opt('span', 480));
const size = Number(opt('size', 480));
const slug = opt('slug', null);

const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

async function geocode(q) {
  const url = `${GEOCODE}?q=${encodeURIComponent(q)}&rows=5&fl=weergavenaam,centroide_rd,type`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`geocode HTTP ${r.status}`);
  const docs = (await r.json()).response.docs;
  const doc = docs.find((d) => d.type === 'adres') ?? docs[0];
  if (!doc) throw new Error(`no match for "${q}"`);
  const [x, y] = doc.centroide_rd.match(/POINT\(([\d.]+) ([\d.]+)\)/).slice(1).map(Number);
  return { name: doc.weergavenaam, x, y };
}

async function grab(url, path) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(path, buf);
  return buf.length;
}

const place = await geocode(query);
const half = span / 2;
const bbox = [place.x - half, place.y - half, place.x + half, place.y + half];
const dir = resolve(ROOT, 'public/data/elsewhere', slug ?? slugify(place.name));
mkdirSync(dir, { recursive: true });

const cov = (id) => `${WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${id}`
  + `&subset=x(${bbox[0]},${bbox[2]})&subset=y(${bbox[1]},${bbox[3]})`
  + `&scalesize=x(${size}),y(${size})&format=image/tiff`;
// WMS 1.3.0 with EPSG:28992 is easting-first. Northing-first returns a valid
// blank image rather than an error, which is a silent hour of debugging.
const ortho = `${WMS}?service=WMS&version=1.3.0&request=GetMap&layers=Actueel_orthoHR`
  + `&crs=EPSG:28992&bbox=${bbox.join(',')}&width=${size}&height=${size}`
  + `&format=image/jpeg&styles=`;

const sizes = {
  dsm: await grab(cov('dsm_05m'), resolve(dir, 'dsm.tif')),
  dtm: await grab(cov('dtm_05m'), resolve(dir, 'dtm.tif')),
  ortho: await grab(ortho, resolve(dir, 'ortho.jpg')),
};
writeFileSync(resolve(dir, 'place.json'), JSON.stringify({
  name: place.name, address: query, centre: [place.x, place.y], bbox,
  width: size, height: size, cell: span / size,
  source: 'PDOK AHN dsm_05m/dtm_05m + Actueel_orthoHR', licence: LICENCE,
}, null, 2) + '\n');

console.log(dir);
for (const [k, v] of Object.entries(sizes)) console.log(`  ${k}  ${(v / 1e3).toFixed(0)} KB`);
```

- [ ] **Step 2: Run it for the opening place**

Run: `node scripts/bake-place.js "Prins Hendriklaan 17, Utrecht" --span 480 --size 480`
Expected: prints the directory and three sizes; `dsm` and `dtm` are each 200–800 KB, `ortho` 40–120 KB.

- [ ] **Step 3: Run it for the test fixture**

Run: `node scripts/bake-place.js "Prins Hendriklaan 17, Utrecht" --span 480 --size 64 --slug _fixture`
Expected: three files, each under 30 KB.

- [ ] **Step 4: Verify the ortho is not blank**

Run: `node -e "const b=require('fs').readFileSync('public/data/elsewhere/prins-hendriklaan/ortho.jpg'); console.log(b.length)"`
Expected: over 20000. A result near 1600 means the bbox axis order is wrong — easting first.

- [ ] **Step 5: Commit**

```bash
git add scripts/bake-place.js public/data/elsewhere
git commit -m "feat(elsewhere): bake script and the opening place"
```

---

### Task 2: GeoTIFF decoder

**Files:**
- Create: `sketches/2026-08-elsewhere/geotiff.js`
- Modify: `test.mjs` (add a Node-side section before the browser tests)

**Interfaces:**
- Consumes: `public/data/elsewhere/_fixture/dsm.tif` from Task 1.
- Produces: `export async function decodeFloatTiff(arrayBuffer)` returning
  `{ width: number, height: number, data: Float32Array, nodata: number }`.
  `data` is row-major, top row first, length `width * height`. NoData cells keep
  their raw `3.4028234663852886e+38`; callers decide what to do about them.

- [ ] **Step 1: Write the failing tests**

In `test.mjs`, immediately after the `const browser = await chromium.launch();` line and inside the existing `try {`, add:

```js
  // ------------------------------------------------------------------ geotiff
  // Node-side, no browser: the decoder is pure and the fixture is on disk.
  {
    const { decodeFloatTiff } = await import('./sketches/2026-08-elsewhere/geotiff.js');
    const fixture = readFileSync('public/data/elsewhere/_fixture/dsm.tif');
    const sharp = readFileSync('public/data/elsewhere/prins-hendriklaan/dsm.tif');

    await test('the geotiff decoder reads AHN float32 with the floating-point predictor', async () => {
      const g = await decodeFloatTiff(fixture.buffer.slice(
        fixture.byteOffset, fixture.byteOffset + fixture.byteLength));
      assert.equal(g.width, 64);
      assert.equal(g.height, 64);
      assert.equal(g.data.length, 64 * 64);
      assert.equal(g.nodata, 3.4028234663852886e+38);
      const real = [...g.data].filter((v) => v < 1e30);
      assert.ok(real.length > g.data.length * 0.5, `only ${real.length} real cells`);
      // Utrecht. Nothing here is below sea level and nothing is a tower block.
      assert.ok(Math.min(...real) > -10, `min ${Math.min(...real)}`);
      assert.ok(Math.max(...real) < 80, `max ${Math.max(...real)}`);
    });

    await test('the decoder agrees with PDAL on the same window', async () => {
      const g = await decodeFloatTiff(sharp.buffer.slice(
        sharp.byteOffset, sharp.byteOffset + sharp.byteLength));
      const real = [...g.data].filter((v) => v < 1e30);
      // The 480 m window contains the 240 m one PDAL measured at 0.36..28.64,
      // so it must span at least that and stay in the same neighbourhood.
      assert.ok(Math.min(...real) < 1.0, `min ${Math.min(...real)} is too high`);
      assert.ok(Math.max(...real) > 25 && Math.max(...real) < 60, `max ${Math.max(...real)}`);
      // A wrong predictor or plane order still yields finite numbers; it does
      // not yield a field whose neighbours agree with each other.
      let jumps = 0;
      for (let i = 1; i < g.width; i++) {
        const a = g.data[240 * g.width + i - 1], b = g.data[240 * g.width + i];
        if (a < 1e30 && b < 1e30 && Math.abs(a - b) > 25) jumps++;
      }
      assert.ok(jumps < 12, `${jumps} implausible height jumps across one row`);
    });
  }
```

Also add `readFileSync` to the existing `node:fs` import at the top of `test.mjs` if it is not already imported.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | grep -A2 "geotiff decoder"`
Expected: FAIL, `Cannot find module './sketches/2026-08-elsewhere/geotiff.js'`.

- [ ] **Step 3: Write the decoder**

Create `sketches/2026-08-elsewhere/geotiff.js`:

```js
// A GeoTIFF reader that reads exactly the one thing PDOK's AHN coverage service
// emits: single-band float32, deflate, floating-point predictor, striped.
//
// There is no dependency here because the platform already has the hard part.
// DecompressionStream('deflate') is the inflate, and the rest is 80 lines of
// tag reading. geotiff.js would be 300 KB to do the same job.
//
// The two steps that go wrong silently are both in the predictor. libtiff's
// floating-point predictor accumulates bytes with stride 1 — not the row width,
// which is the intuitive and wrong reading — and then de-interleaves four byte
// planes in REVERSE order. Get either wrong and you still get finite numbers:
// the first attempt here produced a maximum of 3.4e38 and a centre cell of
// exactly 0.00, both of which look like data.

const TAG = {
  WIDTH: 256, HEIGHT: 257, BITS: 258, COMPRESSION: 259, SAMPLES: 277,
  ROWS_PER_STRIP: 278, STRIP_OFFSETS: 273, STRIP_BYTE_COUNTS: 279,
  PREDICTOR: 317, SAMPLE_FORMAT: 339, GDAL_NODATA: 42113,
};

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodeFloatTiff(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  const le = u8[0] === 0x49 && u8[1] === 0x49;
  if (!le && !(u8[0] === 0x4d && u8[1] === 0x4d)) throw new Error('not a TIFF');
  if (dv.getUint16(2, le) !== 42) throw new Error('not a classic TIFF');

  const ifd = dv.getUint32(4, le);
  const count = dv.getUint16(ifd, le);
  const tags = new Map();
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    const tag = dv.getUint16(e, le);
    const type = dv.getUint16(e + 2, le);
    const n = dv.getUint32(e + 4, le);
    tags.set(tag, { type, n, at: e + 8 });
  }

  const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4 };
  const values = (tag) => {
    const t = tags.get(tag);
    if (!t) return null;
    const stride = SIZE[t.type] ?? 1;
    // Values totalling four bytes or fewer are inlined in the entry itself.
    const base = t.n * stride <= 4 ? t.at : dv.getUint32(t.at, le);
    const out = [];
    for (let i = 0; i < t.n; i++) {
      const o = base + i * stride;
      out.push(t.type === 3 ? dv.getUint16(o, le)
        : t.type === 4 ? dv.getUint32(o, le)
        : dv.getUint8(o));
    }
    return out;
  };
  const one = (tag, dflt) => (values(tag)?.[0] ?? dflt);

  const width = one(TAG.WIDTH);
  const height = one(TAG.HEIGHT);
  const bits = one(TAG.BITS, 32);
  const samples = one(TAG.SAMPLES, 1);
  const format = one(TAG.SAMPLE_FORMAT, 1);
  const compression = one(TAG.COMPRESSION, 1);
  const predictor = one(TAG.PREDICTOR, 1);
  if (samples !== 1) throw new Error(`expected 1 band, got ${samples}`);
  if (bits !== 32 || format !== 3) throw new Error(`expected float32, got ${bits}-bit format ${format}`);
  if (compression !== 1 && compression !== 8) throw new Error(`unsupported compression ${compression}`);
  if (predictor !== 1 && predictor !== 3) throw new Error(`unsupported predictor ${predictor}`);

  let nodata = NaN;
  const nd = tags.get(TAG.GDAL_NODATA);
  if (nd) {
    const base = nd.n <= 4 ? nd.at : dv.getUint32(nd.at, le);
    nodata = Number(new TextDecoder().decode(u8.subarray(base, base + nd.n)).replace(/\0+$/, ''));
  }

  const offsets = values(TAG.STRIP_OFFSETS);
  const counts = values(TAG.STRIP_BYTE_COUNTS);
  const rowsPerStrip = one(TAG.ROWS_PER_STRIP, height);
  const rowBytes = width * 4;
  const data = new Float32Array(width * height);
  const out = new DataView(data.buffer);

  let row = 0;
  for (let s = 0; s < offsets.length; s++) {
    const raw = u8.subarray(offsets[s], offsets[s] + counts[s]);
    const strip = compression === 8 ? await inflate(raw) : raw.slice();
    const rows = Math.min(rowsPerStrip, height - row);
    for (let r = 0; r < rows; r++, row++) {
      const line = strip.subarray(r * rowBytes, (r + 1) * rowBytes);
      if (predictor === 3) {
        // stride 1, over the whole row, byte-wise
        for (let i = 1; i < line.length; i++) line[i] = (line[i] + line[i - 1]) & 0xff;
        // planes back into float order, most significant plane last
        for (let c = 0; c < width; c++) {
          const o = (row * width + c) * 4;
          for (let b = 0; b < 4; b++) out.setUint8(o + b, line[(3 - b) * width + c]);
        }
        // setUint8 wrote the bytes in file order; reinterpret respecting endianness
        for (let c = 0; c < width; c++) {
          const o = (row * width + c) * 4;
          data[row * width + c] = out.getFloat32(o, le);
        }
      } else {
        for (let c = 0; c < width; c++) {
          data[row * width + c] = dv.getFloat32(offsets[s] + r * rowBytes + c * 4, le);
        }
      }
    }
  }
  return { width, height, data, nodata };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | grep -E "geotiff decoder|agrees with PDAL"`
Expected: both `ok`.

If `agrees with PDAL` fails on the neighbour-jump check, the predictor is wrong. Print `g.data.slice(0, 8)` — correct output for this window is a run of similar values in the 0–20 range, not alternating huge and tiny numbers.

- [ ] **Step 5: Commit**

```bash
git add sketches/2026-08-elsewhere/geotiff.js test.mjs
git commit -m "feat(elsewhere): hand-rolled float32 geotiff decoder"
```

---

### Task 3: RD geometry and PDOK URLs

**Files:**
- Create: `sketches/2026-08-elsewhere/pdok.js`
- Modify: `test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const FETCH_SPAN = 240`, `export const FETCH_SIZE = 480`
  - `export function fetchTileKey(x, y)` → `"tx:tz"` string of the 240 m grid cell
  - `export function fetchTileBbox(key)` → `[minx, miny, maxx, maxy]`
  - `export function coverageUrl(id, bbox, size)` → string
  - `export function orthoUrl(bbox, size)` → string
  - `export function journey(from, to)` → `{ km: number, bearing: number, rose: string, dirX: number, dirZ: number, seconds: number }` where `from`/`to` are `[x, y]` in RD, `bearing` is degrees clockwise from north, `dirX`/`dirZ` is the unit vector in scene space (`z = -north`)
  - `export async function geocode(query, fetchImpl = fetch)` → `{ name, x, y }`, throws `Error('no match')`
  - `export function cachedFetch(url, cache)` → `Promise<ArrayBuffer>`

- [ ] **Step 1: Write the failing tests**

Append inside the geotiff block's sibling scope in `test.mjs` (a new block after it):

```js
  // --------------------------------------------------------------------- pdok
  {
    const P = await import('./sketches/2026-08-elsewhere/pdok.js');

    await test('fetch tiles land on a 240 m grid', async () => {
      assert.equal(P.fetchTileKey(138275, 455381), '576:1897');
      assert.equal(P.fetchTileKey(138280, 455390), '576:1897');
      assert.deepEqual(P.fetchTileBbox('576:1897'), [138240, 455280, 138480, 455520]);
    });

    await test('the ortho bbox is easting-first, because northing-first is silently blank', async () => {
      const url = P.orthoUrl([138240, 455280, 138480, 455520], 480);
      assert.match(url, /bbox=138240,455280,138480,455520/);
      assert.match(url, /crs=EPSG:28992/);
      assert.match(url, /layers=Actueel_orthoHR/);
      assert.match(url, /width=480&height=480/);
    });

    await test('coverage urls carry the subset and the scalesize', async () => {
      const url = P.coverageUrl('dsm_05m', [138240, 455280, 138480, 455520], 480);
      assert.match(url, /coverageId=dsm_05m/);
      assert.match(url, /subset=x\(138240,138480\)/);
      assert.match(url, /subset=y\(455280,455520\)/);
      assert.match(url, /scalesize=x\(480\),y\(480\)/);
      assert.match(url, /format=image%2Ftiff|format=image\/tiff/);
    });

    await test('a journey knows its bearing, its distance and how long it takes', async () => {
      // Prins Hendriklaan -> Coolsingel, both real RD coordinates
      const j = P.journey([138275, 455381], [92500, 437300]);
      assert.ok(Math.abs(j.km - 49.2) < 0.5, `km ${j.km}`);
      assert.ok(Math.abs(j.bearing - 248) < 3, `bearing ${j.bearing}`);
      assert.equal(j.rose, 'WSW');
      assert.ok(j.seconds > 1.7 && j.seconds < 2.4, `seconds ${j.seconds}`);
      // scene z runs opposite to northing
      assert.ok(j.dirX < 0 && j.dirZ > 0, `dir ${j.dirX},${j.dirZ}`);
      assert.ok(Math.abs(Math.hypot(j.dirX, j.dirZ) - 1) < 1e-9);
    });

    await test('a journey next door is short but never instant', async () => {
      const j = P.journey([138275, 455381], [138375, 455381]);
      assert.ok(j.km < 0.2);
      assert.ok(j.seconds >= 0.9 && j.seconds < 1.3, `seconds ${j.seconds}`);
      assert.equal(j.rose, 'E');
    });

    await test('geocode picks the address over the street and reads RD out of the WKT', async () => {
      const stub = async () => ({
        ok: true,
        json: async () => ({ response: { docs: [
          { type: 'weg', weergavenaam: 'Prins Hendriklaan, Utrecht', centroide_rd: 'POINT(138539.295 455255.488)' },
          { type: 'adres', weergavenaam: 'Prins Hendriklaan 17, 3583EB Utrecht', centroide_rd: 'POINT(138275.467 455380.628)' },
        ] } }),
      });
      const g = await P.geocode('Prins Hendriklaan 17', stub);
      assert.equal(g.name, 'Prins Hendriklaan 17, 3583EB Utrecht');
      assert.ok(Math.abs(g.x - 138275.467) < 0.01);
      assert.ok(Math.abs(g.y - 455380.628) < 0.01);
    });

    await test('geocode says so when the country has never heard of the place', async () => {
      const stub = async () => ({ ok: true, json: async () => ({ response: { docs: [] } }) });
      await assert.rejects(() => P.geocode('nowhere at all', stub), /no match/);
    });
  }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | grep -E "fetch tiles land|easting-first"`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the module**

Create `sketches/2026-08-elsewhere/pdok.js`:

```js
// Everything that talks to PDOK, plus the RD arithmetic that goes with it.
//
// RD (EPSG:28992) is metric and locally flat, so distance is Pythagoras and
// bearing is atan2. No geodesy, no projection library, no degrees anywhere
// except in what the readout prints.

const GEOCODE = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';
const WCS = 'https://service.pdok.nl/rws/ahn/wcs/v1_0';
const WMS = 'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0';

export const FETCH_SPAN = 240;
export const FETCH_SIZE = 480;

export const fetchTileKey = (x, y) =>
  `${Math.floor(x / FETCH_SPAN)}:${Math.floor(y / FETCH_SPAN)}`;

export function fetchTileBbox(key) {
  const [tx, tz] = key.split(':').map(Number);
  const minx = tx * FETCH_SPAN, miny = tz * FETCH_SPAN;
  return [minx, miny, minx + FETCH_SPAN, miny + FETCH_SPAN];
}

export const coverageUrl = (id, bbox, size) =>
  `${WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${id}`
  + `&subset=x(${bbox[0]},${bbox[2]})&subset=y(${bbox[1]},${bbox[3]})`
  + `&scalesize=x(${size}),y(${size})&format=image/tiff`;

// WMS 1.3.0 with EPSG:28992 is easting-first. Northing-first returns HTTP 200
// and a valid 1.6 KB blank JPEG, so this is not a mistake anything reports.
export const orthoUrl = (bbox, size) =>
  `${WMS}?service=WMS&version=1.3.0&request=GetMap&layers=Actueel_orthoHR`
  + `&crs=EPSG:28992&bbox=${bbox.join(',')}&width=${size}&height=${size}`
  + `&format=image/jpeg&styles=`;

const ROSE = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

export function journey(from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const metres = Math.hypot(dx, dy) || 1;
  const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  const km = metres / 1000;
  return {
    km,
    bearing,
    rose: ROSE[Math.round(bearing / 22.5) % 16],
    dirX: dx / metres,
    dirZ: -dy / metres,          // scene z runs opposite to northing
    seconds: Math.min(3.5, 0.9 + 0.55 * Math.log10(1 + km * 10)),
  };
}

export async function geocode(query, fetchImpl = fetch) {
  const url = `${GEOCODE}?q=${encodeURIComponent(query)}&rows=5&fl=weergavenaam,centroide_rd,type`;
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`the address service answered ${r.status}`);
  const docs = (await r.json()).response?.docs ?? [];
  // Prefer a house number over the street it is on: "Prins Hendriklaan 17"
  // otherwise resolves to the middle of the whole street, 300 m away.
  const doc = docs.find((d) => d.type === 'adres') ?? docs[0];
  if (!doc) throw new Error('no match in the Netherlands');
  const m = doc.centroide_rd?.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
  if (!m) throw new Error('no match in the Netherlands');
  return { name: doc.weergavenaam, x: Number(m[1]), y: Number(m[2]) };
}

// Cache API in front of every byte. Repeat visits and shader iteration cost no
// network at all, and PDOK is asked for each tile once per browser rather than
// once per reload.
export async function cachedFetch(url, cache) {
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return hit.arrayBuffer();
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (cache) await cache.put(url, res.clone());
  return res.arrayBuffer();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | grep -E "fetch tiles land|easting-first|coverage urls|a journey|geocode"`
Expected: all seven `ok`.

- [ ] **Step 5: Commit**

```bash
git add sketches/2026-08-elsewhere/pdok.js test.mjs
git commit -m "feat(elsewhere): pdok endpoints and RD geometry"
```

---

### Task 4: Place assembly

**Files:**
- Create: `sketches/2026-08-elsewhere/place.js`
- Modify: `test.mjs`

**Interfaces:**
- Consumes: `decodeFloatTiff` output from Task 2.
- Produces: `export function assemble({ dsm, dtm, rgb, width, height })` where `dsm`/`dtm` are the objects from `decodeFloatTiff` and `rgb` is a `Uint8ClampedArray` of `width * height * 4` (RGBA, as `getImageData` returns), returning:
  ```
  { width, height,
    y: Float32Array,        // metres above this place's own ground datum
    hag: Float32Array,      // metres above local ground, >= 0
    colour: Uint8Array,     // width*height*3
    normal: Int8Array,      // width*height*2, nx and nz scaled to -127..127
    datum: number,          // the median DTM, in m NAP
    water: Uint8Array }     // 1 where the survey had no return
  ```

- [ ] **Step 1: Write the failing tests**

Append a new block in `test.mjs`:

```js
  // -------------------------------------------------------------------- place
  {
    const { assemble } = await import('./sketches/2026-08-elsewhere/place.js');
    const ND = 3.4028234663852886e+38;
    const grid = (w, h, fn) => {
      const d = new Float32Array(w * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) d[j * w + i] = fn(i, j);
      return { width: w, height: h, data: d, nodata: ND };
    };

    await test('a place stands on its own ground, not on NAP', async () => {
      // ground at a uniform 12 m NAP with a 6 m building in the middle
      const dsm = grid(8, 8, (i, j) => (i === 4 && j === 4 ? 18 : 12));
      const dtm = grid(8, 8, () => 12);
      const p = assemble({ dsm, dtm, rgb: new Uint8ClampedArray(8 * 8 * 4), width: 8, height: 8 });
      assert.equal(p.datum, 12);
      assert.equal(p.y[4 * 8 + 4], 6);
      assert.equal(p.y[0], 0);
      assert.equal(p.hag[4 * 8 + 4], 6);
      assert.equal(p.hag[0], 0);
    });

    await test('nodata becomes flat ground rather than a hole or a NaN', async () => {
      const dsm = grid(4, 4, (i) => (i === 0 ? ND : 3));
      const dtm = grid(4, 4, (i) => (i === 0 ? ND : 3));
      const p = assemble({ dsm, dtm, rgb: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 });
      for (const v of p.y) assert.ok(Number.isFinite(v), `non-finite height ${v}`);
      for (const v of p.hag) assert.ok(Number.isFinite(v) && v >= 0, `bad hag ${v}`);
      assert.equal(p.water[0], 1);
      assert.equal(p.water[1], 0);
      assert.equal(p.y[0], 0);
    });

    await test('colour comes across as rgb, dropping the alpha', async () => {
      const rgb = new Uint8ClampedArray(2 * 2 * 4);
      rgb.set([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);
      const flat = grid(2, 2, () => 1);
      const p = assemble({ dsm: flat, dtm: flat, rgb, width: 2, height: 2 });
      assert.deepEqual([...p.colour.slice(0, 6)], [10, 20, 30, 40, 50, 60]);
      assert.equal(p.colour.length, 2 * 2 * 3);
    });

    await test('normals lean away from a slope and are flat on the level', async () => {
      // a ramp rising in +i, so the surface normal tips towards -i
      const dsm = grid(8, 8, (i) => i * 2);
      const dtm = grid(8, 8, () => 0);
      const p = assemble({ dsm, dtm, rgb: new Uint8ClampedArray(8 * 8 * 4), width: 8, height: 8 });
      assert.ok(p.normal[(4 * 8 + 4) * 2] < -40, `nx ${p.normal[(4 * 8 + 4) * 2]}`);
      const flat = grid(8, 8, () => 5);
      const q = assemble({ dsm: flat, dtm: flat, rgb: new Uint8ClampedArray(8 * 8 * 4), width: 8, height: 8 });
      assert.equal(q.normal[(4 * 8 + 4) * 2], 0);
      assert.equal(q.normal[(4 * 8 + 4) * 2 + 1], 0);
    });
  }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | grep -E "stands on its own ground"`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the module**

Create `sketches/2026-08-elsewhere/place.js`:

```js
// Turns three decoded rasters into the arrays a particle field wants.
//
// Pure and synchronous on purpose: everything network- and browser-shaped
// happens before this is called, which is what lets it be tested in Node.

const NODATA_FLOOR = 1e30;

// Each place stands on its own median ground rather than on NAP. The Netherlands
// runs -7 m to +320 m, so morphing between places on absolute height would make
// the whole scene lurch vertically and bury the thing worth watching, which is
// the buildings and the trees changing. The true NAP value is kept and printed.
function median(values) {
  const real = values.filter((v) => v < NODATA_FLOOR);
  if (!real.length) return 0;
  real.sort((a, b) => a - b);
  return real[real.length >> 1];
}

export function assemble({ dsm, dtm, rgb, width, height }) {
  const n = width * height;
  const datum = median(Array.from(dtm.data));
  const y = new Float32Array(n);
  const hag = new Float32Array(n);
  const water = new Uint8Array(n);
  const colour = new Uint8Array(n * 3);

  for (let i = 0; i < n; i++) {
    const s = dsm.data[i], g = dtm.data[i];
    const missing = !(s < NODATA_FLOOR);
    water[i] = missing ? 1 : 0;
    // A cell with no return is water or a survey gap. Both sit at ground level
    // and keep their photographic colour, so water renders as a flat plane that
    // happens to look exactly like water.
    const surface = missing ? (g < NODATA_FLOOR ? g : datum) : s;
    const ground = g < NODATA_FLOOR ? g : datum;
    y[i] = surface - datum;
    hag[i] = Math.max(0, surface - ground);
    colour[i * 3] = rgb[i * 4];
    colour[i * 3 + 1] = rgb[i * 4 + 1];
    colour[i * 3 + 2] = rgb[i * 4 + 2];
  }

  // Normals by central difference over the height grid. This is where all the
  // shading comes from — the orthophoto is flat light, and a DSM gradient is
  // what makes a roof face the sun and an alley fall into shadow.
  const normal = new Int8Array(n * 2);
  const at = (i, j) => y[Math.min(height - 1, Math.max(0, j)) * width + Math.min(width - 1, Math.max(0, i))];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) / 2;
      const dz = (at(i, j + 1) - at(i, j - 1)) / 2;
      const len = Math.hypot(dx, dz, 1);
      const p = (j * width + i) * 2;
      normal[p] = Math.max(-127, Math.min(127, Math.round(-dx / len * 127)));
      normal[p + 1] = Math.max(-127, Math.min(127, Math.round(-dz / len * 127)));
    }
  }

  return { width, height, y, hag, colour, normal, datum, water };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | grep -E "own ground|nodata becomes|colour comes across|normals lean"`
Expected: four `ok`.

- [ ] **Step 5: Commit**

```bash
git add sketches/2026-08-elsewhere/place.js test.mjs
git commit -m "feat(elsewhere): assemble a place from three rasters"
```

---

### Task 5: Render-tile slot bookkeeping

**Files:**
- Create: `sketches/2026-08-elsewhere/slots.js`
- Modify: `test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function createSlots({ ring })` returning an object with
  - `slots: Array<{ tx: number|null, tz: number|null, ready: boolean, data: object|null, pending: object|null }>` length `ring * ring`. `data` and `pending` are owned by the caller — `createSlots` initialises them to `null` and never reads them.
  - `reshelve(ctx, ctz)` → `Array<{ idx, tx, tz }>` newly assigned slots, nearest first
  - `indexOf(tx, tz)` → `number | undefined`
  - `readyCount()` → `number`
  - `markReady(idx)`

- [ ] **Step 1: Write the failing tests**

Append a new block in `test.mjs`:

```js
  // -------------------------------------------------------------------- slots
  {
    const { createSlots } = await import('./sketches/2026-08-elsewhere/slots.js');

    await test('a first reshelve claims the whole ring', async () => {
      const s = createSlots({ ring: 5 });
      const jobs = s.reshelve(0, 0);
      assert.equal(jobs.length, 25);
      assert.equal(new Set(jobs.map((j) => j.idx)).size, 25);
      assert.ok(Math.abs(jobs[0].tx) + Math.abs(jobs[0].tz) <= 1, 'nearest tile not requested first');
    });

    await test('stepping one tile costs one edge, not the whole ring', async () => {
      // This is the bug the mock found: indexing slots by ring position meant a
      // one-tile step re-pointed all 25 and the picture went black while moving.
      const s = createSlots({ ring: 5 });
      for (const j of s.reshelve(0, 0)) s.markReady(j.idx);
      const jobs = s.reshelve(1, 0);
      assert.equal(jobs.length, 5, `${jobs.length} tiles reloaded for a one-tile step`);
      assert.ok(jobs.every((j) => j.tx === 3));
    });

    await test('a diagonal step costs two edges less the shared corner', async () => {
      const s = createSlots({ ring: 5 });
      for (const j of s.reshelve(0, 0)) s.markReady(j.idx);
      assert.equal(s.reshelve(1, 1).length, 9);
    });

    await test('standing still costs nothing', async () => {
      const s = createSlots({ ring: 5 });
      for (const j of s.reshelve(0, 0)) s.markReady(j.idx);
      assert.equal(s.reshelve(0, 0).length, 0);
    });

    await test('an evicted slot keeps its contents until something replaces them', async () => {
      // Blanking on eviction punched a black square in the leading edge for as
      // long as the fetch took. The stale ground is hidden by the clip instead.
      const s = createSlots({ ring: 5 });
      for (const j of s.reshelve(0, 0)) s.markReady(j.idx);
      const evicted = s.indexOf(-2, 0);
      s.reshelve(1, 0);
      assert.notEqual(s.slots[evicted].tx, null, 'evicted slot was blanked');
      assert.equal(s.slots[evicted].ready, false);
    });

    await test('every tile in the ring is findable by its coordinate', async () => {
      const s = createSlots({ ring: 5 });
      for (const j of s.reshelve(7, -3)) s.markReady(j.idx);
      assert.equal(s.readyCount(), 25);
      for (let j = -2; j <= 2; j++) {
        for (let i = -2; i <= 2; i++) {
          const idx = s.indexOf(7 + i, -3 + j);
          assert.ok(idx !== undefined, `missing tile ${7 + i}:${-3 + j}`);
          assert.equal(s.slots[idx].tx, 7 + i);
        }
      }
    });
  }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | grep -E "first reshelve claims"`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the module**

Create `sketches/2026-08-elsewhere/slots.js`:

```js
// Which slot in the vertex buffer is holding which tile of the world.
//
// Addressed by tile coordinate through a map and a free list, never by position
// in the ring. Position-indexing is the obvious implementation and it is wrong:
// step one tile forward and every slot's target changes, so the whole ring
// reloads for a move that should cost one edge. Measured at 49 reloads instead
// of 7, with the request queue backed up to 107 and the world black while the
// camera was moving.

export function createSlots({ ring }) {
  const total = ring * ring;
  const half = (ring - 1) / 2;
  const slots = Array.from({ length: total }, () => ({ tx: null, tz: null, ready: false, data: null, pending: null }));
  const byTile = new Map();
  const free = Array.from({ length: total }, (_, i) => total - 1 - i);

  const key = (tx, tz) => `${tx}:${tz}`;

  function reshelve(ctx, ctz) {
    const want = new Map();
    for (let j = -half; j <= half; j++) {
      for (let i = -half; i <= half; i++) want.set(key(ctx + i, ctz + j), [ctx + i, ctz + j]);
    }
    for (const [k, idx] of [...byTile]) {
      if (want.has(k)) continue;
      // Deliberately leaves tx, tz and whatever the slot is holding alone. The
      // caller keeps drawing it until a replacement lands; it is outside the
      // frame by then and the clip hides it.
      byTile.delete(k);
      free.push(idx);
      slots[idx].ready = false;
    }
    const jobs = [];
    for (const [k, [tx, tz]] of want) {
      if (byTile.has(k)) continue;
      const idx = free.pop();
      if (idx === undefined) break;
      byTile.set(k, idx);
      slots[idx].tx = tx;
      slots[idx].tz = tz;
      slots[idx].ready = false;
      jobs.push({ idx, tx, tz });
    }
    // Nearest first: what you are moving towards fills in before the corners.
    jobs.sort((a, b) =>
      (Math.abs(a.tx - ctx) + Math.abs(a.tz - ctz)) - (Math.abs(b.tx - ctx) + Math.abs(b.tz - ctz)));
    return jobs;
  }

  return {
    slots,
    reshelve,
    indexOf: (tx, tz) => byTile.get(key(tx, tz)),
    markReady: (idx) => { slots[idx].ready = true; },
    readyCount: () => slots.reduce((n, s) => n + (s.ready ? 1 : 0), 0),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | grep -E "reshelve claims|one edge|diagonal step|standing still|evicted slot|findable"`
Expected: six `ok`.

- [ ] **Step 5: Commit**

```bash
git add sketches/2026-08-elsewhere/slots.js test.mjs
git commit -m "feat(elsewhere): render-tile slot bookkeeping"
```

---

### Task 6: Shaders, field, and the first drawn place

**Files:**
- Create: `sketches/2026-08-elsewhere/shaders.js`
- Create: `sketches/2026-08-elsewhere/field.js`
- Create: `sketches/2026-08-elsewhere/index.html`
- Create: `sketches/2026-08-elsewhere/sketch.js`
- Create: `sketches/2026-08-elsewhere/meta.json`
- Modify: `test.mjs`

At the end of this task the page loads the baked place from disk and draws it as a square of particles under a fixed orbit camera. No movement, no jumping, no controls.

**Interfaces:**
- Consumes: `assemble` (Task 4), `createSlots` (Task 5), `decodeFloatTiff` (Task 2), `place.json` (Task 1).
- Produces:
  - `shaders.js`: `export const POINT_VS`, `POINT_FS`, `FRAME_VS`, `FRAME_FS`
  - `field.js`: `export function createField(gl, { ring, tileCells, cell })` with
    `writeTile(idx, { tx, tz, prev, next, born })`, `draw()`, `uniforms` (the
    location map), `program`, `count`. `prev`/`next` are `{ y, colour, normal }`
    slices of `tileCells * tileCells`.
  - `sketch.js`: `window.__elsewhere` with `{ ready(), coverage(), state(), centre(), place() }`
- Constants live in `field.js`: `CELL = 0.5`, `TILE_CELLS = 32`, `RING = 12`, `SHOWN = 10`, `SPAN = 160`, `HALF = 80`, `STRIDE = 32`.

- [ ] **Step 1: Write the failing test**

Append to `test.mjs`, inside the browser section after the hendriklaan block:

```js
  // ---------------------------------------------------------------- elsewhere
  {
    const errors = [];
    const p = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await p.goto(`${BASE}/sketches/2026-08-elsewhere/`, { waitUntil: 'networkidle' });
    await p.waitForFunction(() => window.__elsewhere?.ready(), null, { timeout: 30000 });
    const el = (fn) => p.evaluate(fn);

    await test('the opening place loads from disk and draws', async () => {
      const place = await el(() => window.__elsewhere.place());
      assert.match(place.address, /Prins Hendriklaan/);
      assert.equal(place.width, 480);
      assert.ok((await el(() => window.__elsewhere.coverage())) > 0.08, 'nothing was drawn');
      assert.deepEqual(errors, []);
    });

    await p.close();
  }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | grep -A2 "opening place loads"`
Expected: FAIL — the page 404s or `__elsewhere` never appears.

- [ ] **Step 3: Write `shaders.js`**

```js
// The whole visual contract in two programs. Every frame is uniforms plus one
// POINTS draw; nothing is recomputed on the CPU per frame.

export const POINT_VS = `#version 300 es
precision highp float;

in vec2 aWorld;       // world x,z in RD metres
in vec2 aY;           // height at A, height at B, in metres above the datum
in float aBorn;       // when this particle's own changeover began
in vec4 aCA;          // colour at A
in vec4 aCB;          // colour at B
in vec4 aN;           // nx,nz at A and at B

uniform mat4 uView, uProj;
uniform vec3 uCentre;     // world xz the square is framing
uniform vec2 uDir;        // unit travel direction, scene space
uniform float uMix, uTime, uArc, uLift, uSwing;
uniform float uColour, uPointK, uSpan, uDrop, uJump, uSize, uHalf, uTop;

out vec3 vCol;
out float vAlive;

float hash1(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

void main() {
  // Two ways a particle changes what it is standing on.
  //
  // Sliding the window: its own clock. aBorn is jittered per particle rather
  // than per tile, so an arriving tile is a scatter of pixels dropping out and
  // popping back instead of a 32x32 block appearing at once. Tile-level timing
  // is visible as chunks and reads as a loading bar.
  //
  // Jumping: one clock for everybody, staggered along the bearing, so the
  // departure edge leaves first and the far edge lands last.
  float u = dot(normalize(aWorld - uCentre.xz + 1e-4), uDir) * 0.5 + 0.5;
  float tJump = clamp(uMix * 1.55 - 0.55 * u, 0.0, 1.0);
  float tLocal = clamp((uTime - aBorn) / uSpan, 0.0, 1.0);
  float t = mix(tLocal, tJump, uJump);
  float arc = sin(t * 3.14159265) * uArc;

  // Through a local changeover the pixel falls away, vanishes, and the new one
  // pops up in its place. At no instant is a particle showing an average of two
  // places; it is showing one or the other.
  float cross = 1.0 - abs(t * 2.0 - 1.0);
  float side = step(0.5, t);
  float pick = mix(side, t, uJump);

  // A particle keeps its ground position and changes what it stands on.
  // Displacing it by the true offset between two places is the obvious reading
  // of "move to the new position" and it is wrong: 49 km puts every particle
  // off screen by mid-flight. The journey lives in the streaming below.
  vec2 w = aWorld;
  float y = mix(aY.x, aY.y, pick) - (1.0 - uJump) * uDrop * cross;

  vec2 stream = -uDir * uSwing * arc * (0.6 + 0.8 * hash1(aWorld));
  float lift = uLift * arc * (0.5 + hash1(aWorld + 3.7));

  vec3 p = vec3(w.x + stream.x - uCentre.x, y + lift, w.y + stream.y - uCentre.z);
  vec4 eye = uView * vec4(p, 1.0);
  gl_Position = uProj * eye;

  // Clip to the square. The ring caches a tile more than the frame shows, and
  // that margin is where new ground lands before it slides in. Without it the
  // leading edge is a hole however fast the loader is.
  vec2 rel = w - uCentre.xz;
  float inside = step(abs(rel.x), uHalf) * step(abs(rel.y), uHalf);

  vec3 n = mix(vec3(aN.x, 0.0, aN.y), vec3(aN.z, 0.0, aN.w), pick);
  n.y = sqrt(max(0.02, 1.0 - dot(n.xz, n.xz)));
  float diff = 0.34 + 0.78 * max(0.0, dot(normalize(n), normalize(vec3(-0.42, 0.80, 0.42))));

  vec3 photo = mix(aCA.rgb, aCB.rgb, pick);
  float ht = clamp(y / uTop, 0.0, 1.0);
  vec3 ramp = ht < 0.38 ? mix(vec3(0.09,0.10,0.19), vec3(0.20,0.44,0.47), ht/0.38)
            : ht < 0.76 ? mix(vec3(0.20,0.44,0.47), vec3(0.85,0.72,0.42), (ht-0.38)/0.38)
                        : mix(vec3(0.85,0.72,0.42), vec3(1.00,0.98,0.94), (ht-0.76)/0.24);
  float lum = dot(photo, vec3(0.299, 0.587, 0.114));

  vec3 col = uColour < 0.5 ? photo * diff
           : uColour < 1.5 ? ramp * diff
                           : ramp * (0.45 + 1.1 * lum) * diff;
  vCol = col + arc * 0.06;
  vAlive = (1.0 - (1.0 - uJump) * cross) * inside;

  float d = max(-eye.z, 1.0);
  // Sized from the projection, not from a constant: the true on-screen size of
  // one cell at this distance, times a grain factor below 1 so points sit
  // smaller than their spacing and the square reads as particles, not a skin.
  gl_PointSize = clamp(uPointK * uSize / d * (1.0 + arc * 0.45) * vAlive, 0.6, 26.0);
}`;

export const POINT_FS = `#version 300 es
precision highp float;
in vec3 vCol;
in float vAlive;
out vec4 frag;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  if (vAlive < 0.06) discard;
  float edge = 1.0 - smoothstep(0.13, 0.25, r2);
  frag = vec4(vCol * (0.68 + 0.32 * edge), 1.0);
}`;

export const FRAME_VS = `#version 300 es
precision highp float;
in vec3 aPos;
in vec3 aCol;
uniform mat4 uView, uProj;
out vec3 vC;
void main() { vC = aCol; gl_Position = uProj * uView * vec4(aPos, 1.0); }`;

export const FRAME_FS = `#version 300 es
precision highp float;
in vec3 vC;
out vec4 frag;
void main() { frag = vec4(vC, 1.0); }`;
```

- [ ] **Step 4: Write `field.js`**

```js
// The vertex buffer and everything that writes into it.
//
// Allocated once at RING*RING*TILE_CELLS*TILE_CELLS particles and never resized.
// A particle is never created and never destroyed for the life of the page;
// loading a place writes into it and jumping tells every particle where to
// stand next. That rule is why a jump has to have the destination in hand
// before anything moves.
import { POINT_VS, POINT_FS, FRAME_VS, FRAME_FS } from './shaders.js';

export const CELL = 0.5;
export const TILE_CELLS = 32;
export const TILE_SPAN = TILE_CELLS * CELL;     // 16 m
export const RING = 12;
export const SHOWN = 10;
export const SPAN = SHOWN * TILE_SPAN;          // 160 m
export const HALF = SPAN / 2;
export const STRIDE = 32;
const PER_TILE = TILE_CELLS * TILE_CELLS;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function link(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

export function createField(gl) {
  const tiles = RING * RING;
  const count = tiles * PER_TILE;
  const buf = new ArrayBuffer(count * STRIDE);
  const f32 = new Float32Array(buf);
  const u8 = new Uint8Array(buf);
  const i8 = new Int8Array(buf);

  const program = link(gl, POINT_VS, POINT_FS);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, buf.byteLength, gl.DYNAMIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const attr = (name, size, type, norm, off) => {
    const l = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, size, type, norm, STRIDE, off);
  };
  attr('aWorld', 2, gl.FLOAT, false, 0);
  attr('aY', 2, gl.FLOAT, false, 8);
  attr('aBorn', 1, gl.FLOAT, false, 16);
  attr('aCA', 4, gl.UNSIGNED_BYTE, true, 20);
  attr('aCB', 4, gl.UNSIGNED_BYTE, true, 24);
  attr('aN', 4, gl.BYTE, true, 28);
  gl.bindVertexArray(null);

  const names = ['uView','uProj','uCentre','uDir','uMix','uTime','uArc','uLift','uSwing',
    'uColour','uPointK','uSpan','uDrop','uJump','uSize','uHalf','uTop'];
  const uniforms = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]));

  const EMPTY = { y: new Float32Array(PER_TILE), colour: new Uint8Array(PER_TILE * 3), normal: new Int8Array(PER_TILE * 2) };

  function writeTile(idx, { tx, tz, prev, next, born }) {
    const A = prev ?? EMPTY, B = next ?? prev ?? EMPTY;
    const base = idx * PER_TILE;
    const ox = tx * TILE_SPAN, oz = tz * TILE_SPAN;
    for (let p = 0; p < PER_TILE; p++) {
      const o = (base + p) * STRIDE, w = o >> 2;
      f32[w] = ox + (p % TILE_CELLS) * CELL;
      f32[w + 1] = oz + ((p / TILE_CELLS) | 0) * CELL;
      f32[w + 2] = A.y[p];
      f32[w + 3] = B.y[p];
      // Jittered per particle, not per tile. This one line is the difference
      // between a tile arriving as a block and a tile arriving as a scatter.
      if (born !== undefined) f32[w + 4] = born + ((p * 2654435761) % 1013) / 1013 * 0.65;
      u8[o + 20] = A.colour[p * 3]; u8[o + 21] = A.colour[p * 3 + 1]; u8[o + 22] = A.colour[p * 3 + 2]; u8[o + 23] = 255;
      u8[o + 24] = B.colour[p * 3]; u8[o + 25] = B.colour[p * 3 + 1]; u8[o + 26] = B.colour[p * 3 + 2]; u8[o + 27] = 255;
      i8[o + 28] = A.normal[p * 2]; i8[o + 29] = A.normal[p * 2 + 1];
      i8[o + 30] = B.normal[p * 2]; i8[o + 31] = B.normal[p * 2 + 1];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, base * STRIDE, u8, base * STRIDE, PER_TILE * STRIDE);
  }

  // The square's own edge, drawn rather than faded. Fog hides the fact that the
  // world stops; a frame says so, and says how big the sample is.
  const frameProgram = link(gl, FRAME_VS, FRAME_FS);
  const frameU = {
    uView: gl.getUniformLocation(frameProgram, 'uView'),
    uProj: gl.getUniformLocation(frameProgram, 'uProj'),
  };
  const frameVao = gl.createVertexArray();
  let frameVerts = 0;
  {
    const L = [];
    const seg = (a, b, c) => L.push(a[0], a[1], a[2], ...c, b[0], b[1], b[2], ...c);
    const dim = [0.22, 0.22, 0.27], amber = [0.88, 0.64, 0.09];
    const H = HALF, gy = -0.5, tick = 18;
    seg([-H, gy, -H], [H, gy, -H], dim); seg([H, gy, -H], [H, gy, H], dim);
    seg([H, gy, H], [-H, gy, H], dim);   seg([-H, gy, H], [-H, gy, -H], dim);
    for (const [sx, sz] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
      seg([sx*H, gy, sz*H], [sx*(H-tick), gy, sz*H], amber);
      seg([sx*H, gy, sz*H], [sx*H, gy, sz*(H-tick)], amber);
      seg([sx*H, gy, sz*H], [sx*H, gy + 10, sz*H], amber);
    }
    gl.bindVertexArray(frameVao);
    const fb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(L), gl.STATIC_DRAW);
    const lp = gl.getAttribLocation(frameProgram, 'aPos'), lc = gl.getAttribLocation(frameProgram, 'aCol');
    gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(lc); gl.vertexAttribPointer(lc, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
    frameVerts = L.length / 6;
  }

  return {
    count, program, uniforms, writeTile,
    drawFrame(view, proj) {
      gl.useProgram(frameProgram);
      gl.uniformMatrix4fv(frameU.uView, false, view);
      gl.uniformMatrix4fv(frameU.uProj, false, proj);
      gl.bindVertexArray(frameVao);
      gl.drawArrays(gl.LINES, 0, frameVerts);
    },
    drawPoints() {
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.bindVertexArray(null);
    },
  };
}
```

- [ ] **Step 5: Write `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>elsewhere</title>
  <style>
    html, body { height: 100%; }
    body { margin: 0; background: #0e0e11; color: #e8e6e0; font: 14px ui-monospace, monospace; overflow: hidden; }
    canvas { display: block; width: 100vw; height: 100vh; cursor: grab; touch-action: none; }
    canvas.dragging { cursor: grabbing; }
    a.back { position: fixed; top: 1rem; left: 1rem; color: #8a877e; text-decoration: none; z-index: 3; }
    #meta { position: fixed; top: 3rem; left: 1rem; z-index: 3; color: #8a877e; font-size: 11px; line-height: 1.7; max-width: 22rem; }
    #meta b { color: #e8e6e0; font-weight: normal; }
    #meta a { color: #7fb3a3; }
    #hint { position: fixed; top: 1rem; right: 1rem; z-index: 3; color: #8a877e; text-align: right; line-height: 1.6; font-size: 12px; }
    #hint kbd { color: #e8e6e0; font: inherit; }
    #ui { position: fixed; bottom: 0.75rem; left: 0; right: 0; margin: 0 auto; width: fit-content; max-width: calc(100vw - 2rem); z-index: 3;
          display: flex; flex-direction: column; gap: 0.45rem; background: #17171cdd; padding: 0.55rem 0.75rem; border-radius: 8px; }
    .row { display: flex; gap: 0.4rem; align-items: center; justify-content: center; flex-wrap: wrap; }
    .row .lab { color: #8a877e; font-size: 11px; }
    button { background: #26262e; color: #e8e6e0; border: 1px solid #444; border-radius: 4px; padding: 0.3rem 0.55rem; font: inherit; font-size: 13px; cursor: pointer; }
    button:hover { border-color: #7fb3a3; }
    button.on { border-color: #7fb3a3; color: #7fb3a3; }
    button:disabled { opacity: 0.45; cursor: default; }
    input[type=text] { background: #0e0e11; color: #e8e6e0; border: 1px solid #444; border-radius: 4px; padding: 0.3rem 0.5rem; font: inherit; font-size: 13px; width: 17rem; }
    input[type=text]:focus { outline: none; border-color: #7fb3a3; }
    input[type=range] { accent-color: #7fb3a3; }
    input[type=range]:disabled { opacity: 0.4; }
    #note { color: #e0a316; font-size: 11px; min-height: 1em; text-align: center; }
    #veil { position: fixed; inset: 0; z-index: 4; display: grid; place-items: center; background: #0e0e11; color: #8a877e; font-size: 12px; transition: opacity .5s; }
    #veil.gone { opacity: 0; pointer-events: none; }
    @media (max-width: 720px) { #meta, #hint { display: none; } }
  </style>
</head>
<body>
  <a class="back" href="/">← sketchbook</a>

  <div id="meta">
    <div><b id="m-place">—</b></div>
    <div>RD <b id="m-x">—</b> <b id="m-z">—</b> · window <b id="m-span">160</b> m</div>
    <div><b id="m-n">—</b> particles · never created, never destroyed</div>
    <div>ground at <b id="m-datum">—</b> m NAP</div>
    <div>AHN 0.5 m + orthophoto · <a href="https://www.ahn.nl/open-data" target="_blank" rel="noopener">AHN</a> CC BY 4.0</div>
    <div id="m-mismatch">photo 2026, heights 2023–24</div>
  </div>

  <div id="hint">
    <kbd>W A S D</kbd> slide the window · <kbd>shift</kbd> faster<br />
    drag to orbit · wheel to dolly<br />
    <kbd>c</kbd> colour · <kbd>s</kbd> png ×3 · <kbd>h</kbd> hide
  </div>

  <div id="ui">
    <div class="row">
      <input id="address" type="text" placeholder="a Dutch address, then ↵" autocomplete="off" spellcheck="false" />
      <button id="go">fly there</button>
    </div>
    <div class="row">
      <span class="lab">scrub</span>
      <input id="mix" type="range" min="0" max="1" step="0.001" value="0" style="width:12rem" disabled />
      <span class="lab" id="mixv">—</span>
      <button id="hold">hold</button>
      <span class="lab">grain</span>
      <input id="grain" type="range" min="0.25" max="1.3" step="0.05" value="0.55" style="width:6rem" />
      <button id="colour">lit photo</button>
      <button id="save">png ×3</button>
    </div>
    <div id="note"></div>
  </div>

  <div id="veil">reading the ground…</div>
  <script type="module" src="./sketch.js"></script>
</body>
</html>
```

- [ ] **Step 6: Write `meta.json`**

```json
{
  "title": "elsewhere",
  "date": "2026-08-09",
  "tags": ["lidar", "point-cloud", "webgl", "maps", "transitions"],
  "description": "A 160 m square of the Netherlands, built live from national LiDAR and aerial photography, that you slide across the country with WASD. Type any Dutch address and the same particles rearrange into that place, streaming along the true compass bearing — and a slider parks the journey anywhere in between.",
  "thumbnail": "thumb.png"
}
```

- [ ] **Step 7: Write the first `sketch.js`**

Loads the baked place, fills every slot from it, draws under a fixed orbit camera. Movement, jumping and controls arrive in Tasks 7–9.

```js
// elsewhere — a square of the Netherlands you can slide across the country.
//
// Nothing here is generated. Heights are AHN, the national 0.5 m LiDAR-derived
// surface and terrain models; colour is the current orthophoto. Both arrive
// live from PDOK for whatever address you ask for, decoded in the page.
//
// The rule the whole thing is built around: there are N particles, allocated
// once, and nothing ever creates or destroys one. Sliding the window re-points
// them at new ground. Jumping tells all of them where to stand next.
import { decodeFloatTiff } from './geotiff.js';
import { assemble } from './place.js';
import { createSlots } from './slots.js';
import { createField, CELL, TILE_CELLS, TILE_SPAN, RING, SPAN, HALF } from './field.js';
import { cachedFetch } from './pdok.js';

const BAKED = '/data/elsewhere/prins-hendriklaan';
const $ = (id) => document.getElementById(id);
const note = (m) => { $('note').textContent = m ?? ''; };

const dot3 = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross3 = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm3 = (a) => { const l = Math.hypot(a[0],a[1],a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
const perspective = (fovy, aspect, near, far) => {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
};

async function loadBaked(base, cache) {
  const meta = await (await fetch(`${base}/place.json`)).json();
  const [dsmBuf, dtmBuf] = await Promise.all([
    cachedFetch(`${base}/dsm.tif`, cache),
    cachedFetch(`${base}/dtm.tif`, cache),
  ]);
  const [dsm, dtm] = await Promise.all([decodeFloatTiff(dsmBuf), decodeFloatTiff(dtmBuf)]);
  const bitmap = await createImageBitmap(await (await fetch(`${base}/ortho.jpg`)).blob());
  const oc = new OffscreenCanvas(dsm.width, dsm.height);
  const ctx = oc.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, dsm.width, dsm.height);
  const rgb = ctx.getImageData(0, 0, dsm.width, dsm.height).data;
  return { meta, data: assemble({ dsm, dtm, rgb, width: dsm.width, height: dsm.height }) };
}

// A raster covers a bbox at some cell size; a render tile wants TILE_CELLS
// squared samples starting at a world corner. Nearest-neighbour is right here:
// the baked opening frame is coarser than the field, and interpolating it would
// invent detail the survey does not have.
function sampleTile(src, meta, tx, tz) {
  const n = TILE_CELLS * TILE_CELLS;
  const out = { y: new Float32Array(n), colour: new Uint8Array(n * 3), normal: new Int8Array(n * 2) };
  const [minx, miny, , maxy] = meta.bbox;
  for (let j = 0; j < TILE_CELLS; j++) {
    for (let i = 0; i < TILE_CELLS; i++) {
      const wx = tx * TILE_SPAN + i * CELL;
      const wz = tz * TILE_SPAN + j * CELL;
      const sx = Math.round((wx - minx) / meta.cell);
      // rasters are north-up: row 0 is the top, which is maxy
      const sy = Math.round((maxy - wz) / meta.cell);
      const p = j * TILE_CELLS + i;
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
      const q = sy * src.width + sx;
      out.y[p] = src.y[q];
      out.colour[p*3] = src.colour[q*3];
      out.colour[p*3+1] = src.colour[q*3+1];
      out.colour[p*3+2] = src.colour[q*3+2];
      out.normal[p*2] = src.normal[q*2];
      out.normal[p*2+1] = src.normal[q*2+1];
    }
  }
  return out;
}

async function main() {
  const canvas = document.createElement('canvas');
  document.body.insertBefore(canvas, document.body.firstChild);
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) { $('veil').textContent = 'this sketch needs WebGL2'; return; }

  const cache = 'caches' in window ? await caches.open('elsewhere-v1').catch(() => null) : null;
  let baked;   // let, not const: landing replaces it with the destination
  try {
    baked = await loadBaked(BAKED, cache);
  } catch (e) {
    $('veil').textContent = 'could not read the opening place: ' + e.message;
    return;
  }

  const field = createField(gl);
  const slots = createSlots({ ring: RING });
  const cam = { x: baked.meta.centre[0], z: baked.meta.centre[1], yaw: 0.72, pitch: 0.40, dist: 215 };
  const view = { colour: 0, grain: 0.55, clock: 0 };

  function fill() {
    const ctx = Math.floor(cam.x / TILE_SPAN), ctz = Math.floor(cam.z / TILE_SPAN);
    for (const job of slots.reshelve(ctx, ctz)) {
      const next = sampleTile(baked.data, baked.meta, job.tx, job.tz);
      field.writeTile(job.idx, { tx: job.tx, tz: job.tz, prev: next, next, born: -10 });
      slots.markReady(job.idx);
    }
  }
  fill();

  $('m-place').textContent = baked.meta.name;
  $('m-n').textContent = field.count.toLocaleString('en-US');
  $('m-datum').textContent = baked.data.datum.toFixed(2);
  $('m-span').textContent = String(SPAN);

  function matrices(w, h) {
    const target = [0, 22, 0];
    const eye = [
      Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist,
      target[1] + Math.sin(cam.pitch) * cam.dist,
      Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist,
    ];
    const z = norm3([eye[0]-target[0], eye[1]-target[1], eye[2]-target[2]]);
    const x = norm3(cross3([0,1,0], z));
    const y = cross3(z, x);
    const FOV = 0.82;
    return {
      view: new Float32Array([
        x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
        -dot3(x,eye), -dot3(y,eye), -dot3(z,eye), 1,
      ]),
      proj: perspective(FOV, w / h, 1, 6000),
      pointK: CELL * (h * 0.5) / Math.tan(FOV / 2) * 1.15,
    };
  }

  function render(w, h) {
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.055, 0.055, 0.067, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const m = matrices(w, h);
    field.drawFrame(m.view, m.proj);
    gl.useProgram(field.program);
    const u = field.uniforms;
    gl.uniformMatrix4fv(u.uView, false, m.view);
    gl.uniformMatrix4fv(u.uProj, false, m.proj);
    gl.uniform3f(u.uCentre, cam.x, 0, cam.z);
    gl.uniform2f(u.uDir, 0, 1);
    gl.uniform1f(u.uMix, 0);
    gl.uniform1f(u.uTime, view.clock);
    gl.uniform1f(u.uArc, 0);
    gl.uniform1f(u.uLift, 0);
    gl.uniform1f(u.uSwing, 0);
    gl.uniform1f(u.uColour, view.colour);
    gl.uniform1f(u.uPointK, m.pointK);
    gl.uniform1f(u.uSpan, 0.55);
    gl.uniform1f(u.uDrop, 11);
    gl.uniform1f(u.uJump, 0);
    gl.uniform1f(u.uSize, view.grain);
    gl.uniform1f(u.uHalf, HALF);
    gl.uniform1f(u.uTop, 18);
    field.drawPoints();
  }

  let last = performance.now();
  function frame(now) {
    view.clock += Math.min(0.05, (now - last) / 1000); last = now;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    render(w, h);
    $('m-x').textContent = cam.x.toFixed(0);
    $('m-z').textContent = cam.z.toFixed(0);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  $('veil').classList.add('gone');

  window.__elsewhere = {
    ready: () => slots.readyCount() === RING * RING,
    place: () => baked.meta,
    state: () => ({ ...view }),
    centre: () => ({ x: cam.x, z: cam.z }),
    coverage: () => {
      const s = Math.min(600, canvas.width, canvas.height);
      render(canvas.width, canvas.height);
      const px = new Uint8Array(s * s * 4);
      gl.readPixels((canvas.width - s) >> 1, (canvas.height - s) >> 1, s, s, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lit = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i+1] + px[i+2] > 60) lit++;
      return lit / (s * s);
    },
  };
}

main();
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test 2>&1 | grep -E "opening place loads"`
Expected: `ok`.

If coverage is near zero, screenshot it with a scratch script before changing anything — a black square usually means the raster's row order is flipped, which `sampleTile` handles with `maxy - wz`.

- [ ] **Step 9: Commit**

```bash
git add sketches/2026-08-elsewhere test.mjs
git commit -m "feat(elsewhere): draw the opening place as a bounded square"
```

---

### Task 7: Sliding the window

**Files:**
- Modify: `sketches/2026-08-elsewhere/sketch.js`
- Modify: `test.mjs`

**Interfaces:**
- Consumes: everything from Task 6.
- Produces: `window.__elsewhere.centre()` moves; `window.__elsewhere.loading()` → number of outstanding tile fetches. A new `tiles.js` is **not** needed; the loader lives in `sketch.js`.

- [ ] **Step 1: Write the failing tests**

Add to the elsewhere browser block in `test.mjs`, before `await p.close()`:

```js
    await test('WASD slides the window and the ground keeps up', async () => {
      const before = await el(() => window.__elsewhere.centre());
      await p.keyboard.down('w');
      const dips = [];
      for (let i = 0; i < 10; i++) {
        await p.waitForTimeout(180);
        dips.push(await el(() => window.__elsewhere.coverage()));
      }
      await p.keyboard.up('w');
      const after = await el(() => window.__elsewhere.centre());
      assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 40, 'the window did not move');
      // The margin ring exists so the leading edge is never a hole. If this
      // fails the margin is too small or eviction is blanking slots again.
      assert.ok(Math.min(...dips) > 0.05, `coverage collapsed to ${Math.min(...dips)} while moving`);
      assert.deepEqual(errors, []);
    });

    await test('at rest nothing moves at all', async () => {
      // Every displacement in the shader is zero at both ends of a transition,
      // so a settled square is the survey rather than an approximation of it.
      // This fails the moment anything integrates or idles.
      await p.waitForFunction(() => window.__elsewhere.loading() === 0, null, { timeout: 30000 });
      await p.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; });
      const a = await p.locator('canvas').screenshot();
      await p.waitForTimeout(1000);
      const b = await p.locator('canvas').screenshot();
      await p.evaluate(() => { document.getElementById('ui').style.visibility = ''; });
      assert.ok(a.equals(b), 'the square drifted while it was supposed to be still');
    });

    await test('drag orbits the square without moving it', async () => {
      const before = await el(() => window.__elsewhere.centre());
      await p.mouse.move(600, 450);
      await p.mouse.down();
      await p.mouse.move(760, 470, { steps: 8 });
      await p.mouse.up();
      const after = await el(() => window.__elsewhere.centre());
      assert.equal(after.x, before.x);
      assert.equal(after.z, before.z);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | grep -A2 "WASD slides"`
Expected: FAIL — the window does not move.

- [ ] **Step 3: Add the tile loader**

In `sketch.js`, replace `fill()` with a queued loader and add a `place` cache. Insert after `const view = {...}`:

```js
  // Fetch tiles are 240 m and cached by URL; render tiles are 16 m and cut out
  // of whichever fetch tile covers them. Separating the two is what keeps both
  // the request count and the buffer writes sane: one PDOK round trip feeds 225
  // render tiles, and each render tile is one contiguous bufferSubData.
  const fetched = new Map();          // fetch tile key -> { meta, data } | Promise
  const CONCURRENCY = 6;
  let inflight = 0;
  const queue = [];

  async function loadFetchTile(key) {
    if (fetched.has(key)) return fetched.get(key);
    const bbox = fetchTileBbox(key);
    const promise = (async () => {
      const [dsmBuf, dtmBuf, orthoBuf] = await Promise.all([
        cachedFetch(coverageUrl('dsm_05m', bbox, FETCH_SIZE), cache),
        cachedFetch(coverageUrl('dtm_05m', bbox, FETCH_SIZE), cache),
        cachedFetch(orthoUrl(bbox, FETCH_SIZE), cache),
      ]);
      const [dsm, dtm] = await Promise.all([decodeFloatTiff(dsmBuf), decodeFloatTiff(dtmBuf)]);
      const bitmap = await createImageBitmap(new Blob([orthoBuf], { type: 'image/jpeg' }));
      const oc = new OffscreenCanvas(dsm.width, dsm.height);
      const c2 = oc.getContext('2d');
      c2.drawImage(bitmap, 0, 0, dsm.width, dsm.height);
      const rgb = c2.getImageData(0, 0, dsm.width, dsm.height).data;
      const meta = { bbox, cell: FETCH_SPAN / FETCH_SIZE, width: dsm.width, height: dsm.height };
      // Every tile is levelled to the place's datum, not its own, or adjacent
      // tiles would step against each other wherever the ground changed.
      const data = assemble({ dsm, dtm, rgb, width: dsm.width, height: dsm.height });
      const shift = data.datum - baked.data.datum;
      for (let i = 0; i < data.y.length; i++) data.y[i] += shift;
      return { meta, data };
    })();
    fetched.set(key, promise);
    const done = await promise;
    fetched.set(key, done);
    return done;
  }

  function pump() {
    while (inflight < CONCURRENCY && queue.length) {
      const job = queue.shift();
      const slot = slots.slots[job.idx];
      if (slot.tx !== job.tx || slot.tz !== job.tz) continue;   // the window moved on
      inflight++;
      const wx = job.tx * TILE_SPAN + TILE_SPAN / 2;
      const wz = job.tz * TILE_SPAN + TILE_SPAN / 2;
      loadFetchTile(fetchTileKey(wx, wz))
        .then((src) => {
          if (slot.tx !== job.tx || slot.tz !== job.tz) return;
          const next = sampleTile(src.data, src.meta, job.tx, job.tz);
          field.writeTile(job.idx, { tx: job.tx, tz: job.tz, prev: slot.data, next, born: view.clock });
          slot.data = next;
          slots.markReady(job.idx);
        })
        .catch((e) => note('could not read that ground: ' + e.message))
        .finally(() => { inflight--; pump(); });
    }
  }

  function fill() {
    const ctx = Math.floor(cam.x / TILE_SPAN), ctz = Math.floor(cam.z / TILE_SPAN);
    for (const job of slots.reshelve(ctx, ctz)) {
      // The opening frame is baked and already in memory, so the first ring is
      // filled synchronously; only ground beyond it goes to the network.
      const inBaked = job.tx * TILE_SPAN >= baked.meta.bbox[0]
        && job.tx * TILE_SPAN + TILE_SPAN <= baked.meta.bbox[2]
        && job.tz * TILE_SPAN >= baked.meta.bbox[1]
        && job.tz * TILE_SPAN + TILE_SPAN <= baked.meta.bbox[3];
      const slot = slots.slots[job.idx];
      if (inBaked) {
        const next = sampleTile(baked.data, baked.meta, job.tx, job.tz);
        field.writeTile(job.idx, { tx: job.tx, tz: job.tz, prev: slot.data ?? next, next, born: slot.data ? view.clock : -10 });
        slot.data = next;
        slots.markReady(job.idx);
      } else {
        queue.push(job);
      }
    }
    pump();
  }
```

Extend the import from `./pdok.js` to `import { cachedFetch, coverageUrl, orthoUrl, fetchTileKey, fetchTileBbox, FETCH_SPAN, FETCH_SIZE } from './pdok.js';`

- [ ] **Step 4: Add movement and orbit input**

Add before `matrices()`:

```js
  const keys = new Set();
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.key.toLowerCase());
    if (['w','a','s','d'].includes(e.key.toLowerCase())) e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cam.yaw -= (e.clientX - drag.x) * 0.004;
    cam.pitch = Math.max(0.06, Math.min(1.45, cam.pitch + (e.clientY - drag.y) * 0.003));
    drag = { x: e.clientX, y: e.clientY };
  });
  const endDrag = () => { drag = null; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = Math.max(90, Math.min(1800, cam.dist * Math.exp(e.deltaY * 0.0011)));
  }, { passive: false });
```

And in `frame()`, before `render(...)`:

```js
    const dt = Math.min(0.05, (now - last) / 1000);
    // The camera orbits and never translates; W slides the framed coordinates,
    // so the square stays put on screen and the country moves through it.
    const speed = 34 * (keys.has('shift') ? 4 : 1) * dt;
    const fwd = [-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw)];
    const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
    let moved = false;
    const go = (v, s) => { cam.x += v[0] * s; cam.z += v[2] * s; moved = true; };
    if (keys.has('w')) go(fwd, speed);
    if (keys.has('s')) go(fwd, -speed);
    if (keys.has('d')) go(right, speed);
    if (keys.has('a')) go(right, -speed);
    if (moved) fill();
```

Replace the existing `view.clock += ...; last = now;` with `view.clock += dt; last = now;` placed after `const dt = ...`.

Add `loading: () => queue.length + inflight` to `window.__elsewhere`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test 2>&1 | grep -E "WASD slides|drag orbits"`
Expected: both `ok`.

- [ ] **Step 6: Commit**

```bash
git add sketches/2026-08-elsewhere/sketch.js test.mjs
git commit -m "feat(elsewhere): slide the window, stream tiles at the edge"
```

---

### Task 8: Jumping to an address

**Files:**
- Modify: `sketches/2026-08-elsewhere/sketch.js`
- Modify: `test.mjs`

**Interfaces:**
- Consumes: `journey`, `geocode` (Task 3).
- Produces: `window.__elsewhere.phase()` → `'roam' | 'gathering' | 'flying'`; `window.__elsewhere.jumpTo(query)` → Promise; `window.__elsewhere.mix()` → number.

- [ ] **Step 1: Write the failing tests**

Add to the elsewhere block:

```js
    await test('a jump gathers the destination before anything moves', async () => {
      const seen = [];
      const done = el(() => window.__elsewhere.jumpTo('Coolsingel 40, Rotterdam'));
      for (let i = 0; i < 30; i++) {
        seen.push({
          phase: await el(() => window.__elsewhere.phase()),
          lit: await el(() => window.__elsewhere.coverage()),
        });
        await p.waitForTimeout(150);
        if (seen.at(-1).phase === 'roam' && seen.length > 6) break;
      }
      await done;
      assert.ok(seen.some((s) => s.phase === 'gathering'), 'never gathered');
      assert.ok(seen.some((s) => s.phase === 'flying'), 'never flew');
      // Nothing may vanish. The first version of this threw the tiles away and
      // reloaded, which went fully black mid-jump — a dissolve, not a journey.
      const dark = seen.filter((s) => s.lit < 0.03);
      assert.equal(dark.length, 0, `the picture went dark ${dark.length} times mid-jump`);
    });

    await test('landing leaves the new place standing and the readout honest', async () => {
      await p.waitForFunction(() => window.__elsewhere.phase() === 'roam', null, { timeout: 30000 });
      assert.match(await p.textContent('#m-place'), /Coolsingel/);
      assert.ok((await el(() => window.__elsewhere.coverage())) > 0.08);
      assert.deepEqual(errors, []);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | grep -A2 "gathers the destination"`
Expected: FAIL — `jumpTo` is not a function.

- [ ] **Step 3: Implement the jump**

Add to `sketch.js`:

```js
  let phase = 'roam';
  let flight = null;      // { journey, mix, dur, started, target }
  let held = false;

  async function jumpTo(query) {
    if (phase !== 'roam') return;
    note('looking that up…');
    let dest;
    try {
      dest = await geocode(query);
    } catch (e) {
      note(e.message);
      return;
    }
    const j = journey([cam.x, cam.z], [dest.x, dest.y]);
    phase = 'gathering';
    note(`gathering ${dest.name} — nothing has moved yet`);

    // The destination has to be in hand before a single particle moves: a
    // particle cannot walk to a position that has not been fetched. Gathering
    // happens behind the place still on screen, and one coarse window covering
    // the whole square is three requests rather than 144.
    const half = HALF + TILE_SPAN;
    const bbox = [dest.x - half, dest.y - half, dest.x + half, dest.y + half];
    let src;
    try {
      const [dsmBuf, dtmBuf, orthoBuf] = await Promise.all([
        cachedFetch(coverageUrl('dsm_05m', bbox, 480), cache),
        cachedFetch(coverageUrl('dtm_05m', bbox, 480), cache),
        cachedFetch(orthoUrl(bbox, 480), cache),
      ]);
      const [dsm, dtm] = await Promise.all([decodeFloatTiff(dsmBuf), decodeFloatTiff(dtmBuf)]);
      const bitmap = await createImageBitmap(new Blob([orthoBuf], { type: 'image/jpeg' }));
      const oc = new OffscreenCanvas(dsm.width, dsm.height);
      const c2 = oc.getContext('2d');
      c2.drawImage(bitmap, 0, 0, dsm.width, dsm.height);
      const rgb = c2.getImageData(0, 0, dsm.width, dsm.height).data;
      src = { meta: { bbox, cell: (half * 2) / 480, width: dsm.width, height: dsm.height },
              data: assemble({ dsm, dtm, rgb, width: dsm.width, height: dsm.height }) };
    } catch (e) {
      phase = 'roam';
      note('could not reach that place: ' + e.message);
      return;
    }

    // Write the destination into every slot's B without touching A, so the
    // place on screen is untouched until the flight starts.
    const dTx = Math.round((dest.x - cam.x) / TILE_SPAN);
    const dTz = Math.round((dest.y - cam.z) / TILE_SPAN);
    for (const slot of slots.slots) {
      if (slot.tx === null) continue;
      const idx = slots.indexOf(slot.tx, slot.tz);
      if (idx === undefined) continue;
      const next = sampleTile(src.data, src.meta, slot.tx + dTx, slot.tz + dTz);
      field.writeTile(idx, { tx: slot.tx, tz: slot.tz, prev: slot.data, next });
      slot.pending = next;
    }

    flight = { j, mix: 0, dur: j.seconds, started: view.clock, dest, dTx, dTz, src };
    phase = 'flying';
    $('mix').disabled = false;
    note(`${j.km.toFixed(1)} km · ${j.bearing.toFixed(0)}° ${j.rose}`);
  }

  function land() {
    const f = flight;
    phase = 'roam';
    cam.x += f.dTx * TILE_SPAN;
    cam.z += f.dTz * TILE_SPAN;
    baked = f.src;                       // the coarse destination is now the base
    for (const slot of slots.slots) {
      if (slot.tx === null) continue;
      slot.tx += f.dTx; slot.tz += f.dTz;
      slot.data = slot.pending ?? slot.data;
      slot.pending = null;
    }
    // The slot map is keyed by tile coordinate, so it has to be rebuilt after a
    // re-anchor. Rebuilding by reshelving from the new centre also queues the
    // sharp tiles that will refine over the coarse arrival.
    slots.rebase(f.dTx, f.dTz);
    flight = null;
    $('m-place').textContent = f.dest.name;
    $('m-datum').textContent = baked.data.datum.toFixed(2);
    $('mix').disabled = true; $('mixv').textContent = '—';
    note('landed — WASD to slide the window from here');
    fill();
  }
```

Add `rebase(dTx, dTz)` to `slots.js`, which rewrites the internal map keys after every slot's `tx`/`tz` has been shifted:

```js
  function rebase(dTx, dTz) {
    byTile.clear();
    for (let i = 0; i < total; i++) {
      const s = slots[i];
      if (s.tx === null) continue;
      byTile.set(key(s.tx, s.tz), i);
    }
    free.length = 0;
    for (let i = total - 1; i >= 0; i--) if (slots[i].tx === null) free.push(i);
  }
```

Return `rebase` from `createSlots`. Note that `slot.tx`/`slot.tz` are shifted by the caller before `rebase` is called.

Add its test to the `slots` block in `test.mjs`:

```js
    await test('rebasing re-keys the map after a landing moves every tile', async () => {
      const s = createSlots({ ring: 5 });
      for (const j of s.reshelve(0, 0)) s.markReady(j.idx);
      const idx = s.indexOf(0, 0);
      for (const slot of s.slots) { if (slot.tx !== null) { slot.tx += 100; slot.tz -= 40; } }
      s.rebase(100, -40);
      assert.equal(s.indexOf(0, 0), undefined, 'the old coordinate still resolves');
      assert.equal(s.indexOf(100, -40), idx, 'the tile did not move with its slot');
      // and the ring is still whole from the new centre
      assert.equal(s.reshelve(100, -40).length, 0);
    });
```

Drive the flight in `frame()`, before `render`:

```js
    if (phase === 'flying' && !held) {
      flight.mix = Math.min(1, (view.clock - flight.started) / flight.dur);
      $('mix').value = String(flight.mix);
      $('mixv').textContent = flight.mix.toFixed(3);
      if (flight.mix >= 1) land();
    }
```

Movement is locked unless `phase === 'roam'` — wrap the WASD block in that check. Reshelving mid-flight would evict the slots carrying particles across the country.

Set the flight uniforms in `render`:

```js
    const flying = phase === 'flying' || phase === 'gathering';
    gl.uniform2f(u.uDir, flight?.j.dirX ?? 0, flight?.j.dirZ ?? 1);
    gl.uniform1f(u.uMix, flight?.mix ?? 0);
    gl.uniform1f(u.uArc, phase === 'flying' ? 1 : 0);
    gl.uniform1f(u.uLift, flight ? Math.min(120, 24 + 30 * Math.log10(1 + flight.j.km * 10)) : 0);
    gl.uniform1f(u.uSwing, flight ? Math.min(210, 34 + 40 * Math.log10(1 + flight.j.km * 10)) : 0);
    gl.uniform1f(u.uJump, flying ? 1 : 0);
```

Wire the input: `$('go').onclick` and Enter in `#address` both call `jumpTo($('address').value)`. Add `jumpTo`, `phase: () => phase`, `mix: () => flight?.mix ?? 0` to `window.__elsewhere`, and import `journey, geocode` from `./pdok.js`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | grep -E "gathers the destination|landing leaves"`
Expected: both `ok`.

- [ ] **Step 5: Commit**

```bash
git add sketches/2026-08-elsewhere test.mjs
git commit -m "feat(elsewhere): gather, fly, land"
```

---

### Task 9: Scrub, colour modes, grain, export

**Files:**
- Modify: `sketches/2026-08-elsewhere/sketch.js`
- Modify: `test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
    await test('the scrub parks the journey and holds it', async () => {
      const done = el(() => window.__elsewhere.jumpTo('Prins Hendriklaan 17, Utrecht'));
      await p.waitForFunction(() => window.__elsewhere.phase() === 'flying', null, { timeout: 30000 });
      await p.click('#hold');
      await p.fill('#mix', '0.42');
      await p.dispatchEvent('#mix', 'input');
      await p.waitForTimeout(500);
      const a = await el(() => window.__elsewhere.mix());
      await p.waitForTimeout(800);
      assert.equal(await el(() => window.__elsewhere.mix()), a, 'a held scrub kept running');
      assert.ok(Math.abs(a - 0.42) < 0.01, `parked at ${a}`);
      await p.click('#hold');
      await done;
      await p.waitForFunction(() => window.__elsewhere.phase() === 'roam', null, { timeout: 30000 });
    });

    await test('every colour mode draws', async () => {
      for (let i = 0; i < 3; i++) {
        await el((n) => window.__elsewhere.setColour(n), i);
        await p.waitForTimeout(150);
        const c = await el(() => window.__elsewhere.coverage());
        assert.ok(c > 0.05, `colour mode ${i} drew almost nothing (${c})`);
      }
      await el(() => window.__elsewhere.setColour(0));
    });

    await test('PNG export produces a download', async () => {
      const [download] = await Promise.all([
        p.waitForEvent('download', { timeout: 15000 }),
        p.click('#save'),
      ]);
      assert.match(download.suggestedFilename(), /^elsewhere-.*\.png$/);
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test 2>&1 | grep -A2 "scrub parks"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
  $('mix').oninput = (e) => {
    if (!flight) return;
    held = true; $('hold').classList.add('on');
    flight.mix = +e.target.value;
    $('mixv').textContent = flight.mix.toFixed(3);
  };
  $('hold').onclick = (e) => {
    held = !held;
    e.target.classList.toggle('on', held);
    // Restart the clock where the scrub left it, or releasing hold snaps.
    if (!held && flight) flight.started = view.clock - flight.mix * flight.dur;
  };
  $('grain').oninput = (e) => { view.grain = +e.target.value; };
  const COLOURS = ['lit photo', 'height ramp', 'photo texture'];
  const setColour = (i) => { view.colour = i; $('colour').textContent = COLOURS[i]; };
  $('colour').onclick = () => setColour((view.colour + 1) % 3);

  function savePNG() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(innerWidth * 3), h = Math.round(innerHeight * 3);
    canvas.width = w; canvas.height = h;
    render(w, h);
    // Read back in the same tick: without preserveDrawingBuffer the composite
    // is gone the moment the frame yields.
    const url = canvas.toDataURL('image/png');
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    const a = document.createElement('a');
    a.href = url;
    a.download = `elsewhere-${Math.round(cam.x)}-${Math.round(cam.z)}.png`;
    a.click();
    note('saved at ×3');
  }
  $('save').onclick = savePNG;

  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'c') setColour((view.colour + 1) % 3);
    else if (k === 's') savePNG();
    else if (k === 'h') document.querySelectorAll('#ui, #meta, #hint').forEach((n) => {
      n.style.display = n.style.display === 'none' ? '' : 'none';
    });
  });
```

Add `setColour` to `window.__elsewhere`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test 2>&1 | grep -E "scrub parks|every colour mode|PNG export produces"`
Expected: three `ok`.

- [ ] **Step 5: Commit**

```bash
git add sketches/2026-08-elsewhere/sketch.js test.mjs
git commit -m "feat(elsewhere): scrub, colour modes, grain, export"
```

---

### Task 10: Failure behaviour

**Files:**
- Modify: `sketches/2026-08-elsewhere/sketch.js`
- Modify: `test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
    await test('an address nobody has heard of leaves the place standing', async () => {
      const before = await p.textContent('#m-place');
      await el(() => window.__elsewhere.jumpTo('qqqzzz not a place at all'));
      await p.waitForTimeout(600);
      assert.equal(await p.textContent('#m-place'), before);
      assert.equal(await el(() => window.__elsewhere.phase()), 'roam');
      assert.match(await p.textContent('#note'), /no match/i);
      assert.ok((await el(() => window.__elsewhere.coverage())) > 0.05);
    });

    await test('a dead coverage service leaves the place standing and says why', async () => {
      await p.route('**/rws/ahn/wcs/**', (route) => route.abort('failed'));
      const before = await p.textContent('#m-place');
      await el(() => window.__elsewhere.jumpTo('Coolsingel 40, Rotterdam'));
      await p.waitForTimeout(1500);
      assert.equal(await p.textContent('#m-place'), before);
      assert.equal(await el(() => window.__elsewhere.phase()), 'roam');
      assert.match(await p.textContent('#note'), /could not reach/i);
      assert.ok((await el(() => window.__elsewhere.coverage())) > 0.05);
      await p.unroute('**/rws/ahn/wcs/**');
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test 2>&1 | grep -A2 "nobody has heard of"`
Expected: FAIL, or a hang, or a blank page.

- [ ] **Step 3: Implement**

The `try`/`catch` blocks in `jumpTo` from Task 8 already reset `phase = 'roam'` and write to the note. Verify both paths do this and that no code after a failed gather touches `field`. Add a guard at the top of `jumpTo` so an empty query is a no-op with `note('type an address first')`.

Also confirm the tile loader's `.catch` in Task 7 leaves the slot un-marked so it retries on the next `fill()` rather than wedging.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test 2>&1 | grep -E "nobody has heard of|dead coverage service"`
Expected: two `ok`.

- [ ] **Step 5: Commit**

```bash
git add sketches/2026-08-elsewhere/sketch.js test.mjs
git commit -m "feat(elsewhere): fail without going blank"
```

---

### Task 11: README, thumbnail, publish

**Files:**
- Modify: `README.md`
- Create (generated): `public/sketches/2026-08-elsewhere/thumb.png`

- [ ] **Step 1: Add the README entry**

Insert this immediately above the `- **hendriklaan**` bullet in the `## Sketches` list:

```markdown
- **elsewhere** (`2026-08-elsewhere`) — a 160 m square of the Netherlands you
  slide across the country. Nothing is generated: heights come from AHN's 0.5 m
  national surface and terrain models and colour from the current orthophoto,
  four requests and about 0.6 s for anywhere in the country, fetched live and
  decoded in the page. That is possible because PDOK's coverage service is
  CORS-open while the AHN point-cloud bucket is not — the COPC tiles behind
  `hendriklaan` cannot be read from a browser at all, so this trades real
  classified returns for a regular grid and gets every Dutch address in
  exchange. The GeoTIFF reader is hand-rolled against `DecompressionStream`
  rather than pulling in a 300 KB dependency; the two things that go wrong
  silently are both in libtiff's floating-point predictor, which accumulates
  bytes with stride 1 rather than by row and then de-interleaves four byte
  planes in reverse. Get either wrong and you still get finite, plausible
  numbers. Tiling is two levels because the network and the GPU want different
  sizes: 240 m fetch tiles cached by URL, 16 m render tiles contiguous in the
  vertex buffer so recycling one is a single upload. The buffer is allocated
  once at 147,456 particles and nothing ever creates or destroys one — which is
  why typing an address gathers the whole destination behind the place still on
  screen before a single particle moves. An earlier version reloaded on the
  jump and went completely black mid-flight, which is a dissolve wearing a
  journey's clothes. Particles do not travel the real distance either; 49 km
  puts every one of them off screen by mid-flight, so a particle keeps its
  ground position and changes what it is standing on while the whole field
  streams along the reverse bearing. A slider parks the journey anywhere in
  between, so you can export a street that is 42% of the way from Utrecht to
  Rotterdam. Storing the country was measured and rejected: 21.1 MB/km² over
  41,500 km² is about 876 GB, and a custom packed format gzips to 1.65 MB
  against 1.21 MB for PDOK's own three files, so the cache format is "whatever
  PDOK sent". AHN is CC BY 4.0.
```

- [ ] **Step 2: Run the whole suite**

Run: `npm test`
Expected: all tests pass, no failures.

- [ ] **Step 3: Generate the thumbnail**

Run: `npm run thumbs`
Expected: writes `public/sketches/2026-08-elsewhere/thumb.png`.

- [ ] **Step 4: Look at the thumbnail**

Open `public/sketches/2026-08-elsewhere/thumb.png`. It must show the lit square, not a black frame. The grabber waits 1500 ms; if the page is still loading at that point, the baked place is not being read synchronously enough — check that the first ring fills from `baked` without touching the network.

- [ ] **Step 5: Commit**

```bash
git add README.md public/sketches/2026-08-elsewhere
git commit -m "docs(elsewhere): readme entry and thumbnail"
```

- [ ] **Step 6: Publish**

Run: `PUBLISH_HOST=nixos make publish DRY=1`
Expected: lists `sketches/2026-08-elsewhere/` and `data/elsewhere/`.

Then: `PUBLISH_HOST=nixos make publish`
Then check: `curl -s -o /dev/null -w '%{http_code}\n' https://sketches.siem2l.nl/sketches/2026-08-elsewhere/`
Expected: `200`.

---

## Notes for the implementer

- `lab/elsewhere/index.html` is the working reference for the interaction. It is procedural and network-free, so when something looks wrong, compare against it before assuming the data is at fault.
- The seven constraints in the spec's "What the mock settled" section are all things that were built the obvious way first and were wrong. If you find yourself simplifying one away, re-read it.
- `npm test` takes about three minutes because it drives a real browser. Iterate with a scratch Playwright script at the repo root and delete it before committing.
