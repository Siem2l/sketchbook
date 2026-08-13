# sketchbook

Creative-coding playground — perlin noise, generative art, data-flow
visualizations. One folder per sketch, auto-generated gallery, published
at https://sketches.siem2l.nl.

## Workflow

```bash
npm install --include=dev   # once (NODE_ENV=production is set on this box)
make new NAME=my-idea       # copy the template to sketches/YYYY-MM-my-idea
make dev                    # hot-reload dev server
make publish                # vite build + rsync to /var/lib/sketchbook
npm test                    # playwright behaviour tests (starts its own server)
npm run thumbs              # regenerate public/sketches/*/thumb.png
```

`make publish DRY=1` shows what would sync. From another machine, set
`PUBLISH_HOST=<ssh-alias>` to rsync over SSH.

Each sketch folder needs `index.html`, `sketch.js`, and `meta.json`
(`title` and `date` required — the build fails otherwise). The gallery
index is generated from these at build time.

`shared/` holds code used by more than one sketch — currently
`kernels.glsl`, imported with Vite's `?raw`. It sits outside `sketches/`
deliberately: the three scanners (vite's page list, `build-index.js`,
`gen-thumbnails.js`) all treat every directory under `sketches/` as a
sketch and `build-index.js` fails the build on one without a `meta.json`.

## Serving

The site is served by the `sketchbook` module in apis-mellifera
(`modules/services/web/sketchbook.nix`): nginx on loopback :8088,
exposed as `sketches.siem2l.nl` via the gateway, no auth. One-time
activation: `make deploy-nixos` in apis-mellifera. After that,
publishing never touches nix — `/var/lib/sketchbook` is group-writable
for the `sketchbook` group.

## Sketches

- **eclipse horizon** (`2026-08-eclipse-horizon`) — all 11,898 solar eclipses
  from 1999 BC to 3000 AD, at the point where each one peaked, out of Espenak's
  Five Millennium Catalog. 4,294 of them — 36% — have the Sun at exactly 0°, and
  every one of those lands between 60° and 72° of latitude with nothing outside
  the band. The cause is one number: gamma, the miss distance of the Moon's
  shadow axis from the Earth's centre, is uniform out to about 1.55 Earth radii
  while the Earth stops at 1.0. A third of the range is the shadow missing the
  planet, and a near miss is only visible from the sliver of surface curving
  away toward sunrise. Mostly those are partial eclipses, but 94 are not: the
  non-central annulars and totals the catalog marks `A-` and `T+`, where the
  axis misses and the antumbra grazes the limb anyway. The ramp runs on
  horizon-ness rather than altitude, so the low Sun is the bright end, and it is
  parameterised by `cos(alt)` — the survival function of the `sin(alt)` altitude
  distribution — so its five steps carry equal shares of eclipses instead of
  equal spans of degrees; walking it linearly put two thirds of the marks in the
  two darkest steps and the globe came out one flat colour. The 0° eclipses are
  off the ramp entirely, on a reserved colour and a hollow mark, because a third
  of the data stacked on one value is a category and not the bottom of a scale.
  The page also says, in the corner, that a sphere is horizon-heavy for free —
  half of all daylight anywhere is below 30° too — because a sketch that shows a
  striking pattern and omits that some of it is geometry is doing the thing this
  repo exists not to do. `scripts/fetch-eclipses.mjs` pulls the 50 century pages
  by hand and the result is committed, so a page load never depends on NASA
  being up.

- **hendriklaan** (`2026-08-hendriklaan`) — 240 metres of Utrecht around Prins
  Hendriklaan 17, cut out of the AHN5 LiDAR survey and driven by sound. The
  geometry is 201,635 real returns, not a generator. The tile it comes from is
  228 MB and none of it was downloaded: AHN publishes COPC, so the octree index
  is in the file header and `scripts/extract-hendriklaan.py` asks PDAL for a
  bounding box over HTTP range requests — a 240 m window costs 16 seconds and a
  few MB. Points ship as 8 bytes each (uint16 per axis over the window's own
  extent, plus class and log intensity), 1.6 MB for the block, shuffled at
  extraction so the load-in reveal fills the whole street at once rather than
  one corner. The mapping from sound to motion is the survey's own
  classification: 62% unclassified (canopy and street furniture), 21% ground,
  16% building, which is already a three-way split, so ground answers the sub
  and low bands, canopy the mids, roofs the highs. Displacement is a pure
  function of band energy with nothing integrating velocity, so silence returns
  every point to its surveyed coordinate exactly — gain 0 is the raw survey, and
  a test asserts the cloud does not drift. Three sources: a built-in sequencer
  that needs no AudioContext and therefore no gesture and no permission (which
  is what lets the thumbnail and the tests see a moving page), the same pattern
  through real oscillators, and the microphone. Each band carries its own slow
  AGC because a room mic and a synth bus are nowhere near each other in level;
  without it the built-in bank pinned every band above 0.79 and the street
  stopped answering the music. The pattern itself is editable: `b` opens a
  sixteen-step grid in the corner where kick, bass and hat are one 16-bit mask
  each, with the built-in pattern drawn underneath as dashed outlines so a hit
  you removed stays visible. Tempo, swing, a four-bar bass-note row, and a
  switch for the pad — which had to exist, because the pad is the mid band and
  a drone you cannot turn off means an empty grid still leaves the canopy
  breathing. Edits ride in the URL hash, stripped again the moment the pattern
  is the built-in one, so the canonical page never carries one. Colour by
  height, class, intensity, or by the band mapping itself. Drag to orbit, `o`
  for the isometric elevation, `s`
  exports at 3x. AHN5 is CC BY 4.0.

