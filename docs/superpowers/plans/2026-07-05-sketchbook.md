# Sketchbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Vite-based creative-coding sketchbook with an auto-generated gallery, a message-seeded perlin-noise tattoo-study sketch, rsync publishing, and a nix module serving it via the apis-mellifera gateway.

**Architecture:** One folder per sketch under `sketches/`; `scripts/build-index.js` scans `meta.json` files and emits `gallery.json` + the vite multi-page entry list. Publish = `vite build` + rsync to `/var/lib/sketchbook` on the homelab, served by an nginx loopback vhost exposed through Pangolin/Traefik via `mylib.mkExposeOptions` (port 8088, subdomain `sketches`, auth `none`).

**Tech Stack:** Vite 6, p5.js (npm), vanilla JS, GNU make, NixOS module in apis-mellifera.

## Global Constraints

- Sketches are self-contained folders; `meta.json` requires `title` and `date`.
- No build step may write outside `dist/` and generated `gallery-data.json`.
- Nix module follows apis-mellifera idiom: `services.apis-mellifera.sketchbook`, `mylib.mkExposeOptions`, loopback-only bind, port 8088.
- Deploy activation (`make deploy-nixos`) is done by the user, not the agent.

---

### Task 1: Repo scaffold + gallery build

**Files:** Create `package.json`, `vite.config.js`, `index.html`, `styles.css`, `scripts/build-index.js`, `sketches/_template/{index.html,sketch.js,meta.json}`, `Makefile`, `.gitignore`, `README.md`.

**Interfaces:** Produces `scripts/build-index.js` emitting `gallery-data.json` (array of `{slug,title,date,tags,description}` sorted date-desc); vite config exporting multi-page `build.rollupOptions.input` from sketch folders.

- [x] Scaffold files, `npm install`
- [x] Verify: `npm run build` succeeds; `dist/index.html` and `dist/sketches/_template` excluded, gallery lists no sketches yet (template skipped)
- [x] Commit

### Task 2: message-noise sketch

**Files:** Create `sketches/2026-07-message-noise/{index.html,sketch.js,meta.json}`.

**Interfaces:** Consumes template layout. Behavior per spec: cyrb128 hash of message → `noiseSeed`+`randomSeed`; animated 3D noise top-down map; spacebar/button freeze with on-screen time `t`; modes: color topo / B&W contour; hi-res PNG export button (3x). Message input is a plain field, never persisted or put in URL.

- [x] Implement sketch
- [x] Verify: `npm run build` includes the page; `make dev` serves it (curl the page, check p5 bundle referenced)
- [x] Commit

### Task 3: Nix module + host enablement

**Files:** Create `apis-mellifera/modules/services/web/sketchbook.nix`; Modify `apis-mellifera/hosts/nixos/default.nix` (enable block).

**Interfaces:** `services.apis-mellifera.sketchbook.{enable,port(8088),dataDir(/var/lib/sketchbook),publishGroup(sketchbook),expose.*}`; nginx vhost `sketchbook-local` listening 127.0.0.1:8088 with `root = dataDir`, `try_files`; tmpfiles rule creating dataDir `0775 root <group>`; expose defaults subdomain `sketches`, auth `none`.

- [x] Write module + host enable (expose.enable = true, dashboard icon optional)
- [x] Verify: `nix flake check` (or targeted eval of nixosConfigurations.nixos) passes port/ingress validation
- [x] Commit (separate commit in apis-mellifera repo, on a branch — user reviews/deploys)

### Task 4: Publish plumbing + docs

**Files:** Modify `Makefile` (publish target: build + rsync to `/var/lib/sketchbook/` — local copy since we run on the homelab; fallback ssh host var), `README.md` (workflow: new/dev/publish, one-time deploy note).

- [x] Implement + verify `make publish DRY=1` (rsync --dry-run) output sane
- [x] Commit; final self-review vs spec
