// The altitude encoding. Two things share this globe and they are not the same
// kind of thing, so they do not share a scale.
//
// The 7,604 central eclipses spread across every altitude and get a sequential
// ramp. The 4,294 horizon eclipses are not the bottom of that ramp — they are
// 36% of the data stacked on one value, and a sequential scale renders a
// categorical spike as a merely-dark end. So they get a reserved colour and a
// different mark: a hollow ring against filled dots. The bands then survive
// greyscale, colour-blindness, and thumbnail size, which is where most people
// meet this page.
//
// Ramp validated dim→bright against the #0e0e11 surface: monotone lightness,
// adjacent OKLCH ΔL ≥ 0.06, dim end 2.33:1, single hue (1° spread). Amber
// against the ramp clears CVD ΔE 15.4 (protan) and 18.5 unsimulated.
import { project } from './globe.js';

export const RAMP = ['#32554b', '#467466', '#5d9383', '#77b3a1', '#90d4c0'];
export const HORIZON_COLOR = '#e0a316';

// Horizon-ness, not altitude: alt 90 is the dim end, alt 1 the bright one.
//
// The parameter is cos(alt) rather than a linear walk from 90 down to 1, and
// the reason is the data's own shape. Central-eclipse altitude is distributed
// as sin(alt) — uniform gamma pushed through alt = 90 − arcsin|gamma| — whose
// survival function is exactly cos(alt). (The CDF is 1 − cos(alt); either is
// uniform on [0,1], and the survival function is the one that already points
// the right way, bright at the horizon.) Pushing altitude through it makes the
// ramp parameter uniform, so the steps carry equal shares of eclipses instead
// of equal spans of degrees.
//
// Linear put 20.0/34.5/27.8/15.5/2.2 percent of the 7,604 central marks into
// the five steps — the bright end all but empty, the globe one flat colour.
//
// floor, not round: round gives the two end steps half-width capture intervals
// and starves them. Measured over the 7,604 central eclipses, dim→bright:
//
//   linear + round   20.0  34.5  27.8  15.5   2.2   max:min 15.42
//   cos    + round   13.3  24.3  23.6  26.6  12.2   max:min  2.17
//   cos    + floor   20.0  19.1  19.5  21.5  19.9   max:min  1.13
//
// The residual wobble in the last row is the catalog's, not the mapping's.
export function colorFor(alt) {
  if (alt === 0) return HORIZON_COLOR;
  const t = Math.cos(alt * Math.PI / 180);            // 0 at overhead, →1 at the horizon
  return RAMP[Math.min(RAMP.length - 1, Math.max(0, Math.floor(t * RAMP.length)))];
}

export function drawPoints(ctx, data, upTo, view, r, cx, cy) {
  // Back-to-front by z so the near hemisphere is drawn over the limb rather
  // than the far side being painted at all. One pass collects, one sorts.
  const vis = [];
  for (let i = 0; i < upTo; i++) {
    const q = project(data.lat[i], data.lon[i], view);
    if (q.z <= 0) continue;
    vis.push([q.z, cx + q.x * r, cy - q.y * r, data.alt[i]]);
  }
  vis.sort((a, b) => a[0] - b[0]);

  // Mark sizes are set by the densest case, not the sparsest. 4,294 horizon
  // eclipses crowd into two narrow bands, and at r=2.6 their strokes overlap
  // into one solid arc — which loses the hollow ring that is the whole point of
  // giving them a separate mark. Smaller, thinner, and the band keeps its
  // grain: you can see it is made of individual eclipses.
  for (const [, px, py, alt] of vis) {
    if (alt === 0) {
      ctx.strokeStyle = HORIZON_COLOR;
      ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.arc(px, py, 1.7, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = colorFor(alt);
      ctx.beginPath(); ctx.arc(px, py, 1.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  return vis.length;
}
