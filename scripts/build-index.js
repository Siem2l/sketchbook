// Scans sketches/*/meta.json and writes gallery-data.json for the gallery page.
// Fails the build loudly on malformed metadata so broken sketches never publish.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sketchesDir = resolve(root, 'sketches');

const entries = [];
for (const dir of readdirSync(sketchesDir, { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name === '_template') continue;
  const metaPath = resolve(sketchesDir, dir.name, 'meta.json');
  if (!existsSync(metaPath)) {
    throw new Error(`sketches/${dir.name}: missing meta.json`);
  }
  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch (e) {
    throw new Error(`sketches/${dir.name}/meta.json: invalid JSON (${e.message})`);
  }
  for (const field of ['title', 'date']) {
    if (!meta[field]) throw new Error(`sketches/${dir.name}/meta.json: "${field}" is required`);
  }
  const conventionThumb = resolve(root, 'public', 'sketches', dir.name, 'thumb.png');
  const thumbnail = existsSync(conventionThumb) ? 'thumb.png' : (meta.thumbnail ?? null);

  entries.push({
    slug: dir.name,
    title: meta.title,
    date: meta.date,
    tags: meta.tags ?? [],
    description: meta.description ?? '',
    thumbnail,
  });
}

entries.sort((a, b) => b.date.localeCompare(a.date));
writeFileSync(resolve(root, 'gallery-data.json'), JSON.stringify(entries, null, 2));
console.log(`gallery-data.json: ${entries.length} sketch(es)`);
