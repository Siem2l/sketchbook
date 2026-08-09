// Renders each sampled variant to a PNG by driving the real sketch.
//
// Driving the real sketch is the whole point. A harness that reimplemented
// message-noise's rendering to produce variants would be ranking something
// that is not the sketch, and the experiment would answer a question nobody
// asked. Same reasoning as shared/kernels.glsl: share the artifact, do not
// reimplement it.
//
//   node lab/render.mjs [--n 64] [--seed 1] [--out lab/variants]
//
// Writes <out>/vNNN.png and <out>/manifest.json. The manifest records what the
// sketch reported back after being set, not what it was asked for — if the two
// ever disagree, the record should show what was actually on screen.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleVariants, stampOf } from './variants.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5181;
const BASE = `http://localhost:${PORT}`;
const SKETCH = `${BASE}/sketches/2026-07-message-noise/`;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const N = Number(arg('n', 64));
const SEED = Number(arg('seed', 1));
const OUT = resolve(root, arg('out', 'lab/variants'));

async function waitForServer(url, ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`dev server never came up at ${url}`);
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'],
  { cwd: root, stdio: 'ignore' });
const browser = await chromium.launch();

try {
  await waitForServer(BASE);
  const variants = sampleVariants({ n: N, seed: SEED });

  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(SKETCH, { waitUntil: 'networkidle' });
  // The hint and the control panel are position:fixed and sit over the canvas,
  // so an element screenshot composites them into the frame. They are constant
  // across variants and leak nothing, but they are page chrome in an image
  // that is supposed to be nothing but the map.
  await page.addStyleTag({ content: '#hint, #ui, a.back { display: none !important; }' });
  await page.waitForTimeout(1200);

  const records = [];
  for (const v of variants) {
    // stamp:false is what makes the ranking blind — a stamped frame shows the
    // ranker the palette, the mode and every parameter, which is the recipe.
    const applied = await page.evaluate((spec) => window.__messageNoise.apply(spec),
      { ...v, stamp: false });

    // The sketch is frozen by apply(), but the frame on screen is still the
    // one from before it — one more paint has to land before the canvas holds
    // the variant. Two rAFs is the cheap guarantee.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const canvas = await page.$('canvas');
    await canvas.screenshot({ path: resolve(OUT, `${v.id}.png`) });

    records.push({ ...v, applied, stamp: stampOf(v), file: `${v.id}.png` });
    process.stdout.write(`\r[render] ${records.length}/${variants.length}`);
  }
  process.stdout.write('\n');

  // Sanity check rather than blind trust: apply() is a setter into live state
  // and a silently ignored field would produce a manifest that lies.
  const drift = records.filter((r) =>
    r.applied.mode !== r.mode || r.applied.palette !== r.palette
    || r.applied.bands !== r.bands || Math.abs(r.applied.t - r.t) > 1e-6);
  if (drift.length) {
    console.warn(`[render] ${drift.length} variant(s) did not take the state they were given`);
    console.warn(JSON.stringify(drift.slice(0, 3), null, 2));
  }

  writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify({
    seed: SEED, n: N, sketch: '2026-07-message-noise', variants: records,
  }, null, 2));

  console.log(`[render] wrote ${records.length} pngs + manifest.json to ${OUT}`);
  if (errors.length) console.warn(`[render] page errors:`, errors.slice(0, 5));
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
