// Why the horizon eclipses exist at all, drawn rather than counted.
//
// This is a cross-section through the Sun, the Moon and the Earth, cut along
// the plane holding all three. Sunlight arrives from the left. The Moon casts
// two shadows: the umbra, a cone that converges to a point near the Earth, and
// the penumbra, a much wider cone that keeps spreading.
//
// The single control is gamma — how far the shadow axis passes from the Earth's
// centre, measured in Earth radii. Everything follows from it, including the
// thing this page is about:
//
//   |gamma| < 1     the axis hits. Where it lands, the Sun stands
//                   arcsin(sqrt(1 - gamma^2)) above the horizon: overhead at
//                   gamma 0, and lower the further out the axis passes.
//   1 to ~1.55      the axis misses the planet entirely. Only the penumbra
//                   still clips the limb, and the limb is the sunrise line, so
//                   the Sun is on the horizon by construction. 36% of all
//                   eclipses live in this band.
//   beyond ~1.55    nothing touches. No eclipse.
//
// The contact point slides toward the terminator as gamma grows and arrives
// exactly as the Sun reaches the horizon. That is not a coincidence to be
// explained, it is the same statement twice: a grazing shadow and a grazing
// Sun are the same geometry seen from two places.
//
// This drawing is a toy — parallel sunlight, a spherical Earth, no parallax,
// no oblateness, no atmosphere — and it is nonetheless the actual mechanism.
// Its one prediction, alt = arcsin(sqrt(1 - gamma^2)), reproduces the solar
// altitude NASA computed properly for all 7,628 central eclipses in the catalog
// to a median of 0.27° and a 99th percentile of 1.43°. A test holds it there,
// because a diagram that stops explaining the data underneath it is worse than
// no diagram at all.
//
// NOT TO SCALE, and it cannot be. The real umbra is about 100 km across where
// it meets the ground — 0.016 Earth radii, a hairline at this size — and the
// Sun is 400 times farther away than the Moon. The umbra is drawn a few times
// too wide so it can be seen at all, and the Sun sits just off the left edge.
// The penumbra's 0.55 Earth radii is real, which is why the miss band runs out
// at about 1.55.

const UMBRA_TIP_X = 0.5;      // umbra converges to a point just past Earth centre
const MOON_X = -4;            // visual distance only; the Moon is much further
const MOON_R = 0.12;
const PENUMBRA_AT_EARTH = 0.55;
export const GAMMA_MAX = 1.55;

// The relation the whole page rests on. Undefined past the miss band.
export function sunAltitudeFor(gamma) {
  const g = Math.abs(gamma);
  if (g >= GAMMA_MAX) return null;        // no eclipse at all
  if (g >= 1) return 0;                   // penumbra only, and only at the limb
  return Math.asin(Math.sqrt(1 - g * g)) * 180 / Math.PI;
}

// Where on the cross-section the eclipse peaks, in Earth radii.
export function contactPoint(gamma) {
  const g = Math.abs(gamma);
  if (g >= GAMMA_MAX) return null;
  const s = Math.sign(gamma) || 1;
  if (g >= 1) return { x: 0, y: s };      // the terminator itself
  return { x: -Math.sqrt(1 - g * g), y: gamma };
}

const umbraHalf = (x) => MOON_R * (UMBRA_TIP_X - x) / (UMBRA_TIP_X - MOON_X);
const penumbraHalf = (x) =>
  MOON_R + (PENUMBRA_AT_EARTH - MOON_R) * (x - MOON_X) / (0 - MOON_X);

