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

  // Wait for the opening assembly to hand over control. The replay is driven by
  // the draw loop, so on a loaded machine it can take far longer than the four
  // seconds it nominally runs for — and a fixed delay that expires early sends
  // the test's first keystroke into finishing the demo instead of doing what it
  // was meant to do.
  const ready = (p) => p.waitForFunction(
    () => window.__inconstructions && window.__inconstructions.demoDone(),
    null, { timeout: 60000 });

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
    await ready(p);

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
    await ready(p);
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
    await ready(p);
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
    await ready(p);
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
    await ready(p);
    const before = await parts(p);
    await p.mouse.click(60, 700);
    await settle(p);
    assert.equal(await parts(p), before);
    await p.close();
  });

  // --------------------------------------------------------------------- touch
  await test('the interface stays within a narrow viewport', async () => {
    const p = await openSketch({ width: 390, height: 780, touch: true });
    await ready(p);
    assert.ok(await parts(p) > 20, 'the assembly did not run on a narrow screen');
    assert.deepEqual(p.errors, []);
    await p.close();
  });

  await test('the shared type module measures what it draws', async () => {
    const p = await openSketch();
    await ready(p);
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

  await test('a tap places a part on a touch device', async () => {
    const p = await openSketch({ width: 390, height: 780, touch: true });
    await ready(p);
    const before = await parts(p);
    await p.touchscreen.tap(195, 430);
    await settle(p);
    assert.notEqual(await parts(p), before, 'a tap in the middle of the build did nothing');
    await p.close();
  });

  // -------------------------------------------------------------------- export
  await test('PNG export produces a download', async () => {
    const p = await openSketch();
    await ready(p);
    const download = p.waitForEvent('download', { timeout: 15000 });
    await p.keyboard.press('s');
    const file = await download;
    assert.match(file.suggestedFilename(), /\.png$/);
    await p.close();
  });

  // ----------------------------------------------------------------- generator
  //
  // The generator panel is drawn on the canvas, so these drive it the same way
  // the sketch's own controls are driven elsewhere in this file: real clicks at
  // coordinates mirrored from the layout. At 1200x900 the panel is a right-hand
  // column sitting below the readout stack (margin, four rows, the printed
  // parameter lines), and each slider's track starts 62px into it and runs
  // 100px wide.
  {
    const PX = 1200 - 20 - 14 - 196, PY = 20 + 14 + 4 * 13 + 40;
    const BX = PX + 62, BW = 100;
    const ROW = { mix: 0, density: 1, grain: 2, accent: 3, trim: 4 };
    const sliderAt = (k, f) => [BX + f * BW, PY + 14 + 18 + 14 + ROW[k] * 16 + 3];
    // Inside the panel but on no control: the seed readout row.
    const PANEL_GAP = [PX + 8, PY + 14 + 18 + 6];

    const gen = (p, fn) => p.evaluate(fn);
    const sig = (p) => gen(p, () => window.__inconstructions.signature());

    async function setSlider(p, k, f) {
      const [x, y] = sliderAt(k, f);
      await p.mouse.click(x, y);
      await settle(p);
    }

    const p = await openSketch();
    await ready(p);

    await test('rolling produces a structure that stands on the ground', async () => {
      await p.keyboard.press(' ');
      await p.waitForTimeout(1600);
      assert.ok(await parts(p) > 40, 'the roll produced almost nothing');
      assert.equal(await gen(p, () => window.__inconstructions.generating()), false);
      assert.ok(await gen(p, () => window.__inconstructions.grounded()),
        'some part of the composition was floating free of the ground');
    });

    await test('a second roll is a different composition', async () => {
      const before = await sig(p);
      const seed = await gen(p, () => window.__inconstructions.seed());
      await p.keyboard.press(' ');
      await p.waitForTimeout(1600);
      assert.notEqual(await gen(p, () => window.__inconstructions.seed()), seed);
      assert.notEqual(await sig(p), before);
    });

    await test('a whole generated composition costs one undo', async () => {
      const before = await sig(p);
      const depth = await gen(p, () => window.__inconstructions.undoDepth());
      await p.keyboard.press(' ');
      await p.waitForTimeout(1600);
      assert.equal(await gen(p, () => window.__inconstructions.undoDepth()), depth + 1);
      await p.keyboard.press('z');
      await settle(p);
      assert.equal(await sig(p), before, 'undo did not restore the previous composition');
      await p.keyboard.press('y');
      await settle(p);
    });

    await test('an interaction finishes a roll that is still assembling', async () => {
      await p.keyboard.press(' ');
      await p.waitForTimeout(120);
      assert.equal(await gen(p, () => window.__inconstructions.generating()), true);
      await p.keyboard.press('r');
      await settle(p);
      assert.equal(await gen(p, () => window.__inconstructions.generating()), false);
    });

    await test('raising density puts more parts into the same composition', async () => {
      await setSlider(p, 'density', 0.25);
      const sparse = await parts(p);
      await setSlider(p, 'density', 0.9);
      assert.ok(await parts(p) > sparse * 1.3,
        `density did not bite: ${sparse} -> ${await parts(p)}`);
    });

    await test('a parameter round-trip restores the identical composition', async () => {
      await setSlider(p, 'grain', 0.4);
      const before = await sig(p);
      await setSlider(p, 'grain', 0.9);
      assert.notEqual(await sig(p), before, 'grain changed nothing');
      await setSlider(p, 'grain', 0.4);
      assert.equal(await sig(p), before, 'the same parameters gave a different composition');
    });

    await test('a whole slider drag costs one undo, not one per frame', async () => {
      const depth = await gen(p, () => window.__inconstructions.undoDepth());
      const [x, y] = sliderAt('mix', 0.2);
      await p.mouse.move(x, y);
      await p.mouse.down();
      for (const f of [0.4, 0.6, 0.8]) await p.mouse.move(sliderAt('mix', f)[0], y);
      await p.mouse.up();
      await settle(p);
      assert.equal(await gen(p, () => window.__inconstructions.undoDepth()), depth + 1);
    });

    await test('cycling the template changes both the readout and the structure', async () => {
      const before = { t: await gen(p, () => window.__inconstructions.template()), s: await sig(p) };
      await p.keyboard.press('t');
      await settle(p);
      assert.notEqual(await gen(p, () => window.__inconstructions.template()), before.t);
      assert.notEqual(await sig(p), before.s);
    });

    await test('cycling symmetry returns to where it started after three presses', async () => {
      const seen = [await gen(p, () => window.__inconstructions.symmetry())];
      for (let i = 0; i < 3; i++) {
        await p.keyboard.press('m');
        await settle(p);
        seen.push(await gen(p, () => window.__inconstructions.symmetry()));
      }
      assert.equal(new Set(seen).size, 3, `expected three modes, saw ${seen.join(',')}`);
      assert.equal(seen[0], seen[3]);
    });

    await test('a click inside the panel but not on a control places nothing', async () => {
      const before = await parts(p);
      await p.mouse.click(PANEL_GAP[0], PANEL_GAP[1]);
      await settle(p);
      assert.equal(await parts(p), before, 'a click in the panel edited the lattice');
    });

    await test('growth extends the structure rather than replacing it', async () => {
      const before = await parts(p);
      await p.keyboard.press('g');
      await settle(p);
      const after = await parts(p);
      assert.ok(after > before, `growth added nothing: ${before} -> ${after}`);
      assert.ok(await gen(p, () => window.__inconstructions.grounded()),
        'growth left a part floating');
    });

    await test('a single growth step adds exactly one part', async () => {
      const before = await parts(p);
      await p.keyboard.press('n');
      await settle(p);
      assert.equal(await parts(p), before + 1);
    });

    await test('growth is undoable in one press', async () => {
      const before = await sig(p);
      await p.keyboard.press('g');
      await settle(p);
      await p.keyboard.press('z');
      await settle(p);
      assert.equal(await sig(p), before);
    });

    await test('the panel can be hidden and shown', async () => {
      assert.equal(await gen(p, () => window.__inconstructions.panelOpen()), true);
      await p.keyboard.press('p');
      await settle(p);
      assert.equal(await gen(p, () => window.__inconstructions.panelOpen()), false);
      await p.keyboard.press('p');
      await settle(p);
      assert.equal(await gen(p, () => window.__inconstructions.panelOpen()), true);
    });

    await p.close();
  }

  // ------------------------------------------------------------------ endless
  //
  // These wait on the sketch's own readiness rather than on a fixed delay: both
  // modes are driven by the draw loop, so a loaded machine changes the timing
  // but never the behaviour being asserted.
  {
    const gen = (p, fn) => p.evaluate(fn);
    const ready = (p) => p.waitForFunction(
      () => window.__inconstructions && window.__inconstructions.demoDone(), null, { timeout: 60000 });
    const rolled = (p) => p.waitForFunction(
      () => !window.__inconstructions.generating(), null, { timeout: 60000 });

    const p = await openSketch();
    await ready(p);
    await p.keyboard.press(' ');
    await rolled(p);

    await test('flux keeps changing the structure on its own', async () => {
      const before = await gen(p, () => window.__inconstructions.signature());
      await p.keyboard.press('f');
      assert.equal(await gen(p, () => window.__inconstructions.flux()), true);
      await p.waitForTimeout(3000);
      assert.notEqual(await gen(p, () => window.__inconstructions.signature()), before,
        'nothing changed in three seconds of flux');
    });

    await test('flux holds its mass rather than filling the volume', async () => {
      const a = await parts(p);
      await p.waitForTimeout(4000);
      const b = await parts(p);
      assert.ok(Math.abs(b - a) < 60, `mass ran away: ${a} -> ${b}`);
    });

    await test('flux never leaves a part floating', async () => {
      assert.ok(await gen(p, () => window.__inconstructions.grounded()));
    });

    await test('a whole flux session costs one undo', async () => {
      const depth = await gen(p, () => window.__inconstructions.undoDepth());
      await p.keyboard.press('f');
      await settle(p);
      assert.equal(await gen(p, () => window.__inconstructions.flux()), false);
      assert.equal(await gen(p, () => window.__inconstructions.undoDepth()), depth + 1);
    });

    // The climb accumulates frame time rather than wall-clock time — a starved
    // tab climbs slowly rather than skipping ahead — so these wait on the
    // altitude itself instead of on a duration.
    const climbTo = (p, alt) => p.waitForFunction(
      (a) => window.__inconstructions.altitude() > a, alt, { timeout: 90000 });

    await test('the tower climbs past the ceiling of the bounded volume', async () => {
      await p.keyboard.press('w');
      assert.equal(await gen(p, () => window.__inconstructions.tower()), true);
      await climbTo(p, 3);
      assert.ok(await gen(p, () => window.__inconstructions.top()) >= 16,
        'nothing was built above the sandbox ceiling');
      assert.ok(await gen(p, () => window.__inconstructions.modules()) >= 3);
    });

    await test('every module is joined to the one below it', async () => {
      assert.ok(await gen(p, () => window.__inconstructions.grounded()),
        'part of the tower is floating free of the rest');
    });

    await test('the tower prunes what it leaves behind', async () => {
      // Sample twice past the entry transient — the live set fills to a steady
      // state of a few modules and then has to stay there, however tall the
      // tower gets. Comparing against entry would only measure that ramp.
      await climbTo(p, (await gen(p, () => window.__inconstructions.altitude())) + 20);
      const a = { m: await gen(p, () => window.__inconstructions.modules()), n: await parts(p) };
      await climbTo(p, (await gen(p, () => window.__inconstructions.altitude())) + 20);
      const b = { m: await gen(p, () => window.__inconstructions.modules()), n: await parts(p) };
      assert.ok(b.m > a.m, `the tower stopped generating: ${a.m} -> ${b.m} modules`);
      // Pruning keeps about six modules live — three below, the current one and
      // two generated ahead. A hard ceiling states that invariant without
      // depending on when the two samples happened to land.
      for (const s of [a, b]) {
        assert.ok(s.n < 1500, `the live set grows with the tower: ${s.n} at ${s.m} modules`);
      }
      assert.ok(await gen(p, () => window.__inconstructions.grounded()));
    });

    await test('the wheel scrubs the altitude and pauses the climb', async () => {
      await p.mouse.move(600, 450);
      const before = await gen(p, () => window.__inconstructions.altitude());
      await p.mouse.wheel(0, 600);
      await settle(p);
      const after = await gen(p, () => window.__inconstructions.altitude());
      assert.ok(after < before, `the wheel did not scrub down: ${before} -> ${after}`);
      await p.waitForTimeout(700);
      assert.ok(await gen(p, () => window.__inconstructions.altitude()) <= after + 1,
        'the climb did not pause while scrubbing');
    });

    await test('one undo leaves the tower and restores what came before it', async () => {
      const depth = await gen(p, () => window.__inconstructions.undoDepth());
      await p.keyboard.press('w');
      await settle(p);
      assert.equal(await gen(p, () => window.__inconstructions.tower()), false);
      assert.equal(await gen(p, () => window.__inconstructions.undoDepth()), depth + 1);
      await p.keyboard.press('z');
      await settle(p);
      assert.ok(await gen(p, () => window.__inconstructions.top()) < 16,
        'undo left the tower behind');
    });

    await test('the two endless modes are mutually exclusive', async () => {
      await p.keyboard.press('f');
      await settle(p);
      await p.keyboard.press('w');
      await settle(p);
      assert.equal(await gen(p, () => window.__inconstructions.flux()), false);
      assert.equal(await gen(p, () => window.__inconstructions.tower()), true);
      await p.keyboard.press('w');
      await settle(p);
      assert.deepEqual(p.errors, []);
    });

    await p.close();
  }

  await test('the generator panel is usable on a narrow screen', async () => {
    const p = await openSketch({ width: 390, height: 780, touch: true });
    await ready(p);
    // The panel sits above the parts strip; the bottom row of controls ends
    // with GEN, which toggles it.
    await p.touchscreen.tap(195, 741);
    await settle(p);
    assert.equal(await p.evaluate(() => window.__inconstructions.panelOpen()), false);
    await p.touchscreen.tap(195, 741);
    await settle(p);
    assert.equal(await p.evaluate(() => window.__inconstructions.panelOpen()), true);
    // A tap on the panel's own background must not fall through to the lattice
    // underneath it. The seed readout row carries no control.
    const before = await parts(p);
    await p.touchscreen.tap(60, 780 - 132 - 192 + 14 + 18 + 7);
    await settle(p);
    assert.equal(await parts(p), before, 'a tap on the panel edited the lattice');
    assert.deepEqual(p.errors, []);
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

    // The poster prints its seed because the seed is the composition. Taking
    // one back through the URL is what makes that promise true, and it is what
    // lets a screenshot harness capture the same image twice.
    await test('a seed in the URL reproduces an exact composition', async () => {
      const page = await openSplinter();
      await page.goto(`${SPLINTER}?seed=1234abcd`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__splinter && window.__splinter.settled(),
        null, { timeout: 60000 });
      assert.equal(await sp(page, () => window.__splinter.seed()), 0x1234abcd);
      await page.close();
    });

    await test('a nonsense seed falls back to a random one rather than breaking', async () => {
      const page = await openSplinter();
      await page.goto(`${SPLINTER}?seed=nonsense`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__splinter && window.__splinter.settled(),
        null, { timeout: 60000 });
      assert.ok(await sp(page, () => window.__splinter.seed()) > 0);
      assert.deepEqual(page.errors, []);
      await page.close();
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

} finally {
  await browser.close();
  if (!process.argv.includes('--keep')) server.kill('SIGTERM');
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const [name, e] of failures) console.error(`\n--- ${name}\n${e.stack}`);
  process.exit(1);
}
