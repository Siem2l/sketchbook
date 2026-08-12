// What is standing on a patch of ground, decided from the height field alone.
//
// The shader has been answering this question since the walls and canopy went
// in — it has to, because that is where the height field lives — and answering
// it on the CPU too is what lets a click know whether it landed on a road, a
// crown or a roof. The two cannot share code: one reads texture fetches with
// bilinear neighbours, the other a Float32Array with integer ones. They can
// share the numbers, and here they do — shaders.js interpolates these three
// into its source the same way it already interpolates the wake's ring size, so
// there is one place where the split is decided and no way for the two readings
// to drift apart on a threshold.
//
// hendriklaan gets this split handed to it by the survey: AHN classifies every
// return. The national coverage service does not publish a classification, only
// a surface and a terrain model, so this sketch works it out from the shape of
// the two — how far off the deck a cell sits, how rough it is in every
// direction at once, and whether it stands on a drop.

export const CANOPY_HAG = 2.5;     // m above the terrain before a cell can be a crown
export const CANOPY_ROUGH = 0.35;  // m of curvature; a pitched roof is a plane, a crown is not
export const BUILT_DROP = 1.2;     // m of fall to a neighbour before a cell stands on a face
export const GROUND_HAG = 0.8;     // m below which a cell is simply the deck

export function createGround() {
  let g = null;

  return {
    // A levelled coarse frame, as loadCoarse already computed it on the way to
    // the GPU. One slot: whichever frame is the current place wins, and the
    // caller decides when that is — a jump loads its destination long before a
    // particle moves, and setting it there would have the page playing the
    // place it is flying to while it is still drawing the one it left.
    set(bbox, span, surf, terr) {
      const n = Math.round(Math.sqrt(surf.length));
      g = { x0: bbox[0], z0: bbox[1], span, n, surf, terr };
    },
    have: () => !!g,

    // Nearest, not bilinear, for the reason the height texture is NEAREST: a
    // smoothed height ramps every facade into a slope, and a facade is exactly
    // what the drop test is looking for.
    //
    // Two ways this can disagree with the shader, both known and both cheap to
    // live with. The one-metre ring of cells around a building reads as canopy
    // rather than as built, because the roughness test is a Laplacian and a
    // hard step is rough in every direction — the shader says the same thing
    // about the same cells, which is the whole reason the thresholds are
    // shared. And this grid is the coarse frame at a metre where the drawn
    // square is sharp tiles at half of one, so a smooth slope reads rougher
    // here than it does there. Keeping all nine sharp tiles on this side would
    // cost eight megabytes to move a handful of clicks between two notes.
    at(x, z) {
      if (!g) return null;
      const fx = (x - g.x0) / g.span;
      // Rasters are north-up, so the first row is the north edge and v runs the
      // other way to northing — the same inversion the shader does on its uv.
      const fz = 1 - (z - g.z0) / g.span;
      if (fx < 0 || fx >= 1 || fz < 0 || fz >= 1) return null;
      const col = Math.min(g.n - 1, Math.floor(fx * g.n));
      const row = Math.min(g.n - 1, Math.floor(fz * g.n));
      const i = row * g.n + col;

      const y = g.surf[i];
      const hag = Math.max(0, y - g.terr[i]);
      // Clamped rather than wrapped: a neighbour off the east edge must not be
      // read from the west one, which would invent a cliff down the seam.
      const at = (c, r) => g.surf[Math.min(g.n - 1, Math.max(0, r)) * g.n
        + Math.min(g.n - 1, Math.max(0, c))];
      const l = at(col - 1, row), r = at(col + 1, row);
      const d = at(col, row + 1), u = at(col, row - 1);
      const drop = Math.max(y - l, y - r, y - d, y - u);
      const rough = Math.abs(4 * y - (l + r + d + u)) * 0.25;

      // Order matters, and it is the shader's order. A crown is found first and
      // by curvature rather than by slope, so a pitched roof stays the plane it
      // is; what is left over falls to the drop test, and only then to the deck.
      const kind = hag > CANOPY_HAG && rough > CANOPY_ROUGH ? 'canopy'
        : drop > BUILT_DROP ? 'built'
        : hag < GROUND_HAG ? 'ground'
        : 'built';
      return { y, hag, drop, rough, kind };
    },
  };
}
