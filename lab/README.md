# lab

Infrastructure for one experiment: **can a written set of aesthetic criteria
rank generated images the way you do?**

It lives here rather than on apis-mellifera because the renderer has to *be*
the sketch. A harness that reimplemented message-noise to produce variants
would be ranking something that isn't the sketch, and the experiment would
answer a question nobody asked — the same reason `shared/kernels.glsl` is
shared rather than copied. Nothing here needs a server: results are JSON in
git, which for an experiment beats a database, because provenance and diffs
come free and there is no schema to migrate. Stand something up on
apis-mellifera when there are rankers you don't control or data arriving over
time. Neither is true yet.

Nothing in `lab/` is published. `vite build` only bundles the pages in its
`input` list (`sketches/*/index.html`), while the dev server serves anything
under the repo root — so `/lab/rank/` exists under `npm run dev` and never
reaches `dist/`.

## Running it

```bash
node lab/render.mjs --n 64 --seed 1     # 64 pngs + manifest.json -> lab/variants/
npm run dev                             # then open /lab/rank/
node lab/compare.mjs lab/results/a.json lab/results/b.json
```

`lab/variants/` is gitignored — it's a cache. Every ranking records the seed
and n that produced its variants, so any result regenerates exactly.

## The design, and why

**Sampling is stratified, not uniform.** Over four modes, six palettes and six
continuous axes, 64 independent uniform draws reliably leave regions empty and
double up elsewhere, and a ranking over a lumpy sample tells you about the
lumps. Mode and palette are dealt round-robin; the continuous axes are Latin
hypercube sampled. Changing `--n` re-strata everything, so `n` is part of a
variant set's identity, not just its length.

**Ranges match the sketch's own controls.** Sampling outside them would produce
images you couldn't reproduce with the sliders, which would make a winner
unactionable.

**Blind means three things**, all load-bearing: the frames carry no stamp
(`render.mjs` passes `stamp: false`, or every image would have its own recipe
printed on it); presentation order is shuffled per session, so manifest
position can't become a cue; and the page never displays palette, mode,
parameters or id. It is *not* blind against devtools — that's deliberate, since
the only ranker who could exploit it is the one being measured.

**Rating 1–5, not a dragged total order.** Ordering 64 items by hand is hours,
most of it spent on pairs you don't care about. A five-point pass is a couple of
minutes and is all a rank correlation needs — provided the analysis handles
ties, which is why `compare.mjs` reports Kendall's **tau-b**. Dwell time is
recorded per rating: a 300ms judgement and a ten-second one aren't the same
measurement, and the difference matters when the correlation is weak and you
want to know why.

**Read the disagreements before the coefficient.** `compare.mjs` prints a
permutation p-value alongside tau because small-n rank correlations look
meaningful when they aren't — two *independent random* rankers over 24 variants
scored tau = 0.236 in testing, which reads like mild agreement and has p = 0.16.
The eight widest disagreements are the actual output; the coefficient only tells
you whether to be surprised by them.

## The confound to avoid

If the same model generates the variants **and** ranks them, the correlation is
meaningless — it would be scoring its own output against criteria it was already
steering by. The sampler is deliberately dumb and criteria-blind for that
reason: it draws from parameter ranges and knows nothing about what looks good.
Keep the agent's ranking pass separate, and don't show it the sampler.

Write the criteria *after* the variants render, against real images rather than
imagined ones — and don't let the generator see them.
