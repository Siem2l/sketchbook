// The two measurements a place needs before its rasters can go to the GPU.
//
// Everything else that used to live here — normals, height above ground, the
// walls, the canopy — moved into the vertex shader when the rasters became
// textures. What is left is what the CPU has to know once per place and cannot
// work out per particle: where the ground is, and how the photograph is exposed.

const NODATA_FLOOR = 1e30;

// Each place stands on its own median ground rather than on NAP. The country
// runs -7 m to +320 m, so morphing between places on absolute height would make
// the whole scene lurch vertically and bury the thing worth watching, which is
// the buildings and the trees changing. The true NAP value is kept and printed.
export function median(data) {
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
export function toneOf(rgb, n) {
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
