# elsewhere — design

A square of the Netherlands, drawn as particles, that you slide across the
country and can send somewhere else entirely.

`sketches/2026-08-elsewhere`. The existing `2026-08-hendriklaan` is untouched —
it keeps its classified LiDAR and its audio engine, which may become an audio
editor later.

## What it is

A 160 m square window onto real Dutch elevation and aerial imagery, rendered as
a fixed field of particles. WASD slides the window; the frame stays put and the
country scrolls through it. Type an address and the same particles rearrange
into that place, streaming along the true compass bearing. A slider parks the
transition anywhere in between.

Nothing is generated. Every height is AHN, every colour is an orthophoto.

## Data

All four endpoints verified working, CORS-open, no key.

| purpose | endpoint | returns |
| --- | --- | --- |
| geocode | `api.pdok.nl/bzk/locatieserver/search/v3_1/free` | RD (EPSG:28992) x,y |
| surface | `service.pdok.nl/rws/ahn/wcs/v1_0`, `dsm_05m` | float32 GeoTIFF, m NAP |
| ground | same, `dtm_05m` | float32 GeoTIFF, m NAP |
| colour | `service.pdok.nl/hwh/luchtfotorgb/wms/v1_0`, `Actueel_orthoHR` | JPEG |

Measured on a 240 m window: 695 KB + 459 KB + 60 KB = **1.21 MB in ~0.6 s**.

`SCALESIZE=x(n),y(n)` is honoured, so any bbox can be requested at any output
resolution. That is what makes both variable window extents and coarse-first
loading possible.

WMS 1.3.0 with EPSG:28992 takes `bbox=minx,miny,maxx,maxy` — easting first.
Northing-first returns a valid, blank 1.6 KB image rather than an error.

### GeoTIFF decoding, by hand

The rasters are single-band float32, deflate, **floating-point predictor 3**,
striped. Decoding without a dependency, using the platform's own
`DecompressionStream('deflate')`:

1. parse the IFD for width, height, `RowsPerStrip`, `StripOffsets`,
   `StripByteCounts`, `SampleFormat`, `Predictor`, `GDAL_NODATA`
2. inflate each strip
3. per row, accumulate bytes with **stride 1** (not row width)
4. de-interleave the four byte planes **in reverse order**: byte `b` of sample
   `c` comes from plane `3 - b`
5. read little-endian float32

Steps 3 and 4 are where this goes wrong quietly. Getting either wrong yields
plausible-looking numbers — the first attempt produced a 3.4e38 maximum and a
centre cell of exactly 0.00. Verified correct against PDAL's reading of the
same window: 0.36–28.64 m NAP, centre 12.56 m.

NoData is `FLT_MAX` (3.4028234663852886e+38), about 3% of cells over this
window, mostly water. NoData cells take the local ground height and keep their
photographic colour, so water renders as a flat plane that looks like water.

### Height datum

Each place stands on its own median DTM value, not on NAP. NAP is absolute and
the country runs −7 m to +320 m; morphing on absolute height would make the
scene lurch vertically and drown the thing worth watching, which is buildings
and trees changing. The true NAP datum goes in the readout instead.

### Not storing the country

At the measured 21.1 MB/km² over ~41,500 km², the whole Netherlands is about
**876 GB** (DSM 501, DTM 331, ortho 44). Not viable. Dropping to 2 m cells
reaches ~55 GB and loses the buildings, which are the point.

A custom packed format is also not worth it: 8 bytes a cell gzips to 1.65 MB
against 1.21 MB for PDOK's own three files. JPEG and deflate already win.

So: keep PDOK's bytes, and keep only what is visited.

- **Cache API** in front of every fetch, keyed by URL. Repeat visits and
  shader iteration cost no network.
- **One baked place** in the repo as PDOK's own three files under
  `public/data/elsewhere/prins-hendriklaan/` — 1.21 MB, instant first paint, a
  deterministic thumbnail, and a page that survives PDOK being down. The loader
  takes a base URL, so a baked place is not a special case.
- **`scripts/bake-place.js "<address>"`** geocodes, fetches, and writes a
  folder. One command to take any place offline for experimentation.
- Test fixtures are the same places baked at 64×64 via `SCALESIZE`, ~20 KB
  each, so the suite runs offline on real AHN data.

A homelab `proxy_cache` in front of PDOK is deliberately **out of scope for
v1**. It would help repeat visitors and would also add the CORS headers that
would unlock the AHN COPC point clouds, but it is a change to `sketchbook.nix`
in apis-mellifera, and this repo's rule is that publishing never touches nix.

## Architecture

### Two levels of tile

Separating them is what keeps both the network and the GPU writes sane.

- **Fetch tile** — 240 m, the network unit. Three requests, cached by URL.
- **Render tile** — 32×32 cells, the GPU unit, contiguous in the vertex buffer
  so recycling one is a single `bufferSubData`.

