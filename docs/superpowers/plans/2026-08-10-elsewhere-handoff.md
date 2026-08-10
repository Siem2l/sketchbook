# elsewhere — handoff

Everything a fresh session needs to pick this up cold. The design lives in
`docs/superpowers/specs/2026-08-09-elsewhere-design.md`; the original task
breakdown in `docs/superpowers/plans/2026-08-09-elsewhere.md` is now **out of
date from Task 6 onward**, because the renderer was rewritten around textures
after that plan was written. This document supersedes it.

## What it is, and where it stands

`sketches/2026-08-elsewhere` — a 240 m square of the Netherlands, drawn as
230,400 particles, built live from national LiDAR and aerial photography. WASD
slides the window across the country; typing an address morphs the same
particles into that place.

**Live and verified** at https://sketches.siem2l.nl/sketches/2026-08-elsewhere/

Working: the opening place from disk, WASD sliding with live tile streaming,
address search with gather → fly → land, the scrub, three colour modes, grain,
orbit/dolly, `p` for a 3× PNG, `h` to hide the panel.

Not done: a Vectorheart colour mode (agreed, not started), a README entry
(the sketch is missing from the `## Sketches` list), and the shared-module
extraction described at the end of this document.

## Architecture

Seven modules. Pure logic is separated from browser work so most of it is
testable in Node inside the existing `test.mjs`.

| file | what it is | testable in Node |
| --- | --- | --- |
| `geotiff.js` | float32 GeoTIFF reader, no dependency | yes |
| `pdok.js` | endpoints, URL builders, RD geometry, cached fetch | yes |
| `place.js` | the datum and the exposure — two measurements per place | yes |
| `slots.js` | which ring slot holds which fetch tile | yes |
| `shaders.js` | both GLSL programs | no |
| `field.js` | texture arrays, uniforms, draw calls | no |
| `sketch.js` | loader, state machine, camera, controls | no |

**There is no vertex buffer.** A particle is its `gl_VertexID`; its ground
position comes from that index and a uniform, and its height, colour and normal
are texture lookups. Sliding the window is a uniform. A tile arriving is one
`texSubImage3D`.

**Thirteen texture layers.** 0–8 are the sharp ring (240 m fetch tiles at 0.5 m).
9,10 and 11,12 are two alternating pairs, each a wide 480 m frame at 1 m plus a
sharp 240 m centre. One pair holds the place you are on, the other the place you
are flying to; landing swaps them. A layer carries its own span, and the shader
takes whichever is finest over a given patch of ground.

**Two levels of tile** because the network and the GPU want different sizes: a
fetch tile is 240 m and costs three PDOK requests; the drawn square is 240 m at
AHN's native half metre.

## Traps

Every one of these was built the obvious way first and was wrong. Most produce
plausible-looking output rather than an error.

1. **The floating-point predictor.** libtiff accumulates bytes with **stride 1**,
   not the row width, and then de-interleaves four byte planes **in reverse**.
   Get either wrong and you still get finite numbers: the first attempt gave a
   maximum of 3.4e38 and a centre cell of exactly 0.00. Verified against PDAL:
   the opening window reads 0.36–33.21 m NAP with the centre cell at 12.56.

2. **WMS bbox axis order.** EPSG:28992 in WMS 1.3.0 is **easting first**.
   Northing-first returns HTTP 200 and a valid, blank 1.6 KB JPEG. The sanity
   check is the byte count — a real 480² ortho is 60–110 KB.

3. **Ask for `geotiff:compression=None`.** Deflate is 683 KB against 923 KB but
   takes **55 seconds** to decode in a browser against **14 ms**. Not because
   inflating is slow — because a striped TIFF has 120 strips, each needing its
   own `DecompressionStream`, and each of those yields to the event loop. Against
   a render loop those yields never come back. The deflate path still exists,
   inflating all strips at once (330 ms), and `_fixture` is baked with
   `--compress` to keep it under test.

4. **Residency is not the clock.** Whether a layer holds this ground has nothing
   to do with when it arrived. Conflating them drew nothing at all: the opening
   frame is marked long-settled, and settled read as absent.

5. **A 3×3 ring needs nine layers plus the coarse ones.** With one fewer, two
   slots share a layer and overwrite each other.

6. **Slots are addressed by tile coordinate, never by ring position.** Position
   indexing means one step forward re-points every slot: 49 reloads for a move
   that should cost 7, the queue backed up to 107, and the world went black
   while moving. Pinned by a test.

7. **Never blank an evicted slot.** It punches a black square in the leading
   edge for the length of the fetch. The stale ground sits outside the frame and
   the clip hides it.

8. **The transition, twice over.** A 49 km flight asking for a 105 m lift across
   a 240 m window threw the whole field out of the picture — measured at 0.17
   coverage mid-flight against 0.41 at rest. Then the per-particle stagger meant
   to fix it turned the field into churn. What works is one eased curve, every
   particle together, no lift and no lateral slide on a jump, colour carried the
   whole way. A test pins the swell and the landing.

9. **Refinements must land quietly.** A sharp tile arriving over ground the
   coarse frame already shows is a refinement, not a change of place. Firing the
   arrival changeover for those meant every landing was followed by the square
   sinking and popping a second time. Tested by **overlap**, not containment — a
   240 m tile on a fixed grid rarely sits wholly inside a 480 m window, and the
   straddling ones kept sinking one corner.

10. **Colour must not inherit the height grid.** One particle per half-metre
    cell meant one colour sample per half metre while the orthophoto's source is
    8 cm. That single fact is why the renderer was rewritten around textures.

