# inconstructions — Vectorheart assembly sandbox

Status: ready-for-agent
Slug: 2026-07-inconstructions

## Problem Statement

The sketchbook has three sketches, all of them 2D and all of them things you
*watch*. Two are generative (perlin terrain, festival timelines), one is a data
visualisation. None of them are things you *operate*.

Separately, there's an aesthetic the author keeps returning to and has nowhere
to put: **Vectorheart** — the late-90s/early-2000s Designers Republic and Bionic
Systems language of flat vector shapes, hard 45°/60° diagonals, tight
high-contrast palettes, and dense fake technical furniture. Its two canonical
readings, both supplied as references, are an exploded diagonal assembly of
extruded parts in red/black/off-white, and a snapped isometric interlock of
grey and yellow blocks captioned *INCONSTRUCTIONS / DELTA INC*.

There is no obvious way to get from "I like this look" to something on
sketches.siem2l.nl. Vectorheart is a *graphic design* language, not an
algorithm — you can't seed it from noise. It has to be built, part by part,
which means the sketch has to be a tool. The sketchbook has never contained a
tool, and its conventions (one folder, one `sketch.js`, no dependencies beyond
p5, no tests) were not written with one in mind.

## Solution

A single-page sandbox where you assemble interlocking axonometric structures
from a fixed kit of parts, on a bounded lattice, in a Vectorheart idiom.

It opens by building a seeded structure in front of you, part by part, then
hands you the controls. You click a face of anything already placed and a new
part attaches to it. Parts snap to integer cells; colour is a property of the
part type, not a choice you make; the camera snaps between four isometric
corners. Around all of it sits an interface that is simultaneously the tool's
real controls and the artwork's graphic furniture — part legend, live
coordinate readout, part count, camera bearing, corner registration marks, a
fake unit code.

Nothing is saved. Refresh and it's gone. The building is the point; the only
thing that leaves is a PNG.

## User Stories

### Arriving

1. As a gallery visitor, I want the sketch to show me something the moment it
   loads, so that I don't face an empty void with no idea what it is.
2. As a gallery visitor, I want to watch a structure assemble itself part by
   part, so that I learn the vocabulary of the toy without reading instructions.
3. As a gallery visitor, I want the opening assembly to finish in a few seconds,
   so that I'm not made to wait before I can touch anything.
4. As a visitor who already knows the sketch, I want any interaction to skip the
   opening animation straight to its finished state, so that I'm never held
   hostage by an animation I've seen.
5. As the sketchbook maintainer, I want the gallery thumbnail to catch the
   opening assembly mid-build, so that the tile reads as a machine being made
   rather than a static object.
6. As a gallery visitor, I want the same seeded structure every time I load,
   so that the sketch has a recognisable identity rather than a random roll.

### Building

7. As a builder, I want to hover over the structure and see exactly which face
   my cursor is on, so that I know where a part will land before I commit.
8. As a builder, I want to click a highlighted face and have the active part
   attach to it, so that placement is one gesture with no dialogue.
9. As a builder, I want parts to snap to integer cells, so that everything I
   make interlocks cleanly without my having to align anything.
10. As a builder, I want to place the first part onto the ground plane, so that
    I can start from nothing after clearing.
11. As a builder, I want to choose which of the kit's shapes is active, so that
    I can compose with the full vocabulary rather than one primitive.
12. As a builder, I want to rotate the active part before placing it, so that
    elbows, wedges and slots can face the direction the structure needs.
13. As a builder, I want to see the active part and its rotation rendered
    somewhere persistent, so that I always know what a click will produce.
14. As a builder, I want a delete mode that removes the part under the cursor,
    so that I can correct a structure without starting over.
15. As a builder, I want placement and deletion to be modes I can see, so that
    I'm never unsure which one a click will trigger.
16. As a builder, I want to be prevented from placing a part into an occupied
    cell, so that the lattice never holds two things at once.
17. As a builder, I want a bounded build volume with visible edges, so that my
    composition is framed like an object on a plinth rather than adrift.
18. As a builder, I want to be prevented from placing parts outside that volume,
    so that the frame is a real constraint and the camera stays sane.

