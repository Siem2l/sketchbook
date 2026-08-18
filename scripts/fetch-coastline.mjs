// Pulls Natural Earth's 1:110m land outline into one JSON file, so the globe
// reads as the Earth rather than as an abstract sphere with a grid on it.
//
//   node scripts/fetch-coastline.mjs
//
// Run by hand, like fetch-eclipses.mjs, and the output is committed: a page
// load never depends on GitHub being up.
//
// GeoJSON arrives as nested Polygon/MultiPolygon coordinate arrays, which is a
// lot of structure for something that gets drawn as plain open paths. It is
// flattened to one array per ring, [lon, lat, lon, lat, …], rounded to 0.1°.
// At the size this globe is drawn, 0.1° is about half a pixel — smaller than
// the line it is stroked with, so the rounding is invisible and it halves the
// file.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const URL_110M = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector'
  + '/master/geojson/ne_110m_land.geojson';

const res = await fetch(URL_110M);
if (!res.ok) throw new Error(`${URL_110M}: HTTP ${res.status}`);
const geo = await res.json();
if (geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
  throw new Error('not a FeatureCollection — Natural Earth changed shape');
}

const rings = [];
for (const f of geo.features) {
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates]
    : g.type === 'MultiPolygon' ? g.coordinates
      : null;
  if (!polys) throw new Error(`unexpected geometry ${g.type}`);
  for (const poly of polys) {
    for (const ring of poly) {
      const flat = [];
      for (const [lon, lat] of ring) {
        flat.push(Math.round(lon * 10) / 10, Math.round(lat * 10) / 10);
      }
      if (flat.length >= 6) rings.push(flat);   // three points or it is not a shape
    }
  }
}

if (rings.length < 100) throw new Error(`only ${rings.length} rings — the file looks truncated`);

mkdirSync(resolve(root, 'public', 'data'), { recursive: true });
writeFileSync(resolve(root, 'public', 'data', 'coastline.json'), JSON.stringify({ rings }));

const pts = rings.reduce((a, r) => a + r.length / 2, 0);
console.log(`${rings.length} rings, ${pts} points`);
