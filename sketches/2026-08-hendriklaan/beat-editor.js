// The sixteen-step editor. The pattern it edits lives in shared/beat.js,
// because a mask with a tempo and a swing is not specific to one street — the
// elsewhere sketch plays the same one. What is specific is this: sixteen
// columns in a corner, drawn against hendriklaan's own CSS.
import { STEPS, LANES, NOTES, DEFAULT, changes } from '../../shared/beat.js';

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
