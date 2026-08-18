# eclipse horizon — a third of them happen at eye level

A friend's intuition: eclipses seem to happen more often near the horizon. It is
true, and the reason is a single number that has no opinion about you at all.

`sketches/2026-08-eclipse-horizon`, new.

## What the catalog says

Espenak's Five Millennium Catalog of Solar Eclipses gives, for every eclipse
from astronomical year −1999 to +3000, the latitude, longitude and **solar
altitude** at the moment of greatest eclipse. Those are astronomical year
numbers, which include a year 0 — three eclipses fall in it — and year 0 is
1 BC, so the span is **2000 BC to 3000 AD**, which is how NASA titles it.
Parsing all 50 century pages — 11,898 eclipses — gives three facts:

```
4,294 of 11,898  (36.1%)  have the Sun at exactly 0°
   all 4,294               fall between |lat| 60° and 72°
   none                    fall anywhere else — the band is exact
```

Of those 4,294, most are partial eclipses, but 94 are not: 68 annular and 26
total, the ones the catalog marks `A-` and `T+`. Those are the *non-central*
eclipses, where the shadow axis misses the Earth and the antumbra grazes the
polar limb regardless. Same near-miss geometry as the partials, caught one notch
closer in — which is why they land in the same band.

> An earlier draft of this design said 60°–80° and 35.3%, taken from a 10°-bin
> histogram over 20 of the 50 centuries. The bin edge was not the extremum and
> the sample was not the catalog. The numbers above are measured over all of it.

The mechanism is gamma — the miss distance of the Moon's shadow axis from the
Earth's centre, in Earth radii. Over 2,000 years it is flat:

```
|γ|   0.0  0.2  0.4  0.6  0.8  1.0  1.2  1.4
      332  296  306  335  319  273  304  336     uniform to ~1.55
```

The axis has no preference for hitting square. But the Earth stops at |γ| = 1,
so everything from 1.0 to 1.55 — a third of the range — is the shadow sailing
*past* the planet. Those eclipses are still seen, but only from the sliver of
surface that curves away far enough to catch the shadow's edge: the sunrise
line. Sun on the horizon, by construction, at high latitude, by construction.

For the 7,604 that do connect, altitude follows `sin(alt)` — uniform γ pushed
through `alt = 90° − arcsin|γ|`. Measured over 20 centuries, the fit was:

```
        obs    pred
 0-10   2.4%   1.5%
30-40   9.4%  10.0%
60-70  14.7%  15.8%
80-90  18.5%  17.4%
```

And the geography that follows from it: **91.8%** of eclipses inside |lat| 15°
peak with the Sun 60° or higher, against **45.1%** of all eclipses peaking at
30° or lower. Tropics overhead, poles on the horizon, nothing in between.

Nothing in the sketch computes any of this. It plots the points.

## The caveat that keeps it honest

A sphere is already horizon-heavy. For a random spot on the daylit half of
Earth the solar altitude density is `cos(alt)` — half of *all daylight* happens
with the Sun under 30°, because there is simply more surface at grazing angles.
Part of the intuition is geometry that has nothing to do with eclipses.

This gets one line in the hint block. Not a second chart. A sketch that shows a
striking pattern and quietly omits that some of it is free is doing the thing
this repo exists not to do.

## Data

`scripts/fetch-eclipses.mjs` — a manual run, not part of `make dev`.

Fetches all 50 century pages of `eclipse.gsfc.nasa.gov/SEcat5/SE<y1>-<y2>.html`
(verified: `SE-1999--1900`, `SE-0099-0000`, `SE0001-0100`, `SE2001-2100` all
resolve), strips tags from the `<pre>` blocks, and matches rows with:

```
^(\d{5})\s+(-?\d{1,4})\s+(\w{3})\s+(\d+)\s+\S+\s+ ... \s+(\d+)([NS])\s+(\d+)([EW])\s+(\d+)
```

Whitespace splitting does not survive the catalog: partial eclipses leave Path
Width and Central Duration blank, so row field counts vary (17 and 15 in a
single century). Fixed-column slicing does not survive it either, because the
BCE pages carry a negative year of varying width. The regex anchors on the
5-digit catalog number and the `NNN`/`EEE` hemisphere letters, which every row
has. **Zero unmatched lines**; a line that looks like a row and does not parse is
a parse failure, not a partial success, and the script exits non-zero.

