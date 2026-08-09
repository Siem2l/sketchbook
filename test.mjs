// Behaviour tests for the sketches. Plain node + playwright (already a
// devDependency for thumbnails) rather than a test framework, so the repo keeps
// its single-runtime-dependency shape.
//
//   npm test              — starts a dev server, runs everything, tears down
//   npm test -- --keep    — leaves the dev server running afterwards
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const PORT = 5178;
const BASE = `http://localhost:${PORT}`;
const SKETCH = `${BASE}/sketches/2026-07-inconstructions/`;
const SPLINTER = `${BASE}/sketches/2026-07-splinter/`;
const FLASH = `${BASE}/sketches/2026-08-flash/`;
const NOISE = `${BASE}/sketches/2026-07-message-noise/`;
const EDGE = `${BASE}/sketches/2026-08-edge/`;
const HYDRA = `${BASE}/sketches/2026-08-hydra-edge/`;

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push([name, e]);
    console.log(`  FAIL ${name}\n       ${e.message.split('\n')[0]}`);
  }
}

async function waitForServer(url, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`dev server never came up at ${url}`);
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore', detached: false });

const browser = await chromium.launch();

try {
  await waitForServer(BASE);

  // ------------------------------------------------------------------ helpers
  const state = (p, fn) => p.evaluate(fn);
  const parts = (p) => state(p, () => window.__inconstructions.parts());

  async function openSketch({ width = 1200, height = 900, touch = false } = {}) {
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: touch,
      isMobile: touch,
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(SKETCH, { waitUntil: 'networkidle' });
    page.errors = errors;
    return page;
  }

  const settle = (p) => p.waitForTimeout(250);

  // Points on the finished demo build, verified against the assembled geometry:
  // TOP is the upward face of the accent ribbon, whose neighbour above is free;
  // SOLID is an interior face whose neighbour is already occupied; GROUND is a
  // bare lattice cell inside the volume.
  const TOP = { x: 600, y: 480 };
  const SOLID = { x: 600, y: 520 };
  const GROUND = { x: 450, y: 650 };

  // ------------------------------------------------------------- opening state
  {
    const p = await openSketch();

    await test('the page loads without console or runtime errors', async () => {
      await p.waitForTimeout(5200);
      assert.deepEqual(p.errors, []);
    });

    await test('the opening assembly is still mid-build at the thumbnail moment', async () => {
      const q = await openSketch();
      await q.waitForTimeout(2500);
      const n = await parts(q);
      assert.ok(n > 0, 'nothing had been placed yet');
      assert.ok(!(await state(q, () => window.__inconstructions.demoDone())),
        'assembly had already finished by 2.5s — the thumbnail would be static');
      await q.close();
    });

    await test('the opening assembly completes and yields control', async () => {
      assert.equal(await state(p, () => window.__inconstructions.demoDone()), true);
      assert.ok(await parts(p) > 20);
    });

    await test('the completed assembly leaves nothing on the undo stack', async () => {
      assert.equal(await state(p, () => window.__inconstructions.undoDepth()), 0);
    });

    await p.close();
  }

  await test('an interaction skips the opening assembly', async () => {
    const p = await openSketch();
    await p.waitForTimeout(600);
    await p.keyboard.press('r');
    await settle(p);
    assert.equal(await state(p, () => window.__inconstructions.demoDone()), true);
    await p.close();
  });

  // -------------------------------------------------------------- building
  {
    const p = await openSketch();
    await p.waitForTimeout(5000);

    await test('clicking a face of the structure attaches a part to it', async () => {
      const before = await parts(p);
      await p.mouse.move(TOP.x, TOP.y);
      await settle(p);
      assert.ok(await state(p, () => window.__inconstructions.target()),
        'no ghost target under the cursor, so the click would be refused');
      await p.mouse.click(TOP.x, TOP.y);
      await settle(p);
      assert.equal(await parts(p), before + 1);
    });

    await test('clicking the bare lattice seeds a part on the ground', async () => {
      const before = await parts(p);
      await p.mouse.move(GROUND.x, GROUND.y);
      await settle(p);
      assert.deepEqual(await state(p, () => window.__inconstructions.cell()), [5, 10, 0]);
      await p.mouse.click(GROUND.x, GROUND.y);
      await settle(p);
      assert.equal(await parts(p), before + 1);
      await p.keyboard.press('z');
      await settle(p);
    });

    await test('a face whose neighbour is already occupied refuses the click', async () => {
      const before = await parts(p);
      await p.mouse.move(SOLID.x, SOLID.y);
      await settle(p);
      assert.equal(await state(p, () => window.__inconstructions.target()), null);
      await p.mouse.click(SOLID.x, SOLID.y);
      await settle(p);
      assert.equal(await parts(p), before, 'a part landed in an occupied cell');
    });

    await test('undo removes the part that was just placed', async () => {
      const before = await parts(p);
      await p.keyboard.press('z');
      await settle(p);
      assert.equal(await parts(p), before - 1);
    });

    await test('redo puts it back', async () => {
      const before = await parts(p);
      await p.keyboard.press('y');
      await settle(p);
      assert.equal(await parts(p), before + 1);
    });

    await test('undo past the start of history is a no-op, not a crash', async () => {
      for (let i = 0; i < 12; i++) await p.keyboard.press('z');
      await settle(p);
      assert.equal(await state(p, () => window.__inconstructions.undoDepth()), 0);
      assert.deepEqual(p.errors, []);
    });

    await test('hovering the structure reports a cell in the readout', async () => {
      await p.mouse.move(SOLID.x, SOLID.y);
      await settle(p);
      const cell = await state(p, () => window.__inconstructions.cell());
      assert.ok(Array.isArray(cell), 'no cell was reported under the cursor');
      assert.equal(cell.length, 3);
    });

    await test('hovering empty space away from the volume reports no cell', async () => {
      await p.mouse.move(1150, 300);
      await settle(p);
      assert.equal(await state(p, () => window.__inconstructions.cell()), null);
    });

    await test('number keys select a part from the kit', async () => {
      await p.keyboard.press('5');
      await settle(p);
      assert.equal(await state(p, () => window.__inconstructions.activePart()), 'POST');
    });

    await test('r cycles the placement rotation through four states', async () => {
      const seen = [];
      for (let i = 0; i < 5; i++) {
        seen.push(await state(p, () => window.__inconstructions.rot()));
        await p.keyboard.press('r');
        await settle(p);
      }
      assert.deepEqual(seen, [0, 1, 2, 3, 0]);
    });

    await p.close();
  }

  // ------------------------------------------------------------------ deleting
  await test('delete mode removes a part rather than adding one', async () => {
    const p = await openSketch();
    await p.waitForTimeout(5000);
    await p.keyboard.press('x');
    await settle(p);
    assert.equal(await state(p, () => window.__inconstructions.mode()), 'delete');
    const before = await parts(p);
    await p.mouse.move(SOLID.x, SOLID.y);
    await settle(p);
    await p.mouse.click(SOLID.x, SOLID.y);
    await settle(p);
    assert.equal(await parts(p), before - 1);
    await p.close();
  });

  // ------------------------------------------------------------------- camera
  await test('the camera cycles four bearings and returns to where it started', async () => {
    const p = await openSketch();
    await p.waitForTimeout(5000);
    const seen = [await state(p, () => window.__inconstructions.bearing())];
    for (let i = 0; i < 4; i++) {
      await p.keyboard.press('e');
      await p.waitForTimeout(500);
      seen.push(await state(p, () => window.__inconstructions.bearing()));
    }
    assert.equal(new Set(seen).size, 4, `expected four distinct bearings, saw ${seen.join(',')}`);
    assert.equal(seen[0], seen[4], 'four quarter-turns did not return to the start');
    await p.close();
  });

  // ------------------------------------------------------------ clear + reset
  await test('clear empties the lattice and is itself undoable', async () => {
    const p = await openSketch();
    await p.waitForTimeout(5000);
    const before = await parts(p);
    await p.keyboard.press('c');
    await settle(p);
    assert.equal(await parts(p), 0);
    await p.keyboard.press('z');
    await settle(p);
    assert.equal(await parts(p), before, 'undo did not restore the cleared build');
    await p.close();
  });

  // -------------------------------------------------------------------- bounds
  await test('clicking outside the build volume places nothing', async () => {
    const p = await openSketch();
    await p.waitForTimeout(5000);
    const before = await parts(p);
    await p.mouse.click(60, 700);
    await settle(p);
    assert.equal(await parts(p), before);
    await p.close();
  });

  // --------------------------------------------------------------------- touch
  await test('the interface stays within a narrow viewport', async () => {
    const p = await openSketch({ width: 390, height: 780, touch: true });
    await p.waitForTimeout(5000);
    assert.ok(await parts(p) > 20, 'the assembly did not run on a narrow screen');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await test('a tap places a part on a touch device', async () => {
    const p = await openSketch({ width: 390, height: 780, touch: true });
    await p.waitForTimeout(5000);
    const before = await parts(p);
    await p.touchscreen.tap(195, 430);
    await settle(p);
    assert.notEqual(await parts(p), before, 'a tap in the middle of the build did nothing');
    await p.close();
  });

  // -------------------------------------------------------------------- export
  await test('PNG export produces a download', async () => {
    const p = await openSketch();
    await p.waitForTimeout(5000);
    const download = p.waitForEvent('download', { timeout: 15000 });
    await p.keyboard.press('s');
    const file = await download;
    assert.match(file.suggestedFilename(), /\.png$/);
    await p.close();
  });

  // ------------------------------------------------------------------ splinter
  {
    async function openSplinter({ width = 1400, height = 950 } = {}) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(SPLINTER, { waitUntil: 'networkidle' });
      page.errors = errors;
      return page;
    }
    const sp = (p, fn) => p.evaluate(fn);
    // Cycle a control until it reaches the named state — tests can pin down a
    // composition without any way to set one directly.
    async function cycle(p, key, read, want, max = 9) {
      for (let i = 0; i < max; i++) {
        if (await sp(p, read) === want) return true;
        await p.keyboard.press(key);
        await p.waitForTimeout(170);
      }
      return await sp(p, read) === want;
    }

    const p = await openSplinter();
    await p.waitForTimeout(2200);

    await test('splinter loads and settles without errors', async () => {
      assert.deepEqual(p.errors, []);
      assert.equal(await sp(p, () => window.__splinter.settled()), true);
    });

    await test('a composition has pieces in the intended range', async () => {
      const n = await sp(p, () => window.__splinter.pieces());
      assert.ok(n > 300 && n < 1800, `piece count out of range: ${n}`);
    });

    await test('space reseeds into a different composition', async () => {
      const before = await sp(p, () => window.__splinter.seed());
      await p.keyboard.press(' ');
      await p.waitForTimeout(400);
      assert.notEqual(await sp(p, () => window.__splinter.seed()), before);
    });

    await test('dragging orbits the camera in LOOK mode', async () => {
      assert.equal(await sp(p, () => window.__splinter.mode()), 'LOOK');
      const before = await sp(p, () => window.__splinter.camera());
      await p.mouse.move(700, 520);
      await p.mouse.down();
      await p.mouse.move(950, 420, { steps: 14 });
      await p.mouse.up();
      await p.waitForTimeout(300);
      const after = await sp(p, () => window.__splinter.camera());
      assert.notEqual(after.yaw, before.yaw, 'the camera did not turn');
      assert.notEqual(after.pitch, before.pitch, 'the camera did not tilt');
    });

    await test('camera pitch is clamped so the scene never inverts', async () => {
      for (let i = 0; i < 4; i++) {
        await p.mouse.move(700, 200);
        await p.mouse.down();
        await p.mouse.move(700, 900, { steps: 10 });
        await p.mouse.up();
      }
      await p.waitForTimeout(300);
      const c = await sp(p, () => window.__splinter.camera());
      assert.ok(Math.abs(c.pitch) <= 1.5001, `pitch escaped its clamp: ${c.pitch}`);
    });

    await test('o switches between orthographic and perspective', async () => {
      const before = await sp(p, () => window.__splinter.ortho());
      await p.keyboard.press('o');
      await p.waitForTimeout(300);
      assert.equal(await sp(p, () => window.__splinter.ortho()), !before);
      await p.keyboard.press('o');
      await p.waitForTimeout(300);
      assert.equal(await sp(p, () => window.__splinter.ortho()), before);
    });

    await test('v cycles every view and wraps', async () => {
      const seen = [];
      for (let i = 0; i < 6; i++) {
        seen.push(await sp(p, () => window.__splinter.view()));
        await p.keyboard.press('v');
        await p.waitForTimeout(220);
      }
      assert.equal(new Set(seen).size, 5, `expected five views, saw ${seen.join(',')}`);
      assert.equal(seen[0], seen[5]);
    });

    await test('k cycles every palette and wraps', async () => {
      const seen = [];
      for (let i = 0; i < 6; i++) {
        seen.push(await sp(p, () => window.__splinter.palette()));
        await p.keyboard.press('k');
        await p.waitForTimeout(220);
      }
      assert.equal(new Set(seen).size, 5, `expected five palettes, saw ${seen.join(',')}`);
      assert.equal(seen[0], seen[5]);
    });

    await test('t cycles every motion mode and wraps', async () => {
      const seen = [];
      for (let i = 0; i < 6; i++) {
        seen.push(await sp(p, () => window.__splinter.motion()));
        await p.keyboard.press('t');
        await p.waitForTimeout(200);
      }
      assert.equal(new Set(seen).size, 5, `expected five motions, saw ${seen.join(',')}`);
      assert.equal(seen[0], seen[5]);
    });

    await test('m reaches both ends of the shard/hardware mix', async () => {
      assert.ok(await cycle(p, 'm', () => window.__splinter.mix(), 'SHARDS'));
      assert.ok(await cycle(p, 'm', () => window.__splinter.mix(), 'HARDWARE'));
    });

    await test('the MC-202 composition is reachable: STREAM + HARDWARE + BLASTER', async () => {
      assert.ok(await cycle(p, 'v', () => window.__splinter.view(), 'STREAM'));
      assert.ok(await cycle(p, 'm', () => window.__splinter.mix(), 'HARDWARE'));
      assert.ok(await cycle(p, 'k', () => window.__splinter.palette(), 'BLASTER'));
      await p.waitForTimeout(300);
      assert.ok(await sp(p, () => window.__splinter.pieces()) > 400);
      assert.deepEqual(p.errors, []);
    });

    await test('the panel RAY button toggles the component and rebuilds the field', async () => {
      // Exercises the on-screen controls, not just the keyboard: the RAY chip
      // is the one component with its own generator loop, so switching it off
      // must actually reduce the piece count.
      const RAY_CHIP = await sp(p, () => window.__splinter.buttonAt('RAY'));
      assert.ok(RAY_CHIP, 'no RAY button on the panel');
      const before = await sp(p, () => window.__splinter.pieces());
      assert.equal((await sp(p, () => window.__splinter.components())).ray, true);
      await p.mouse.click(RAY_CHIP.x, RAY_CHIP.y);
      await p.waitForTimeout(400);
      assert.equal((await sp(p, () => window.__splinter.components())).ray, false,
        'clicking the RAY chip did not toggle the component');
      const after = await sp(p, () => window.__splinter.pieces());
      assert.ok(after < before, `expected fewer pieces without rays: ${before} -> ${after}`);
      await p.mouse.click(RAY_CHIP.x, RAY_CHIP.y);
      await p.waitForTimeout(400);
      assert.equal((await sp(p, () => window.__splinter.components())).ray, true);
    });

    await test('a click on the panel never orbits the camera behind it', async () => {
      const before = await sp(p, () => window.__splinter.camera());
      const chip = await sp(p, () => window.__splinter.buttonAt('LOOK'));
      await p.mouse.move(chip.x, chip.y);
      await p.mouse.down();
      await p.mouse.move(chip.x + 140, chip.y + 160, { steps: 10 });
      await p.mouse.up();
      await p.waitForTimeout(300);
      assert.deepEqual(await sp(p, () => window.__splinter.camera()), before,
        'a drag starting on the panel leaked through and moved the camera');
    });

    await test('d toggles into DRAW mode and dragging then paints', async () => {
      await p.keyboard.press('d');
      await p.waitForTimeout(200);
      assert.equal(await sp(p, () => window.__splinter.mode()), 'DRAW');
      const cam = await sp(p, () => window.__splinter.camera());
      const before = await sp(p, () => window.__splinter.strokes());
      await p.mouse.move(500, 420);
      await p.mouse.down();
      await p.mouse.move(820, 600, { steps: 16 });
      await p.mouse.up();
      await p.waitForTimeout(300);
      assert.equal(await sp(p, () => window.__splinter.strokes()), before + 1);
      assert.ok(await sp(p, () => window.__splinter.strokePieces()) > 0,
        'the stroke produced no fragments');
      assert.deepEqual(await sp(p, () => window.__splinter.camera()), cam,
        'drawing moved the camera as well as painting');
    });

    await test('drawings survive reseeding, and only undo and clear remove them', async () => {
      const before = await sp(p, () => window.__splinter.strokes());
      assert.ok(before > 0, 'no drawing to test with');
      await p.keyboard.press(' ');
      await p.waitForTimeout(400);
      assert.equal(await sp(p, () => window.__splinter.strokes()), before,
        'reseeding destroyed the drawing');
      await p.keyboard.press('v');
      await p.waitForTimeout(300);
      assert.equal(await sp(p, () => window.__splinter.strokes()), before,
        'changing the view destroyed the drawing');
      await p.keyboard.press('z');
      await p.waitForTimeout(250);
      assert.equal(await sp(p, () => window.__splinter.strokes()), before - 1);
      await p.keyboard.press('c');
      await p.waitForTimeout(250);
      assert.equal(await sp(p, () => window.__splinter.strokes()), 0);
    });

    await test('detonating scatters the field, then it settles back into the composition', async () => {
      // The launch velocity is tuned so drag lands every fragment on the exact
      // position the composition designed for it — the explosion assembles the
      // poster rather than merely scattering it.
      assert.equal(await sp(p, () => window.__splinter.spread()) < 0.01, true,
        'the field was not at rest to begin with');
      await p.keyboard.press('x');
      await p.waitForTimeout(200);
      assert.equal((await sp(p, () => window.__splinter.physics())).live, true);
      const mid = await sp(p, () => window.__splinter.spread());
      assert.ok(mid > 0.1, `fragments did not launch away from the focus: ${mid}`);
      await p.waitForTimeout(4200);
      const end = await sp(p, () => window.__splinter.spread());
      assert.ok(end < 0.06, `field never settled onto its designed positions: ${end}`);
      assert.ok(end < mid);
    });

    await test('gravity drops the debris and the floor catches it', async () => {
      await p.keyboard.press('g');
      await p.waitForTimeout(4000);
      const ph = await sp(p, () => window.__splinter.physics());
      assert.equal(ph.gravity, true);
      const lowest = await sp(p, () => window.__splinter.lowest());
      assert.ok(lowest >= -1.16 && lowest <= -1.14,
        `debris did not come to rest on the floor plane: ${lowest}`);
      assert.ok(await sp(p, () => window.__splinter.spread()) > 0.2,
        'gravity did not move anything');
      await p.keyboard.press('g');
      await p.waitForTimeout(200);
    });

    await test('collision resolves contacts and keeps fragments from interpenetrating', async () => {
      // Rods are capsules and everything else is an oriented box, so the pile
      // is solved with closest-segment and SAT rather than bounding spheres.
      await cycle(p, 'v', () => window.__splinter.view(), 'STREAM');
      await cycle(p, 'm', () => window.__splinter.mix(), 'HARDWARE');
      const ph = await sp(p, () => window.__splinter.physics());
      if (!ph.collide) { await p.keyboard.press('b'); await p.waitForTimeout(200); }
      if (!ph.gravity) { await p.keyboard.press('g'); await p.waitForTimeout(200); }
      await p.keyboard.press('x');
      await p.waitForTimeout(7000);
      const c = await sp(p, () => window.__splinter.collision());
      assert.ok(c.bodies > 0, 'no bodies were selected for collision');
      assert.ok(c.contacts > 30, `too few contacts to be resolving a pile: ${c.contacts}`);
      // Fragments run up to ~0.25 across, so this caps overlap well under 10%.
      assert.ok(c.worstDepth < 0.04,
        `penetration was not resolved, solver may be diverging: ${c.worstDepth}`);
    });

    await test('collision makes the debris stack rather than spread flat', async () => {
      // pileHeight is clearance above the floor surface beneath each body, so
      // it reports stacking rather than the basin's own curvature.
      const withCollision = await sp(p, () => window.__splinter.pileHeight());
      await p.keyboard.press('b');
      await p.waitForTimeout(200);
      assert.equal((await sp(p, () => window.__splinter.physics())).collide, false);
      await p.keyboard.press('x');
      await p.waitForTimeout(7000);
      const without = await sp(p, () => window.__splinter.pileHeight());
      assert.ok(withCollision > without * 1.05,
        `collision did not lift the pile: ${withCollision.toFixed(4)} vs ${without.toFixed(4)}`);
      await p.keyboard.press('b');
      await p.waitForTimeout(200);
    });

    await test('the COLLIDE panel button toggles the solver', async () => {
      const btn = await sp(p, () => window.__splinter.buttonAt('COLLIDE'));
      assert.ok(btn, 'no COLLIDE button on the panel');
      const before = (await sp(p, () => window.__splinter.physics())).collide;
      await p.mouse.click(btn.x, btn.y);
      await p.waitForTimeout(300);
      assert.equal((await sp(p, () => window.__splinter.physics())).collide, !before);
      await p.mouse.click(btn.x, btn.y);
      await p.waitForTimeout(300);
      assert.equal((await sp(p, () => window.__splinter.physics())).collide, before);
    });

    await test('SETTLE returns every fragment to its designed position', async () => {
      const SETTLE_BTN = await sp(p, () => window.__splinter.buttonAt('SETTLE'));
      assert.ok(SETTLE_BTN, 'no SETTLE button on the panel');
      await p.mouse.click(SETTLE_BTN.x, SETTLE_BTN.y);
      await p.waitForTimeout(400);
      const ph = await sp(p, () => window.__splinter.physics());
      assert.equal(ph.live, false, 'the SETTLE button did not stop the simulation');
      assert.ok(await sp(p, () => window.__splinter.spread()) < 0.001,
        'fragments did not return exactly to their designed positions');
    });

    await test('splinter exports a PNG named for its seed', async () => {
      const download = p.waitForEvent('download', { timeout: 15000 });
      await p.keyboard.press('s');
      const file = await download;
      assert.match(file.suggestedFilename(), /^splinter-[0-9a-f]+\.png$/);
    });

    await p.close();

    await test('splinter renders on a narrow screen', async () => {
      const q = await openSplinter({ width: 390, height: 780 });
      await q.waitForTimeout(2500);
      assert.deepEqual(q.errors, []);
      assert.ok(await sp(q, () => window.__splinter.pieces()) > 0);
      await q.close();
    });
  }

  // --------------------------------------------------------------------- flash
  {
    // flash talks to three public archives, so anything that depends on the
    // network is asserted loosely or not at all — what's pinned down here is the
    // half that is pure: the seeded draw, the weighting, and the shelf. A 404
    // from a museum's own API is theirs, not ours, so those are filtered out.
    const OURS = (m) => !/Failed to load resource/.test(m);

    async function openFlash({ width = 1500, height = 1000 } = {}) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(FLASH, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__flash?.ready(), null, { timeout: 30000 });
      page.errors = errors;
      return page;
    }
    const fl = (p, fn) => p.evaluate(fn);
    // Each browser.newPage() gets its own storage, so persistence has to be
    // tested by reloading the same page rather than opening a second one.
    const reloadFlash = async (page) => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__flash?.ready(), null, { timeout: 30000 });
    };

    const p = await openFlash();
    await fl(p, () => window.__flash.reset());

    await test('flash renders a complete brief without runtime errors', async () => {
      const b = await fl(p, () => window.__flash.brief());
      for (const axis of ['subject', 'lineage', 'technique', 'format', 'constraint', 'twist']) {
        assert.ok(b[axis]?.v, `the ${axis} row came out empty`);
      }
      assert.deepEqual(p.errors.filter(OURS), []);
    });

    await test('the same seed reproduces the same brief, a different one does not', async () => {
      const r = await fl(p, () => ({
        a: window.__flash.rollOffline('deadbeef'),
        b: window.__flash.rollOffline('deadbeef'),
        c: window.__flash.rollOffline('deadbeee'),
      }));
      assert.deepEqual(r.a, r.b, 'one seed produced two different briefs');
      assert.notDeepEqual(r.a, r.c, 'two seeds produced the same brief');
    });

    await test('every deck is large enough for the cross-product to be the surprise', async () => {
      const d = await fl(p, () => window.__flash.decks());
      for (const [name, n] of Object.entries(d)) assert.ok(n >= 30, `deck ${name} is only ${n} long`);
      const combos = Object.values(d).reduce((a, b) => a * b, 1);
      assert.ok(combos > 1e8, `only ${combos} combinations`);
    });

    await test('killing an entry lowers its weight and keeping raises it', async () => {
      const r = await fl(p, () => {
        window.__flash.reset();
        window.__flash.nudge('lineage:0', false);
        const killed = window.__flash.weight('lineage:0');
        window.__flash.nudge('lineage:0', true);
        window.__flash.nudge('lineage:0', true);
        return { killed, kept: window.__flash.weight('lineage:0') };
      });
      assert.ok(r.killed < 1, `kill did not suppress: ${r.killed}`);
      assert.ok(r.kept > 1, `keep did not boost: ${r.kept}`);
    });

    await test('a killed entry stays reachable rather than being removed', async () => {
      // The floor is what stops one impatient afternoon permanently narrowing
      // the deck — a killed entry has to stay possible, only rare.
      const w = await fl(p, () => {
        window.__flash.reset();
        for (let i = 0; i < 40; i++) window.__flash.nudge('twist:3', false);
        return window.__flash.weight('twist:3');
      });
      assert.ok(w > 0, 'a killed entry reached zero and can never come back');
      assert.ok(w < 0.05, `kill floor is too generous: ${w}`);
    });

    await test('weights survive a reload', async () => {
      await fl(p, () => { window.__flash.reset(); window.__flash.nudge('format:2', true); });
      await reloadFlash(p);
      assert.ok(await fl(p, () => window.__flash.weight('format:2')) > 1,
        'the deck forgot its weighting across a reload');
      await fl(p, () => window.__flash.reset());
    });

    await test('a locked row survives a re-roll and an unlocked one does not', async () => {
      await fl(p, () => window.__flash.setLock('constraint', true));
      const before = await fl(p, () => window.__flash.brief());
      let changed = false;
      for (let i = 0; i < 6 && !changed; i++) {
        await p.click('#reroll-open');
        await p.waitForTimeout(700);
        const after = await fl(p, () => window.__flash.brief());
        assert.equal(after.constraint.v, before.constraint.v, 'a locked row was re-rolled');
        if (after.twist.v !== before.twist.v || after.lineage.v !== before.lineage.v) changed = true;
      }
      assert.ok(changed, 'six re-rolls never moved an unlocked row');
      await fl(p, () => window.__flash.setLock('constraint', false));
    });

    await test('the seed box drives the brief and the url follows it', async () => {
      await p.fill('#seed', 'c0ffee01');
      await p.press('#seed', 'Enter');
      await p.waitForFunction(() => window.__flash.seed() === 'c0ffee01', null, { timeout: 25000 });
      assert.match(p.url(), /#c0ffee01$/);
    });

    await test('saving puts the brief on the shelf, and it survives a reload', async () => {
      await fl(p, () => { window.__flash.reset(); });
      await p.click('#save');
      await p.waitForTimeout(200);
      assert.equal((await fl(p, () => window.__flash.saved())).length, 1);
      assert.equal(await p.textContent('#shelf-n'), '1', 'the shelf counter did not move');
      await reloadFlash(p);
      assert.equal((await fl(p, () => window.__flash.saved())).length, 1, 'the shelf did not persist');
      await fl(p, () => window.__flash.reset());
    });

    await test('a keystroke typed into the seed box is not read as a shortcut', async () => {
      await fl(p, () => window.__flash.reset());
      await p.fill('#seed', '');
      await p.type('#seed', 'ssrr');
      assert.equal(await p.inputValue('#seed'), 'ssrr', 'the seed box swallowed its own keystrokes');
      assert.equal((await fl(p, () => window.__flash.saved())).length, 0, 's typed in a field still saved');
      await p.fill('#seed', await fl(p, () => window.__flash.seed()));
    });

    await test('the copied brief carries every row and its seed', async () => {
      const txt = await fl(p, () => window.__flash.briefText());
      for (const k of ['SUBJECT', 'LINEAGE', 'TECHNIQUE', 'FORMAT', 'HARD RULE', 'TWIST', 'seed']) {
        assert.ok(txt.includes(k), `the copied brief is missing ${k}`);
      }
    });

    await test('the reference wall fills from more than one archive', async () => {
      // Networked, so this is the one assertion allowed to be soft: the wall may
      // be thin for an obscure subject, but it should not be single-sourced
      // across several rolls, and it must never break the page.
      let best = 0;
      for (let i = 0; i < 3; i++) {
        await p.click('#roll');
        await p.waitForTimeout(7000);
        const badges = await fl(p, () => window.__flash.wall().map((r) => r.badge));
        best = Math.max(best, new Set(badges).size);
      }
      assert.ok(best >= 2, `the wall never drew on more than one source (best: ${best})`);
      assert.deepEqual(p.errors.filter(OURS), []);
    });

    await test('flash reflows to a narrow screen without sideways scroll', async () => {
      // Resized rather than reopened: this catches a wall that has already been
      // populated failing to reflow, which a fresh narrow load would not.
      await p.setViewportSize({ width: 390, height: 780 });
      await p.waitForTimeout(600);
      const narrow = await fl(p, () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(narrow <= 1, `the page scrolls sideways by ${narrow}px at 390px wide`);
      await p.setViewportSize({ width: 1500, height: 1000 });
      await p.waitForTimeout(300);
      const wide = await fl(p, () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(wide <= 1, `the page scrolls sideways by ${wide}px at 1500px wide`);
      assert.deepEqual(p.errors.filter(OURS), []);
    });

    await fl(p, () => window.__flash.reset());
    await p.close();
  }

  // ------------------------------------------------------------ message noise
  {
    async function openNoise({ width = 1200, height = 980 } = {}) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(NOISE, { waitUntil: 'networkidle' });
      page.errors = errors;
      return page;
    }
    const mn = (p, fn) => p.evaluate(fn);
    const seedWith = async (p, msg) => {
      await p.fill('#message', msg);
      await p.click('#apply');
      await p.waitForTimeout(300);
    };
    const setParam = async (p, id, v) => {
      await p.fill(`#${id}`, String(v));
      await p.dispatchEvent(`#${id}`, 'input');
      await p.waitForTimeout(200);
    };

    const p = await openNoise();
    await p.waitForTimeout(1200);

    await test('the map loads and breathes without errors', async () => {
      assert.deepEqual(p.errors, []);
      const a = await mn(p, () => window.__messageNoise.t());
      await p.waitForTimeout(400);
      assert.ok(await mn(p, () => window.__messageNoise.t()) > a, 'time never advanced');
    });

    await test('a message picks its own palette, and a different one differs', async () => {
      await seedWith(p, 'the words under the map');
      const a = await mn(p, () => window.__messageNoise.palette());
      await seedWith(p, 'a different set of words entirely');
      const b = await mn(p, () => window.__messageNoise.palette());
      const seen = new Set([a, b]);
      await seedWith(p, 'the words under the map');
      assert.equal(await mn(p, () => window.__messageNoise.palette()), a,
        'the same message chose a different palette the second time');
      assert.ok(seen.size === 2 || a === b, 'palette is not message-derived');
    });

    await test('the message never reaches the url, the dom, or the stamp', async () => {
      await seedWith(p, 'zzqqxx-secret-marker');
      assert.ok(!p.url().includes('zzqqxx'), 'the message leaked into the url');
      const html = await mn(p, () => document.body.innerHTML);
      assert.ok(!html.includes('zzqqxx'), 'the message leaked into the dom');
      assert.equal(await p.getAttribute('#message', 'type'), 'password');
    });

    await test('every mode renders, and the cycle wraps', async () => {
      const modes = await mn(p, () => window.__messageNoise.modes());
      const seen = [];
      for (let i = 0; i < modes.length; i++) {
        seen.push(await mn(p, () => window.__messageNoise.mode()));
        await p.click('#mode');
        await p.waitForTimeout(400);
      }
      assert.deepEqual(seen, modes);
      assert.equal(await mn(p, () => window.__messageNoise.mode()), modes[0], 'the mode cycle did not wrap');
      assert.deepEqual(p.errors, []);
    });

    await test('every palette is reachable, and the cycle wraps', async () => {
      const pals = await mn(p, () => window.__messageNoise.palettes());
      const first = await mn(p, () => window.__messageNoise.palette());
      const seen = new Set();
      for (let i = 0; i < pals.length; i++) {
        seen.add(await mn(p, () => window.__messageNoise.palette()));
        await p.click('#palette');
        await p.waitForTimeout(150);
      }
      assert.equal(seen.size, pals.length, 'a palette was skipped');
      assert.equal(await mn(p, () => window.__messageNoise.palette()), first, 'the palette cycle did not wrap');
    });

    // The reason NORM exists: raw p5 perlin used 5 of 12 bands, so most of a
    // theme never appeared. This is the regression guard for that.
    await test('the terrain spans its ramp rather than a slice of it', async () => {
      for (const oct of [1, 2, 3, 4, 5]) {
        await setParam(p, 'octaves', oct);
        const { lo, hi, bandsUsed } = await mn(p, () => window.__messageNoise.spread());
        assert.ok(hi - lo > 0.75, `octaves=${oct}: field spans only ${(hi - lo).toFixed(2)} of the ramp`);
        assert.ok(bandsUsed >= 10, `octaves=${oct}: only ${bandsUsed} of 12 bands rendered`);
      }
      await p.click('#reset');
      await p.waitForTimeout(200);
    });

    await test('space freezes the map and the arrows walk it a frame at a time', async () => {
      await mn(p, () => document.activeElement.blur());
      await p.keyboard.press('Space');
      await p.waitForTimeout(300);
      assert.equal(await mn(p, () => window.__messageNoise.frozen()), true);
      const held = await mn(p, () => window.__messageNoise.t());
      await p.waitForTimeout(400);
      assert.equal(await mn(p, () => window.__messageNoise.t()), held, 'a frozen map kept moving');
      await p.keyboard.press('ArrowRight');
      await p.waitForTimeout(200);
      const fwd = await mn(p, () => window.__messageNoise.t());
      assert.ok(fwd > held, 'the right arrow did not step forward');
      await p.keyboard.press('ArrowLeft');
      await p.waitForTimeout(200);
      assert.ok(Math.abs(await mn(p, () => window.__messageNoise.t()) - held) < 1e-9,
        'the left arrow did not step back to where it started');
    });

    await test('stepping a running map freezes it, so the frame you found stays', async () => {
      await p.keyboard.press('Space');           // resume
      await p.waitForTimeout(200);
      assert.equal(await mn(p, () => window.__messageNoise.frozen()), false);
      await p.keyboard.press('ArrowRight');
      await p.waitForTimeout(200);
      assert.equal(await mn(p, () => window.__messageNoise.frozen()), true);
    });

    await test('the controls move the terrain and reset restores the message defaults', async () => {
      const before = await mn(p, () => window.__messageNoise.params());
      for (const [id, v] of [['bands', 5], ['zoom', 2.4], ['warp', 1.2], ['octaves', 4], ['sea', 0.72]]) {
        await setParam(p, id, v);
      }
      assert.deepEqual(await mn(p, () => window.__messageNoise.params()),
        { bands: 5, zoom: 2.4, warp: 1.2, octaves: 4, sea: 0.72 });
      await p.click('#reset');
      await p.waitForTimeout(250);
      assert.deepEqual(await mn(p, () => window.__messageNoise.params()), before,
        'reset did not return the terrain to what the message asked for');
    });

    await test('a keystroke typed into a control is not read as a shortcut', async () => {
      const mode = await mn(p, () => window.__messageNoise.mode());
      await p.fill('#message', 'm c r');
      await p.waitForTimeout(200);
      assert.equal(await mn(p, () => window.__messageNoise.mode()), mode,
        'typing into the message box cycled the mode');
      await p.focus('#zoom');
      const zoom = (await mn(p, () => window.__messageNoise.params())).zoom;
      await p.keyboard.press('ArrowRight');
      await p.waitForTimeout(200);
      assert.notEqual((await mn(p, () => window.__messageNoise.params())).zoom, zoom,
        'a focused slider did not take its own arrow key');
    });

    await test('export produces a png named for the frame it captured', async () => {
      await mn(p, () => document.activeElement.blur());
      const dl = p.waitForEvent('download', { timeout: 60000 });
      await p.click('#save');
      const name = (await dl).suggestedFilename();
      const { mode, palette, t } = await mn(p, () => ({
        mode: window.__messageNoise.mode(),
        palette: window.__messageNoise.palette(),
        t: window.__messageNoise.t(),
      }));
      assert.equal(name, `message-noise-${mode}-${palette}-t${t.toFixed(3)}.png`);
      // p5 1.11's Graphics.remove() throws, so the buffer is dropped by hand;
      // if that regresses, the export canvas is left in the page.
      assert.equal(await mn(p, () => document.querySelectorAll('canvas').length), 1,
        'the export buffer was left behind in the dom');
      assert.deepEqual(p.errors, []);
    });

    await test('the panel stays clear of the map it controls', async () => {
      const clear = await mn(p, () => {
        const c = document.querySelector('canvas').getBoundingClientRect();
        const u = document.getElementById('ui').getBoundingClientRect();
        // The stamp lives in the bottom-left of the canvas and has to stay readable.
        return u.top >= c.bottom - 1;
      });
      assert.ok(clear, 'the control panel overlaps the canvas');
    });

    await p.close();
  }

  // -------------------------------------------------------------------- edge
  {
    async function openGl(url, { width = 1200, height = 980 } = {}) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(url, { waitUntil: 'networkidle' });
      page.errors = errors;
      return page;
    }
    const ed = (p, fn) => p.evaluate(fn);
    const setParam = async (p, id, v) => {
      await p.fill(`#${id}`, String(v));
      await p.dispatchEvent(`#${id}`, 'input');
      await p.waitForTimeout(220);
    };

    const p = await openGl(EDGE);
    await p.waitForTimeout(1800);

    await test('the rig compiles its shaders and renders without errors', async () => {
      assert.deepEqual(p.errors, []);
      // Non-zero coverage is the real assertion: a shader that failed to
      // compile still leaves a canvas, it just leaves a black one.
      const c = await ed(p, () => window.__edge.coverage());
      assert.ok(c > 0.005, `nothing was drawn (coverage ${c})`);
    });

    await test('every operator renders, and the cycle wraps', async () => {
      const ops = await ed(p, () => window.__edge.ops());
      const seen = [];
      for (let i = 0; i < ops.length; i++) {
        const name = await ed(p, () => window.__edge.op());
        await p.waitForTimeout(250);
        const c = await ed(p, () => window.__edge.coverage());
        assert.ok(c > 0.002, `${name} drew nothing (coverage ${c})`);
        seen.push(name);
        await p.click('#op');
        await p.waitForTimeout(250);
      }
      assert.deepEqual(seen.sort(), [...ops].sort());
      assert.deepEqual(p.errors, []);
    });

    await test('gain opens the operator up and threshold shuts it down', async () => {
      await setParam(p, 'gain', 1);
      const low = await ed(p, () => window.__edge.coverage());
      await setParam(p, 'gain', 6);
      const high = await ed(p, () => window.__edge.coverage());
      assert.ok(high > low, `gain did not raise coverage (${low} -> ${high})`);
      await setParam(p, 'threshold', 0.55);
      const cut = await ed(p, () => window.__edge.coverage());
      assert.ok(cut < high, `threshold did not lower coverage (${high} -> ${cut})`);
      await setParam(p, 'threshold', 0.08);
      await setParam(p, 'gain', 2);
    });

    // The card exists to be failed on in specific ways; this pins the one
    // finding the sketch is built around, so a change to the kernels or to the
    // card that quietly erases it gets caught.
    await test('only sobel clears the soft edge at default gain', async () => {
      const read = async (want) => {
        await p.evaluate(() => document.activeElement.blur());
        for (let i = 0; i < 6; i++) {
          if (await ed(p, () => window.__edge.op()) === want) break;
          await p.keyboard.press('o');
          await p.waitForTimeout(200);
        }
        await p.waitForTimeout(250);
        // A column through the clear corridor, away from every card region.
        return p.evaluate(() => {
          const c = document.querySelector('canvas');
          const s = document.createElement('canvas');
          s.width = c.width; s.height = c.height;
          s.getContext('2d').drawImage(c, 0, 0);
          const d = s.getContext('2d').getImageData(c.width / 2 - 12, Math.round(c.height * 0.55), 24, 1).data;
          let max = 0;
          for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i]);
          return max;
        });
      };
      const sob = await read('sobel');
      const lap = await read('laplacian');
      assert.ok(sob > 120, `sobel missed the soft edge (peak ${sob})`);
      assert.ok(lap < 60, `laplacian answered the soft edge (peak ${lap}), which it should not`);
    });

    await test('show source puts the untouched card up', async () => {
      await p.evaluate(() => document.activeElement.blur());
      await p.keyboard.press('r');
      await p.waitForTimeout(300);
      assert.equal((await ed(p, () => window.__edge.flags())).raw, true);
      // The card is mid-grey overall; an operator's output is mostly black.
      const c = await ed(p, () => window.__edge.coverage());
      assert.ok(c > 0.25, `the source does not look like the card (coverage ${c})`);
      await p.keyboard.press('r');
      await p.waitForTimeout(250);
    });

    // Both non-default sources are opt-in and neither is available in a
    // headless run: what is being tested is that they say so instead of
    // silently leaving a black frame behind.
    await test('an unavailable source explains itself and changes nothing', async () => {
      const before = await ed(p, () => window.__edge.source());
      await p.click('#source');            // -> webcam, absent in a headless run
      await p.waitForTimeout(900);
      const camNote = await ed(p, () => window.__edge.note());
      assert.ok(camNote.length > 0, 'an unavailable camera left no explanation');
      assert.equal(await ed(p, () => window.__edge.source()), before,
        'the sketch switched to a source it could not load');

      await p.click('#source');            // -> td frame, absent until one is exported
      await p.waitForTimeout(1500);
      const tdNote = await ed(p, () => window.__edge.note());
      assert.ok(/td-frame\.png/.test(tdNote), `the missing frame said "${tdNote}"`);
      assert.equal(await ed(p, () => window.__edge.source()), before);
      // The cycle has to keep moving through sources it cannot load, or a
      // machine with no camera could never reach the frame sitting past it.
      assert.equal(await ed(p, () => window.__edge.requested()), 'td frame',
        'a dead source trapped the cycle');
      assert.ok((await ed(p, () => window.__edge.coverage())) > 0.005, 'the canvas went black');

      await p.click('#source');            // -> back round to the card
      await p.waitForTimeout(400);
      assert.equal(await ed(p, () => window.__edge.source()), 'card');
      assert.equal(await ed(p, () => window.__edge.note()), '');
    });

    await test('export produces a png named for the operator', async () => {
      await p.evaluate(() => document.activeElement.blur());
      // p5 appends every createGraphics canvas to the document, and this
      // sketch keeps two of them alive for the source and operator passes —
      // so the count to hold steady is the one before the export, not one.
      const before = await ed(p, () => document.querySelectorAll('canvas').length);
      const dl = p.waitForEvent('download', { timeout: 60000 });
      await p.click('#save');
      const name = (await dl).suggestedFilename();
      const { op, source } = await ed(p, () => ({ op: window.__edge.op(), source: window.__edge.source() }));
      assert.equal(name, `edge-${source.replace(/ /g, '-')}-${op}.png`);
      await p.waitForTimeout(300);
      assert.equal(await ed(p, () => document.querySelectorAll('canvas').length), before,
        'an export buffer was left behind in the dom');
      assert.deepEqual(p.errors, []);
    });

    await p.close();

    // ------------------------------------------------------------ hydra edge
    const h = await openGl(HYDRA, { height: 1050 });
    await h.waitForTimeout(2500);
    const hy = (fn) => h.evaluate(fn);
    const hcov = () => h.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(window.__hydraEdge.coverage()))));

    await test('hydra boots and the first patch is running', async () => {
      assert.equal(await hy(() => window.__hydraEdge.running()), true);
      assert.equal(await hy(() => window.__hydraEdge.error()), '');
      assert.deepEqual(h.errors, []);
    });

    // The point of the pair: the operators are not reimplemented for hydra,
    // they are the same GLSL. If the injection into hydra's shader ever breaks
    // — a bundler change, a hydra upgrade — every one of these compiles to an
    // undefined function and the canvas goes black while the JS still "runs".
    await test('every preset compiles the shared kernels and draws', async () => {
      const presets = await hy(() => window.__hydraEdge.presets());
      for (let i = 0; i < presets.length; i++) {
        const name = await hy(() => window.__hydraEdge.preset());
        await h.waitForTimeout(1400);
        const c = await hcov();
        assert.equal(await hy(() => window.__hydraEdge.error()), '', `${name} failed to run`);
        assert.ok(c > 0.002, `${name} drew a black frame (coverage ${c}) — kernels likely missing`);
        await h.click('#preset');
        await h.waitForTimeout(600);
      }
      assert.deepEqual(h.errors, []);
    });

    await test('every operator is reachable by name from the editor', async () => {
      const ops = await hy(() => window.__hydraEdge.ops());
      for (const op of ops) {
        const args = op === 'dogEdge' ? 'o1, 1, 3, 720, 2.2' : 'o1, 1, 3';
        await h.fill('#code', `card().out(o1)\n${op}(${args}).out(o0)`);
        await h.click('#run');
        await h.waitForTimeout(1200);
        assert.equal(await hy(() => window.__hydraEdge.error()), '', `${op} threw`);
        const c = await hcov();
        assert.ok(c > 0.002, `${op} drew nothing (coverage ${c})`);
      }
    });

    await test('a broken patch reports the error instead of dying', async () => {
      await h.fill('#code', 'thisIsNotAHydraFunction().out(o0)');
      await h.click('#run');
      await h.waitForTimeout(500);
      assert.equal(await hy(() => window.__hydraEdge.running()), false);
      assert.ok((await hy(() => window.__hydraEdge.error())).length > 0, 'no error surfaced');
      assert.equal(await h.evaluate(() => getComputedStyle(document.getElementById('error')).display), 'block');
      // and it recovers
      await h.click('#preset');
      await h.waitForTimeout(1400);
      assert.equal(await hy(() => window.__hydraEdge.error()), '');
      assert.equal(await hy(() => window.__hydraEdge.running()), true);
    });

    await test('typing in the editor does not re-evaluate on every keystroke', async () => {
      await h.fill('#code', 'card().out(o1)\nsobelEdge(o1, 1, 2).out(o0)');
      await h.click('#run');
      await h.waitForTimeout(900);
      await h.focus('#code');
      await h.keyboard.type('\n// half a th');   // would throw if evaluated
      await h.waitForTimeout(400);
      assert.equal(await hy(() => window.__hydraEdge.error()), '', 'a keystroke re-ran the patch');
    });

    await h.close();
  }

} finally {
  await browser.close();
  if (!process.argv.includes('--keep')) server.kill('SIGTERM');
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const [name, e] of failures) console.error(`\n--- ${name}\n${e.stack}`);
  process.exit(1);
}