A render tile is filled from whichever fetch tile covers it.

### The particle buffer

Allocated once and never resized. 320×320 cells at 0.5 m = **102,400
particles** covering the 160 m square, plus a one-tile margin ring, giving
about 160,000 allocated. Interleaved, 32 bytes:

```
 0  aWorld   vec2  float32   world x,z
 8  aY       vec2  float32   height at A, height at B
16  aBorn    float           when this particle's changeover began
20  aCA      ubyte4          colour at A
24  aCB      ubyte4          colour at B
28  aN       byte4           nx,nz at A and at B
```

Normals are recomputed on load by central difference over the height grid, not
stored in the file — cheap, and it keeps the baked places as PDOK's own bytes.

### States

`roam → gathering → flying → roam`, with `parked` when the scrub is held.
Movement is locked while a jump is in the air.

## Behaviour

### Sliding the window

WASD pans the framed coordinates. The camera orbits the square and never
translates, so the frame is stationary and the terrain moves through it.

### Jumping

1. Geocode. Compute bearing and distance directly from the two RD coordinates
   — metric, so `atan2` and Pythagoras, no geodesy.
2. **Gather the destination behind the place still on screen.** One coarse
   window covering the whole square, three requests, ~0.6 s. Nothing on screen
   changes.
3. Fly. Duration `0.9 s + 0.55·log₁₀(1 + 10·km)`, capped at 3.5 s.
4. Land: A := B in place, no fetch, no reallocation.
5. Refine: the sharp fetch tiles stream in after landing, so you arrive at a
   soft version of the place and watch it come into focus.

### Scrub

A slider parks the transition and holds it. Freeze at 0.42 and you have a place
that is 42% of the way from one real address to another. `s` exports at 3×.

### Look

Default **lit photograph**: aerial RGB as albedo, shaded by the normal from the
height grid, plus an openness term (`DSM − blurred DSM`) that sinks alleys and
courtyards into shadow. `c` cycles to a graphic height ramp and to
photo-luminance under ramp hue.

Point size is derived from the projection — the true on-screen size of one cell
at that distance — multiplied by a grain factor below 1 so points sit smaller
than their spacing. That is what makes it read as particles rather than as a
skin. A constant was tried and is wrong at every distance but one.

The orthophoto is 2026 and the LiDAR is 2023–24. Anything built between has
colour but no height. Stated on the page.

## What the mock settled

`lab/elsewhere/` is procedural and network-free, and exists to have made these
mistakes already.

1. **Address render tiles by tile coordinate, not ring position.** Indexing by
   position in the ring means stepping one tile forward changes every slot's
   target: 49 reloads for a move that should cost 7. The queue backed up to 107
   and the world went black while moving.
2. **Never blank an evicted slot.** Clearing it punches a black square in the
   leading edge for the length of the fetch. Leave the stale ground in the
   buffer; the clip hides it.
3. **Cache a bigger ring than you show.** A one-tile margin is where new ground
   lands before it slides into frame. Without it the leading edge is a hole
   however fast the loader is.
4. **Gather before flying.** Throwing tiles away and reloading on a jump is a
   dissolve, not a journey — the screen went fully black mid-jump.
5. **Particles cannot traverse the real distance.** Displacing by the true
   offset put every particle 25 km off screen at mid-flight. A particle keeps
   its ground position and changes what it is standing on; the journey lives in
   the streaming.
6. **Jitter the changeover per particle, not per tile.** Tile-level timing is
   visible as chunks and reads as a loading bar. Per particle, a tile arriving
   is a scatter of pixels dropping out and popping back.
7. **Through a changeover a particle shows one place or the other, never an
   average.** It falls, vanishes, and the new one pops up in its place.

## Failure behaviour

Address not found, address outside the Netherlands, a service down, a window
that is entirely NoData — each keeps the place currently on screen and explains
itself in the note line. The page never blanks because a fetch failed. No
WebGL2 gets a message.

## Testing

`page.route()` serves baked 64×64 fixtures, so the suite is offline and
deterministic.

- the baked place loads, decodes, and draws
- the hand-rolled GeoTIFF decoder matches known values for the fixture
- NoData produces no NaN in any position or colour
- mix 0 is exactly place A; mix 1 is exactly place B
- at rest, two frames a second apart are byte-identical — nothing integrates
- scrub parks and holds
- sliding the window never drops the drawn coverage below a floor
- bearing and distance are correct for a known RD pair
- a bad address leaves the previous place standing, and says why
- every colour mode draws
- PNG export produces a download

Canvas-only screenshots with the panel hidden — an element screenshot still
captures whatever overlaps it.

## Out of scope

Audio. Ghost overlay. Guided tour. Visit history. The homelab proxy. Real
classified point clouds, which need the proxy to be reachable at all.
