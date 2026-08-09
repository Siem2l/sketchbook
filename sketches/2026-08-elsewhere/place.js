// Turns three decoded rasters into the arrays a particle field wants.
//
// Pure and synchronous on purpose: everything network- and browser-shaped
// happens before this is called, which is what lets it be tested in Node.

const NODATA_FLOOR = 1e30;

// Each place stands on its own median ground rather than on NAP. The country
// runs -7 m to +320 m, so morphing between places on absolute height would make
// the whole scene lurch vertically and bury the thing worth watching, which is
// the buildings and the trees changing. The true NAP value is kept and printed.
function median(data) {
  const real = [];
  for (const v of data) if (v < NODATA_FLOOR) real.push(v);
  if (!real.length) return 0;
  real.sort((a, b) => a - b);
  return real[real.length >> 1];
}

// An orthophoto off the wire spends its range in a narrow, low slice — this
// window measures 56 at the 2nd percentile and 196 at the 98th, out of 255 —
// and once multiplied by the shading the whole street sinks into the
// background. Stretching it between its own percentiles is what makes the red
// pantiles red. Measured once per place and passed to every tile after it: per
// tile, adjacent tiles would disagree about what grey is and the seams would
// show. Same reasoning as the datum.
function toneOf(rgb, n) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    hist[(0.299 * rgb[i*4] + 0.587 * rgb[i*4+1] + 0.114 * rgb[i*4+2]) | 0]++;
  }
  const at = (frac) => {
    let acc = 0, target = n * frac;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
    return 255;
  };
  const lo = at(0.02), hi = at(0.98);
  return { lo, hi: Math.max(lo + 16, hi) };
}

export function assemble({ dsm, dtm, rgb, width, height, tone }) {
  const n = width * height;
  const datum = median(dtm.data);
  const y = new Float32Array(n);
  const hag = new Float32Array(n);
  const water = new Uint8Array(n);
  const colour = new Uint8Array(n * 3);
  const t = tone ?? toneOf(rgb, n);
  const gain = 255 / (t.hi - t.lo);

  for (let i = 0; i < n; i++) {
    const s = dsm.data[i], g = dtm.data[i];
    const missing = !(s < NODATA_FLOOR);
    water[i] = missing ? 1 : 0;
    // A cell with no return is water or a survey gap. Both sit at ground level
    // and keep their photographic colour, so water renders as a flat plane that
    // happens to look exactly like water.
    const surface = missing ? (g < NODATA_FLOOR ? g : datum) : s;
    const ground = g < NODATA_FLOOR ? g : datum;
    y[i] = surface - datum;
    hag[i] = Math.max(0, surface - ground);
    // Stretch the luminance and carry the chroma along, rather than stretching
    // each channel on its own. Per channel, a shadow at (60,70,85) comes out
    // (7,27,55) and the whole square goes blue — the stretch invents a colour
    // cast that is not in the photograph. Scaling by the luminance ratio keeps
    // the hue the survey actually recorded.
    const R = rgb[i * 4], G = rgb[i * 4 + 1], B = rgb[i * 4 + 2];
    const l = 0.299 * R + 0.587 * G + 0.114 * B;
    const k = l > 1 ? Math.max(0, (l - t.lo) * gain) / l : 0;
    colour[i * 3] = Math.min(255, R * k);
    colour[i * 3 + 1] = Math.min(255, G * k);
    colour[i * 3 + 2] = Math.min(255, B * k);
  }

  // Normals by central difference over the height grid. This is where all the
  // shading comes from: an orthophoto is flat light with the sun already baked
  // in, and a DSM gradient is what makes a roof face the sun and an alley fall
  // into shadow.
  const normal = new Int8Array(n * 2);
  const clampi = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);
  const at = (i, j) => y[clampi(j, height - 1) * width + clampi(i, width - 1)];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) / 2;
      const dz = (at(i, j + 1) - at(i, j - 1)) / 2;
      const len = Math.hypot(dx, dz, 1);
      const p = (j * width + i) * 2;
      normal[p] = Math.max(-127, Math.min(127, Math.round(-dx / len * 127)));
      normal[p + 1] = Math.max(-127, Math.min(127, Math.round(-dz / len * 127)));
    }
  }

  return { width, height, y, hag, colour, normal, datum, water, tone: t };
}