### Undoing and clearing

19. As a builder, I want to undo my last action, so that a misclick during fast
    building isn't permanent.
20. As a builder, I want undo to cover both placements and deletions, so that
    the whole history is reversible, not half of it.
21. As a builder, I want to redo what I undid, so that overshooting the undo
    stack isn't itself a loss.
22. As a builder, I want to clear the lattice to empty, so that I can start a
    composition from nothing.
23. As a builder, I want to restore the seeded opening structure, so that I can
    get back to the known-good starting point after experimenting.

### Looking

24. As a builder, I want to rotate the camera a quarter-turn at a time, so that
    I can work on faces that are currently pointing away from me.
25. As a builder, I want every camera angle to be one of four fixed isometric
    corners, so that the composition never drifts into a generic 3D viewport.
26. As a builder, I want the quarter-turn to animate rather than cut, so that I
    keep my bearings and don't lose track of which side I'm on.
27. As a builder, I want the current camera bearing displayed, so that I can
    reason about direction while placing directional parts.
28. As a builder, I want parts nearer the camera to correctly cover parts behind
    them, so that the structure reads as solid rather than as overlapping
    transparencies.

### The interface as artwork

29. As a builder, I want the interface itself to be in the Vectorheart idiom, so
    that the tool and the thing it makes are the same piece of design.
30. As a builder, I want a parts legend showing every shape and its colour, so
    that the palette reads as a catalogue rather than a toolbar.
31. As a builder, I want the coordinates of the cell under my cursor displayed
    live, so that the interface feels instrumented like the reference material.
32. As a builder, I want a running count of placed parts, so that the structure
    has a readable statistic attached to it.
33. As a builder, I want hairline rules, corner registration marks and a fake
    unit code framing the view, so that the page reads as a technical document.
34. As a gallery visitor, I want the interface to be legible and uncluttered, so
    that it reads as designed rather than as a debug overlay.

### Leaving with something

35. As a builder, I want to export the current view as a high-resolution PNG, so
    that a structure I liked can outlive the page.
36. As a builder, I want the exported PNG to include the interface furniture, so
    that the image is the whole composition and not a bare render.
37. As a builder, I want the export resolution to be higher than the screen, so
    that the result stands up to printing, matching the existing 3× export.

### On a phone

38. As a phone visitor, I want the sketch to load and the opening assembly to
    play, so that I get the piece even if I never build anything.
39. As a phone visitor, I want a tap to place a part, so that the toy is
    actually usable and not desktop-only.
40. As a phone visitor, I want on-screen controls for camera rotation, part
    selection and place/delete mode, so that I'm not dependent on a keyboard.
41. As a phone visitor, I want the interface to stay legible on a narrow screen,
    so that the readouts don't collapse into overlap.

### Publishing

42. As the sketchbook maintainer, I want the sketch to follow the existing
    folder convention, so that the gallery index picks it up with no special
    casing.
43. As the sketchbook maintainer, I want the sketch registered with the
    thumbnail generator, so that its gallery tile isn't blank.
44. As the sketchbook maintainer, I want the sketch to build with the existing
    Vite multi-page setup and no new runtime dependency, so that publishing
    stays a single unchanged command.

## Implementation Decisions

**Rendering is hand-rolled 2D, not a 3D engine.** Points project
axonometrically to the 2D canvas and faces draw as flat filled polygons with a
hairline stroke. p5 remains the only runtime dependency; p5's WEBGL mode is not
used. The reasoning: flat unlit fills, crisp consistent outlines and text are
what this aesthetic is made of, and they are precisely what 3D engines make
awkward. Nothing in the piece needs lighting, perspective, materials or a
depth buffer.

**Visibility is a sort, not a buffer.** Because every part occupies an
axis-aligned cell on a lattice, drawing cells in order of a signed sum of their
coordinates is provably correct occlusion under any orthographic view. The
signs flip to match the current camera corner. This eliminates per-face depth
sorting and interpenetration artifacts — the failure mode that usually sinks
hand-rolled 3D — and it is the reason the lattice constraint exists. Free
placement or arbitrary rotation would invalidate it and is out of scope.

