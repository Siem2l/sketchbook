// beat — the pattern the street is answering to.
//
// Until this file existed the tune was implied rather than stored. `beat % 2`
// was not a convenient way of expressing "kick on one and three"; it *was*
// "kick on one and three", and there was nothing to hand a click. Making it
// editable means giving the pattern a representation, and the representation
// chosen is three 16-bit masks — one bit per sixteenth, one integer per voice.
//
// Masks rather than note events, for two reasons. The sketch's whole claim is
// that displacement is a pure function of band energy with nothing integrating
// anywhere, so freezing is exact and silence returns all 201,635 points to
// their surveyed coordinates. An event list would have needed a scheduler with
// state, and state is the thing this page is careful not to have. And a mask
// is four hex characters, so a whole pattern fits in a URL without a codec
// worth the name.
//
// The pad has no lane. It is a swell on two periods, 21.7 s and 58.7 s, that do
// not divide into each other or into the bar — that is what keeps the canopy
// finding new shapes instead of looping — and putting it on a sixteenth grid
// would be drawing a control that lies about what the sound does.
//
// It does get a switch, though, and that was not the original plan. Emptying
// the three lanes was supposed to stop the street dead — the sketch opens by
// claiming that silence returns every point to its surveyed coordinate, and
// the grid was meant to make that claim clickable rather than argued. It did
// not: with the lanes clear the mid band still sat at 0.72 and the canopy kept
// breathing, because the pad is not in the grid. One bit fixes it. A drone you
// cannot switch off is not a drone, it is a floor.
//
// The amplitude wobbles on hat and bass stay tied to absolute beat count rather
// than becoming per-cell velocity. Per-cell velocity is more controllable and
// much flatter: every pass through the bar comes out identical, and a
// sixteen-step loop starts to sound like one. sin(beat * 1.7) has a period of
// 3.70 beats against a four-beat bar, so an edited pattern still breathes.

export const STEPS = 16;
export const LANES = ['kick', 'bass', 'hat'];

// One octave, no accidentals. Free pitch entry would want a keyboard and this
// is a four-cell row; a diatonic pool means every click lands somewhere the
// bass can go.
export const NOTES = [
  { name: 'C3', hz: 130.81 },
  { name: 'D3', hz: 146.83 },
  { name: 'E3', hz: 164.81 },
  { name: 'F3', hz: 174.61 },
  { name: 'G3', hz: 196.00 },
  { name: 'A3', hz: 220.00 },
  { name: 'B3', hz: 246.94 },
];

// Bit i is step i, so bit 0 is the downbeat. These three constants are the
// music that was hardcoded here before, written down: 0x0101 is beats one and
// three, 0x1111 is every beat, 0x5555 is every eighth.
export const DEFAULT = Object.freeze({
  bpm: 96,
  swing: 0,                              // fraction of a sixteenth, 0..0.75
  kick: 0x0101,
  bass: 0x1111,
  hat: 0x5555,
  pad: 1,                                // 0 or 1, not a lane — see above
  notes: Object.freeze([2, 1, 4, 0]),    // E3 D3 G3 C3
});

export const clone = (p) => ({ ...p, notes: [...p.notes] });

// Time since this lane last fired, in steps.
//
// The obvious implementation walks backwards from the current step and returns
// the first set bit it finds. That is wrong once swing is non-zero: a swung
// step that has not arrived yet reads as a bar old, and shadows an earlier
// step that genuinely did just fire. Scanning all sixteen and taking the
// smallest non-negative distance costs 48 iterations a frame across three
// lanes and cannot get that wrong.
const since = (mask, pos, swing) => {
  let best = Infinity;
  for (let i = 0; i < STEPS; i++) {
    if (!(mask & (1 << i))) continue;
    let d = pos - (i + (i % 2 ? swing : 0));
    if (d < 0) d += STEPS;               // it fired a bar ago, not in the future
    if (d < best) best = d;
  }
  return best;                           // Infinity for an empty lane
};

// `t` is seconds and `beats` is a tempo-relative phase, and they are separate
// arguments on purpose. Deriving beats from t would mean that dragging the
// tempo slider rescales all elapsed history at once and the playhead teleports
// mid-bar. The pad keeps using t, because its swells are deliberately unrelated
// to the bar and should not stretch when the tempo changes.
export function sequence(t, beats, p) {
  const step = 60 / p.bpm / 4;                    // seconds in a sixteenth
  const pos = ((beats % 4) + 4) % 4 * 4;          // step position inside the bar
  const bar = Math.floor(beats / 4);
  // An empty lane gives `since` = Infinity, and exp(-Infinity) is 0, so
  // clearing a lane silences it without a branch.
  const env = (d, decay) => Math.exp(-d * step / decay);

  const kick = env(since(p.kick, pos, p.swing), 0.13);
  const bass = env(since(p.bass, pos, p.swing), 0.22) * (0.6 + 0.4 * Math.sin(beats * 0.37));
  const hat = env(since(p.hat, pos, p.swing), 0.035) * (0.55 + 0.45 * Math.sin(beats * 1.7));
  const pad = p.pad ? 0.16 + 0.34 * (0.5 + 0.5 * Math.sin(t * 0.29))
                            + 0.30 * (0.5 + 0.5 * Math.sin(t * 0.107 + 1.3))
                    : 0;

  return { kick, bass, pad, hat, note: NOTES[p.notes[((bar % 4) + 4) % 4]].hz };
}

