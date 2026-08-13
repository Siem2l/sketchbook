// Every solar eclipse NASA has computed, from 2000 BC to 3000 AD, plotted at
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
import { drawPoints, colorFor, RAMP, HORIZON_COLOR } from './points.js';
import { drawGeometry, sunAltitudeFor, GAMMA_MAX } from './geometry.js';

const SIZE = 720;

// The cross-section goes above the globe deliberately: it is the explanation,
// and the globe is the consequence. Read top to bottom and the rings stop being
// a pattern you have to take on trust.
const GEO_W = 720, GEO_H = 380;
const geoCanvas = document.createElement('canvas');
geoCanvas.width = GEO_W; geoCanvas.height = GEO_H;
geoCanvas.id = 'geometry';
document.body.insertBefore(geoCanvas, document.getElementById('ui'));
const geoCtx = geoCanvas.getContext('2d');

const canvas = document.createElement('canvas');
canvas.width = SIZE; canvas.height = SIZE;
canvas.id = 'globe';   // there are two canvases on this page; drag targets this one
document.body.insertBefore(canvas, document.getElementById('ui'));
// No willReadFrequently: this canvas is written every frame and read only by
// the test probe below. The hint asks the browser for a software-backed
// surface, which is exactly the wrong trade for a page whose job is to draw
// 11,898 marks per frame.
const ctx = canvas.getContext('2d');

// phi 15, not 25: the two bands sit at ±60-72, and tilting far enough to show
// the northern one properly pushes the southern one off the limb entirely,
// which reads as a bug rather than as a hemisphere. Low enough to keep both.
const view = { lambda: 20, phi: 15 };
let data = null;

let drawn = 0;
let index = 0;            // eclipses placed so far
let playing = false;
let carry = 0;            // fractional eclipses between frames
let lastFrame = performance.now();

const $ = (id) => document.getElementById(id);

let gamma = 0.3;

function renderGeometry() {
  drawGeometry(geoCtx, gamma, GEO_W, GEO_H);
  const alt = sunAltitudeFor(gamma);
  $('gamma-val').textContent = gamma.toFixed(2)
    + (alt === null ? ' · no eclipse'
      : alt === 0 ? ' · sun on the horizon'
        : ` · sun ${alt.toFixed(0)}° up`);
}

function render() {
  ctx.fillStyle = '#0e0e11';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const r = SIZE * 0.44;
  drawGlobe(ctx, view, r, SIZE / 2, SIZE / 2);
  drawn = data ? drawPoints(ctx, data, index, view, r, SIZE / 2, SIZE / 2) : 0;
}

// Recomputed over the whole prefix on every scrub — 11,898 iterations, well
// under a millisecond. An incremental accumulator would be faster and would
// eventually disagree with what is on screen; this cannot, because it reads
// the same prefix the renderer draws.
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

// The catalog counts in astronomical years, which have a year 0 — and three
// eclipses fall in it. Year 0 is 1 BC, so the offset is 1 − y and not −y, which
// is why the catalog spans 2000 BC rather than the 1999 BC its first row reads
// as. NASA titles it "2000 BCE to 3000 CE" for exactly this reason. Getting it
// wrong renders an impossible "0 AD" and dates every BC eclipse a year late.
const yearLabel = (y) => (y <= 0 ? `${1 - y} BC` : `${y} AD`);

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

// Built from the same constants the marks are drawn from, so a palette change
// cannot leave the key describing the old one. The horizon swatch is styled
// through border-color and never background: it stands for a hollow mark, and a
// filled amber dot here would advertise an encoding the globe does not use.
function buildLegend() {
  const swatch = (c) => `<i style="background:${c}"></i>`;
  $('legend').innerHTML =
    // RAMP is stored dim→bright and colorFor sends alt 90 to the dim end, so
    // reading it in storage order under a "sun 90° … 1°" axis is already right.
    // Reversing it here put the bright swatch under 90° and stated the exact
    // inverse of the encoding the globe uses.
    '<span>sun 90°</span>'
    + RAMP.map(swatch).join('')
    + '<span>1°</span>'
    + '<span style="margin-left:0.8rem">on the horizon, 0°</span>'
    + `<i class="ring" style="border-color:${HORIZON_COLOR}"></i>`;
}

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

function loop(now) {
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
  if (!dragging && now - idleSince > 3000) {
    view.lambda = ((view.lambda + 0.08 + 180) % 360 + 360) % 360 - 180;
  }
  render();
  requestAnimationFrame(loop);
}

window.eclipse = {
  view: () => ({ ...view }),
  ready: () => data !== null,
  drawn: () => drawn,
  total: () => (data ? data.count : 0),
  colorFor,
  year: () => (index > 0 ? data.year[index - 1] : null),
  index: () => index,
  setIndex,
  playing: () => playing,
  stats,
  gamma: () => gamma,
  setGamma: (g) => { gamma = Math.max(0, Math.min(GAMMA_MAX + 0.15, g)); $('gamma').value = String(gamma); renderGeometry(); },
  sunAltitudeFor,
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
  .then((j) => {
    data = j;
    $('scrub').max = String(j.count);
    $('scrub').addEventListener('input', (e) => {
      playing = false; $('play').textContent = 'play';
      setIndex(+e.target.value);
    });
    $('play').addEventListener('click', togglePlay);
    $('reset').addEventListener('click', () => { setIndex(0); });
    $('gamma').addEventListener('input', (e) => { gamma = +e.target.value; renderGeometry(); });
    buildLegend();
    renderGeometry();
    setIndex(j.count);
  })
  .catch((e) => { console.error('eclipses.json did not load', e); });

requestAnimationFrame(loop);
