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
// opening replay finished, or the seeded composition fully revealed and still.
// Both wait on the sketch's own readiness rather than on a delay — under load
// these take far longer than the time they nominally run for, and a fixed wait
// captures a half-drawn frame.
//
// inconstructions is captured with FLUX and TOWER off, which is how it loads.
// Do not add a target with either enabled: they animate forever by design and
// there is no frame to hold still.
const TARGETS = [
  {
    slug: 'inconstructions',
    url: '/sketches/2026-07-inconstructions/',
    ready: (p) => p.waitForFunction(
      () => window.__inconstructions && window.__inconstructions.demoDone() === true,
      null, { timeout: 60000 }),
  },
  {
    slug: 'splinter',
    url: '/sketches/2026-07-splinter/?seed=1234abcd',
    ready: (p) => p.waitForFunction(
      () => window.__splinter && window.__splinter.settled() === true,
      null, { timeout: 60000 }),
  },
];

async function waitForServer(url, ms = 30000) {
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
    // capturing or the hover highlight lands wherever the last run left it.
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
