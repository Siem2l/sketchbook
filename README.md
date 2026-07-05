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

- **message noise** (`2026-07-message-noise`) — a hidden message is
  hashed (cyrb128) into noise/random seeds and terrain parameters; the
  map animates over 3D noise, spacebar freezes it, and the on-screen
  `t` value plus the message reproduce any frame exactly. Contour mode
  and 3x PNG export for tattoo/print reference. The message is never
  stored, sent, or rendered.
