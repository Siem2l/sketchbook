# elsewhere — touch

Give the cursor weight. Sweeping it across the square kicks a furrow through the
particles that closes behind you; clicking drops an invisible weight that dents
the surface and rebounds out.

`sketches/2026-08-elsewhere`, on top of `ae87c9d`.

## The constraint that shapes everything

Two properties of the sketch are not negotiable, and both of them make this
design better rather than harder.

**Nothing is written per particle, ever.** A particle is its `gl_VertexID`;
where it stands, how high, what colour and which way it faces are all functions
of that index, a handful of uniforms and two texture arrays. So touch cannot be
a simulation with state per particle. It has to be a pure function of world
position, evaluated in the vertex shader — which it can be, because a wake and a
dent are both radial fields around a point.

**At rest the square is the survey, not an animation of it.** `test.mjs:2063`
screenshots the canvas twice a second apart and asserts the bytes are equal.
Every displacement in the sketch already multiplies through a term that is
exactly zero when nothing is happening — that is why `uAudio` exists as a
separate switch from the band values.

That rules out a static repulsion bubble parked under a resting cursor, and
points somewhere better: drive the effect from pointer *motion* and *events*,
both of which genuinely reach zero. The wake decays to exactly zero at the end
of its life; a weight lands on exactly zero at the end of its rebound. Touch
ends up covered by the invariant rather than an exception to it.

## What the gestures are

Press-drag already orbits and the wheel already dollies. The two gestures
actually free are hover and click-without-drag, and they map onto the two
effects without a single rebinding:

| gesture | effect |
| --- | --- |
| move the pointer over the canvas | a wake — particles lift and flee, then settle |
| press and release under 5 px of travel | a weight lands, dents, rebounds, flattens |
| press and drag | orbit, unchanged |
| wheel | dolly, unchanged |

## No switch

Touch is always on and has no toggle.

The `inferred` row — walls, canopy, tone, sun — is four claims the sketch makes
about *the data*, each switchable so the inference can be seen rather than taken
on trust. Touch is not a claim about the data; it is a claim about you, and it
is exactly zero whenever you are not touching. A switch that turns off something
already at zero turns off nothing, for the same reason drag-orbits-the-camera
has no switch.

`#meta` gains one line saying so.

## Anchoring

The wake and the weights live in **RD world coordinates**, not screen space. A
furrow you cut stays with the ground and slides out of frame as you WASD away.
The alternative — anchoring in scene space so the effect follows the window —
would mean the cursor touches the picture rather than the place, and this sketch
has been consistent from the start that the frame is stationary and the country
moves through it.

## Screen to ground

`matrices()` already builds the camera basis (`eye`, and the orthonormal `x`,
`y`, `z`). It will also return that basis so the pointer can build a ray
directly rather than inverting a projection matrix:

```
dir = normalize(nx·tan(fov/2)·aspect·x + ny·tan(fov/2)·y − z)
```

then intersect the plane `y = 0` in scene space and add `uCentre` for RD. The
ground is a plane at the datum, not the height field — the heights only exist in
a texture, and the parallax error on a roof is a couple of metres at this
framing, well inside the radius of either effect.

Pointing at or above the horizon misses. Pitch clamps at 0.06 so the camera is
always above the plane, but the top of the screen still looks past it, and a ray
with `dir.y ≥ −1e-4` produces no hit and therefore no touch.

## The wake

A ring of 12 samples. A sample is pushed on `pointermove` over the canvas when
the ray hits and at least 0.6 m of ground has passed since the last one — so a
pointer that jitters without travelling never fills the ring, and the spacing is
in metres of ground rather than pixels of screen, which keeps the furrow the
same shape at every dolly distance.

Each sample packs to a `vec4`: world x, world z, birth time, strength. Strength
comes from how fast the pointer was travelling across the ground at that moment,
normalised and clamped, so a slow drift barely ripples and a fast swipe cuts
deep. Speed is the expressive control and there is nothing to configure.

Per particle, per live sample:

