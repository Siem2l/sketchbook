# elsewhere — the city, struck

Dropping a weight plays a note, and what it sounds like comes from what it
landed on. The sketch already derives ground, canopy and built from the height
field to decide how sound moves the geometry; this reads that split backwards.

`sketches/2026-08-elsewhere`, on top of the touch work in `1cf9952`.

## The inversion

What is there now:

```
sound → four bands → terrain class → displacement
        (ground answers the sub, canopy the mids,
         roofs and facades the highs)
```

What this adds:

```
click → terrain class → note
```

The same three-way split, read the other way. A click on the road is a low thud,
on a crown a short rustle, on a roof a struck bell — and the height above ground
sets the pitch, so the ground is always in the bass and the roofline always on
top. The city stops being the audience and becomes the instrument.

## Silence stays silent

Audible in `tone` and `mic` only.

`off` means off, and `field` is inaudible by definition — it drives the bands
from the sequencer with no AudioContext at all, which is what lets the page move
on load with no gesture and no permission, and what the thumbnail grabber and
the tests depend on. Neither needs a conditional to enforce: `field` has no
context to play into, and `off` is gated where every other audible thing in the
sketch is gated.

Nothing on this page ever makes a noise nobody asked for.

## Knowing what was hit

The classification lives in the vertex shader because that is where the height
field lives. The CPU has no idea what is under the pointer.

**The thresholds move to `terrain.js` and the shader interpolates them.**
`shaders.js` already builds its source with `${WAKE_N}` from a JS module; the
same trick puts `CANOPY_HAG`, `CANOPY_ROUGH` and `BUILT_DROP` in one place. The
two classifiers cannot share code — one reads texture fetches, the other a
`Float32Array` — but they cannot disagree about the numbers either.

**The grid is a copy the loader already had.** `loadCoarse` computes `surf` and
`terr` before uploading them and then drops them. It now returns them, and one
slot keeps whichever coarse frame is current: the baked opening frame, the
destination's sharp centre at a landing, or the wide frame that catches up
behind it. About 1.8 MB, 1 m resolution, stamped with its own bbox — a query
outside it returns `null` and simply makes no sound.

Deliberately *not* set inside `loadCoarse`: a jump loads the destination before
a single particle moves, and setting the ground there would have the page
playing Rotterdam while it is still drawing Utrecht. The callers set it at the
three moments a frame actually becomes the current place.

Sampling is nearest, not bilinear, for the same reason the height texture is
`NEAREST`: a smoothed height ramps every facade into a slope.

## Which note

`hag / 18` — height above ground over the top of the height ramp — mapped onto
`NOTES` from `beat.js` across two octaves. Fourteen diatonic steps, C3 to B4.

That pool is the one the bass already plays from, so a click is always in the
key of the built-in tune rather than on an arbitrary frequency. It also means
the pitch mapping does a second job for free: ground has `hag ≈ 0` and so is
always in the bass, a roof at twelve metres is always near the top.

`noteFor(fraction)` lives in `shared/audio.js`, next to the thing that plays it,
and knows nothing about metres. `terrain.js` says what is there; `audio.js` says
what it sounds like.

## The voices

`Listener.strike(kind, hz)` builds a one-shot per hit and disposes of it on
`ended`. At most eight can be alive, because at most eight weights can be.

| kind | voice |
| --- | --- |
| ground | sine, `hz` falling to `hz/2` over 0.12 s, 0.4 s decay — a thud |
| canopy | noise through a bandpass at `hz × 8`, 0.18 s — a rustle |
| built | triangle at `hz` with a fifth above it, fast attack, 0.5 s decay — a struck bell |

A new `voice` gain node is created in `ensureCtx()` and feeds both the
destination and the analyser. The second connection is the good part: a hit you
play is heard by the FFT and moves the geometry. Strike the road and the sub
band spikes and the ground heaves under the crater you just made.

## Two bugs in the bus, fixed on the way past

Both are in routing this change rewires anyway.

**The mic monitors itself.** `buildTone()` runs `analyser.connect(destination)`,
and `mic` mode runs `micNode.connect(analyser)` — so going tone → mic sends the
room back out through the room's own speakers, three lines below a comment
saying it deliberately does not. The analyser becomes a pure tap and `out` and
`voice` reach the destination directly. Same sound, no loop.

**Selecting `off` stops the picture but not the sound.** `setAudio('off')`
returns before `setMode` is reached, so `nodes.out.gain` keeps whatever it had
and `drive()` stops being called — leaving the oscillators sustaining the last
envelope they were given. To be confirmed in the browser before it is written
down as fact; if it holds, `off` mutes the bus as well as the bands.

## Testing

**Unit, in node:** a synthetic grid classifies flat ground as ground, tall rough
cells as canopy and a cliff edge as built; `at()` returns `null` outside its own
bbox; every fraction in 0..1 maps to a pitch that is a member of `NOTES` times a
power of two.

**Browser:** a click on the square records one strike with a plausible kind; the
same click with listen `off` records the hit and plays nothing; a strike in
`tone` mode moves the bands, which is the loop through the analyser proving
itself; and selecting `off` after `tone` leaves the bus silent.

The rest-state guarantee is untouched — sound moves no pixels — and the existing
weight test already pins a click returning the canvas to byte-identical.

## Out of scope

The wake making noise. Continuous audio under every mouse move is the unbidden
noise this design just went out of its way to avoid, and it would wear out in
about thirty seconds.