- **edge** (`2026-08-edge`) — four edge-detection operators on one source, side
  by side, because the differences between Sobel, Roberts, the Laplacian and a
  difference-of-gaussians are otherwise folklore. The operators live in
  `shared/kernels.glsl` and are not written in the sketch; the source is always
  rendered to a texture first, even when it is procedural and could have been
  evaluated inline, because sampling a `sampler2D` is the contract every host
  shares and an inlined function does not survive the move to TouchDesigner.
  The procedural test card is built to be failed on in specific ways — a
  rotating hard-edged square, a circle, a frequency sweep, a smooth-noise
  patch, a gradient that should stay dark, and a soft vertical edge that at
  default gain only Sobel answers. That last one is the sharpest result the rig
  produces, and it is pinned by a test. A second finding contradicts the
  textbook: against *smooth* grain the Laplacian is the quiet operator, not the
  noisy one, because it responds to curvature rather than slope. Webcam and a
  bundled TouchDesigner frame are opt-in sources; neither can be the default or
  `npm run thumbs` and the tests would both capture a black frame.

- **hydra edge** (`2026-08-hydra-edge`) — the same four operators registered as
  Hydra sources, so they compose with feedback, modulation and live
  re-evaluation. `shared/kernels.glsl` is imported verbatim; nothing is
  reimplemented, which is the only version of "portable kernel" that holds up.
  Two things had to be worked out for that. A neighbourhood operator cannot be
  a Hydra `color` transform at all — those receive one `vec4` — so each is a
  `src` taking a `sampler2D`. And `setFunction` wraps whatever GLSL you give it
  in a function signature, so the shared file pasted there is a syntax error at
  the first `float luma(vec3 c) {`; GLSL has no nested functions. The kernels
  go in through `_addMethod`, which takes already-complete GLSL that Hydra
  emits at top level, with an include guard so whichever operator a patch uses
  first defines them. Mutating Hydra's utility-function map is tidier and does
  not survive the bundler: Vite pre-bundles hydra-synth, so the sketch and
  Hydra end up holding different copies of that module and the injection lands
  nowhere. The `disagree` preset subtracts two operators so only what they
  disagree about survives — the clearest picture of the difference on the site.

- **flash** (`2026-08-flash`) — a tattoo brief generator built so that nothing
  chooses the idea. Asked for "a tattoo idea", a language model collapses onto
  snake / moth / dagger every time, so it doesn't get a vote: about half of
  rolls walk the subject out of the tree of life instead, taking a uniform draw
  over the ~650 taxonomic orders under a kingdom and then a random offset inside
  one, which samples flat over the tree rather than over popularity and turns up
  a webspinner where the model would have said wolf. Everything else — lineage,
  technique, format, a hard constraint, a twist — comes from six hand-written
  decks combined by the same seeded PRNG the other sketches use, so a brief is a
  pure function of its printed seed. The constraint row is what separates a
  brief from a mood board. References are fetched live and client-side, which
  restricts the sources to the keyless CORS-open ones: the Met Collection API,
  iNaturalist, and the Biodiversity Heritage Library's plates reached through
  Wikimedia Commons (BHL's own API needs a key). Commons searches are strict AND
  and its BHL category is mostly whole scanned books, so the queries cascade up
  the taxonomy until something answers and filter to `filetype:bitmap`. ♥ and ✕
  on any row reweight the decks permanently in localStorage — killed entries
  keep a floor so an impatient afternoon can't narrow the deck for good — which
  means the page converges on your taste rather than on the middle of a corpus.
  The wall is allowed to fail; the brief renders offline.

- **splinter** (`2026-07-splinter`) — a Vectorheart debris field in real 3D
  you can walk around and draw into. Two references, one generator: Chapter
  Three's flat angular shards at one pole, MC-202's extruded hardware at the
  other, with a MIX control between them. The scene is genuinely dimensional —
  fragments have world-space geometry and an orbit camera projects them — so
  the posters' isometric look is just the ORTHO camera at 45 degrees. Rendering
  stays hand-rolled on the 2D canvas (flat fills, hairline strokes, crisp type)
  with back-face culling and painter's sorting. Drag to orbit, wheel to dolly,
  DRAW mode to paint fragments in; `v`/`m`/`k`/`t` cycle view/mix/palette/motion,
  `o` toggles ortho, `s` exports at 3x. Component toggles and all controls are
  on-screen buttons. `x` detonates: fragments launch from the focus and tumble
  under exponential drag tuned so they asymptotically settle onto the exact
  positions the composition designed for them — the explosion assembles the
  poster. `g` adds gravity and a floor, and the debris falls into a heap.
  Every composition is a pure function of its printed seed.

- **inconstructions** (`2026-07-inconstructions`) — an ephemeral Vectorheart
  assembly sandbox. Interlocking axonometric parts snap to a bounded lattice,
  which makes occlusion a depth sort rather than a z-buffer; picking reads a
  pixel from an offscreen ID buffer. Colour belongs to the part type, so there
  is no colour picker. The page opens by building itself, nothing is saved, and
  the only thing that leaves is a 3x PNG.

- **message noise** (`2026-07-message-noise`) — a hidden message is hashed
  (cyrb128) into noise/random seeds, terrain parameters and a palette; the map
  animates over 3D noise, spacebar freezes it, ←/→ step a frame at a time, and
  the stamp along the bottom edge plus the message reproduce any frame exactly.
  Four ways to survey the same terrain — filled relief, contour sheet, both at
  once, and four-pass engraved cross-hatch — across six themes, with band
  count, zoom, warp, octaves and sea level on live controls. p5's perlin only
  occupies a narrow slice of 0..1 and the slice drifts as octaves are added, so
  the field is stretched between measured per-octave percentiles before it is
  banded; without that a twelve-band ramp renders five. 3x PNG export for
  tattoo/print reference. The message is never stored, sent, or rendered.
