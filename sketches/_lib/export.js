// The 3x PNG export both sketches offer. The poster is the artefact; the panel
// is a tool and does not belong in it, which is why `render` is the caller's
// function rather than the sketch's live draw.
//
// The library deliberately knows nothing about how a sketch scales itself.
// inconstructions swaps its module-level origin and scale; splinter swaps its
// world-to-pixel `unit`. Both do that inside their own `render`.

export function exportPng(p, { name, k = 3, render }) {
  const g = p.createGraphics(p.width * k, p.height * k);
  render(g, k);
  p.saveCanvas(g, name, 'png');
  // saveCanvas reads the buffer asynchronously; removing it immediately can
  // race the download on slower machines.
  setTimeout(() => g.remove(), 200);
}