export const same = (a, b) =>
  a.bpm === b.bpm && a.swing === b.swing && a.pad === b.pad &&
  a.kick === b.kick && a.bass === b.bass && a.hat === b.hat &&
  a.notes.every((v, i) => v === b.notes[i]);

const popcount = (n) => { let c = 0; while (n) { n &= n - 1; c++; } return c; };

// How far this pattern has been dragged from the built-in one. Drives the
// readout under the grid; the ghosts show *where*, this shows *how much*.
export const changes = (p) =>
  LANES.reduce((a, k) => a + popcount((p[k] ^ DEFAULT[k]) & 0xffff), 0)
  + p.notes.reduce((a, v, i) => a + (v === DEFAULT.notes[i] ? 0 : 1), 0)
  + (p.bpm === DEFAULT.bpm ? 0 : 1)
  + (p.swing === DEFAULT.swing ? 0 : 1)
  + (p.pad === DEFAULT.pad ? 0 : 1);

// ---------------------------------------------------------------- the hash
// Fixed-width and regex-checkable, so a mangled link fails loudly at the field
// level instead of decoding into a pattern that is half someone else's.
//
//   b=010111115555&n=2140&t=96&s=0&p=1
//     └kick┘└bass┘└hat─┘   E D G C          pad on
//
// Rejection is all-or-nothing on purpose. Half-reading a broken link would
// hand someone a tune that is neither the one they were sent nor the built-in
// one, and they would have no way to tell which parts were which.

const hex4 = (n) => (n & 0xffff).toString(16).padStart(4, '0');

export const encode = (p) =>
  `b=${hex4(p.kick)}${hex4(p.bass)}${hex4(p.hat)}`
  + `&n=${p.notes.join('')}`
  + `&t=${Math.round(p.bpm)}`
  + `&s=${Math.round(p.swing * 100)}`
  + `&p=${p.pad ? 1 : 0}`;