export function drawGeometry(ctx, gamma, W, H) {
  // World is measured in Earth radii: x from -6 to +2 across the width.
  const s = W / 8;
  const px = (x) => (x + 6) * s;
  const py = (y) => H / 2 - y * s;

  ctx.fillStyle = '#0e0e11';
  ctx.fillRect(0, 0, W, H);

  // The Sun's limb, curving in from off the left edge, with rays leaving it.
  // Only an edge, because the Sun is 400 times further away and 400 times
  // bigger than the Moon: any disc that fitted on this canvas would misstate
  // the one thing the drawing is about.
  ctx.font = '11px ui-monospace, monospace';
  const sunR = 3.4 * s, sunCx = 14 - sunR;   // limb just inside the left edge
  ctx.fillStyle = '#171610';
  ctx.beginPath(); ctx.arc(sunCx, H / 2, sunR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#5a4c1e';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(sunCx, H / 2, sunR, -Math.PI / 2.1, Math.PI / 2.1); ctx.stroke();

  ctx.strokeStyle = '#3a3a30';
  ctx.lineWidth = 1;
  for (let y = -1.75; y <= 1.75; y += 0.5) {
    const edge = sunCx + Math.sqrt(Math.max(0, sunR * sunR - (y * s) ** 2));
    ctx.beginPath();
    ctx.moveTo(edge, py(y));
    ctx.lineTo(edge + 0.5 * s, py(y));
    ctx.stroke();
  }
  ctx.fillStyle = '#8a877e';
  ctx.fillText('sun', 18, H / 2 + 4);

  const ex = px(0), ey = py(0), er = s;
  const g = gamma;
  const my = g;

  // Order does the occluding here, not a clip path. Shadows are laid down
  // first, then the strip behind the planet is painted back to background, then
  // the planet goes on top opaque. Light stops at a surface: a wedge that
  // carries on out the far side is the sort of wrongness a viewer feels without
  // being able to name, and subtracting two differently-wound subpaths from one
  // clip region is fragile enough that it silently did not work the first time.
  const wedge = (halfAt, fill) => {
    ctx.beginPath();
    ctx.moveTo(px(MOON_X), py(my + halfAt(MOON_X)));
    ctx.lineTo(px(1.9), py(my + halfAt(1.9)));
    ctx.lineTo(px(1.9), py(my - halfAt(1.9)));
    ctx.lineTo(px(MOON_X), py(my - halfAt(MOON_X)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  wedge(penumbraHalf, 'rgba(224, 163, 22, 0.10)');
  wedge((x) => Math.max(0, umbraHalf(x)), 'rgba(224, 163, 22, 0.55)');

  ctx.setLineDash([2, 4]);
  ctx.strokeStyle = 'rgba(224, 163, 22, 0.45)';
  ctx.beginPath(); ctx.moveTo(px(MOON_X), py(my)); ctx.lineTo(px(1.9), py(my)); ctx.stroke();
  ctx.setLineDash([]);

  // Everything downstream of the planet is in the planet's own shadow.
  ctx.fillStyle = '#0e0e11';
  ctx.fillRect(ex, ey - er, W - ex, er * 2);

  // Earth, opaque, over the top. The day side faces the Sun, so it is the left
  // half; the terminator is the vertical through the centre, which is exactly
  // where the horizon eclipses land.
  ctx.save();
  ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#1b1b22';
  ctx.fillRect(ex - er, ey - er, er * 2, er * 2);
  ctx.fillStyle = '#252530';
  ctx.fillRect(ex - er, ey - er, er, er * 2);       // lit half
  ctx.restore();
  ctx.strokeStyle = '#3c4a46';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.stroke();

  // The terminator, dashed: the sunrise/sunset line all the way round.
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = '#4a4a40';
  ctx.beginPath(); ctx.moveTo(ex, ey - er); ctx.lineTo(ex, ey + er); ctx.stroke();
  ctx.setLineDash([]);

  // The Moon.
  ctx.fillStyle = '#0e0e11';
  ctx.beginPath(); ctx.arc(px(MOON_X), py(my), MOON_R * s, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#8a877e';
  ctx.stroke();
  ctx.fillStyle = '#8a877e';
  ctx.fillText('moon', px(MOON_X) - 14, py(my) - MOON_R * s - 7);

  // Gamma, as a measured distance from the Earth's centre.
  ctx.strokeStyle = '#7fb3a3';
  ctx.setLineDash([2, 2]);
  ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex, py(my)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#7fb3a3';
  ctx.fillText(`γ ${Math.abs(g).toFixed(2)}`, ex + 6, (ey + py(my)) / 2 + 4);

  // Where it lands, and what the Sun is doing there.
  const P = contactPoint(g);
  const alt = sunAltitudeFor(g);
  if (P) {
    const cx = px(P.x), cy = py(P.y);
    const horizon = alt === 0;
    const mark = horizon ? '#e0a316' : '#90d4c0';

    // Local horizon: the tangent at the contact point. The Sun's altitude is
    // the angle between this line and the direction to the Sun — which is why
    // a contact point on the terminator has the Sun at zero.
    const nx = P.x, ny = P.y;                 // unit normal, P is on the sphere
    ctx.strokeStyle = mark;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - ny * 0.55 * s, cy - nx * 0.55 * s);
    ctx.lineTo(cx + ny * 0.55 * s, cy + nx * 0.55 * s);
    ctx.stroke();

    // Direction to the Sun from that spot.
    ctx.strokeStyle = '#e8e6e0';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - 0.5 * s, cy); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = mark;
    ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();

    // Keep the label on the canvas: at high gamma the contact point is close to
    // the right edge and a label hung off it walks straight out of the frame.
    const label = horizon ? 'sun on the horizon' : `sun ${alt.toFixed(0)}° up`;
    const lw = ctx.measureText(label).width;
    const lx = Math.min(cx + 10, W - lw - 8);
    ctx.fillStyle = mark;
    ctx.fillText(label, lx, cy - 10);

    // Central or partial. Past gamma 1 the umbra has missed the planet
    // altogether and only the penumbra still clips the limb, so what is left is
    // a partial eclipse seen at sunrise — and that band is 36% of the catalog.
    ctx.fillStyle = '#8a877e';
    if (Math.abs(g) >= 1) {
      ctx.fillText('umbra misses — partial only, seen along the sunrise line',
        px(-3.4), H - 34);
      ctx.fillStyle = '#e0a316';
      ctx.fillText('this band is the amber ring on the globe below', px(-3.4), H - 18);
    } else {
      ctx.fillText('umbra reaches the surface — total or annular somewhere along its track',
        px(-3.4), H - 22);
    }
  } else {
    ctx.fillStyle = '#8a877e';
    ctx.fillText('even the penumbra misses — no eclipse anywhere on Earth',
      px(-3.4), H - 22);
  }
}
