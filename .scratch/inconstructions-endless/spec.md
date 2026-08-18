# inconstructions — endless generation

Status: ready-for-agent
Slug: 2026-07-inconstructions (extends `.scratch/inconstructions-generator/spec.md`)

## Problem Statement

The generator produces a composition and then stops. Every control is a verb
you press once: ROLL, GROW, STEP. The piece is a machine for making objects,
and each object is finished the moment it appears.

Two things are missing, and they are not the same thing:

1. **Nothing changes on its own.** A visitor who does not touch the panel sees a
   still image. GROW already accretes parts one at a time under the typing
   rules — the mechanism for a living structure exists, but nothing drives it.
2. **The volume is 12 x 12 x 10 and that is the whole world.** Every
   composition is an object on a plinth. There is no way to express something
   that keeps going.

## Solution

Two modes, mutually exclusive, each answering "endless" differently.

**FLUX** — the bounded volume, alive. Growth runs continuously and the oldest
grown parts erode away, so the structure churns at roughly constant mass
forever. The plinth, the frame and the poster reading all survive intact.

**TOWER** — the volume becomes a shaft with no ceiling. The camera rises at a
constant crawl and modules of eight levels generate ahead of it, each picking
its own template, so the tower changes character as it climbs. Below the camera
the tower is pruned away; above it, it does not exist yet.

The pipeline does not change. The five passes were already pure functions over
a coordinate window, which is the property that makes a module cheap: `compose`
becomes `composeRange(z0, z1, below)` and the bounded sandbox is the special
case `composeRange(0, NZ, null)`.

## User Stories

### FLUX

1. As a visitor, I want a mode where the structure keeps changing without my
   touching anything, so that the page is alive rather than a still image.
2. As a visitor, I want the churn to hold a roughly constant mass, so that it
   neither fills the volume solid nor erodes to nothing.
3. As a visitor, I want erosion to take the oldest parts first, so that the
   change reads as a slow conveyor rather than as random flicker.
4. As a visitor, I want the structure to stay standing while it churns, so that
   erosion never leaves parts floating.
5. As a visitor, I want to switch flux off and keep whatever it left, so that I
   can stop on a composition I like and then edit or export it.
6. As a visitor, I want a whole flux session to cost one undo, so that minutes
   of churn do not bury my history.

### TOWER

7. As a visitor, I want a mode where the structure keeps going upward, so that
   the piece can express something unbounded.
8. As a visitor, I want the camera to rise on its own, so that the tower
   reveals itself without my driving it.
9. As a visitor, I want to scrub the altitude with the wheel and have the climb
   pause while I do, so that I can stop and look at a section.
10. As a visitor, I want each module to pick its own template, so that the tower
    changes character as it rises instead of extruding one shape forever.
11. As a visitor, I want the noise to run continuously through the whole tower,
    so that the mass does not visibly restart at every seam.
12. As a visitor, I want every module joined to the one below it, so that the
    tower is a single structure and not a stack of floating slabs.
13. As a visitor, I want the altitude and module count shown, so that the climb
    has a readable statistic attached to it.
14. As a visitor, I want the tower to be a pure function of its seed, so that
    the printed seed still reproduces what I saw.
15. As a visitor, I want the frame rate to hold while it climbs, so that the
    piece does not degrade the longer it runs.
16. As a builder, I want to place and delete parts in the tower, so that the
    mode is still the same tool.
17. As a visitor, I want one undo to leave the tower and restore what was there
    before it, so that entering the mode is not a one-way door.

## Implementation Decisions

**`compose` becomes `composeRange(z0, z1, below, mi)`.** All five passes already
read only local neighbourhoods, with one exception — the support flood-fill —
so a module is the same code over a z-window plus a boundary condition. `below`
is a predicate answering "is there mass at this cell in the module underneath",
consulted by the support pass and by typing across the seam. `null` means the
window sits on the ground. The bounded sandbox calls
`composeRange(0, NZ, null)` and is otherwise unchanged.

**Templates measure against `span`, not `NZ`.** Their vertical features — the
tower's setback tiers, SLABS' three-level decks, SPINE's height cap — are
expressed relative to the height of the window being composed, so they tile per
module instead of being stretched or truncated by it.

