// TITLE — one sentence on what this is.
//
// Say why it works the way it does, not what the code does.
import '../_lib/chrome.css';
import p5 from 'p5';
import { titleBlock, regMarks, footer } from '../_lib/type.js';
import { buttonStyle, hitLayer, heading, stack } from '../_lib/panel.js';
import { keymap } from '../_lib/keys.js';
import { exportPng as exportPngTo } from '../_lib/export.js';
import { probe } from '../_lib/probe.js';

// Colour never lives in the library — it lives here.
const THEME = { ink: '#16160f', paper: '#eceae1', accent: '#fabd2f', onAccent: '#16160f', muted: '#8a8a80' };
const BTN = buttonStyle({ theme: THEME });

const ui = hitLayer();
let P = null;
let count = 0;

const KEYS = keymap([
  { key: 'c', label: 'CLEAR', hint: 'CLEAR', run: () => { count = 0; } },
  { key: 's', label: 'PNG', hint: 'PNG', run: () => exportPng() },
]);

// Everything draws into an arbitrary target at an arbitrary scale, so the 3x
// export is the same code path as the screen. Never read a global scale here.
function render(g, k, w, h, withPanel) {
  g.background(THEME.paper);
  regMarks(g, k, w, h, { theme: THEME });
  titleBlock(g, k, { x: 34 * k, y: 40 * k, title: 'TITLE', sub: 'SUBTITLE', rule: 200, theme: THEME });
  footer(g, k, { x: 34 * k, y: h - 28 * k, text: 'SKETCHBOOK · SIEM2L.NL', theme: THEME });
  if (withPanel) {
    ui.clear();
    heading(g, k, 34 * k, 96 * k, 'CONTROLS', { theme: THEME });
    const end = stack(g, k, 34 * k, 104 * k, 120 * k, 17 * k,
      [[`COUNT ${count}`, () => { count++; }, false]], { layer: ui, style: BTN });
    ui.region(34 * k, 96 * k, 120 * k, end - 96 * k);
    KEYS.overlay(g, k, w, h, { theme: THEME, title: 'TITLE · KEYS' });
  }
}

function exportPng() {
  exportPngTo(P, { name: 'TITLE', render: (g, k) => render(g, k, P.width * k, P.height * k, false) });
}

probe('TITLE', { count: () => count, helpOpen: () => KEYS.visible }, ui);

new p5((p) => {
  P = p;
  p.setup = () => p.createCanvas(p.windowWidth, p.windowHeight);
  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);
  p.draw = () => render(p, 1, p.width, p.height, true);
  p.mousePressed = () => { ui.hit(p.mouseX, p.mouseY); return false; };
  p.keyPressed = () => (KEYS.handle(p) ? false : true);
});
