// Compares two rankings of the same variant set.
//
//   node lab/compare.mjs lab/results/human.json lab/results/agent.json
//
// Reports Kendall's tau-b and Spearman's rho, a permutation p-value, and the
// variants the two rankers disagree about most — which is the output actually
// worth reading. A correlation coefficient tells you whether to be surprised;
// the disagreement list tells you what to look at.
//
// tau-b rather than plain tau because a five-point rating produces a lot of
// ties, and tau-a treats tied pairs as neither concordant nor discordant while
// still dividing by the untied total, which drags the coefficient toward zero
// for reasons that have nothing to do with agreement.
import { readFileSync } from 'node:fs';

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.error('usage: node lab/compare.mjs <ranking-a.json> <ranking-b.json>');
  process.exit(1);
}

const load = (p) => {
  const j = JSON.parse(readFileSync(p, 'utf8'));
  const scores = new Map(Object.entries(j.ratings).map(([id, r]) => [id, r.score ?? r]));
  return { path: p, meta: j, scores };
};

const A = load(aPath);
const B = load(bPath);

// A comparison across different variant sets is meaningless, and the failure
// is silent if you do not check: you would get a coefficient over whatever
// happened to overlap.
if (A.meta.variantSeed !== B.meta.variantSeed || A.meta.variantN !== B.meta.variantN) {
  console.error(`refusing to compare different variant sets: `
    + `seed/n ${A.meta.variantSeed}/${A.meta.variantN} vs ${B.meta.variantSeed}/${B.meta.variantN}`);
  process.exit(1);
}

const ids = [...A.scores.keys()].filter((id) => B.scores.has(id)).sort();
const missing = A.scores.size + B.scores.size - 2 * ids.length;
if (!ids.length) { console.error('no variants in common'); process.exit(1); }

const a = ids.map((id) => A.scores.get(id));
const b = ids.map((id) => B.scores.get(id));

function kendallTauB(x, y) {
  let con = 0, dis = 0, tx = 0, ty = 0;
  for (let i = 0; i < x.length; i++) {
    for (let j = i + 1; j < x.length; j++) {
      const dx = Math.sign(x[i] - x[j]);
      const dy = Math.sign(y[i] - y[j]);
      if (dx === 0 && dy === 0) continue;   // tied in both: informative to neither
      if (dx === 0) { tx++; continue; }
      if (dy === 0) { ty++; continue; }
      if (dx === dy) con++; else dis++;
    }
  }
  const d = Math.sqrt((con + dis + tx) * (con + dis + ty));
  return d === 0 ? 0 : (con - dis) / d;
}

// Fractional ranks, so ties share their average rank rather than an arbitrary
// order — otherwise rho depends on the order the ids happen to be listed in.
function rank(v) {
  const idx = v.map((val, i) => [val, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(v.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(x, y) {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

const tau = kendallTauB(a, b);
const rho = pearson(rank(a), rank(b));

// Permutation test rather than a table lookup: it makes no distributional
// assumption, and with n this small the assumptions are exactly what would be
// doing the work. Deterministic seed so the p-value is reproducible.
function mulberry32(s) {
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(12345);
const TRIALS = 20000;
let atLeastAsExtreme = 0;
const shuffled = b.slice();
for (let t = 0; t < TRIALS; t++) {
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  if (Math.abs(kendallTauB(a, shuffled)) >= Math.abs(tau)) atLeastAsExtreme++;
}
const pValue = (atLeastAsExtreme + 1) / (TRIALS + 1);

const nameA = A.meta.ranker ?? 'a';
const nameB = B.meta.ranker ?? 'b';

console.log(`\n  ${nameA}  vs  ${nameB}`);
console.log(`  ${ids.length} variants in common${missing ? ` (${missing} unmatched, ignored)` : ''}`);
console.log(`\n  kendall tau-b   ${tau.toFixed(3)}`);
console.log(`  spearman rho    ${rho.toFixed(3)}`);
console.log(`  permutation p   ${pValue < 1 / TRIALS ? `<${(1 / TRIALS).toFixed(5)}` : pValue.toFixed(5)}  (${TRIALS} shuffles, two-sided)`);

// Both rankers' scores normalised to their own 0..1 range before differencing:
// one ranker using 2–5 and another using 1–4 do not disagree by a whole point
// everywhere, they just have different spreads.
const norm = (v) => {
  const lo = Math.min(...v), hi = Math.max(...v);
  return hi === lo ? v.map(() => 0.5) : v.map((x) => (x - lo) / (hi - lo));
};
const na = norm(a), nb = norm(b);
const gaps = ids.map((id, i) => ({ id, a: a[i], b: b[i], gap: na[i] - nb[i] }))
  .sort((p, q) => Math.abs(q.gap) - Math.abs(p.gap));

console.log(`\n  widest disagreements (${nameA} → ${nameB})`);
for (const g of gaps.slice(0, 8)) {
  const dir = g.gap > 0 ? `${nameA} liked it more` : `${nameB} liked it more`;
  console.log(`    ${g.id}   ${nameA} ${g.a}  ${nameB} ${g.b}   ${dir}`);
}
console.log(`\n  look at those eight before you look at the coefficient.\n`);