- **radially**, a falloff over 7 m, reaching zero at the edge
- **temporally**, an envelope that kicks fast and settles slowly over 0.8 s,
  hitting exactly 0 at the end of life
- **jittered** by the same `hash1` the canopy and audio terms already use, so
  the disturbance is a scatter of particles rather than a smooth dome

The displacement is a lift of ~2.2 m plus a radial push of ~1.8 m. The lift is
what makes it visible: pure lateral sliding on a flat street reads as almost
nothing from an orbiting camera, and lift alone reads as a bulge rather than as
something getting out of the way.

**The push is applied to `p`, after the texture lookup, not to `w` before it.**
A displaced particle carries its own roof colour and its own measured height
sideways, instead of resampling whatever ground it flew over. That is the jump's
rule inverted: there a particle keeps its ground and changes what it stands on;
here it keeps what it stands on and changes its ground.

An expired sample has strength exactly `0.0`, so its whole contribution is
exactly `0.0`. `pointerleave` clears the ring outright.

## The weights

A ring of 8, recycled oldest-first, packed the same way. Fired on `pointerup`
when the total pointer travel since `pointerdown` is under 5 px — a click and
not an orbit drag, which is unambiguous and costs the existing drag nothing.

**Radially**: a dent inside 9 m with a rim bulge just outside it. The bulge is
what makes it read as displaced material rather than a hole punched through the
city.

**Temporally**: full depth on impact, then a damped oscillating rebound, the
whole thing multiplied by `(1 − τ)` so it lands on exactly zero at 1.6 s rather
than approaching it.

The weight itself is not drawn. You see only what it does to the field. The
square's frame is the only non-particle geometry in the sketch and adding a
second exception to draw a ball would cost more than it buys — the dent is the
event.

## Where the code goes

| file | change |
| --- | --- |
| `touch.js` | **new.** The trail, the weights, the packing. No GL, no DOM. |
| `shaders.js` | `uWake[12]`, `uWeights[8]`, a `touchOf()` returning a `vec3` offset |
| `field.js` | two names in the uniform list |
| `sketch.js` | camera basis out of `matrices()`, pointer wiring, uniform uploads, `__elsewhere.touch()` |
| `index.html` | one line in `#meta`, one clause in `#hint` |
| `test.mjs` | unit tests for `touch.js`, behaviour tests in the elsewhere block |

`touch.js` takes numbers and returns `Float32Array`s, so it is testable in node
the way `slots.js` and `place.js` already are. Every tuning constant sits in one
block at its top.

Pointer listeners go on `canvas` only, so interacting with the control panel —
which overlaps the canvas at the bottom — cannot seed the trail.

## Cost

20 extra loop iterations per vertex, against the 26 that `findLayer` already
runs twice per vertex over 230,400 vertices. A dead entry is skipped on a
strength test before any distance maths. Nothing new is uploaded per frame
except two small uniform arrays.

## Testing

**Unit, in node:**

- a sample older than its life packs to strength 0
- a pointer that does not travel adds no samples
- weights recycle oldest-first once the ring is full
- with everything expired, every packed strength is exactly 0

**Behaviour, in the browser:**

- sweeping the mouse across the canvas moves `coverage()` measurably
- **and then**: a canvas screenshot taken before the sweep is byte-identical to
  one taken after both lifetimes have elapsed. This is the point of the whole
  design — it extends the rest-state guarantee to cover touch instead of
  weakening it.
- a click drops exactly one weight; a 40 px drag drops none and orbits instead
- the existing rest-state test at `test.mjs:2063` still passes unchanged

## Starting numbers

Trail 12 samples, 0.8 s life, 0.6 m spacing, 7 m radius, 2.2 m lift, 1.8 m push,
full strength at a brisk swipe. Weights 8, 1.6 s life, 9 m radius, 3.5 m depth.
All of them will move once there is something to look at.

## Out of scope

A drawn object. Permanent craters — a dent that never relaxes would mean a
settled square is no longer the survey, which is the one thing this sketch will
not trade. Touch on a phone: `touch-action: none` already routes touch through
the same pointer events, and a tap will drop a weight, but nothing here is
designed for it.
