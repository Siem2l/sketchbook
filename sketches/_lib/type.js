// Type for the Vectorheart sketches. Everything here draws into an arbitrary
// graphics target at an arbitrary scale, because the 3x PNG export is the same
// code path as the screen — that is what the (g, k) convention is for.
//
// p5 has no letterspacing, and letterspacing is most of the house style, so
// every string is drawn one glyph at a time.

// Draw `str` from (x, y) with `tracking` extra pixels after each glyph.
// Returns the total advance, including the trailing tracking.
export function spaced(g, str, x, y, tracking) {
  let cx = x;
  for (const ch of str) {
    g.text(ch, cx, y);
    cx += g.textWidth(ch) + tracking;
  }
  return cx - x;
}

// The width `spaced` would occupy, minus the trailing tracking — this is the
// number you centre with.
export function spacedWidth(g, str, tracking) {
  let w = 0;
  for (const ch of str) w += g.textWidth(ch) + tracking;
  return w - tracking;
}
