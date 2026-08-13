// Orthographic projection and the sphere's furniture. Six lines of trig, which
// is why this sketch imports no drawing library: p5's WEBGL mode would mean
// fighting a camera to arrive back here, and d3-geo would charge per-frame path
// generation for a projection that is three cosines.
const RAD = Math.PI / 180;

// view.lambda = longitude at the centre, view.phi = latitude at the centre.
//
// Visible means z > 0, everywhere in this sketch. Exactly zero is the limb
// itself, seen edge-on, and it is culled rather than drawn — the one convention
// both this file and points.js follow, because a graticule that keeps its limb
// points and a scatter that drops them disagree by a hairline at the edge of
// the disc and nobody ever finds out why.
export function project(latDeg, lonDeg, view) {
  const lat = latDeg * RAD, dl = (lonDeg - view.lambda) * RAD, phi = view.phi * RAD;
  const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
  const cosDl = Math.cos(dl);
  return {
    x: cosLat * Math.sin(dl),
    y: Math.cos(phi) * sinLat - Math.sin(phi) * cosLat * cosDl,
    z: Math.sin(phi) * sinLat + Math.cos(phi) * cosLat * cosDl,
  };
}

function strokeParallel(ctx, latDeg, view, r, cx, cy) {
  ctx.beginPath();
  let drawing = false;
  for (let lon = -180; lon <= 180; lon += 2) {
    const q = project(latDeg, lon, view);
    if (q.z <= 0) { drawing = false; continue; }
    const px = cx + q.x * r, py = cy - q.y * r;
    if (drawing) ctx.lineTo(px, py); else { ctx.moveTo(px, py); drawing = true; }
  }
  ctx.stroke();
}

function strokeMeridian(ctx, lonDeg, view, r, cx, cy) {
  ctx.beginPath();
  let drawing = false;
  for (let lat = -90; lat <= 90; lat += 2) {
    const q = project(lat, lonDeg, view);
    if (q.z <= 0) { drawing = false; continue; }
    const px = cx + q.x * r, py = cy - q.y * r;
    if (drawing) ctx.lineTo(px, py); else { ctx.moveTo(px, py); drawing = true; }
  }
  ctx.stroke();
}

export function drawGlobe(ctx, view, r, cx, cy) {
  ctx.fillStyle = '#15151a';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

  // 60 and 72 are drawn heavier below, so the plain graticule skips ±60 rather
  // than laying a thin line under a thick one.
  const BAND = [-72, -60, 60, 72];

  ctx.lineWidth = 1;
  ctx.strokeStyle = '#26262e';
  for (let lat = -75; lat <= 75; lat += 15) {
    if (BAND.includes(lat)) continue;
    strokeParallel(ctx, lat, view, r, cx, cy);
  }
  for (let lon = -180; lon < 180; lon += 15) strokeMeridian(ctx, lon, view, r, cx, cy);

  // 60 and 72 are exactly what the horizon eclipses refuse to cross — measured
  // over all 11,898, not rounded to the graticule, which is why 72 is not on
  // the 15° grid above. Drawing them is the difference between a pattern a
  // viewer notices and one they can check.
  ctx.strokeStyle = '#3c4a46';
  ctx.lineWidth = 1.5;
  for (const lat of BAND) strokeParallel(ctx, lat, view, r, cx, cy);

  ctx.strokeStyle = '#2e2e38';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
}
