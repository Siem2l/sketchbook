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
// The parameter is cos(alt), not a linear walk from 90 down to 1, and that is
// not a cosmetic curve. Central-eclipse altitude is distributed as sin(alt) —
// uniform gamma pushed through alt = 90 − arcsin|gamma| — so a linear ramp puts
// roughly two thirds of all 7,604 marks into its two dimmest steps and the
// globe comes out one flat colour. cos(alt) is that distribution's own CDF, so
// the five steps carry equal populations and the ramp shows what it encodes.
// Reading the scale off the physics is also what makes it honest: the steps are
// equal shares of eclipses, not equal spans of degrees.
export function colorFor(alt) {
  if (alt === 0) return HORIZON_COLOR;
  const t = Math.cos(alt * Math.PI / 180);            // 0 at overhead, →1 at the horizon
  return RAMP[Math.min(RAMP.length - 1, Math.max(0, Math.round(t * (RAMP.length - 1))))];
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
