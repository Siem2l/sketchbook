// Everything that talks to PDOK, plus the arithmetic that goes with it.
//
// RD (EPSG:28992) is metric and locally flat, so distance is Pythagoras and
// bearing is atan2. No geodesy, no projection library, no degrees anywhere
// except in what the readout prints.

const GEOCODE = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';
const WCS = 'https://service.pdok.nl/rws/ahn/wcs/v1_0';
const WMS = 'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0';

export const FETCH_SPAN = 240;
export const FETCH_SIZE = 480;

export const fetchTileKey = (x, y) =>
  `${Math.floor(x / FETCH_SPAN)}:${Math.floor(y / FETCH_SPAN)}`;

export function fetchTileBbox(key) {
  const [tx, tz] = key.split(':').map(Number);
  const minx = tx * FETCH_SPAN, miny = tz * FETCH_SPAN;
  return [minx, miny, minx + FETCH_SPAN, miny + FETCH_SPAN];
}

// geotiff:compression=None costs 35% more bytes — 923 KB against 683 KB — and
// is 3,900 times faster to decode in a browser: 14 ms against 55 seconds,
// measured on the same tile. Deflate is not slow because inflating is slow. It
// is slow because a striped TIFF has 120 strips, each needing its own
// DecompressionStream, and each of those yields to the event loop. Against a
// render loop drawing 296k points those yields never come back. Bandwidth is
// cheap and the main thread is not.
//
// The bake script passes compressed:true for one small fixture, so the
// decoder's predictor branch stays under test.
export const coverageUrl = (id, bbox, size, { compressed = false } = {}) =>
  `${WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${id}`
  + `&subset=x(${bbox[0]},${bbox[2]})&subset=y(${bbox[1]},${bbox[3]})`
  + `&scalesize=x(${size}),y(${size})&format=image/tiff`
  + (compressed ? '' : '&geotiff:compression=None');

// WMS 1.3.0 with EPSG:28992 is easting-first. Northing-first returns HTTP 200
// and a valid 1.6 KB blank JPEG, so nothing reports this as a mistake.
export const orthoUrl = (bbox, size) =>
  `${WMS}?service=WMS&version=1.3.0&request=GetMap&layers=Actueel_orthoHR`
  + `&crs=EPSG:28992&bbox=${bbox.join(',')}&width=${size}&height=${size}`
  + `&format=image/jpeg&styles=`;

const ROSE = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

export function journey(from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const metres = Math.hypot(dx, dy) || 1;
  const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  const km = metres / 1000;
  return {
    km,
    bearing,
    rose: ROSE[Math.round(bearing / 22.5) % 16],
    dirX: dx / metres,
    dirZ: -dy / metres,          // scene z runs opposite to northing
    // Long enough to read as a journey, short enough not to be a wait. Log so
    // the next street is a hop and Groningen is a proper trip.
    seconds: Math.min(3.5, 0.9 + 0.55 * Math.log10(1 + km * 10)),
  };
}

export async function geocode(query, fetchImpl = fetch) {
  const url = `${GEOCODE}?q=${encodeURIComponent(query)}&rows=5&fl=weergavenaam,centroide_rd,type`;
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`the address service answered ${r.status}`);
  const docs = (await r.json()).response?.docs ?? [];
  // Prefer a house number over the street it sits on: "Prins Hendriklaan 17"
  // otherwise resolves to the middle of the whole street, 300 m away.
  const doc = docs.find((d) => d.type === 'adres') ?? docs[0];
  const m = doc?.centroide_rd?.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
  if (!m) throw new Error('no match in the Netherlands');
  return { name: doc.weergavenaam, x: Number(m[1]), y: Number(m[2]) };
}

// The Cache API in front of every byte. Repeat visits and shader iteration cost
// no network at all, and PDOK is asked for each tile once per browser rather
// than once per reload. Storing the country is not an option — 21.1 MB/km2 over
// 41,500 km2 is about 876 GB — so what is visited is all that is kept.
export async function cachedFetch(url, cache) {
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return hit.arrayBuffer();
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (cache) await cache.put(url, res.clone());
  return res.arrayBuffer();
}
