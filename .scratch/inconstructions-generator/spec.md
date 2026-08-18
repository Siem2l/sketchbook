# inconstructions — the generator and its dashboard

Status: ready-for-agent
Slug: 2026-07-inconstructions (extends `.scratch/inconstructions/spec.md`)

## Problem Statement

`2026-07-inconstructions` is a tool with exactly one composition in it. The
opening replay builds the same seeded structure on every load — deliberately,
so the sketch has an identity and the thumbnail catches a machine being made —
and after that the lattice only ever holds what a visitor placed by hand, one
click at a time. A visitor who is not in the mood to build gets a static object.

The parent spec closed the door on generation for a reason: *"Vectorheart is a
graphic design language, not an algorithm — you can't seed it from noise."*
That is true of the *whole* language, and false of the part this sketch models.
The kit is closed, the lattice is bounded, colour is a property of part type,
and occlusion is a sort. Everything a generator would have to get right about
the look is already a constraint of the world. What noise alone cannot supply
is *massing* — the tiered, interlocked, deliberately-composed silhouette that
makes the reference read as designed rather than as a heightmap.

So the interesting question is not "template or noise" but where the seam
between them sits, and whether that seam can be a control the visitor holds.

## Solution

A generator built as a **pipeline of five passes over the lattice**, with a
single crossfade — MIX — running between an authored template field and a
perlin field at the massing stage. At MIX 0 the composition is the template's
geometry exactly; at MIX 1 the template is gone and noise decides everything;
in between, noise erodes and encrusts an authored form. Every later pass —
support, part typing, accent ribbons, trim — reads the resulting occupancy and
is common to all templates, so a new template is a single scalar field
function, not a new generator.

Around it sits a **generator panel**: the template cycler, the seed, four
sliders, symmetry, and the ROLL / STEP / GROW actions, drawn in the same
Vectorheart idiom as the rest of the interface. Dragging a slider regenerates
live from the *same seed*, which turns the panel from a form into an
instrument: you hold a composition still and watch one parameter move it.

Determinism is total. Seed plus the printed parameter line reproduces a
composition exactly, and both are printed into the exported PNG — the same
contract the message-noise sketch already makes.

## User Stories

### Rolling a composition

1. As a visitor, I want to press one control and get a complete structure, so
   that I get something worth looking at without building it myself.
2. As a visitor, I want each roll to be visibly different from the last, so
   that the generator reads as a generator and not as one shape with jitter.
3. As a visitor, I want the structure to assemble part by part rather than
   appear, so that a roll has the same character as the opening replay.
4. As a visitor, I want to interrupt that assembly and have it finish
   immediately, so that I am never waiting on an animation.
5. As a visitor, I want a whole generated composition to disappear on one undo,
   so that a roll I dislike costs one keystroke rather than two hundred.
6. As a visitor, I want the load-time composition to stay the fixed seeded one,
   so that the sketch keeps its identity and the gallery tile stays stable.

### Steering it

7. As a visitor, I want to choose between named templates, so that I can ask
   for a tower rather than take whatever comes.
8. As a visitor, I want one control that crossfades from the template's
   authored geometry to pure noise, so that I can decide how much of the
   composition is designed and how much is found.
9. As a visitor, I want a density control, so that I can move between a sparse
   frame and a solid mass without changing anything else.
10. As a visitor, I want a grain control over the noise scale, so that the
    same seed reads as boulders or as gravel.
11. As a visitor, I want an accent control governing how much of the hot yellow
    ribbon runs across the structure, so that the palette balance is mine.
12. As a visitor, I want a trim control over how much of the exposed surface
    becomes slabs, plates and ramps rather than raw blocks, so that I can move
    between rough massing and a detailed machine.
13. As a visitor, I want symmetry modes, so that a composition can read as
    architecture rather than as an accident.
14. As a visitor, I want dragging a slider to regenerate from the same seed,
    so that I see that one parameter's effect and not a different roll.
15. As a visitor, I want a whole slider drag to cost one undo, so that
    exploring a parameter does not bury my history.
16. As a visitor, I want the seed shown, so that a composition I like has a
    name.

### Letting it take over

17. As a builder, I want to grow the structure I built by hand, so that the
    generator extends my composition instead of replacing it.
18. As a builder, I want a single-step growth control, so that I can watch the
    rule apply one part at a time and stop when I like it.
19. As a builder, I want generated parts to obey the same kit, colours and
    lattice as hand-placed ones, so that a mixed composition is indistinguishable
    from either pure one.
20. As a builder, I want to hand-edit a generated structure, so that generation
    is a starting point rather than a finished product.

