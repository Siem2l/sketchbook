// beat — the pattern the street is answering to.
//
// Until this file existed the tune was implied rather than stored. `beat % 2`
// was not a convenient way of expressing "kick on one and three"; it *was*
// "kick on one and three", and there was nothing to hand a click. Making it
// editable means giving the pattern a representation, and the representation
// chosen is three 16-bit masks — one bit per sixteenth, one integer per voice.
//
// Masks rather than note events, for two reasons. The sketch's whole claim is
// that displacement is a pure function of band energy with nothing integrating
// anywhere, so freezing is exact and silence returns all 201,635 points to
// their surveyed coordinates. An event list would have needed a scheduler with
// state, and state is the thing this page is careful not to have. And a mask
// is four hex characters, so a whole pattern fits in a URL without a codec
// worth the name.
//
// The pad has no lane. It is a swell on two periods, 21.7 s and 58.7 s, that do
// not divide into each other or into the bar — that is what keeps the canopy
// finding new shapes instead of looping — and putting it on a sixteenth grid
// would be drawing a control that lies about what the sound does.
//
// The amplitude wobbles on hat and bass stay tied to absolute beat count rather
// than becoming per-cell velocity. Per-cell velocity is more controllable and
// much flatter: every pass through the bar comes out identical, and a
// sixteen-step loop starts to sound like one. sin(beat * 1.7) has a period of
// 3.70 beats against a four-beat bar, so an edited pattern still breathes.

export const STEPS = 16;
export const LANES = ['kick', 'bass', 'hat'];

// One octave, no accidentals. Free pitch entry would want a keyboard and this
// is a four-cell row; a diatonic pool means every click lands somewhere the
// bass can go.
export const NOTES = [
  { name: 'C3', hz: 130.81 },
  { name: 'D3', hz: 146.83 },
  { name: 'E3', hz: 164.81 },
  { name: 'F3', hz: 174.61 },
  { name: 'G3', hz: 196.00 },
  { name: 'A3', hz: 220.00 },
  { name: 'B3', hz: 246.94 },
];

// Bit i is step i, so bit 0 is the downbeat. These three constants are the
// music that was hardcoded here before, written down: 0x0101 is beats one and
// three, 0x1111 is every beat, 0x5555 is every eighth.
export const DEFAULT = Object.freeze({
  bpm: 96,
  swing: 0,                              // fraction of a sixteenth, 0..0.75
  kick: 0x0101,
  bass: 0x1111,
  hat: 0x5555,
  notes: Object.freeze([2, 1, 4, 0]),    // E3 D3 G3 C3
});

export const clone = (p) => ({ ...p, notes: [...p.notes] });

// Time since this lane last fired, in steps.
//
// The obvious implementation walks backwards from the current step and returns
// the first set bit it finds. That is wrong once swing is non-zero: a swung
// step that has not arrived yet reads as a bar old, and shadows an earlier
// step that genuinely did just fire. Scanning all sixteen and taking the
// smallest non-negative distance costs 48 iterations a frame across three
// lanes and cannot get that wrong.
const since = (mask, pos, swing) => {
  let best = Infinity;
  for (let i = 0; i < STEPS; i++) {
    if (!(mask & (1 << i))) continue;
    let d = pos - (i + (i % 2 ? swing : 0));
    if (d < 0) d += STEPS;               // it fired a bar ago, not in the future
    if (d < best) best = d;
  }
  return best;                           // Infinity for an empty lane
};

// `t` is seconds and `beats` is a tempo-relative phase, and they are separate
// arguments on purpose. Deriving beats from t would mean that dragging the
// tempo slider rescales all elapsed history at once and the playhead teleports
// mid-bar. The pad keeps using t, because its swells are deliberately unrelated
// to the bar and should not stretch when the tempo changes.
export function sequence(t, beats, p) {
  const step = 60 / p.bpm / 4;                    // seconds in a sixteenth
  const pos = ((beats % 4) + 4) % 4 * 4;          // step position inside the bar
  const bar = Math.floor(beats / 4);
  // An empty lane gives `since` = Infinity, and exp(-Infinity) is 0, so
  // clearing a lane silences it without a branch.
  const env = (d, decay) => Math.exp(-d * step / decay);

  const kick = env(since(p.kick, pos, p.swing), 0.13);
  const bass = env(since(p.bass, pos, p.swing), 0.22) * (0.6 + 0.4 * Math.sin(beats * 0.37));
  const hat = env(since(p.hat, pos, p.swing), 0.035) * (0.55 + 0.45 * Math.sin(beats * 1.7));
  const pad = 0.16 + 0.34 * (0.5 + 0.5 * Math.sin(t * 0.29))
                   + 0.30 * (0.5 + 0.5 * Math.sin(t * 0.107 + 1.3));

  return { kick, bass, pad, hat, note: NOTES[p.notes[((bar % 4) + 4) % 4]].hz };
}

export const same = (a, b) =>
  a.bpm === b.bpm && a.swing === b.swing &&
  a.kick === b.kick && a.bass === b.bass && a.hat === b.hat &&
  a.notes.every((v, i) => v === b.notes[i]);

const popcount = (n) => { let c = 0; while (n) { n &= n - 1; c++; } return c; };

// How far this pattern has been dragged from the built-in one. Drives the
// readout under the grid; the ghosts show *where*, this shows *how much*.
export const changes = (p) =>
  LANES.reduce((a, k) => a + popcount((p[k] ^ DEFAULT[k]) & 0xffff), 0)
  + p.notes.reduce((a, v, i) => a + (v === DEFAULT.notes[i] ? 0 : 1), 0)
  + (p.bpm === DEFAULT.bpm ? 0 : 1)
  + (p.swing === DEFAULT.swing ? 0 : 1);