11. **The orthophoto occupies a narrow low slice** — 56 to 196 of 255 on the
    opening window — and must be stretched, per place rather than per tile, or
    adjacent tiles disagree about what grey is. Stretch **luminance and carry the
    chroma**: per channel, a shadow at (60,70,85) comes out (7,27,55) and the
    square goes blue.

12. **Point size comes from the projection**, not a constant — the on-screen size
    of one cell at that distance, times a grain factor below 1. A constant is
    wrong at every distance but the one it was tuned at.

13. **A surface model has no walls and no canopy.** Facades collect nothing
    because they are a discontinuity between two cells, and a tree is one opaque
    number. Cells on a sharp drop are spent down the face; cells that look like
    vegetation are spread through the crown. Vegetation is found by **curvature,
    not slope**, so a pitched roof stays the plane it is.

## What is left, in order

1. **README entry.** The sketch is missing from the `## Sketches` list. Draft
   text is in `docs/superpowers/plans/2026-08-09-elsewhere.md`, Task 11, but it
   predates the texture rewrite — it still says 147,456 particles and describes a
   vertex buffer. Rewrite around: no vertex buffer, colour freed from geometry,
   the compression finding, the transition.

2. **Vectorheart colour mode.** Agreed as a fourth mode on `c`, not started.
   Ortho camera at 45°, heights snapped to bands so buildings read as flat
   stepped plates, square points rather than round, a tight flat palette, the
   photograph dropped. All of it is shader work plus an ortho projection in
   `matrices()`; nothing else needs to move.

3. **Shared modules.** See below.

4. **Failure paths.** A bad address and a dead coverage service both leave the
   place standing and explain themselves, but neither is covered by a test yet.
   The design document lists the cases.

## Shared modules

The rule in the repo README is that `shared/` holds code used by **more than one
sketch**. `kernels.glsl` earned it by being proven in two hosts. Two candidates
qualify today and one is about to.

**`shared/pdok.js` — earned now, two consumers.** `sketches/2026-08-elsewhere/pdok.js`
and `scripts/bake-place.js` both hard-code the same three endpoints and both
implement the same `centroide_rd` parser. This has already cost a double edit:
adding `geotiff:compression=None` had to be done in both, and a miss there is a
silent 55-second decode. The module is already Node-safe — `geocode` takes its
fetch as an argument and `cachedFetch` degrades without a cache — so the move is
mechanical. `bake-place.js` keeps its `--compress` flag and its CLI.

**`shared/geotiff.js` — reasonable now.** A general float32 GeoTIFF reader with
no coupling to this sketch, already imported by both the sketch and `test.mjs`.

**`shared/audio.js` and `shared/beat.js` — earned the moment `elsewhere` becomes
audio-reactive, which is the agreed next consumer.** The seam is already clean:

- `sketches/2026-08-hendriklaan/beat.js` is the pattern model and sequencer —
  `STEPS`, `LANES`, `NOTES`, `DEFAULT`, `clone`, `sequence`, `same`, `changes`,
  `encode`, `decode` — plus `mountEditor`, which is DOM and styled by
  hendriklaan's CSS. The model and sequencer are generic; the editor is not.
- `class Listener` in `sketches/2026-08-hendriklaan/sketch.js` (around lines
  327–514) is the engine: three sources (field / tone / mic), the FFT band
  reader, the per-band AGC, and the synth. It depends on `sequence` from
  beat.js and on nothing else in that sketch.

So: move `Listener` to `shared/audio.js` and the pattern model plus `sequence`
to `shared/beat.js`; leave `mountEditor` in hendriklaan until something else
wants an editor. hendriklaan keeps its class→band mapping, `elsewhere` writes
its own — bands to height, grain and canopy. **The engine emits four numbers in
0..1 and decides nothing about what they mean.** That is the whole interface,
and having two consumers is what proves it.

Two cautions. `Listener` was rewritten by a second session after the original
audio work, so read it before moving it — it is no longer the code the
hendriklaan commits describe. And the per-band AGC exists because a room mic and
a synth bus are nowhere near each other in level; without it the built-in bank
pinned every band above 0.79 and the street stopped answering the music. Do not
simplify it away.

## Running it

```bash
npx vite --port 5179 --strictPort        # dev server
npm test                                 # the whole suite, ~10 min under load
npm run thumbs                           # regenerate thumbnails, then commit them
PUBLISH_HOST=nixos make publish          # build + rsync to sketches.siem2l.nl
node scripts/bake-place.js "<address>" --span 480 --size 480 --slug <name>
```

`npm test` drives a real browser and has no name filter. Iterate with a scratch
Playwright script at the repo root — it only resolves there — and delete it
before committing.

Every fps and timing number measured in this session came from **headless
Chromium on SwiftShader**, which is software rendering. 4–6 fps, and an 11 s
gather whose three requests take 0.3–0.5 s each, are floors and not what a real
GPU does. Measure on hardware before optimising against them.

## Test suite state

Four `elsewhere` browser tests and fifteen Node-side tests, all passing at the
time of writing, plus the jump regression test.

Three tests were failing that are **not** this sketch's and were not investigated
here:

- `an unavailable source explains itself and changes nothing` — the `edge`
  sketch, untouched since before this work began, waits on a webcam that never
  arrives in headless.
- `the pattern reaches the geometry, not just the page` — `hendriklaan`, the
  second session's beat editor.
- splinter's physics tests appeared and disappeared across runs.

All three look like contention — several Playwright browsers were running on
this machine at once, and these tests wait fixed timeouts for things to settle.
That is an inference, not a measurement. Confirm on a quiet machine before
concluding anything, and in particular before refactoring hendriklaan's audio
out from under a test that may genuinely be failing.
