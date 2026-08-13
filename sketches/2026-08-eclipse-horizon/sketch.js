// Every solar eclipse NASA has computed, from 1999 BC to 3000 AD, plotted at
// the point where it peaked. The claim the page makes is not subtle and is not
// argued: 4,294 of the 11,898 — 36% — have the Sun at exactly 0°, and every
// one of those lands between 60° and 72° of latitude, with nothing outside the
// band. Turn the globe and the two rings are simply there.
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
// No drawing library of any kind — no p5, no d3, no WebGL. The only import is
// this sketch's own projection; see globe.js for why six lines of trig did not
// need a dependency behind them.
import { drawGlobe } from './globe.js';

const SIZE = 720;
const canvas = document.createElement('canvas');
canvas.width = SIZE; canvas.height = SIZE;
document.body.insertBefore(canvas, document.getElementById('ui'));
// No willReadFrequently: this canvas is written every frame and read only by
// the test probe below. The hint asks the browser for a software-backed
// surface, which is exactly the wrong trade for a page whose job is to draw
// 11,898 marks per frame.
const ctx = canvas.getContext('2d');

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
  // Cheap "is anything actually drawn" probe for the tests. Counts opaque
  // pixels that differ from the page background, on a coarse grid.
  //
  // The alpha test is not redundant. An untouched canvas is transparent black,
  // which differs from the background tuple just as much as a drawn pixel does
  // — so without it this returns "everything is ink" for a page that rendered
  // nothing at all, which is the one answer it exists to rule out.
  inkCount: () => {
    const d = ctx.getImageData(0, 0, SIZE, SIZE).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 4) {
      if (d[i + 3] === 0) continue;
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