### Structural coherence

21. As a visitor, I want generated structures to be connected to the ground,
    so that they read as objects rather than as floating debris.
22. As a visitor, I want overhangs to be carried by visible posts, so that
    cantilevers look supported rather than accidental.
23. As a visitor, I want the accent ribbon to run along the surface as a
    continuous line with proper corners, so that it reads as the ribbon in the
    reference rather than as scattered yellow cells.
24. As a visitor, I want step edges to be finished with ramps and exposed tops
    with plates, so that the structure has a skin and not just a shape.

### The dashboard

25. As a visitor, I want the generator controls in one panel in the sketch's
    own idiom, so that the tool and the artwork stay the same piece of design.
26. As a visitor, I want to hide the panel, so that the composition can be seen
    without it.
27. As a visitor, I want clicks and drags inside the panel to never place or
    delete a part, so that operating the dashboard cannot damage the build.
28. As a phone visitor, I want the panel to remain usable and legible at
    390 px wide, so that the generator is not desktop-only.
29. As a visitor, I want every panel control to have a keyboard equivalent, so
    that rolling and growing is fast on a desktop.

### Leaving with something

30. As a visitor, I want the exported PNG to print the seed and the parameters,
    so that a composition I liked can be reproduced exactly.
31. As a visitor, I want the exported PNG to omit the dashboard, so that the
    poster is the composition and its furniture, not the instrument.

## Implementation Decisions

**The generator is five passes, in order.** Each reads the previous pass's
output and nothing else, so the whole thing is a pure function of
`(seed, params)`:

1. **Field → mass.** For every cell, `s = lerp(template(x,y,z), noise(x,y,z),
   MIX)`; occupy where `s > threshold(DENSITY)`. Symmetry is applied by folding
   coordinates *before* sampling, not by mirroring the result, so the fold is
   free and cannot produce doubled cells.
2. **Support.** Flood-fill 6-connectivity from the ground layer. Components
   that reach the ground stay. Floaters either get a POST column dropped to the
   nearest support below (LEGS on) or are deleted (LEGS off). This is what
   turns an isosurface into a building.
3. **Typing.** Each occupied cell picks a part from its 6-neighbourhood:
   exposed tops become SLAB or PLATE at a rate set by TRIM, lone columns
   become POST, everything else is BLOCK. Empty cells that sit one step below
   an exposed top become RAMP facing the higher mass, which is the only pass
   that *adds* cells after massing.
4. **Ribbon.** One to three accent walks over the surface, biased to continue
   straight, placing TUBE along runs and ELBOW at corners. A ribbon lives in the
   cell directly above the surface and never climbs, so a run reads as a level
   line rather than a staircase — but it may bridge a drop for up to two cells,
   because the reference is full of ribbons crossing voids. A bridge left
   hanging off the end of a run is trimmed back.
5. **Trim.** Perimeter apron plates at ground level and corner posts on the
   composition's bounding box, both gated by TRIM.

**Templates are scalar fields, not builders.** A template is
`(x, y, z, ctx) => number in [0,1]` — TOWER (stepped setbacks, Chebyshev
radius so it stays square in iso), TERRACE (concentric plateaus), GANTRY
(orthogonal beam lanes with legs at the intersections), SLABS (stacked decks
with voids punched through), SPINE (a diagonal backbone with arms). Adding a
sixth is one function and one name in a list. Everything about how the result
looks as *parts* lives in passes 2–5 and is shared.

**MIX is the whole architecture, exposed as one slider.** "Templates" and
"random generation takes over" are not two modes to switch between; they are
the ends of one control. This is the decision the rest of the design hangs
off: it is why templates must be fields rather than op-emitters, since only
fields can be crossfaded.

**Noise is p5's perlin, domain-warped, with a vertical bias.** Two octaves of
warp, as in the message-noise sketch, then a `1 - 0.55·z/NZ` bias so mass
thins with height, and a soft falloff near the volume walls so compositions do
not clip the plinth. `noiseSeed`/`randomSeed` are set from the composition
seed, so noise and the RNG advance together.

**Generation emits an op list; the sketch replays it.** The existing opening
replay generalizes: any op list can be animated over a duration, and any
interaction finishes it immediately. Ops are ordered by height, then by
distance from the centre, with ribbons last — so a roll assembles bottom-up
and the yellow lands as the finishing move.

**A generation is one undo entry.** The passes build into a scratch map;
completion records a single `load` op holding the previous and next worlds.
Slider drags regenerate without recording, and record one `load` op on release,
so a drag from 0.2 to 0.8 costs one undo rather than sixty.

