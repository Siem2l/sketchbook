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
