# Hendriklaan beat editor

Date: 2026-08-09
Status: approved, not yet implemented

## Problem

`2026-08-hendriklaan` maps a 240 m window of AHN5 LiDAR onto four audio
bands: ground answers the sub and low, canopy the mids, roofs and facades the
highs. The music driving those bands is eighteen lines of arithmetic at
`sketch.js:309-333` and nothing about it can be changed from the page.

The pattern is not stored anywhere. It is *implied by modulo arithmetic*:

```js
kick = env((beat % 2) * BEAT, 0.13)     // "% 2" IS "beats 1 and 3"
bass = env((beat % 1) * BEAT, 0.22) * (0.6 + 0.4 * sin(beat * 0.37))
hat  = env((beat % 0.5) * BEAT, 0.035) * (0.55 + 0.45 * sin(beat * 1.7))
```

There is no array of steps to edit, no note-on events, no state. That is what
makes the sketch cheap — `sequence(t)` is a pure function of the clock, so
freeze is exact and nothing can drift — and it is also what makes the music
fixed. A visitor can change what they are *looking* at (colour, projection,
gain, point size) but not what the street is *answering to*.

The sketch's own thesis is that displacement is a pure function of band
energy, so silence returns every one of the 201,635 points to its surveyed
coordinate exactly. Today that claim is only reachable by dragging gain to
zero, which mutes the mapping rather than the music. An editable pattern makes
it reachable the honest way: empty every lane and the street stops moving
because there is nothing to answer.

## Scope

**In:** an editable 16-step pattern for kick, bass and hat; a four-cell
bass-note row; BPM and swing; a top-right overlay panel that shows the
built-in pattern as ghosts underneath the edited one; URL-hash persistence;
extraction of all of it into `beat.js`.

**Out:** editing the pad (it is a free-running swell on two non-dividing
periods and stepping it would misrepresent it); per-voice synth shaping
(decay, filter cutoff, pitch); remapping which survey class answers which
band; per-cell velocity; patterns longer than one bar of rhythm.

## Architecture

A new module beside the sketch. `sketch.js` is 822 lines; the editor would
add roughly 250, and the pattern, its codec and its UI are a genuinely
separable unit.

**`sketches/2026-08-hendriklaan/beat.js`** exports:

| Export | Responsibility |
| --- | --- |
| `DEFAULT` | the pattern object reproducing today's music exactly |
| `NOTES` | the seven-note pool, C3..B3, with frequencies |
| `sequence(t, beats, pattern)` | replaces `sequence(t)`; same `{kick, bass, pad, hat, note}` contract |
| `encode(p)` / `decode(str)` | pattern to and from the URL hash; `decode` returns `null` on anything malformed |
| `mountEditor(root, opts)` | builds the panel, returns `{ open, close, toggle, isOpen, draw }` |

`sketch.js` keeps rendering, camera, `Listener` and wiring. `Listener` holds a
reference to the live pattern object and passes it to `sequence`.

### The pattern

Three 16-bit masks and a little metadata:

```js
export const DEFAULT = {
  bpm: 96, swing: 0,
  kick: 0x0101,          // steps 0, 8       — beats 1 and 3
  bass: 0x1111,          // steps 0,4,8,12   — every beat
  hat:  0x5555,          // every other 16th — 8ths
  notes: [2, 1, 4, 0],   // indices into NOTES — E3 D3 G3 C3
};
```

Bit `i` is step `i`, so bit 0 is the downbeat. These three constants are
chosen so `sequence(t, beats, DEFAULT)` is indistinguishable from today's
output.

### Generalised step lookup

Today's modulo arithmetic becomes a backward walk to the nearest set bit:

```js
const since = (mask, pos, swing) => {          // pos: float step, 0..16
  if (!mask) return Infinity;
  for (let k = 0; k < 16; k++) {
    const i = (Math.floor(pos) - k + 16) % 16;
    if (!(mask & (1 << i))) continue;
    let d = pos - (i + (i % 2 ? swing : 0));
    if (d < 0) d += 16;
    return d;                                   // in steps; caller scales
  }
  return Infinity;
};
```

An empty lane returns `Infinity`, and `exp(-Infinity / decay)` is `0`, so
clearing a lane genuinely silences it. Clearing all three drops every band to
zero and the cloud sits on its surveyed coordinates. Worst case is 16
iterations across 3 voices per frame.

Swing offsets odd 16ths later, applied in the lookup rather than by warping
the clock, so the playhead stays linear. `pattern.swing` is a **fraction of a
16th, 0 to 0.75**; the hash stores it as an integer percent and the slider
shows percent, so `s=50` means `pattern.swing === 0.5`.

### Clock

`sequence` currently derives `beat = t / BEAT` from absolute time. With BPM on
a live slider that is wrong: dragging 96 to 120 rescales all elapsed history
at once and the playhead teleports mid-bar. `frame()` accumulates a phase
instead:

```js
if (!view.frozen) {
  view.clock += dt;                          // seconds, unchanged
  view.beats += dt * pattern.bpm / 60;       // new, tempo-relative
  audio.update(view.clock, view.beats);
}
```

`sequence(t, beats, pattern)` takes both. `beats` drives kick, bass, hat and
the note cycle. `t` still drives the pad, because its 21.7 s and 58.7 s swells
are deliberately unrelated to the bar and must not stretch with tempo. Freeze
halts both, as it does today.

### What does not change