**Picking is an ID buffer, not a raycast.** A second offscreen render fills each
face with a colour encoding its part and face identity; the pixel under the
cursor is read back to identify the hovered face. This is exact, independent of
part geometry, costs no maths per part shape, and continues to work for any
part added later. The ID pass must render at the same transform as the visible
pass.

**The world is a bounded integer lattice**, roughly 24 × 24 × 16, with drawn
edges. Occupancy is one part per cell. Out-of-bounds and occupied-cell
placements are rejected rather than clamped.

**Parts are a fixed kit of roughly six or seven shapes**, each placeable in four
rotations about the vertical axis: cube, half-slab, wedge, quarter-round elbow,
tube segment, slotted plate, post. Each part is defined as a small set of quads
in unit-cell space. The kit is deliberately closed — the interlocking quality of
the reference material comes from a constrained vocabulary, not from an
open-ended modelling capability.

**Colour is a property of the part type, not of the instance.** Structural
blocks grey, ribbon and elbow parts the hot accent, plates off-white, posts
near-black, on a warm paper field with near-black hairline outlines — matching
both reference images, which are print-light rather than screen-dark. This
makes the sketch the only light one in the gallery, which is correct: the
aesthetic is print design, not a screen glow. There is no colour picker and no per-cell
colour state. This reproduces the reference imagery directly — where the yellow
is a *run of particular parts* through grey structure — and makes every build
automatically coherent. Each part's three face tones (top and two sides) derive
mechanically from its single base colour.

**Placement is face attachment.** The hovered face determines the neighbouring
cell that a click fills. A visible place/delete mode toggle governs what a click
does; this replaces right-click deletion, which does not exist on touch, and
makes the current behaviour legible on desktop too.

**The camera has four discrete states**, the isometric corners, moved between by
an animated quarter-turn. Input direction mapping and the occlusion sort key are
both derived from the current corner. There is no free orbit, no zoom, no pan.

**Undo is an operation log.** Each place and delete appends an invertible
record; undo and redo walk that log. A new operation after an undo truncates the
redo tail. Clear is itself an operation, so it is undoable.

**The interface is diegetic.** The controls the tool genuinely requires — parts
legend with active shape marked, active rotation, place/delete mode, camera
bearing, hovered cell coordinates, part count — *are* the graphic furniture,
set on a hairline grid with rules, corner registration marks and a fake unit
code. There is no separate decorative layer drawn around a functional UI. The
interface must remain legible at roughly 390 px wide.

**The opening state is a seeded replay.** A fixed list of placement operations
replays on a timer over roughly four seconds, then control passes to the user.
Any input skips to the final state immediately. The structure is identical on
every load. This solves three problems at once: the blank first impression, the
absence of instructions, and the thumbnail — the existing generator screenshots
2.5 seconds after load, landing mid-assembly.

**Nothing persists.** No URL fragment, no JSON export, no localStorage, no
server. The PNG export is the only artifact that leaves the page, rendered
offscreen at 3× including the interface, matching the existing export in the
message-noise sketch.

**The sketch stays a single sketch file** in one folder alongside `index.html`
and `meta.json`, matching every existing sketch. This is a larger sketch than
its predecessors and the temptation to split it into modules should be resisted
unless it genuinely stops being navigable; Vite would permit it, but no other
sketch does it. No new runtime dependency is introduced.

**The thumbnail generator hardcodes its list of sketch slugs** and must be
updated, or the gallery tile will be blank.

## Testing Decisions

**One seam: the rendered page, driven by Playwright.** Playwright is already a
devDependency — it generates the thumbnails — so this adds no new dependency.
Tests load the sketch, drive real clicks, taps and key presses, and assert
against what the page displays.

**Good tests here assert external behaviour only.** They must not import
internal functions, inspect module state, or assert on pixel values, all of
which would couple them to implementation and break on every visual iteration.

