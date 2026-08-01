// On-canvas controls. The interface is drawn in the same idiom as the thing it
// makes, which means it is pixels — so it needs its own hit-testing, and tests
// need a way to find a control without hardcoding a coordinate.
import { spaced, spacedWidth } from './type.js';

// Freeze a sketch's button look once, rather than passing six numbers per call.
//
// `align` and `shape` exist because the two existing sketches rasterize their
// controls differently and this library was extracted under a no-visual-change
// rule. 'baseline'/'poly' is inconstructions; 'center'/'rect' is splinter.
export function buttonStyle({
  theme, size = 8, tracking = 0, dy = 0, align = 'center', shape = 'rect', weight = 1,
}) {
  return { theme, size, tracking, dy, align, shape, weight };
}

export function button(g, k, x, y, w, h, label, { on = false, action, live = true, layer, style }) {
  const { theme, size, tracking, dy, align, shape, weight } = style;
  g.push();
  g.fill(on ? theme.accent : 'rgba(0,0,0,0)');
  g.stroke(theme.ink);
  g.strokeWeight(weight * k);
  if (shape === 'poly') {
    g.beginShape();
    for (const [px, py] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) g.vertex(px, py);
    g.endShape(g.CLOSE);
  } else {
    g.rect(x, y, w, h);
  }
  g.noStroke();
  g.fill(on ? theme.onAccent : theme.ink);
  g.textFont('monospace');
  g.textSize(size * k);
  if (align === 'baseline') {
    g.textAlign(g.LEFT, g.BASELINE);
    const tw = spacedWidth(g, label, tracking * k);
    spaced(g, label, x + (w - tw) / 2, y + h / 2 + dy * k, tracking * k);
  } else {
    g.textAlign(g.CENTER, g.CENTER);
    g.text(label, x + w / 2, y + h / 2 + dy * k);
  }
  g.pop();
  if (live && layer) layer.add(x, y, w, h, { action, label });
  return x + w;
}

// Collects this frame's clickable rects. Rebuilt every frame, because a panel
// reflows with the viewport and with its own contents.
//
// `region` is separate from `add`: a panel needs to swallow a gesture that lands
// on its background as well as on a control, or you orbit the camera through it.
// inconstructions has two disjoint control areas, so this is a list of regions
// rather than a single bounding rect.
export function hitLayer() {
  let hits = [];
  let regions = [];
  const within = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  return {
    add(x, y, w, h, { action, drag, label } = {}) {
      hits.push({ x, y, w, h, action, drag, label });
    },
    region(x, y, w, h) { regions.push({ x, y, w, h }); },
    // Run whatever is under the point. Returns whether anything was.
    hit(x, y) {
      for (const b of hits) {
        if (within(b, x, y)) { if (b.action) b.action(); return true; }
      }
      return false;
    },
    // Hand back the control under the point without firing it, so a caller can
    // hold onto one for the length of a drag. A slider needs this; a button
    // does not care.
    press(x, y) {
      return hits.find((b) => within(b, x, y)) ?? null;
    },
    swallows(x, y) {
      return hits.some((b) => within(b, x, y)) || regions.some((r) => within(r, x, y));
    },
    find(label) {
      return hits.find((b) => b.label === label || (b.label && b.label.startsWith(label))) ?? null;
    },
    clear() { hits = []; regions = []; },
  };
}

// A section label above a run of controls.
export function heading(g, k, x, y, text, { theme, size = 6.8 }) {
  g.push();
  g.noStroke();
  g.fill(theme.muted);
  g.textFont('monospace');
  g.textAlign(g.LEFT, g.BASELINE);
  g.textSize(size * k);
  g.text(text, x, y);
  g.pop();
}

// A run of controls left to right. `defs` are [width, label, action, on] with
// width in unscaled units. Returns the x just past the last control.
export function strip(g, k, x, y, h, defs, { gap = 5, layer, style, live = true }) {
  let cx = x;
  for (const [w, label, action, on] of defs) {
    cx = button(g, k, cx, y, w * k, h, label, { on, action, live, layer, style }) + gap * k;
  }
  return cx;
}

// A column of full-width controls. `defs` are [label, action, on]. Returns the y
// just past the last control.
export function stack(g, k, x, y, w, h, defs, { gap = 4, layer, style, live = true }) {
  let cy = y;
  for (const [label, action, on] of defs) {
    button(g, k, x, cy, w, h, label, { on, action, live, layer, style });
    cy += h + gap * k;
  }
  return cy;
}

// Label, track, printed value. The hit it registers carries a `drag` handler
// rather than an action, because a slider is worth nothing if it only responds
// to the pixel you first pressed.
//
// What a drag *means* stays with the caller: inconstructions snapshots its world
// on press and records one undo entry on release, so a drag from one end to the
// other costs one undo rather than sixty. The library only reports positions.
export function slider(g, k, x, y, w, label, value, set, {
  style, layer, live = true, track = 62, tail = 34, barH = 6, size = 7,
}) {
  const { theme, shape } = style;
  const bx = x + track * k;
  const bw = w - (track + tail) * k;
  const bh = barH * k;
  // Same reason as the button: beginShape and rect() rasterize differently, so
  // the track follows whichever the sketch already draws with.
  const box = (bxx, byy, bww, bhh) => {
    if (shape === 'poly') {
      g.beginShape();
      for (const [px, py] of [[bxx, byy], [bxx + bww, byy], [bxx + bww, byy + bhh], [bxx, byy + bhh]]) {
        g.vertex(px, py);
      }
      g.endShape(g.CLOSE);
    } else {
      g.rect(bxx, byy, bww, bhh);
    }
  };
  g.push();
  g.noStroke();
  g.textFont('monospace');
  g.textSize(size * k);
  g.textAlign(g.LEFT, g.BASELINE);
  g.fill(theme.muted);
  spaced(g, label, x, y + 6 * k, 0.9 * k);
  g.fill('rgba(0,0,0,0)');
  g.stroke(theme.ink);
  g.strokeWeight(1 * k);
  box(bx, y, bw, bh);
  if (value > 0) {
    g.noStroke();
    g.fill(theme.accent);
    box(bx + 1 * k, y + 1 * k, (bw - 2 * k) * value, bh - 2 * k);
  }
  g.noStroke();
  g.fill(theme.ink);
  g.textAlign(g.RIGHT, g.BASELINE);
  g.text(String(Math.round(value * 100)).padStart(2, '0'), x + w, y + 6 * k);
  g.pop();
  if (live && layer) {
    layer.add(bx - 8 * k, y - 6 * k, bw + 16 * k, bh + 12 * k, {
      drag: (mx) => set(Math.max(0, Math.min(1, (mx - bx) / bw))),
      label,
    });
  }
}