export function decode(str) {
  const q = new URLSearchParams(String(str || '').replace(/^#/, ''));
  const b = q.get('b') || '', n = q.get('n') || '';
  const t = q.get('t') || '', s = q.get('s') || '', d = q.get('p') || '';
  if (!/^[0-9a-f]{12}$/.test(b)) return null;
  if (!/^[0-6]{4}$/.test(n)) return null;
  if (!/^\d{2,3}$/.test(t)) return null;
  if (!/^\d{1,2}$/.test(s)) return null;
  if (!/^[01]$/.test(d)) return null;
  const bpm = +t, swing = +s;
  if (bpm < 40 || bpm > 200 || swing > 75) return null;
  return {
    bpm,
    swing: swing / 100,
    kick: parseInt(b.slice(0, 4), 16),
    bass: parseInt(b.slice(4, 8), 16),
    hat: parseInt(b.slice(8, 12), 16),
    pad: +d,
    notes: n.split('').map(Number),
  };
}

// ---------------------------------------------------------------- the panel
// Everything below touches the DOM, and nothing above it does, which is what
// lets test.mjs import this module in plain node and check the arithmetic
// without a browser.

const NOTE_BARS = 4;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export function mountEditor(root, { pattern, onChange, onOpen }) {
  const grid = root.querySelector('#beat-grid');
  const noteRow = root.querySelector('#beat-notes');
  const diff = root.querySelector('#beat-diff');
  const padBar = root.querySelector('#beat-pad');
  const padOn = root.querySelector('#beat-pad-on');
  const bpm = root.querySelector('#beat-bpm');
  const bpmV = root.querySelector('#beat-bpm-v');
  const swing = root.querySelector('#beat-swing');
  const swingV = root.querySelector('#beat-swing-v');

  // A playhead row, then one row a lane. The row of ticks doubles as the bar
  // ruler: every fourth is brighter, so beats can be counted without labels.
  const ticks = [];
  grid.append(el('div', 'lab', ''));
  for (let i = 0; i < STEPS; i++) {
    const t = el('div', 'tick' + (i % 4 ? '' : ' beat'), '');
    t.dataset.step = String(i);
    ticks.push(t);
    grid.append(t);
  }
  const cells = [];
  for (const lane of LANES) {
    grid.append(el('div', 'lab', lane));
    for (let i = 0; i < STEPS; i++) {
      const c = el('button', 'cell', '');
      c.type = 'button';
      c.dataset.lane = lane;
      c.dataset.step = String(i);
      cells.push(c);
      grid.append(c);
    }
  }

  noteRow.append(el('div', 'lab', 'bars'));
  const noteCells = [];
  for (let b = 0; b < NOTE_BARS; b++) {
    const n = el('button', 'note', '');
    n.type = 'button';
    n.dataset.bar = String(b);
    noteCells.push(n);
    noteRow.append(n);
  }

  function repaint() {
    for (const c of cells) {
      const bit = 1 << +c.dataset.step;
      const mine = !!(pattern[c.dataset.lane] & bit);
      const orig = !!(DEFAULT[c.dataset.lane] & bit);
      c.className = 'cell'
        + (mine ? ' on' : '')
        + (mine && !orig ? ' added' : '')
        + (!mine && orig ? ' ghost' : '')
        + (!mine && !orig && +c.dataset.step % 4 === 0 ? ' q' : '');
    }
    for (const n of noteCells) {
      const b = +n.dataset.bar;
      n.textContent = NOTES[pattern.notes[b]].name;
      n.className = 'note' + (pattern.notes[b] === DEFAULT.notes[b] ? '' : ' moved');
    }
    padOn.textContent = pattern.pad ? 'on' : 'off';
    padOn.classList.toggle('on', !!pattern.pad);
    bpm.value = String(pattern.bpm);
    bpmV.textContent = String(pattern.bpm);
    swing.value = String(Math.round(pattern.swing * 100));
    swingV.textContent = Math.round(pattern.swing * 100) + '%';
    const n = changes(pattern);
    diff.textContent = n === 0 ? 'unchanged' : n === 1 ? '1 change' : `${n} changes`;
  }

  const changed = () => { repaint(); onChange(); };

  // Drag paints. A sixteen-step grid one click at a time is tedious, and the
  // value is taken from the first cell so a drag either fills or clears — it
  // does not toggle each cell it crosses into whatever it was not.
  let paint = null;
  const apply = (c) => {
    const bit = 1 << +c.dataset.step;
    if (!!(pattern[c.dataset.lane] & bit) === paint) return;
    pattern[c.dataset.lane] = paint
      ? pattern[c.dataset.lane] | bit
      : pattern[c.dataset.lane] & ~bit;
    changed();
  };
  grid.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.cell');
    if (!c) return;
    e.preventDefault();
    paint = !(pattern[c.dataset.lane] & (1 << +c.dataset.step));
    apply(c);
    grid.setPointerCapture(e.pointerId);
  });
  grid.addEventListener('pointermove', (e) => {
    if (paint === null) return;
    // The pointer is captured by the grid, so e.target is the grid itself and
    // hit-testing has to be done by hand.
    const c = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.cell');
    if (c && grid.contains(c)) apply(c);
  });
  const stop = () => { paint = null; };
  grid.addEventListener('pointerup', stop);
  grid.addEventListener('pointercancel', stop);

  noteRow.addEventListener('click', (e) => {
    const n = e.target.closest('.note');
    if (!n) return;
    const b = +n.dataset.bar;
    const d = e.shiftKey ? NOTES.length - 1 : 1;
    pattern.notes[b] = (pattern.notes[b] + d) % NOTES.length;
    changed();
  });

  padOn.addEventListener('click', () => { pattern.pad = pattern.pad ? 0 : 1; changed(); });
  bpm.addEventListener('input', () => { pattern.bpm = +bpm.value; changed(); });
  swing.addEventListener('input', () => { pattern.swing = +swing.value / 100; changed(); });

  let open = false;
  const hint = document.getElementById('hint');
  const api = {
    isOpen: () => open,
    open: () => {
      if (open) return;
      open = true;
      root.hidden = false;
      if (hint) hint.style.display = 'none';
      repaint();
      onOpen();
    },
    close: () => {
      open = false;
      root.hidden = true;
      if (hint) hint.style.display = '';
    },
    toggle: () => (open ? api.close() : api.open()),
    repaint,
    // Called once a frame. Cheap: one class swap when the sixteenth changes,
    // one width. Repainting 48 cells every frame to move a playhead would be
    // the most expensive thing on the page.
    draw(beats, pad, inert) {
      if (!open) return;
      const i = Math.floor(((beats % 4) + 4) % 4 * 4);
      if (i !== api._at) {
        ticks[api._at]?.classList.remove('now');
        ticks[i].classList.add('now');
        api._at = i;
      }
      padBar.style.width = (pad * 100).toFixed(0) + '%';
      root.classList.toggle('inert', inert);
    },
    _at: -1,
  };
  repaint();
  return api;
}
