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

// The poster header both sketches wear: a display title, a mono subtitle, and a
// hairline rule under them. Returns the rule width so a caller can lay content
// against it.
//
// The option list is long because the two headers genuinely differ — one sets
// its subtitle in ink and rules in ink, the other sets both in grey. Every
// option here exists because a real call site needs it.
export function titleBlock(g, k, {
  x, y, title, sub, rule, theme,
  titleSize = 20, titleTracking = 2.4, titleFont = 'monospace',
  subSize = 8, subTracking = 1.6, subColor = null, subDy = 14,
  ruleColor = null, ruleDy = 20, ruleWeight = 1,
}) {
  g.push();
  g.textAlign(g.LEFT, g.BASELINE);
  g.noStroke();
  g.fill(theme.ink);
  g.textFont(titleFont);
  g.textSize(titleSize * k);
  if (title) spaced(g, title, x, y, titleTracking * k);
  if (sub) {
    g.textFont('monospace');
    g.textSize(subSize * k);
    g.fill(subColor ?? theme.muted);
    spaced(g, sub, x, y + subDy * k, subTracking * k);
  }
  if (rule) {
    g.stroke(ruleColor ?? theme.ink);
    g.strokeWeight(ruleWeight * k);
    g.line(x, y + ruleDy * k, x + rule * k, y + ruleDy * k);
  }
  g.pop();
  return rule ?? 0;
}

// A right-aligned label/value column — CELL, PARTS, BEARING and so on. `x` is
// the right edge that values flush to; labels flush to `x - gap`.
export function readout(g, k, { x, y, rows, theme, gap = 52, rowH = 13, size = 8 }) {
  g.push();
  g.noStroke();
  g.textFont('monospace');
  g.textAlign(g.RIGHT, g.BASELINE);
  g.textSize(size * k);
  rows.forEach(([label, value], i) => {
    const ry = y + i * rowH * k;
    g.fill(theme.muted);
    g.text(label, x - gap * k, ry);
    g.fill(theme.ink);
    g.text(value, x, ry);
  });
  g.pop();
  // The column is not a fixed height — inconstructions adds ALT and MODULE in
  // TOWER mode, and stacks its parameter line and generator panel underneath —
  // so hand back where it finished, as strip and stack do.
  return y + rows.length * rowH * k;
}

// Corner registration ticks. Print-shop furniture that also does the honest job
// of showing where the frame is on any viewport.
export function regMarks(g, k, w, h, { theme, margin = 20, arm = 9, weight = 1 }) {
  const m = margin * k;
  const r = arm * k;
  g.push();
  g.stroke(theme.ink);
  g.strokeWeight(weight * k);
  for (const [cx, cy, sx, sy] of
    [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) {
    g.line(cx, cy, cx + sx * r, cy);
    g.line(cx, cy, cx, cy + sy * r);
  }
  g.pop();
}

// The SKETCHBOOK · SIEM2L.NL line. Small enough to inline, shared so that every
// sketch signs itself the same way.
export function footer(g, k, { x, y, text, theme, size = 7, tracking = 1.2 }) {
  g.push();
  g.noStroke();
  g.fill(theme.muted);
  g.textFont('monospace');
  g.textAlign(g.LEFT, g.BASELINE);
  g.textSize(size * k);
  spaced(g, text, x, y, tracking * k);
  g.pop();
}
