# elsewhere — as a desktop

Point Plash at it, pick the virtual device your music is already going through,
and the square answers whatever is playing on the laptop.

`sketches/2026-08-elsewhere`, on top of `172aa27`.

## What Spotify cannot do, and why it does not matter

The obvious idea is the Spotify Web API, and it is a dead end. Spotify
discontinued `GET /audio-analysis` and `GET /audio-features` on 27 November
2024; only apps holding a quota extension from before that date still reach
them, everything newer gets a 403, and there is no replacement. Those were
exactly the endpoints that would have carried beats, tempo and loudness.

What survives is the player endpoint — track, artist, progress — which is a
caption, not a reaction. Out of scope.

The route that works needs no account at all. macOS will not hand system audio
to a browser on its own, but a virtual audio device will: BlackHole, free and
open source, plus a Multi-Output Device in Audio MIDI Setup so sound reaches the
speakers *and* the loopback. The `mic` mode this sketch already has then picks up
exactly what is playing, clean, with no room in it. Spotify, Apple Music, a
browser tab, anything.

So the work is not "integrate Spotify". It is "be usable with no interface, be
cheap enough to leave open, and let the input device be chosen".

## Three parts

### `?bare`, and the URL as the whole interface

A wallpaper has no one to click it, so everything the panel does has to be
sayable in the address bar.

| param | effect |
| --- | --- |
| `bare` | hides the back link, the panel, the readout and the hint |
| `listen=off\|field\|tone\|mic` | the source to start on |
| `input=<text>` | the audio input whose label contains this, case-insensitive |

`blueprint` set the `?bare` convention when it landed and this follows it: a
`body.bare` class, styled in the sketch's own CSS. The `h` key stops writing
inline `display` on three elements and toggles that same class instead, so
hiding is one mechanism rather than two that can disagree.

Matching the device by label substring rather than by `deviceId` is deliberate.
A device id is an opaque per-origin string that a browser may rotate; `BlackHole`
is a thing a person can type and will still be right next month.

The wallpaper URL ends up:

```
https://sketches.siem2l.nl/sketches/2026-08-elsewhere/?bare&listen=mic&input=BlackHole
```

### An idle throttle

At rest with the audio off, the rest-state test pins consecutive frames as
byte-identical — the sketch is drawing 230,400 points sixty times a second to
produce the same image. On a desktop that runs all day that is the whole cost
and none of the value.

So when nothing can be changing, the frame loop drops to 5 fps. Something can be
changing when audio is on, when a jump is in the air, when tiles are still
arriving, or within two seconds of any input — a pointer, a key, a control, a
wheel. Everything else idles.

**Not zero, and the reason is the drawing buffer.** With `preserveDrawingBuffer`
false, which is the default and what `savePNG` is already written around, the
buffer is undefined after compositing; a canvas that stops drawing entirely is
free to come back blank, which on a wallpaper is a black screen rather than a
saving. Five frames a second keeps it alive and still removes about 92% of the
work. Going to a true zero means turning `preserveDrawingBuffer` on and paying a
copy on every active frame instead — a worse trade for a sketch that is
interactive most of the time it is being watched.

Waking is done by one capturing listener on the document rather than a call in
each handler. A missed `wake()` reads as a frozen page, and the failure mode of
forgetting one is far worse than the cost of waking on a pointer move that
turned out not to matter.

### An input picker

`Listener.setMode(mode, deviceId)` passes the id through to `getUserMedia`, and
`Listener.inputs()` lists the audio inputs. Labels are empty until permission
has been granted, so the picker fills in after the first `mic` selection, not
before — which is a browser rule, not a choice.

## The risk worth naming

Plash is a WKWebView, and whether it grants `getUserMedia` at all is untested.
If it refuses, the mic route works in a browser window and not in the wallpaper,
and this whole approach needs rethinking.

Rather than a throwaway probe page, the answer is built in: `?bare` still shows
the note line, and `Listener` already falls back to `field` with
`no microphone — staying on the built-in field` when access is refused. Pointing
Plash at the URL therefore reports the answer itself, in the corner, on the
first try.

## Testing

- the three URL params each do what they say, and `?bare` hides all four chrome
  elements while leaving the note visible
- `h` and `?bare` drive the same class, so the two cannot disagree
- an unknown `input=` substring falls back to the default device rather than
  failing to open the microphone at all
- with audio off and no input, the frame counter stops climbing at the idle
  rate; a pointer move takes it back to full rate; audio on holds it there
- the existing rest-state and touch guarantees still hold, which the throttle
  must not disturb: a frame that is drawn is drawn identically

## Out of scope

A now-playing caption. The Spotify player endpoint would give one, and it is a
separate component with its own OAuth; it has nothing to do with making the
square move.
