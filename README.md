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

## Vectorheart house rules

Sketches in the Vectorheart idiom (`splinter`, `inconstructions`) share
`sketches/_lib/` — type, panel controls, keys, PNG export, the test probe and
the page chrome. The template starts from it. A directory under `sketches/`
whose name begins with `_` is not a sketch and needs no `meta.json`.

- **`(g, k)` first.** Every drawing function takes the graphics target and the
  scale factor. `k` is 1 on screen and 3 in a PNG export; that single convention
  is what makes export a re-render rather than an upscale. Never read a
  module-level scale inside a shared function.
- **Colour is data.** The library defines none. Each sketch passes a
  `{ ink, paper, accent, onAccent, muted }` theme in — a constant if its palette
  is fixed, a function of the active palette if not.
- **Reserved keys.** `s` PNG, `z` undo, `y` redo, `c` clear, space new, `?` help.
  Everything else is yours. `keymap()` throws if you take one for something else.
  It checks the canonical verb, not the printed one: inconstructions binds NEW to
  space and prints it as ROLL.
- **The library never owns the draw loop.** Sketches differ too much — one
  redraws every frame off a dirty flag, another parks in `noLoop()`. Primitives
  and plumbing are shared; control flow is not.
- **The probe is read-only.** `probe(name, fields, layer)` exposes what the
  interface already shows. Tests click and type like a person, and find controls
  with `buttonAt(label)` rather than by hardcoding a pixel.
- **Reproducibility is a feature.** If a composition has a seed, print it and
  accept it back through `?seed=`.

`npm run pixels` is the guard on all of it: it captures both sketches at a fixed
viewport and settle point and byte-compares against a baseline in `.pixels/`
(uncommitted — a baseline belongs to one Chromium build on one machine).
`npm run pixels -- --update` takes a new one.

## Serving

The site is served by the `sketchbook` module in apis-mellifera
(`modules/services/web/sketchbook.nix`): nginx on loopback :8088,
exposed as `sketches.siem2l.nl` via the gateway, no auth. One-time
activation: `make deploy-nixos` in apis-mellifera. After that,
publishing never touches nix — `/var/lib/sketchbook` is group-writable
for the `sketchbook` group.

## Sketches

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
  assembly sandbox with a generator bolted to it. Interlocking axonometric parts
  snap to a bounded lattice, which makes occlusion a depth sort rather than a
  z-buffer; picking reads a pixel from an offscreen ID buffer. Colour belongs to
  the part type, so there is no colour picker. SPACE rolls a composition: five
  passes over the lattice — field, support, typing, ribbon, trim — where the
  massing pass crossfades an authored template field with domain-warped perlin.
  MIX is that crossfade as one slider, so the same control runs from "the
  template exactly" to "noise decided everything". The GENERATOR panel holds the
  template, seed, MIX/DENSITY/GRAIN/ACCENT/TRIM, symmetry and legs; dragging a
  slider regenerates live from the same seed, and the whole drag is one undo.
  `g` grows the structure you already have under the same rules, `t`/`m` cycle
  template and symmetry, `p` hides the panel. Two endless modes: `f` FLUX keeps
  the bounded volume alive, growing and eroding at roughly constant mass, and
  `w` TOWER removes the ceiling — modules of eight levels generate ahead of a
  camera that rises at a crawl, each picking its own template, pruned behind so
  the live set stays the size the sandbox's is. The wheel scrubs the altitude
  and pauses the climb. Nothing is saved; the 3x PNG export prints the seed and
  parameters that reproduce it.

- **message noise** (`2026-07-message-noise`) — a hidden message is
  hashed (cyrb128) into noise/random seeds and terrain parameters; the
  map animates over 3D noise, spacebar freezes it, and the on-screen
  `t` value plus the message reproduce any frame exactly. Contour mode
  and 3x PNG export for tattoo/print reference. The message is never
  stored, sent, or rendered.
