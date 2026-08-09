// Blind rating pass over the rendered variants.
//
// Blind means three things here, and all three are load-bearing:
//   - the frames carry no stamp (lab/render.mjs sets stamp:false), so the
//     recipe is not written on the image being judged;
//   - the presentation order is shuffled per session, so position in the
//     manifest cannot become a cue;
//   - nothing on this page ever displays palette, mode, parameters or id.
//
// It is not blind against someone who opens devtools — the filenames are the
// ids. That is deliberate: the point is to stop incidental cueing, not to
// defeat a determined self-cheater, and the cost of true blinding (blob URLs,
// shuffled filenames) buys nothing against the only ranker who matters.
//
// Rating 1–5 rather than dragging 64 frames into a total order: a full manual
// ordering of 64 items is hours of work and most of it is spent on pairs you
// do not care about. A five-point pass takes a couple of minutes and produces
// exactly what a rank correlation needs, as long as the analysis uses a
// coefficient that handles ties properly — lab/compare.mjs uses Kendall's
// tau-b, which does.

const RESULTS_VERSION = 1;

const els = {
  img: document.getElementById('img'),
  progress: document.getElementById('progress'),
  bar: document.querySelector('#bar div'),
  scale: document.getElementById('scale'),
  frame: document.getElementById('frame'),
  meta: document.getElementById('meta'),
  done: document.getElementById('done'),
  summary: document.getElementById('summary'),
  dump: document.getElementById('dump'),
  save: document.getElementById('save'),
};

// Which rendered set to rank. Defaults to lab/variants; ?set=… lets a second
// set sit alongside it, which is what the behaviour tests point at so they
// never depend on a 64-variant render having been done first.
const SET = (new URLSearchParams(location.search).get('set') || 'variants').replace(/[^\w-]/g, '');

const manifest = await fetch(`../${SET}/manifest.json`)
  .then((r) => {
    if (!r.ok) throw new Error(`no manifest (${r.status})`);
    return r.json();
  })
  .catch((e) => {
    document.body.innerHTML =
      `<p style="font:14px ui-monospace;color:#e05252;max-width:40rem;line-height:1.7">`
      + `${e.message}. Render the variants first:<br><br>`
      + `<code>node lab/render.mjs --n 64 --seed 1</code></p>`;
    throw e;
  });

// Session seed is recorded so the exact presentation order can be reconstructed
// — order effects (fatigue, drift, anchoring on the first few) are real, and
// being able to check for them afterwards costs one integer.
const sessionSeed = Date.now() >>> 0;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(sessionSeed);
const order = manifest.variants.map((v) => v.id);
for (let i = order.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [order[i], order[j]] = [order[j], order[i]];
}

const byId = new Map(manifest.variants.map((v) => [v.id, v]));
const ratings = new Map();
const shownAt = new Map();
let cursor = 0;

// Decode the next frame before it is needed. A visible load between frames
// turns into a rhythm, and a rhythm turns into a rating cue.
function preload(i) {
  const id = order[i];
  if (!id) return;
  new Image().src = `../${SET}/${byId.get(id).file}`;
}

function show() {
  if (cursor >= order.length) return finish();
  const v = byId.get(order[cursor]);
  els.img.src = `../${SET}/${v.file}`;
  els.progress.textContent = `${cursor + 1} / ${order.length}`;
  els.bar.style.width = `${(cursor / order.length) * 100}%`;
  shownAt.set(v.id, performance.now());
  preload(cursor + 1);
  preload(cursor + 2);
}

function rate(score) {
  if (cursor >= order.length) return;
  const id = order[cursor];
  const t0 = shownAt.get(id);
  ratings.set(id, {
    score,
    // Dwell time is worth keeping: a rating given in 300ms and one given after
    // ten seconds are not the same measurement, and the difference shows up
    // when the correlation is weak and you want to know why.
    ms: t0 ? Math.round(performance.now() - t0) : null,
    position: cursor,
  });
  cursor++;
  show();
}

function back() {
  if (cursor === 0) return;
  cursor--;
  ratings.delete(order[cursor]);
  show();
}

function finish() {
  els.frame.style.display = 'none';
  els.scale.style.display = 'none';
  els.meta.style.display = 'none';
  els.bar.style.width = '100%';
  els.done.style.display = 'block';

  const scores = [...ratings.values()].map((r) => r.score);
  const hist = [1, 2, 3, 4, 5].map((s) => `${s}:${scores.filter((x) => x === s).length}`);
  const median = scores.slice().sort((a, b) => a - b)[Math.floor(scores.length / 2)];
  els.summary.textContent =
    `${scores.length} rated · distribution ${hist.join('  ')} · median ${median}`;
  els.dump.textContent = JSON.stringify(payload(), null, 1).slice(0, 1400) + '\n…';
}

function payload() {
  return {
    version: RESULTS_VERSION,
    ranker: 'human',
    sketch: manifest.sketch,
    variantSeed: manifest.seed,
    variantN: manifest.n,
    sessionSeed,
    // Not an ISO timestamp from inside the page for reproducibility's sake —
    // it is metadata about the session, not part of what makes it repeatable.
    ratedAt: new Date().toISOString(),
    presentationOrder: order,
    ratings: Object.fromEntries([...ratings].map(([id, r]) => [id, r])),
  };
}

els.scale.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.hasAttribute('data-back')) return back();
  rate(Number(b.dataset.score));
});

window.addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= '5') { rate(Number(e.key)); e.preventDefault(); }
  if (e.key === 'ArrowLeft') { back(); e.preventDefault(); }
});

els.save.onclick = () => {
  const blob = new Blob([JSON.stringify(payload(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ranking-human-seed${manifest.seed}-n${manifest.n}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

// Read-only view for the behaviour tests.
window.__rank = {
  total: () => order.length,
  cursor: () => cursor,
  rated: () => ratings.size,
  payload,
  // What is on screen, so a test can assert the page never shows a recipe.
  visibleText: () => document.body.innerText,
};

show();
