// The Moon's shadow, cast onto the globe itself.
//
// This replaces a flat cross-section that nobody could read. The slice was
// correct and required you to rebuild the three-dimensional arrangement in your
// head before it meant anything, which is a lot to ask of a picture whose job
// is to explain.
//
// The setup: sunlight comes from behind the viewer. That single choice does all
// the work, because it makes the visible disc exactly the daylit hemisphere,
// and therefore makes **the edge of the disc the sunrise/sunset line** — the
// terminator, where the Sun sits on the horizon. So the claim this whole page
// is about stops being an argument and becomes a thing you watch:
//
//   the shadow reaches the rim exactly when gamma reaches 1,
//   and the rim is where the Sun is on the horizon.
//
// Those are not two facts to connect. They are one fact, seen once.
//
// Gamma is how far the shadow axis passes from the Earth's centre in Earth
// radii, measured across the line of sight — so on screen it is simply how far
// up from the centre of the disc the shadow sits, in units of the disc's own
// radius. Nothing is projected or foreshortened: under an orthographic
// projection the shadow's screen footprint is a true circle, and the smearing
// happens where it should, in the geography underneath. A circle of fixed size
// near the rim covers vastly more of the Earth's surface than the same circle
// at the centre, because the surface is turning away.
//
// Scale: the umbra is drawn several times too wide. In truth it is about 100 km
// across, 0.016 Earth radii, which at this size is a third of a pixel and would
// simply not be there. The penumbra's 0.55 Earth radii is real, and it is what
// sets the outer limit: past gamma of about 1.55 not even the penumbra reaches,
// and there is no eclipse anywhere on Earth.

export const GAMMA_MAX = 1.55;
const UMBRA_R = 0.055;          // exaggerated so it exists at all
const PENUMBRA_R = 0.55;        // real

// The one relation the page rests on. At gamma 0 the axis strikes the middle of
// the daylit face and the Sun is overhead; at gamma 1 it reaches the rim and
// the Sun is on the horizon; between 1 and 1.55 only the penumbra still clips
// the rim, so it is a partial eclipse seen at sunrise, which is 36% of them.
export function sunAltitudeFor(gamma) {
  const g = Math.abs(gamma);
  if (g >= GAMMA_MAX) return null;
  if (g >= 1) return 0;
  return Math.asin(Math.sqrt(1 - g * g)) * 180 / Math.PI;
}

export function shadowState(gamma) {
  const g = Math.abs(gamma);
  if (g >= GAMMA_MAX) return 'none';
  if (g >= 1) return 'partial';
  return 'central';
}

// Draws over the globe, so it expects the same centre and radius the globe was
// drawn with. Clipped to the disc: light that misses the planet has nothing to
// fall on, and a shadow hanging in the space beside the Earth is exactly the
// kind of wrongness that makes a diagram quietly untrustworthy.
export function drawShadow(ctx, gamma, r, cx, cy) {
  const sy = cy - gamma * r;      // straight up the screen, in disc radii

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();

  // A shadow is dark. The first pass filled the umbra amber, which is the
  // colour this page reserves for a horizon eclipse, so the shadow read as one
  // enormous data point sitting in the middle of the data.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.beginPath(); ctx.arc(cx, sy, PENUMBRA_R * r, 0, Math.PI * 2); ctx.fill();

  if (Math.abs(gamma) < 1 + UMBRA_R) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.94)';
    ctx.beginPath(); ctx.arc(cx, sy, UMBRA_R * r, 0, Math.PI * 2); ctx.fill();
    // A thin warm rim so the umbra is findable against a dark ocean without
    // being filled with the reserved colour.
    ctx.strokeStyle = 'rgba(224, 163, 22, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, sy, UMBRA_R * r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();

  // The rim, drawn as the sunrise line it is. This is the thing the shadow is
  // travelling towards, so it should be visible before the shadow gets there.
  ctx.strokeStyle = '#e0a316';
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;

  // The penumbra's outline, so you can see it clip the rim even when its centre
  // has sailed off past the planet.
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(224, 163, 22, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, sy, PENUMBRA_R * r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
}