**Noise is sampled at absolute z with one seed for the whole tower; the RNG is
re-seeded per module.** Continuity comes from the noise field, variety from the
per-module template pick and stochastic passes. Seeding the noise per module
would put a visible discontinuity at every seam; sharing the RNG across modules
would make the tower's composition depend on how far you had scrolled, which
would break reproducibility from the seed.

**Module 0 uses the panel's template; every module above it picks its own.**
The control still means something — it chooses the base — and the tower stops
being one extruded shape.

**Two invariants make the tower endless rather than usually-endless.** A module
that fails to connect to the one below it would break the chain permanently, so
each module gets a *stitch* (mass is forced at the seam above an occupied cell
below, giving the support flood a seed) and a *cap* (a column is forced up to
the module's top layer if nothing else reaches it, so the next module always has
something to stitch to). With both, every live cell is connected to the lowest
live layer, and that is the property the tests assert.

**Below the camera the tower is pruned by whole modules.** Live cells stay at
roughly five modules' worth, which keeps the per-frame face build the same size
it is today — this is what avoids needing a render cache. Pruning whole modules
rather than a sliding z-cut preserves the connectivity invariant, since the new
bottom layer is a module's own bottom layer. Wheel scrubbing clamps to the live
window; the pruned tower is gone, not regenerated.

**Faces are culled to a z-window around the camera.** `rebuild` skips cells
outside it, so the visible set — and therefore the sort, the face list and the
ID buffer — stay the size they are in the bounded sandbox.

**The ID buffer is throttled while climbing.** `renderIds` ends in
`loadPixels()`, a full-canvas readback; today it runs only when the scene
changes, which during a continuous climb is every frame. In TOWER mode it
refreshes at most eight times a second. Hover precision during a slow climb is
worth less than the frame rate.

**FLUX erodes from a queue, and checks before it cuts.** Grown cells go onto a
queue; erosion takes from the front, skipping any cell that is not currently
exposed. A candidate is only removed if the structure is still fully connected
without it — the check is a flood-fill over a few hundred cells, which is
cheap enough to run per eviction and is the only thing that reliably prevents
erosion from orphaning a cantilever.

**Neither mode records per-step operations.** Turning a mode on snapshots the
world; turning it off records one `load` op. Same pattern as a slider drag.
Entering TOWER is itself that snapshot, so one undo exits the mode and restores
the composition that preceded it.

**The two modes are mutually exclusive.** They are two answers to the same
question and the combination — churn inside a climbing shaft — has no coherent
reading and would defeat the pruning invariant.

## Testing Decisions

Same seam and same rules: real clicks and keys, assertions against
`window.__inconstructions`, which gains `flux`, `tower`, `altitude` and
`modules`. `grounded` generalizes from "connected to z = 0" to "connected to the
lowest live layer", which is the same assertion in the bounded case.

**What to cover:** flux changes the structure over time; flux holds mass within
a band rather than growing without bound; flux keeps everything connected; a
whole flux session is one undo. Tower generates modules and gains altitude; the
tower reaches above the bounded ceiling, which is the proof it is unbounded;
every module is connected to the one below; the live cell count stays bounded
while the altitude keeps climbing, which is the proof pruning works; the wheel
scrubs and pauses the climb; one undo leaves the mode; the two modes cannot both
be on.

**Deliberately not covered:** frame rate. It is the reason for the culling, the
pruning and the ID throttle, but asserting it from Playwright measures the CI
machine rather than the sketch. Measured by hand during implementation instead,
and the cell-count bound is the proxy that can be asserted.

## Out of Scope

- **Regenerating pruned modules on the way back down.** Modules are pure
  functions of `(seed, index, below)` so it is possible, but `below` chains all
  the way to the ground and the wheel clamp is a one-line answer to the same
  problem.
- **Endless in x and y.** Chunk streaming in two axes, camera panning, and the
  loss of the plinth — that is a different sketch, not a mode of this one.
- **A rise-rate control.** The wheel pauses and scrubs; a speed slider would be
  a fifth thing in a panel that is already full.
- **Persisting or sharing a tower.** Unchanged: the seed in the exported PNG is
  the only thing that leaves.
- **FLUX and TOWER at the same time.**
