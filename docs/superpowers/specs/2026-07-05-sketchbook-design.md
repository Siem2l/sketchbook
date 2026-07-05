# Sketchbook — Creative Coding Playground

**Date:** 2026-07-05
**Status:** Approved

## Purpose

A low-ceremony creative-coding playground (perlin noise, generative art,
data-flow visualizations) where each sketch is a self-contained folder,
tinkering happens with hot reload, and publishing to a public gallery site
on the homelab takes seconds.

## Decisions made

- **Publishing model:** auto-generated gallery site listing every sketch.
- **Tooling:** Vite + vanilla JS, hot reload; p5.js as default library,
  sketches free to use three.js/d3/plain canvas via npm.
- **Hosting:** self-hosted on the homelab, exposed through the existing
  apis-mellifera Traefik gateway (`services.apis-mellifera.expose`).
- **Publish flow:** quick rsync of built static files — no nix rebuild per
  sketch. Nix only serves the directory.

## Repo layout (`~/projects/sketchbook`)

```
sketchbook/
  package.json           # vite + p5
  vite.config.js         # multi-page build: one entry per sketch
  index.html             # gallery shell
  scripts/build-index.js # scans sketches/, emits gallery data at build time
  sketches/
    _template/           # copied by `make new`
      index.html
      sketch.js
      meta.json          # { title, date, tags, description }
    <date>-<name>/       # one folder per sketch, self-contained
  Makefile               # make new NAME=..., make dev, make publish
```

### Components

- **Sketch folder:** owns its page (`index.html`) and code (`sketch.js`).
  `meta.json` is the only contract with the gallery: title, date, tags,
  description, optional thumbnail path. Thumbnails are manual/optional in
  v1 (automated screenshots are a possible later addition).
- **Gallery index:** `scripts/build-index.js` scans `sketches/*/meta.json`
  (skipping `_template`) and generates the data the gallery `index.html`
  renders. Runs as part of `vite build` and dev.
- **Vite config:** discovers sketch folders and registers each as a
  multi-page entry so every sketch builds to its own static page.
- **Makefile targets:**
  - `make new NAME=foo` — copy `_template` to `sketches/YYYY-MM-foo/`.
  - `make dev` — vite dev server with hot reload.
  - `make publish` — `vite build` then
    `rsync --delete dist/ <homelab>:/var/lib/sketchbook/` using the
    existing SSH identity/host-alias routing in `~/.ssh/config`.

## First sketch: message-noise (tattoo study)

A top-down perlin noise map driven by a hidden message:

- A text input (kept out of the URL and the rendered output) is hashed
  (cyrb128) into seeds for `noiseSeed`/`randomSeed` — the same message
  always reproduces the same visual world; the message itself is
  unrecoverable from the output.
- The field animates naturally (3D noise, time as the z-axis).
- Spacebar/button freezes/resumes the animation; a frozen frame is
  deterministic given (message, elapsed time shown on screen) so a
  chosen frame can be found again.
- Render modes: filled topographic color map and a black-and-white
  contour/threshold mode suitable for tattoo linework.
- High-resolution PNG export of the current frame.

## Nix side (apis-mellifera repo)

One module `modules/services/web/sketchbook.nix`:

- Static file server for `/var/lib/sketchbook` (match the idiom of the
  repo's existing static web services — nginx or Caddy, whichever they
  use; pick a free port respecting the eval-time port-conflict checks).
- Registers with `services.apis-mellifera.expose` so the Traefik gateway
  auto-creates the `sketches.<domain>` vhost with Let's Encrypt TLS.
  Public, no forward-auth.
- `/var/lib/sketchbook` created via tmpfiles, group-writable by a group
  that the rsync-ing user belongs to, so publish needs no sudo.
- Activation is a one-time `make deploy-nixos` by the user; subsequent
  publishes never touch nix.

## Data flow

Tinker (`make dev`, hot reload) → `make publish` → static files land in
`/var/lib/sketchbook` → served by the vhost → Traefik → public URL.

## Error handling

- `build-index.js` fails the build with a clear message on malformed or
  missing `meta.json` fields (title and date required).
- `make publish` aborts if the build fails; rsync uses `--delete` so the
  served site always mirrors the last successful build exactly.

## Testing

- v1 verification is manual: `make dev` renders the gallery and template
  sketch; `make publish` followed by fetching the public URL returns the
  new sketch. No test framework for sketches themselves — they're art.
- The nix module is covered by the flake's existing eval-time checks
  (port conflicts, ingress validation).

## Out of scope (future phases)

- **Blog:** prose can grow out of sketch descriptions; a fuller blog
  (e.g. Astro) is a separate later design.
- **Data-driven sketches:** fetching Prometheus/Loki homelab metrics into
  sketches needs a read-only query proxy (or Authentik-gated pages) —
  separate design when phase 3 starts.
- Automated thumbnail capture, RSS feed, GIF/video export tooling.
