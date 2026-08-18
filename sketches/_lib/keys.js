// Key bindings as data. Two things follow from that: the on-screen hint line
// cannot drift from what the keys actually do, and a `?` overlay comes free.
import { spaced } from './type.js';

// Verbs every Vectorheart sketch spells the same way. Both existing sketches
// already agree on these; the table exists so a third one cannot quietly
// disagree. Sketch-specific verbs stay free — splinter's `x` (detonate) and
// inconstructions' `w` (tower) are not here and do not need to be.
//
// `label` is the canonical verb and is what this table checks. `hint` is what
// the sketch chooses to print, which can be more specific: inconstructions
// binds NEW to space and prints it as ROLL.
export const RESERVED = {
  s: 'PNG', z: 'UNDO', y: 'REDO', c: 'CLEAR', ' ': 'NEW', '?': 'HELP',
};

export function keymap(bindings) {
  for (const b of bindings) {
    const want = RESERVED[b.key];
    if (want && b.label !== want) {
      throw new Error(
        `key "${b.key}" is reserved for ${want}, not ${b.label} — see _lib/keys.js`);
    }
  }
  const byKey = new Map(bindings.filter((b) => b.key.length === 1 && b.run).map((b) => [b.key, b]));
  let visible = false;

  return {
    get visible() { return visible; },
    toggle() { visible = !visible; },

    // Call from p.keyPressed. Returns true when a binding fired, so the sketch
    // can decide what to do with everything else.
    handle(p) {
      if (p.key === '?') { visible = !visible; return true; }
      if (p.keyCode === p.ESCAPE && visible) { visible = false; return true; }
      const b = byKey.get(p.key.toLowerCase()) ?? byKey.get(p.key);
      if (!b) return false;
      b.run(p);
      return true;
    },

    // The one-line hint strip, built from the bindings that asked for one. A
    // sketch that draws fewer than all of them slices this.
    hints() {
      return bindings.filter((b) => b.hint)
        .map((b) => `${b.key === ' ' ? 'SPACE' : b.key.toUpperCase()} ${b.hint}`)
        .join(' · ');
    },

    // The full card, shown on `?`. Drawn in the sketch's own idiom.
    overlay(g, k, w, h, { theme, title = 'KEYS' }) {
      if (!visible) return;
      const rows = bindings.filter((b) => b.hint ?? b.label);
      const bw = 300 * k;
      const bh = (rows.length + 3) * 16 * k;
      const x = (w - bw) / 2;
      const y = (h - bh) / 2;
      g.push();
      g.noStroke();
      g.fill(theme.paper);
      g.rect(x, y, bw, bh);
      g.noFill();
      g.stroke(theme.ink);
      g.strokeWeight(1 * k);
      g.rect(x, y, bw, bh);
      g.noStroke();
      g.fill(theme.ink);
      g.textFont('monospace');
      g.textAlign(g.LEFT, g.BASELINE);
      g.textSize(9 * k);
      spaced(g, title, x + 16 * k, y + 24 * k, 1.6 * k);
      g.textSize(8 * k);
      rows.forEach((b, i) => {
        const ry = y + 46 * k + i * 16 * k;
        g.fill(theme.muted);
        g.text(b.key === ' ' ? 'SPACE' : b.key.toUpperCase(), x + 16 * k, ry);
        g.fill(theme.ink);
        g.text(b.hint ?? b.label, x + 70 * k, ry);
      });
      g.pop();
    },
  };
}