The expected total is 11,898 — the published size of the catalog, not something
verified here, since this design was checked against a 20-century sample. The
first full run pins it, and the test below asserts whatever that run finds. If
it disagrees with 11,898, the count is wrong in this document and the parser is
what to trust.

Output `public/data/eclipses.json`, committed. Parallel arrays, not objects:

```json
{ "year": [...], "lat": [...], "lon": [...], "alt": [...], "gamma": [...], "type": "TAPPH..." }
```

Signed integer degrees for lat/lon, integer degrees for alt, γ to 4 dp. Type is
one char per eclipse in a single string — the catalog's **first** character only
(`T`, `A`, `H`, `P`). It also emits subtypes (`Pb`, `An`, `A-`, `H3`, `T+`,
`Am`, `As`, `Pe`) which distinguish beginning/end-of-saros and non-central
totals; the sketch draws none of those distinctions, so they are dropped at
fetch time rather than carried and ignored. ~350 KB, inspectable, and refetching
is never something a page load does — the sketch does not depend on NASA being
up.

## The globe

Plain 2D canvas. No p5, breaking with most sketches here.

The projection is orthographic and it is six lines:

```js
const dl = lon - λ;
const x =  cos(lat) * sin(dl);
const y =  cos(φ) * sin(lat) - sin(φ) * cos(lat) * cos(dl);
const z =  sin(φ) * sin(lat) + cos(φ) * cos(lat) * cos(dl);   // z < 0 → far side
```

p5's WEBGL mode would mean fighting its camera to arrive back at that. d3-geo
would hand over a projection and then charge per-frame path generation for it.
Neither earns its import for 11,898 `fillRect` calls, which is a rounding error
at 60 fps. The sketch header says this, so the next person does not read the
missing `import p5` as an oversight.

Drag to rotate — horizontal on λ, vertical on φ clamped to ±90°. Slow idle spin
resumes a few seconds after release. Graticule every 15°, with **60° and 72°
drawn heavier in both hemispheres**: those two circles are exactly what the
horizon eclipses refuse to cross, and drawing them is the difference between a
pattern the viewer notices and one they can check.

Points are z-sorted back-to-front so the far hemisphere is culled, not painted
over. Sorting 11,898 floats per frame is affordable; if it is not, the sort key
is monotonic in λ and φ and the array can be bucketed instead. Measure first.

## Encoding

Solar altitude drives a sequential ramp — exact values taken from the `dataviz`
skill at build time rather than invented here.

But the 0° eclipses are not the bottom of a continuum, they are 35% of the data
stacked on one value, and a sequential ramp renders a categorical spike as a
merely-dark end. **They get a different mark: hollow rings against filled
dots.** The bands then survive greyscale, survive colour-blindness, and survive
being seen at thumbnail size, which is where most people will meet this page.

## Deep time

Play/pause, a scrub bar across −1999…+3000, and a speed control. Points
accumulate; nothing is ever removed except by scrubbing backwards. The newest
arrival flashes and settles over ~400 ms.

The rings do not exist at any single moment. They are residue. Watching them
precipitate out of what starts as scatter is the whole argument, and it is an
argument that cannot be made by a still image — which is the justification for
this being a sketch rather than a chart.

A readout in the corner counts what has landed *so far*: `n`, share with Sun
≤30°, share at exactly 0°, and the min/max `|lat|` of the horizon set. Early on,
at small `n`, these visibly wobble before settling. That wobble is not noise to
be hidden; it is what a statistical claim honestly looks like while it is still
being earned.

## Tests

Added to `test.mjs`, following the existing pattern — plain node, playwright,
one section per concern.

Node-side, no browser or server needed, since the data is on disk and the claim
is about the data:

- `eclipses.json` has exactly 11,898 records and all six arrays agree in length
- every record with `alt === 0` has `60 ≤ |lat| ≤ 72`, and both bounds are hit

That second one is the design's central claim asserted against its own source.
If a refetch ever changes it, the build fails loudly instead of the page quietly
telling a story that is no longer true.

Browser-side:

- canvas is non-blank a second after load
- scrubbing to year 1000 draws strictly fewer points than the end of the range
- a drag changes the rendered frame

## Not doing

- **Eclipse paths.** The catalog gives one greatest-eclipse point per eclipse.
  Real visibility from a given spot needs Besselian elements and a much larger
  build. The globe shows greatest-eclipse points and the readout says so.
- **A second chart.** The altitude histogram and the `cos(alt)` baseline are a
  sentence, not a panel.
- **Population weighting.** Interesting, and a different sketch.