**Correction, found during implementation.** The original plan was to read the
HUD readouts directly as the test oracle. That does not survive contact: the HUD
is drawn on the canvas, so there is no DOM for a test to query and no way to
read it as text. The resolution is a single read-only accessor on `window`
exposing exactly what the HUD already displays — part count, hovered cell, ghost
target, bearing, mode, active part, rotation, whether the opening assembly has
finished, and the undo/redo depths. It exposes no way to drive the sketch, so
tests still act only through real clicks, taps and key presses. This is a
deliberate, documented seam rather than a hole in the encapsulation.

**What to cover:** the opening assembly completes and yields control; an
interaction skips it; clicking a face increments the part count; deleting
decrements it; undo and redo return the count and structure to prior states;
clear empties the lattice and is itself undoable; camera rotation cycles four
bearings and returns to the start after four turns; placement outside the bounds
or into an occupied cell is refused and the count does not change; the HUD
coordinate readout tracks the cursor; the interface remains legible and
non-overlapping at a narrow viewport; PNG export produces a download.

**Deliberately not covered:** occlusion correctness. The sort is correct by
construction given the lattice constraint, and asserting it from outside would
require pixel comparison, which is flaky and would fight every visual change.
This is an accepted gap, not an oversight.

**Prior art:** there is none — this is the first test in the repository. The
closest existing code is the thumbnail generator, which already establishes the
launch-Chromium, load-the-sketch-URL, wait, act pattern that these tests extend.
A test script needs adding to the package manifest, and the tests should run
against the local dev server rather than the published site.

## Out of Scope

- **Persistence of any kind.** No URL-hash scenes, no JSON import or export, no
  localStorage, no sharing a structure with anyone. This was considered and
  explicitly declined in favour of a purely ephemeral toy.
- **Free placement and arbitrary rotation.** The exploded-assembly reference
  image cannot be reproduced by this tool. Off-lattice placement would
  invalidate the occlusion sort and require solving interpenetrating per-face
  depth sorting.
- **Exploded-diagram annotation.** Leader lines from parts out to floating
  labels were considered and deferred; label layout that avoids collisions is a
  hard problem and clutters quickly.
- **Generating publishable sketches.** The builder does not emit sketch folders,
  code, or anything the gallery can host.
- **Per-instance colour.** No colour picker, no recolouring placed parts.
- **Free camera orbit, zoom and pan.**
- **Sound.**
- **A reusable 3D template for future sketches.** If a second 3D sketch later
  wants these bones, extracting them is a separate piece of work; nothing here
  should be generalised speculatively.
- **Touch optimisation beyond working.** Taps and on-screen controls must
  function and the interface must stay legible narrow, but the interaction is
  not designed thumb-first.

## Further Notes

**The risk is the typography, not the geometry.** Every technically hard part of
this has been designed out: the lattice makes occlusion a sort, the ID buffer
makes picking a pixel read, the closed part kit bounds the geometry work.
Whether the result reads as Designers Republic or as a debug overlay comes down
to type choice, spacing, weight and restraint in the interface layer — the one
part that cannot be derisked by planning and will only be settled by looking at
it against the reference images. Build the lattice, parts, picking and camera
first; then iterate the chrome with the references open.

**Size.** Existing sketches run 270–440 lines. This is realistically 600–900,
because a tool carries interface and input state that generative sketches do
not. That is expected, not a signal that something has gone wrong.

**Vectorheart is flat.** It is easy to drift toward glowing wireframe, neon, or
phosphor vector-display looks, which are a different aesthetic entirely. The
reference is flat fills, hard edges, high contrast, and a tight palette. If it
starts to glow, it has gone wrong.

**Colour note.** The accent in the second reference is essentially gruvbox
`#fabd2f`, which is already the accent used across the author's other projects.
Using it here is consistent rather than coincidental.

**References:** the aesthetic is documented at
`aesthetics.fandom.com/wiki/Vectorheart` and `cari.institute/aesthetics/vectorheart`.
The two source images supplied during the design conversation — an exploded
red/black assembly captioned *MC-202*, and an isometric grey/yellow interlock
captioned *INCONSTRUCTIONS / DELTA INC* — are the visual contract. The sketch
takes its name from the second.
