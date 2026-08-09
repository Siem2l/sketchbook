#!/usr/bin/env node
// Takes a place offline. Geocodes an address through the PDOK locatieserver,
// pulls the two AHN coverages and the orthophoto for a window around it, and
// writes PDOK's own bytes into public/data/elsewhere/<slug>/.
//
// The bytes are not repacked. A packed 8-bytes-a-cell format gzips to 1.65 MB
// against 1.21 MB for these three files: JPEG and deflate already beat anything
// worth hand-rolling, so the cache format is "whatever PDOK sent".
//
//   node scripts/bake-place.js "Prins Hendriklaan 17, Utrecht" --span 480 --size 480
//   node scripts/bake-place.js "Prins Hendriklaan 17, Utrecht" --span 480 --size 64 --slug _fixture
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEOCODE = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';
const WCS = 'https://service.pdok.nl/rws/ahn/wcs/v1_0';
const WMS = 'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0';
const LICENCE = 'AHN CC BY 4.0 · orthophoto Beeldmateriaal.nl';

const args = process.argv.slice(2);
const query = args.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? dflt : args[i + 1];
};
if (!query) {
  console.error('usage: node scripts/bake-place.js "<address>" [--span 480] [--size 480] [--slug name]');
  process.exit(1);
}
const span = Number(opt('span', 480));
const size = Number(opt('size', 480));
const slugArg = opt('slug', null);

const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

async function geocode(q) {
  const url = `${GEOCODE}?q=${encodeURIComponent(q)}&rows=5&fl=weergavenaam,centroide_rd,type`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`geocode HTTP ${r.status}`);
  const docs = (await r.json()).response.docs;
  // Prefer a house number over the street it is on: "Prins Hendriklaan 17"
  // otherwise resolves to the middle of the whole street, 300 m away.
  const doc = docs.find((d) => d.type === 'adres') ?? docs[0];
  if (!doc) throw new Error(`no match for "${q}"`);
  const [x, y] = doc.centroide_rd.match(/POINT\(([-\d.]+) ([-\d.]+)\)/).slice(1).map(Number);
  return { name: doc.weergavenaam, x, y };
}

async function grab(url, path) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(path, buf);
  return buf.length;
}

const place = await geocode(query);
const half = span / 2;
const bbox = [place.x - half, place.y - half, place.x + half, place.y + half];
const dir = resolve(ROOT, 'public/data/elsewhere', slugArg ?? slugify(place.name));
mkdirSync(dir, { recursive: true });

const cov = (id) => `${WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${id}`
  + `&subset=x(${bbox[0]},${bbox[2]})&subset=y(${bbox[1]},${bbox[3]})`
  + `&scalesize=x(${size}),y(${size})&format=image/tiff`;
// WMS 1.3.0 with EPSG:28992 is easting-first. Northing-first returns HTTP 200
// and a valid 1.6 KB blank JPEG, which is a silent hour of debugging.
const ortho = `${WMS}?service=WMS&version=1.3.0&request=GetMap&layers=Actueel_orthoHR`
  + `&crs=EPSG:28992&bbox=${bbox.join(',')}&width=${size}&height=${size}`
  + `&format=image/jpeg&styles=`;

const sizes = {
  dsm: await grab(cov('dsm_05m'), resolve(dir, 'dsm.tif')),
  dtm: await grab(cov('dtm_05m'), resolve(dir, 'dtm.tif')),
  ortho: await grab(ortho, resolve(dir, 'ortho.jpg')),
};
writeFileSync(resolve(dir, 'place.json'), JSON.stringify({
  name: place.name, address: query, centre: [place.x, place.y], bbox,
  width: size, height: size, cell: span / size,
  source: 'PDOK AHN dsm_05m/dtm_05m + Actueel_orthoHR', licence: LICENCE,
}, null, 2) + '\n');

console.log(dir);
for (const [k, v] of Object.entries(sizes)) console.log(`  ${k}  ${(v / 1e3).toFixed(0)} KB`);
