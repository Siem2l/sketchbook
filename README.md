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
  assembly sandbox. Interlocking axonometric parts snap to a bounded lattice,
  which makes occlusion a depth sort rather than a z-buffer; picking reads a
  pixel from an offscreen ID buffer. Colour belongs to the part type, so there
  is no colour picker. The page opens by building itself, nothing is saved, and
  the only thing that leaves is a 3x PNG.

- **message noise** (`2026-07-message-noise`) — a hidden message is
  hashed (cyrb128) into noise/random seeds and terrain parameters; the
  map animates over 3D noise, spacebar freezes it, and the on-screen
  `t` value plus the message reproduce any frame exactly. Contour mode
  and 3x PNG export for tattoo/print reference. The message is never
  stored, sent, or rendered.