The `env()` shape; the amplitude wobbles on hat (`sin(beat * 1.7)`) and bass
(`sin(beat * 0.37)`), which are tied to absolute beat count and are what keep
an edited loop from sounding mechanical; the pad; both consumers of
`sequence` (the silent `field` path and the `tone` synth); the four synth
voices and their deliberate band placement; the per-band AGC and asymmetric
smoothing; and the entire shader.

## The panel

Fixed top-right. `#hint` already occupies that corner, so opening the editor
hides it; `#hint` gains one line, `b = beat editor`.

```
┌─ beat ──────────────── × ─┐
│      ▾                    │
│      1 · · · 2 · · · 3 …  │
│ kick ■ · · ■ · · · · □ …  │
│ bass ■ · · · ■ · · · ■ …  │
│ hat  ■ · ■ · ■ · ■ · ■ …  │
│                           │
│ bars [E3][D3][G3][C3]     │
│ pad  ▁▂▄▆█▆▄▂▁  (free)    │
│                           │
│ bpm  ──●───── 96          │
│ swing ●────── 0%          │
│ ■ yours  □ built-in       │
│ [clear] [reset] [link]    │
└───────────────────────────┘
```

**Ghosts.** Every cell picks one of four renderings from `yours & bit` and
`DEFAULT & bit`: solid (kept), solid with accent border (added), hollow
outline (removed), dot (empty in both). `popcount(yours ^ DEFAULT)` summed
across the three lanes, plus note, BPM and swing differences, gives the
changes count. The note row marks changed cells the same way and the BPM
slider carries a tick at 96.

**Interaction.**

- Opening — the `[beat]` button in the bottom `#ui` row, or key `b` — is a
  user gesture, so it calls `audio.setMode('tone')`. You hear what you edit.
  Closing leaves the source where it is.
- Cells toggle on click and drag-paints: pointerdown fixes a paint value from
  the first cell hit, pointermove applies that value to cells crossed.
- Note cells cycle up the seven-note pool on click, down on shift-click.
- The playhead is a caret above the columns driven by `view.beats`, so
  `space` freezes it with everything else.
- `pad` is a read-only level bar, not a lane.
- In `mic` mode the grid dims and the panel reads *the room is driving the
  bands* — the pattern is still there, just not the source.
- Under 720 px the panel is full-width at the top rather than a floating card.
  The existing media query already hides `#meta` and `#hint` at that width.

`clear` empties all three lanes. `reset` restores `DEFAULT` and strips the
hash. `link` copies the URL, falling back to selecting the text with a note if
`navigator.clipboard` is unavailable.

## Persistence

Fixed-width and regex-validatable:

```
#b=010111115555&n=2140&t=96&s=0
   └kick┘└bass┘└hat─┘   E D G C
```

| Field | Format | Range |
| --- | --- | --- |
| `b` | 12 hex chars, kick then bass then hat | `/^[0-9a-f]{12}$/` |
| `n` | 4 digits, indices into `NOTES` | `/^[0-6]{4}$/` |
| `t` | BPM, integer | 40..200 |
| `s` | swing, integer percent | 0..75 |

Any field failing its check rejects the whole hash. `decode` returns `null`,
the page falls back to `DEFAULT`, and `note()` says *unreadable pattern in
that link — showing the built-in one.*

Writes go through `history.replaceState` debounced 250 ms, so editing does not
fill the back stack. **When the pattern equals `DEFAULT` the hash is stripped
entirely**, which keeps the canonical URL clean and guarantees the thumbnail
grabber and the existing tests never see one. A hash present on load restores
the pattern and opens the panel showing it.

## Test surface

`window.__hendriklaan` gains `pattern()`, `setPattern(p)`, `editorOpen()` and
`toggleEditor()`, alongside the existing probes.

Tests are added to the `hendriklaan` block in `test.mjs`, which already denies
the microphone on purpose:

1. No hash — `pattern()` deep-equals `DEFAULT`, and `location.hash` stays
   empty after the panel is opened and closed untouched.
2. Round-trip — toggling a cell writes a hash that `decode` returns to the
   identical object.
3. Restore — loading a crafted `#b=…` yields that pattern and opens the panel.
4. **The one that matters.** Clear the kick lane, advance 3 s of clock, assert
   `bands()[0] < 0.02` while `bands()[3] > 0.1`. This proves the grid reaches
   the geometry rather than only the DOM.
5. Silence — clear all three lanes, all four bands fall under 0.02, and
   `coverage()` stays non-zero: the cloud is sitting on its surveyed
   coordinates, not gone.
6. Malformed — `#b=zzzz&n=99` gives `DEFAULT`, no page error, and the note
   text mentions the fallback.
7. The eight existing hendriklaan assertions keep passing unchanged.

Error handling elsewhere is thin by design. The editor is DOM and integers;
its only failure modes are a bad hash and a missing clipboard, both covered.

## Prose

`sketch.js` carries essayistic comments recording why each decision went the
way it did — the 55 Hz and 110 Hz bass attempts that pinned the sub band, the
pad filter sweep that the FFT could actually see, simplex over Perlin on a
street grid. `beat.js` matches that voice. The header explains why the pattern
is masks rather than events, why the pad has no lane, and why the wobbles stay
tied to absolute beat count instead of becoming per-cell velocity.

`meta.json` gains no new tags; the description gains a clause about the beat
being editable. The `#hint` block and the README sketch list are updated.