**Live regeneration keeps the seed.** Every parameter change re-runs the
pipeline for the *current* seed. Only ROLL draws a new one. A full pipeline
over 12×12×10 cells is roughly a millisecond, so this runs inside a drag.

**GROW is accretion under the same typing rules.** It picks a surface cell
weighted by noise, adds a free neighbour, and types it with pass 3's rules.
It reads whatever is in the lattice — hand-built or generated — which is what
makes "let it take over" literal rather than a metaphor. STEP is one iteration.

**The dashboard is a right-hand column** below the existing readouts on
desktop, and a full-width overlay above the control strip on narrow screens,
toggled by a GEN button and the `p` key. It introduces two new primitives to
the HUD: a slider row that reports drags, and a declared panel region that
swallows clicks and drags so the instrument can never edit the lattice. The
hit list gains a `drag` handler and the sketch gains `mouseDragged` /
`mouseReleased` / `touchMoved`; there is currently no drag interaction at all.

**The export prints parameters instead of the panel.** The PNG keeps the title
block, readouts, legend and registration marks — the parent spec's "interface
is the artwork" rule — and replaces the dashboard with a single printed line:
template, seed in hex, and the four parameters. Same reproducibility contract
as message-noise, same printed-parameter-line idiom as splinter.

**The load-time composition does not change.** The fixed demo replay stays
exactly as it is. Rolling is explicit, so the gallery tile, the thumbnail
timing and the existing behaviour tests are untouched.

**Nothing new persists.** The seed lives in memory and in the exported PNG.
No URL fragment, no localStorage — the parent spec's ephemerality holds.

**It stays one file.** `sketch.js` grows from 804 lines to about 1520 — the
same order as splinter, which is 1190. The
Vectorheart shared library is approved but unimplemented; when it lands, the
slider and panel-region primitives added here are obvious candidates for
`_lib/panel.js`, and this spec should not pre-empt that refactor by inventing
a private module layout first.

## Testing Decisions

Same seam as before: Playwright against the rendered page, driving real clicks
and keys, asserting on the existing read-only `window.__inconstructions`
accessor. The accessor gains `seed`, `template`, `params`, `symmetry`,
`panelOpen`, `generating`, `grounded`, and `signature` — a cheap hash of the
lattice contents — and still exposes no way to *drive* the sketch.

`signature` is what makes determinism testable from outside without a setter:
raise a slider, lower it back, and the signature must return to its previous
value, because the seed never moved.

**What to cover:** rolling produces a connected non-empty structure; two rolls
differ; a roll is one undo entry and undo restores exactly the prior signature;
raising density raises the part count; a parameter round-trip restores the
signature; cycling templates changes the structure; GROW increases the count
without clearing what was there; STEP adds exactly one part; panel clicks and
drags never change the part count; the panel stays inside a 390 px viewport;
the opening composition is still the fixed one and still mid-build at the
thumbnail moment.

**Deliberately not covered:** that generated structures look good. There is no
oracle for that. The closest proxy — every cell is ground-connected — *is*
covered, because it is the one structural property the passes actually promise.

## Out of Scope

- **Persisting or sharing a seed.** No URL fragment, no gallery of seeds. The
  PNG carries the seed as printed text and that is the whole story.
- **Generating anything the existing kit cannot express.** No new parts.
- **A general grammar or L-system.** Considered and declined: the five-pass
  pipeline is legible and directly steerable, and a grammar's expressive gain
  would be spent on rules nobody can see the effect of.
- **Curated seeds.** No hand-picked list of good compositions shipped with the
  sketch.
- **Animating the parameters over time.** The dashboard is an instrument you
  play, not a timeline.
- **Generation on load.** Explicitly declined — the fixed opening composition
  is a parent-spec commitment and the thumbnail depends on it.
- **Making the generator reusable across sketches.** If splinter later wants
  a field-and-passes generator, extracting it is separate work.

## Further Notes

**The failure mode is mush.** A pure noise threshold over a lattice gives
lumpy caves, which look like a heightmap and not like Delta Inc. Three things
hold that off, and if the result reads badly it is one of them that has
drifted: the template floor under MIX, the support pass (ground-connection is
what makes a silhouette read as a built object), and the ribbon, which is the
single strongest cue that a composition was designed — a continuous yellow
line across grey mass is doing more work than any amount of massing subtlety.

**Tune the defaults, not the range.** The sliders should be wide enough to
break the composition at their ends; the defaults are where the good
compositions live. A slider whose whole range is safe is not telling the
visitor anything.
