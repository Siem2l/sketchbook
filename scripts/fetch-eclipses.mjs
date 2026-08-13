// Pulls Fred Espenak's Five Millennium Catalog of Solar Eclipses (-1999 to
// +3000) into one JSON file. Run by hand, never by `make dev` — the sketch
// reads the committed output, so a page load never depends on NASA being up.
//
//   node scripts/fetch-eclipses.mjs
//
// Parsing the catalog resists both obvious approaches. Whitespace splitting
// fails because partial eclipses leave Path Width and Central Duration blank,
// so a row is 17 fields or 15 depending on whether the Moon's shadow touched
// the Earth. Fixed-column slicing fails because the BCE pages carry a negative
// year one character wider than the CE pages. What every row does have is a
// 5-digit catalog number at the front and NN[NS]/NNN[EW] hemisphere letters
// near the back, so the regex anchors on those and counts the columns between.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://eclipse.gsfc.nasa.gov/SEcat5';

// -1999 -> "-1999", -99 -> "-0099", 0 -> "0000", 1 -> "0001", 2901 -> "2901".
const fmt = (y) => (y < 0 ? '-' + String(-y).padStart(4, '0') : String(y).padStart(4, '0'));

function pages() {
  const out = [];
  for (let a = -1999; a < 0; a += 100) out.push([a, a + 99]);   // ...-0099..0000
  for (let a = 1; a <= 2901; a += 100) out.push([a, a + 99]);   // 0001-0100...
  return out.map(([a, b]) => `${BASE}/SE${fmt(a)}-${fmt(b)}.html`);
}

// catnum  year mon day  time  dT luna saros type QLE gamma mag lat lon alt ...
// Saros series numbers run negative for the earliest BCE centuries (the count
// is relative to the series' first eclipse, which for old series predates the
// catalog's start), so that field takes a sign like dT and luna do.
const ROW = /^(\d{5})\s+(-?\d{1,4})\s+(\w{3})\s+(\d+)\s+\S+\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(\S+)\s+(\S+)\s+(-?\d\.\d+)\s+(\d\.\d+)\s+(\d+)([NS])\s+(\d+)([EW])\s+(\d+)/;
// A line that starts like a row but does not match is a parse failure, not a
// line to skip. This is what tells the difference.
const LOOKS_LIKE_ROW = /^\d{5}\s+-?\d{1,4}\s+\w{3}\s/;

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.text();
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (i === tries - 1) throw new Error(`${url}: ${e.message}`);
      await new Promise((s) => setTimeout(s, 1000 * (i + 1)));
    }
  }
}

const rows = [];
let unmatched = 0;
const urls = pages();
console.log(`fetching ${urls.length} century pages`);

for (const url of urls) {
  const html = await get(url);
  for (const block of html.match(/<pre>[\s\S]*?<\/pre>/g) ?? []) {
    const text = block.replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    for (const line of text.split('\n')) {
      if (!LOOKS_LIKE_ROW.test(line)) continue;
      const m = ROW.exec(line);
      if (!m) { unmatched++; console.error(`unmatched: ${line.slice(0, 90)}`); continue; }
      rows.push({
        year: Number(m[2]),
        type: m[8][0],
        gamma: Number(m[10]),
        lat: Number(m[12]) * (m[13] === 'N' ? 1 : -1),
        lon: Number(m[14]) * (m[15] === 'E' ? 1 : -1),
        alt: Number(m[16]),
      });
    }
  }
  process.stdout.write('.');
}
console.log();

if (unmatched) throw new Error(`${unmatched} rows looked like data and did not parse`);
if (rows.length < 11000) throw new Error(`only ${rows.length} eclipses — a page came back empty`);

const out = {
  count: rows.length,
  year: rows.map((r) => r.year),
  lat: rows.map((r) => r.lat),
  lon: rows.map((r) => r.lon),
  alt: rows.map((r) => r.alt),
  gamma: rows.map((r) => r.gamma),
  type: rows.map((r) => r.type).join(''),
};

mkdirSync(resolve(root, 'public', 'data'), { recursive: true });
writeFileSync(resolve(root, 'public', 'data', 'eclipses.json'), JSON.stringify(out));

const horizon = rows.filter((r) => r.alt === 0);
const lats = horizon.map((r) => Math.abs(r.lat));
console.log(`${rows.length} eclipses, ${rows[0].year} to ${rows[rows.length - 1].year}`);
console.log(`${horizon.length} at the horizon (${(100 * horizon.length / rows.length).toFixed(1)}%), `
  + `|lat| ${Math.min(...lats)}-${Math.max(...lats)}`);
