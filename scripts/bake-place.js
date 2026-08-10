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
import { coverageUrl, orthoUrl, geocode } from '../shared/pdok.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
// Uncompressed by default: 35% more bytes for a decode that is 3,900x faster in
// a browser. --compress keeps one fixture on the deflate-plus-predictor path so
// the decoder's hardest branch stays tested.
const compress = args.includes('--compress');

const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

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

const cov = (id) => coverageUrl(id, bbox, size, { compressed: compress });
const ortho = orthoUrl(bbox, size);

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
