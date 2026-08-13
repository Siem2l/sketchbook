# Medieval bike — the blacksmith's contraption

A riveted iron-framed bicycle with iron-banded wooden wheels, a crank-and-cog
drive, a caged lantern at the front and a leather saddle with a strapped satchel
behind it. Drawn for a 2D isometric game.

Regenerate with:

```sh
node scripts/gen-medieval-bike.mjs
```

## Files

| File | What it is |
| --- | --- |
| `bike_iso_8dir.png` | 768×384 sheet: 8 facings across, 4 roll phases down |
| `bike_iso_<DIR>.png` | the 8 facings at roll phase 0, as individual 96×96 sprites |
| `bike_iso_8dir_shadow.png` | matching ground-shadow sheet, same layout |
| `palette.json` | palette ramps, frame size, pivot, projection |

## Frame layout

Frames run **clockwise starting at N**:

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Facing | N | NE | E | SE | S | SW | W | NW |

The facing is the screen direction the **nose** points: `N` is away from the
camera (up the screen), `S` is toward it. Frame `i` sits at `x = i * 96` in the
sheet.

Rows are the roll cycle: row `r` sits at `y = r * 96`. One cycle is 45° of
wheel, so **step the row from distance travelled, not from a timer** —
`row = floor(distance / 11.78) % 4` at this sprite scale, or the wheels skate
along the ground. `palette.json` carries `roll.travelPerCycle` for exactly this.

The crank does not animate. A seamless loop needs every moving part back where
it started: the spokes manage that after 45° of wheel, the crank only after
360°, which at this gearing is two full wheel revolutions and 32-odd phases. For
a part four pixels across with no rider's legs on it, a still crank reads as
nothing at all; a crank spun at the spoke rate reads as broken.

## Placement

- Frame: 96×96, transparent background.
- **Pivot: (48, 68)** — the ground point midway between the wheel contacts. Draw
  the sprite so this pixel lands on the tile position, then it plants correctly
  in all eight facings.
- The shadow sheet shares the frame size and pivot exactly, so it can be drawn
  underneath with the same offset. It is a separate layer so you can tint or
  fade it per time of day; it is pre-multiplied at two alpha steps (110/55) to
  stay chunky rather than soft.

## Projection and light

- 2:1 isometric (30° pitch), 45° yaw step — matches standard 2:1 iso tiles.
- The key light is fixed in **camera** space (upper-left, slightly toward the
  viewer), so highlights stay on the same side of the screen as the bike turns.
  This is what you want for sprites; a world-fixed light would make the shading
  swim between facings.

## Palette

24 colours: six materials × four shades, plus one outline (`#10121a`). See
`palette.json`. The ramps are shared across the whole sprite, so recolouring one
ramp (e.g. brass → silver) restyles every frame consistently.

`iron` · `darkiron` · `brass` · `leather` · `wood` · `glass` (the lantern, which
is emissive and always renders at its top two shades).

## Retuning

Everything lives in `scripts/gen-medieval-bike.mjs`:

- `CONFIG` — frame size, supersampling, pivot, coverage threshold, shade bands.
- `CONFIG.ROLL_PHASES` — roll frames per 45° of wheel (default 4, one sheet row
  each). `ROLL_PHASES=1 node scripts/gen-medieval-bike.mjs` gives a static
  single-row sheet. The individual `bike_iso_<DIR>.png` files always hold
  phase 0.
- `RAMPS` — the palette.
- `buildScene()` — the model itself, as signed-distance primitives in model
  space (+x forward, +z up, one unit = one output pixel).
