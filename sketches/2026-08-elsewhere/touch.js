// The cursor, as two small rings of numbers.
//
// Nothing about this is per particle, because nothing in this sketch is. A wake
// and a dent are both radial fields around a point, so both can be a pure
// function of world position evaluated in the vertex shader, and all the CPU
// has to keep is where the pointer has been and where it has landed.
//
// The property worth protecting is the one the rest-state test pins: a settled
// square is the survey bit for bit, not an animation of it. So an expired entry
// is not merely small, it is zeroed outright — strength exactly 0.0, which the
// shader multiplies through to exactly no displacement. That is the same
// discipline uAudio keeps, and it is why touch needs no switch: a square nobody
// is touching is already untouched.
//
// Both rings are anchored in RD, not in the drawn square. A furrow you cut
// stays with the ground and slides out of frame as you WASD away, and a landing
// puts the old place 49 km from every sample, so a jump cleans up after itself
// with no bookkeeping at all.

export const WAKE_N = 28;      // pointer positions kept
export const WEIGHT_N = 8;     // weights that can be relaxing at once

// Every number that decides how touch feels, in one place.
//
// The scale is set by the framing, and the framing is fixed: a 240 m square
// across most of the screen puts a metre at roughly four pixels. The first pass
// of these numbers was sized as if a person were standing in the street — a 7 m
// furrow and a 3 m dent — and neither was visible at all. What reads here is
// weather, not footsteps.
//
// Spacing matters more than it looks. At 0.6 m the ring recycled every few
// centimetres of travel, so a sweep right across the country left a dot: what
// survived was only the last few samples. Spacing near a third of the radius is
// what makes consecutive samples overlap into one continuous furrow.
const WAKE_LIFE = 0.9;         // s, and an entry is dead exactly here
const WAKE_R = 20.0;           // m, radius of the furrow
const WAKE_LIFT = 8.0;         // m per sample, before the envelope and the overlap
const WAKE_PUSH = 4.0;         // m per sample, radially outward, same caveats
const SPACING = 5.0;           // m of ground between samples — 28 of them is a 140 m trail
const SPEED_FULL = 1800;       // px/s of pointer travel for full strength
const MIN_S = 0.15;            // a slow drift still ripples, barely
const SMOOTH = 0.45;           // new speed's share, so one stuttered frame is not a gouge
const GAP = 0.2;               // s; a longer pause starts a fresh stroke
const TELEPORT = 200;          // m; further than that in one event is not a stroke at all

const WEIGHT_LIFE = 1.8;       // s of dent and rebound
const WEIGHT_R = 22.0;         // m to the rim
const WEIGHT_DEPTH = 20.0;     // m at the deepest point of the impact
const WEIGHT_RIM = 0.85;       // how much of that depth the rim throws back up

export function createTouch() {
  const wake = new Float32Array(WAKE_N * 4);       // world x, world z, born, strength
  const weights = new Float32Array(WEIGHT_N * 4);
  const wakeK = new Float32Array([WAKE_LIFE, WAKE_R, WAKE_LIFT, WAKE_PUSH]);
  const weightK = new Float32Array([WEIGHT_LIFE, WEIGHT_R, WEIGHT_DEPTH, WEIGHT_RIM]);

  let wakeAt = 0, weightAt = 0;
  let prev = null;      // the last event, for velocity
  let anchor = null;    // the last sample actually pushed, for spacing
  let speed = 0;        // px/s, smoothed

  // Writing at a rotating index recycles oldest-first on its own, because every
  // entry has the same lifetime. No sorting, no timestamps to compare.
  const write = (arr, at, n, x, z, t, s) => {
    arr[at * 4] = x; arr[at * 4 + 1] = z; arr[at * 4 + 2] = t; arr[at * 4 + 3] = s;
    return (at + 1) % n;
  };

  // Ground metres decide when to drop a sample; screen pixels decide how hard.
  // Spacing in metres keeps the furrow the same shape at every dolly distance,
  // and strength from pixels keeps it about how vigorously you moved rather
  // than about how far away the camera happens to be.
  //
  // Two clocks, because they measure two different things. `t` is a birth
  // stamp and has to sit on the render clock, which advances by a *clamped* dt
  // so a stalled frame cannot fling the sketch forward. `tv` is real elapsed
  // time and is the only honest basis for a velocity. Stamping births off the
  // real clock drifts them permanently ahead of the render clock during slow
  // frames, and a sample whose birth is in the future never expires.
  function move(x, z, px, py, t, tv = t) {
    const t0 = prev ? prev.t : t;
    if (prev) {
      const dt = tv - prev.tv;
      if (dt > 0 && dt < GAP) {
        const v = Math.hypot(px - prev.px, py - prev.py) / Math.max(dt, 0.008);
        speed = speed * (1 - SMOOTH) + v * SMOOTH;
      } else {
        speed = 0;
      }
    }
    prev = { px, py, t, tv };
    // The first event of a stroke has no velocity behind it and no anchor to
    // measure from. It sets both and moves nothing.
    if (!anchor) { anchor = { x, z }; return 0; }
    const dx = x - anchor.x, dz = z - anchor.z;
    const gap = Math.hypot(dx, dz);
    // A landing moves the ground 49 km under a pointer that never went
    // anywhere, and re-entering the canvas from the far edge is much the same.
    // Neither is a stroke, and drawing a furrow across the country to say so
    // would be worse than drawing nothing.
    if (gap > TELEPORT) { anchor = { x, z }; return 0; }
    if (gap < SPACING) return 0;

    // Walk the segment rather than marking its end. A pointer moving at any
    // speed worth noticing covers twenty metres of ground between two events,
    // so one sample per event laid a chain of separate craters with clear air
    // between them — the trail has to follow the path, not the polling rate.
    const n = Math.min(WAKE_N, Math.floor(gap / SPACING));
    const s = MIN_S + (1 - MIN_S) * Math.min(1, speed / SPEED_FULL);
    for (let i = 1; i <= n; i++) {
      const f = (i * SPACING) / gap;
      wakeAt = write(wake, wakeAt, WAKE_N,
        anchor.x + dx * f, anchor.z + dz * f, t0 + (t - t0) * f, s);
    }
    // Advance to the last sample laid, not to the pointer: the remainder is
    // ground that has not been covered yet and belongs to the next segment.
    const done = (n * SPACING) / gap;
    anchor = { x: anchor.x + dx * done, z: anchor.z + dz * done };
    return n;
  }

  function drop(x, z, t) {
    weightAt = write(weights, weightAt, WEIGHT_N, x, z, t, 1);
  }

  // The pointer left the canvas. This ends the stroke; it does not wipe what
  // the stroke already did. Zeroing live samples would snap the furrow shut the
  // instant the cursor crossed an edge, and they reach zero on their own.
  function leave() { prev = null; anchor = null; speed = 0; }

  // Called once a frame, before the upload. An entry past its life is zeroed
  // whole rather than left to tail off, so "nothing is happening" is a value
  // the shader can test and not a small number it has to tolerate.
  function expire(t) {
    for (let i = 0; i < WAKE_N; i++) {
      if (wake[i * 4 + 3] !== 0 && t - wake[i * 4 + 2] >= WAKE_LIFE) wake.fill(0, i * 4, i * 4 + 4);
    }
    for (let i = 0; i < WEIGHT_N; i++) {
      if (weights[i * 4 + 3] !== 0 && t - weights[i * 4 + 2] >= WEIGHT_LIFE) {
        weights.fill(0, i * 4, i * 4 + 4);
      }
    }
  }

  const count = (arr, n) => {
    let c = 0;
    for (let i = 0; i < n; i++) if (arr[i * 4 + 3] !== 0) c++;
    return c;
  };
  const peak = (arr, n) => {
    let m = 0;
    for (let i = 0; i < n; i++) m = Math.max(m, arr[i * 4 + 3]);
    return m;
  };

  return {
    wake, weights, wakeK, weightK,
    move, drop, leave, expire,
    // Strength as well as count, because "something is there" and "it is worth
    // looking at" are different questions and the first one answered yes for a
    // long time while the second was answering no.
    live: () => ({
      wake: count(wake, WAKE_N),
      weights: count(weights, WEIGHT_N),
      peak: peak(wake, WAKE_N),
    }),
  };
}
