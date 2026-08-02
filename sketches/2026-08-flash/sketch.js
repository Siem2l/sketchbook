// flash — a tattoo brief generator built so that nothing chooses the idea.
//
// Three mechanisms, in order of how much they matter:
//
//   1. The subject is walked out of the tree of life at random. Pick a kingdom,
//      pick a uniformly random *order* out of the several hundred under it, then
//      a uniformly random species inside that order. Sampling flat over the tree
//      rather than over popularity is what turns up Verongiida and Embioptera
//      instead of a wolf, a moth and a snake. About half of rolls take this
//      route; the rest come from a hand-written deck of specific objects.
//   2. Everything else comes from fixed decks (decks.js), combined by a seeded
//      PRNG. The cross-product is the surprise; nothing picks at roll time.
//   3. You are the taste function. ♥ and ✕ reweight the decks permanently, so
//      the thing narrows towards you rather than towards the middle of a corpus.
//
// References are fetched live and client-side — the site is static nginx, so
// every source here has to be keyless and CORS-open. The Met Collection API,
// iNaturalist and Wikimedia Commons all are. The Biodiversity Heritage Library's
// own API needs a key, so its plates are reached through Commons instead, where
// they live under "Files from the Biodiversity Heritage Library".
//
// The wall is allowed to fail. The brief is the deliverable and renders offline.

import { LINEAGE, TECHNIQUE, FORMAT, CONSTRAINT, TWIST, OBJECTS, ROOTS, DECKS } from './decks.js';

// ---------------------------------------------------------------------- seeded
// cyrb128 + sfc32, the same pair message-noise uses, so a seed means the same
// thing across the sketchbook.
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}
function sfc32(a, b, c, d) {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9); b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}
const makeRng = (seed) => { const s = cyrb128(String(seed)); return sfc32(s[0], s[1], s[2], s[3]); };
const newSeed = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');

// ----------------------------------------------------------------------- store
// Weights, saved briefs and pinned references, in localStorage. Weights are
// multiplicative: ♥ multiplies by 2.2 up to a ceiling, ✕ by 0.34 down to a floor
// that never quite reaches zero — a killed entry stays possible, just rare, so
// the deck can't be permanently narrowed by one impatient afternoon.
const KEY = 'flash.v1';
const KEEP = 2.2, KILL = 0.34, CEIL = 14, FLOOR = 0.02;
const blank = () => ({ weights: {}, saved: [], pins: [] });
let store = blank();
try { store = { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* corrupt or blocked */ }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private mode */ } };
const wOf = (key) => store.weights[key] ?? 1;
function nudge(key, up) {
  const next = up ? Math.min(CEIL, wOf(key) * KEEP) : Math.max(FLOOR, wOf(key) * KILL);
  if (Math.abs(next - 1) < 1e-6) delete store.weights[key]; else store.weights[key] = next;
  persist();
}

// A weighted draw over indices, using one number from the seeded stream. Deck
// order never changes, so a given seed keeps meaning the same thing until you
// actually reweight something — which is the one thing allowed to change it.
function drawIdx(deckName, n, frac) {
  let total = 0;
  const w = new Array(n);
  for (let i = 0; i < n; i++) { w[i] = wOf(`${deckName}:${i}`); total += w[i]; }
  let t = frac * total;
  for (let i = 0; i < n; i++) { t -= w[i]; if (t <= 0) return i; }
  return n - 1;
}
const drawFrom = (deckName, deck, frac) => {
  const idx = drawIdx(deckName, deck.length, frac);
  return { deck: deckName, idx, key: `${deckName}:${idx}`, ...deck[idx] };
};

// ------------------------------------------------------------------- fetching
const memo = new Map();
async function jget(url, ms = 11000) {
  if (memo.has(url)) return memo.get(url);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    memo.set(url, j);
    return j;
  } finally { clearTimeout(timer); }
}

const INAT = 'https://api.inaturalist.org/v1';
const MET = 'https://collectionapi.metmuseum.org/public/collection/v1';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';

// ---------------------------------------------------------------- taxon walk
// iNaturalist orders its results by observation count, so a *random offset* into
// a clade is the lever that gets you away from the charismatic head of the
// distribution. Its paging tops out around offset 10000, hence the clamp.
const INAT_MAX_OFFSET = 10000;

async function cladeSize(parentId, rank) {
  const d = await jget(`${INAT}/taxa?taxon_id=${parentId}&rank=${rank}&per_page=1`);
  return d?.total_results || 0;
}
async function cladeAt(parentId, rank, frac) {
  const total = await cladeSize(parentId, rank);
  if (!total) return null;
  const page = 1 + Math.floor(frac * Math.min(total, INAT_MAX_OFFSET));
  const d = await jget(`${INAT}/taxa?taxon_id=${parentId}&rank=${rank}&per_page=1&page=${page}`);
  return d?.results?.[0] || null;
}
function pickRoot(frac) {
  // Kingdom weights from the deck, modulated by anything the user has killed.
  const w = ROOTS.map((r) => r.w * wOf(`root:${r.id}`));
  const total = w.reduce((a, b) => a + b, 0);
  let t = frac * total;
  for (let i = 0; i < ROOTS.length; i++) { t -= w[i]; if (t <= 0) return ROOTS[i]; }
  return ROOTS[0];
}
async function walkTaxon(fracs) {
  const root = pickRoot(fracs[0]);
  const order = await cladeAt(root.id, 'order', fracs[1]);
  if (!order) return null;
  // Three offsets inside the order, looking for one that has a photo — obscure
  // clades are exactly the ones most likely to have an empty species record.
  for (let i = 0; i < 3; i++) {
    const sp = await cladeAt(order.id, 'species', (fracs[2] + i * 0.3819) % 1);
    if (sp?.default_photo) return { taxon: sp, order, root, depth: 'species' };
  }
  if (order.default_photo) return { taxon: order, order, root, depth: 'order' };
  return null;
}

// -------------------------------------------------------------- ref adapters
const bigPhoto = (u) => String(u || '').replace(/\/square\.(jpe?g|png|gif)/i, '/large.$1');
const strip = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function sampleN(arr, n, rnd) {
  const a = arr.slice(0, 400);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

// The Met's search is generous to a fault: ask it for "printing type metal" and
// it will happily hand back a sacristy cabinet. Fetching a few extra objects and
// keeping the ones that actually mention a query word somewhere tightens it a
// lot, with a fallback so a strict filter can't empty the column.
function metRelevant(objs, q) {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  if (!words.length) return objs;
  const hay = (o) => [o.title, o.objectName, o.medium, o.culture, o.classification, o.department]
    .filter(Boolean).join(' ').toLowerCase();
  const hits = objs.filter((o) => words.some((w) => hay(o).includes(w)));
  return hits.length >= 2 ? hits : objs;
}

async function metRefs(q, n, rnd) {
  if (!q.trim()) return [];
  const s = await jget(`${MET}/search?q=${encodeURIComponent(q)}&hasImages=true`);
  const ids = s?.objectIDs || [];
  if (!ids.length) return [];
  const objs = await Promise.all(sampleN(ids, n + 6, rnd).map((id) => jget(`${MET}/objects/${id}`).catch(() => null)));
  return metRelevant(objs.filter((o) => o && o.primaryImageSmall), q)
    .slice(0, n)
    .map((o) => ({
      src: 'met', badge: 'met',
      thumb: o.primaryImageSmall,
      full: o.primaryImage || o.primaryImageSmall,
      page: o.objectURL || `https://www.metmuseum.org/art/collection/search/${o.objectID}`,
      title: o.title || o.objectName || 'untitled',
      credit: [o.artistDisplayName || o.culture, o.objectDate].filter(Boolean).join(', ')
        + (o.isPublicDomain ? ' · CC0' : ' · Met OA'),
    }));
}

// Commons needs more care than the other two. Its search is strict AND across
// terms, so `x OR y` groups swamp the subject and every query comes back with
// the same million hits — don't. And most of what sits in the BHL category is a
// whole scanned *book* (PDF/DjVu) whose thumbnail is a cover, not a plate, so
// `filetype:bitmap` is doing real work here rather than being a tidy-up.
const NATIVE = /^image\/(jpeg|png|gif|webp)$/;
// Scanned volumes come with a lot of furniture — microfiche headers, title
// pages, blank versos, indexes. None of it is a plate.
// Kept deliberately narrow: a bare /spine/ would throw away every spine-tailed
// swift, and /blank/ every blanket octopus.
const NOT_A_PLATE = /microfich|title page|(front|back|book)\s*cover|book\s*spine|blank (page|leaf|verso|folio)|colophon|table of contents|(front|back) matter|\bindex\b|\berrata\b/i;
const tidyTitle = (t) => strip(t)
  .replace(/^File:/, '')
  .replace(/\.(jpe?g|png|gif|webp|tiff?)$/i, '')
  .replace(/\s*\((IA|LCCN|BHL)[^)]*\)/gi, '')
  .replace(/\s*\(\d{6,}\)\s*$/, '')
  .replace(/_/g, ' ')
  .trim();

async function commonsRefs(search, n, badge = 'plate') {
  if (!search.trim()) return [];
  const url = `${COMMONS}?action=query&generator=search&gsrsearch=${encodeURIComponent(search + ' filetype:bitmap')}`
    + `&gsrnamespace=6&gsrlimit=${n + 8}&prop=imageinfo&iiprop=url%7Cmime%7Cextmetadata&iiurlwidth=800&format=json&origin=*`;
  const d = await jget(url);
  return Object.values(d?.query?.pages || {})
    .map((p) => {
      const ii = p.imageinfo?.[0];
      if (!ii?.thumburl) return null;
      const mime = ii.mime || '';
      if (!mime.startsWith('image/') || mime === 'image/vnd.djvu') return null;
      if (NOT_A_PLATE.test(p.title || '')) return null;
      const m = ii.extmetadata || {};
      return {
        src: 'commons', badge,
        thumb: ii.thumburl,
        // A TIFF original would be a 200MB download in the lightbox; Commons
        // renders thumbnails at any width, so ask it for a bigger one instead.
        full: NATIVE.test(mime) ? ii.url : ii.thumburl.replace(/\/\d+px-/, '/1600px-'),
        page: ii.descriptionurl,
        title: tidyTitle(p.title) || 'plate',
        credit: [strip(m.Artist?.value), strip(m.LicenseShortName?.value) || 'see Commons'].filter(Boolean).join(' · '),
      };
    })
    .filter(Boolean)
    .slice(0, n);
}

// Obscure clades are exactly the ones the archives have never catalogued under
// their own name — Verongiida returns nothing, Aplysina returns 164. So walk up
// until something answers, rather than showing an empty column.
async function commonsCascade(rungs, n, badge) {
  for (const rung of rungs) {
    if (!rung || !rung.trim()) continue;
    const refs = await commonsRefs(rung, n, badge).catch(() => []);
    if (refs.length) return refs;
  }
  return [];
}

async function inatRefs(taxonId, n, fallbackId) {
  const grab = async (id) => {
    const d = await jget(`${INAT}/observations?taxon_id=${id}&photos=true&quality_grade=research&per_page=${n}&order_by=votes`);
    return (d?.results || []).flatMap((o) => (o.photos || []).slice(0, 1).map((ph) => ({
      src: 'inat', badge: 'alive',
      thumb: bigPhoto(ph.url),
      full: bigPhoto(ph.url).replace(/\/large\./, '/original.'),
      page: `https://www.inaturalist.org/observations/${o.id}`,
      title: strip(o.taxon?.preferred_common_name || o.taxon?.name || 'observation'),
      credit: [strip(ph.attribution) || 'iNaturalist', o.place_guess ? strip(o.place_guess) : ''].filter(Boolean).join(' · '),
    })));
  };
  let out = await grab(taxonId).catch(() => []);
  // Obscure species often have almost no research-grade records — widen to the
  // order rather than showing an empty wall.
  if (out.length < 2 && fallbackId && fallbackId !== taxonId) {
    out = out.concat(await grab(fallbackId).catch(() => []));
  }
  return out.slice(0, n);
}

// ------------------------------------------------------------------- the roll
// Every random draw is taken from the seeded stream in a fixed order, so a seed
// plus a set of weights always reproduces the same brief.
function rollSync(seed) {
  const rnd = makeRng(seed);
  const routeFrac = rnd();
  const walkFracs = [rnd(), rnd(), rnd()];
  const b = {
    seed,
    lineage: drawFrom('lineage', LINEAGE, rnd()),
    technique: drawFrom('technique', TECHNIQUE, rnd()),
    format: drawFrom('format', FORMAT, rnd()),
    constraint: drawFrom('constraint', CONSTRAINT, rnd()),
    twist: drawFrom('twist', TWIST, rnd()),
  };
  const objectSubject = drawFrom('object', OBJECTS, rnd());
  const wantTaxon = routeFrac < 0.55 * wOf('route:taxon');
  return { brief: b, objectSubject, wantTaxon, walkFracs, rnd };
}

const taxonSubject = (walked) => {
  const t = walked.taxon;
  return {
    deck: 'taxon', idx: t.id, key: `root:${walked.root.id}`,
    v: strip(t.preferred_common_name) || t.name,
    latin: t.name,
    note: '',
    q: strip(t.preferred_common_name) || t.name,
    taxon: t, order: walked.order, root: walked.root, depth: walked.depth,
    link: `https://www.inaturalist.org/taxa/${t.id}`,
    photo: bigPhoto(t.default_photo?.medium_url || t.default_photo?.url),
  };
};

// The deck half is pure and instant; the taxonomic walk is up to six sequential
// calls to a live archive. Building them together meant a slow iNaturalist held
// the entire brief — seed included — off the screen for as long as it took. So
// the decks land first and the subject upgrades in place when the walk returns.
function rollDecks(seed, locks = {}, prev = null) {
  const { brief: b, objectSubject, wantTaxon, walkFracs, rnd } = rollSync(seed);
  b.subject = objectSubject;
  b.wantTaxon = wantTaxon; b.walkFracs = walkFracs; b.rnd = rnd;
  // Locked rows survive the re-roll untouched.
  for (const name of AXES) if (locks[name] && prev?.[name]) b[name] = prev[name];
  return b;
}

// Resolves true when it actually replaced the subject, so the caller knows
// whether a second render is worth doing.
async function walkInSubject(b) {
  if (!b.wantTaxon || locks.subject) return false;
  const walked = await walkTaxon(b.walkFracs).catch(() => null);
  if (!walked || b !== current) return false;   // a newer roll won the race
  b.subject = taxonSubject(walked);
  return true;
}

const AXES = ['subject', 'lineage', 'technique', 'format', 'constraint', 'twist'];
const LABELS = { subject: 'subject', lineage: 'lineage', technique: 'technique', format: 'format & placement', constraint: 'the hard rule', twist: 'twist' };

// ---------------------------------------------------------------------- state
const $ = (id) => document.getElementById(id);
let current = null;
let locks = {};
let token = 0;          // guards stale wall results
let wall = [];
const seen = new Set(); // dedupe by image url within a roll

// ------------------------------------------------------------------ rendering
function subjectHTML(s) {
  if (s.deck !== 'taxon') {
    return `<div class="axis-value">${esc(s.v)}</div>`;
  }
  const common = strip(s.taxon.preferred_common_name);
  const latin = `<em>${esc(s.latin)}</em>`;
  return `<div class="axis-value">${common ? esc(common) : latin}</div>`
    + (common ? `<div class="axis-note">${latin} · <a href="${esc(s.link)}" target="_blank" rel="noopener">iNaturalist</a></div>`
      : `<div class="axis-note"><a href="${esc(s.link)}" target="_blank" rel="noopener">iNaturalist</a></div>`)
    + `<div class="sub-meta">`
    + `<span class="route">walked</span>`
    + `<span>${esc(s.root.name)}</span>`
    // When no species under the order had a photo the walk stops at the order,
    // and the subject *is* the order — repeating it as provenance reads as a bug.
    + (s.depth === 'order' ? ''
      : `<span>${esc(s.order.name)}${s.order.preferred_common_name ? ' — ' + esc(strip(s.order.preferred_common_name)) : ''}</span>`)
    + `<span>${esc(s.depth)}</span>`
    + `</div>`;
}

function axisHTML(name, a) {
  const locked = !!locks[name];
  const w = a.key ? wOf(a.key) : 1;
  const heat = w > 1.01 ? 'kept' : w < 0.99 ? 'weighted' : '';
  const body = name === 'subject'
    ? subjectHTML(a)
    : `<div class="axis-value">${esc(a.v)}</div>${a.note ? `<div class="axis-note">${esc(a.note)}</div>` : ''}`;
  return `
    <div class="axis ${name} ${heat}" data-axis="${name}">
      <div class="axis-head">
        <span class="axis-label">${esc(LABELS[name])}</span>
        <span class="axis-tools">
          <button class="tool keep" data-act="keep" data-axis="${name}" title="more of this" aria-pressed="${w > 1.01}">♥</button>
          <button class="tool kill" data-act="kill" data-axis="${name}" title="less of this" aria-pressed="${w < 0.99}">✕</button>
          <button class="tool" data-act="spin" data-axis="${name}" title="re-roll this row">⇄</button>
          <button class="tool lock" data-act="lock" data-axis="${name}" title="lock against the next roll" aria-pressed="${locked}">⚿</button>
        </span>
      </div>
      ${body}
    </div>`;
}

function renderBrief() {
  if (!current) return;
  const tilted = Object.keys(store.weights).length;
  $('brief').innerHTML = AXES.map((n) => axisHTML(n, current[n])).join('')
    + `<div class="brief-foot">
         <span>seed <b>${esc(current.seed)}</b></span>
         <span>·</span>
         <span>${current.subject.deck === 'taxon' ? 'subject walked from the tree' : 'subject from the object deck'}</span>
         ${tilted ? `<span>·</span><span><b>${tilted}</b> entr${tilted === 1 ? 'y' : 'ies'} reweighted by you</span>` : ''}
       </div>`;
  $('seed').value = current.seed;
  location.replace('#' + current.seed);
}

function cardHTML(r, i) {
  const pinned = store.pins.some((p) => p.full === r.full);
  return `
    <figure class="ref" data-i="${i}">
      <span class="badge ${esc(r.badge)}">${esc(r.badge)}</span>
      <button class="pin" data-act="pin" data-i="${i}" title="pin this reference" aria-pressed="${pinned}">♥</button>
      <img class="shot" src="${esc(r.thumb)}" alt="${esc(r.title)}" loading="lazy" decoding="async">
      <figcaption>
        <span class="cap-title">${esc(r.title).slice(0, 110)}</span>
        <span class="cred">${esc(r.credit).slice(0, 90)}</span>
      </figcaption>
    </figure>`;
}

function renderWall() {
  const el = $('wall');
  if (!wall.length) return;
  el.innerHTML = wall.map(cardHTML).join('');
  $('wall-sources').textContent = ['alive', 'plate', 'met', 'lineage']
    .map((b) => [b, wall.filter((r) => r.badge === b).length])
    .filter(([, n]) => n).map(([b, n]) => `${b} ${n}`).join('   ');
}

function skeletons(n = 8) {
  $('wall').innerHTML = Array.from({ length: n }, () => '<div class="skel"></div>').join('');
  $('wall-sources').textContent = '';
}

// Which queries to run, given what the subject turned out to be. A walked taxon
// gets its living photographs from iNaturalist and its engraved ancestors from
// the BHL plates on Commons; the Met is asked about the *lineage* as much as the
// subject, since it has never heard of a species with four observations.
//
// The fourth column is always the lineage itself. It is the one query that can't
// come back empty, and it's the reference you actually need anyway — you can
// picture the animal, but not necessarily what an Etruscan bronze mirror looks
// like at the moment you're asked to draw one.
const BHL_CAT = 'incategory:"Files from the Biodiversity Heritage Library"';

function wallJobs(b) {
  const rnd = b.rnd || makeRng(b.seed + 'w');
  // Some lineages are modern or vernacular enough that no museum indexes them
  // under a tidy term, so they carry no search hint — fall back to their own
  // name, which Commons usually knows even when the Met doesn't.
  const lin = b.lineage.q || '';
  const linSearch = lin || b.lineage.v;
  const lineageJob = commonsCascade([linSearch, linSearch.split(/\s+/)[0]], 3, 'lineage');

  if (b.subject.deck === 'taxon') {
    const latin = b.subject.latin || '';
    const genus = latin.split(/\s+/)[0];
    const common = strip(b.subject.taxon.preferred_common_name);
    const ord = b.subject.order.name;
    const ordCommon = strip(b.subject.order.preferred_common_name);
    return [
      inatRefs(b.subject.taxon.id, 4, b.subject.order.id),
      commonsCascade(rungs([
        [latin, BHL_CAT], [genus, BHL_CAT], [ord, BHL_CAT],
        [genus, 'illustration'], [ord, 'illustration'], [ordCommon, 'illustration'],
        // Last resort: the bare taxon name. Specific enough to stay honest, and
        // for a clade the plate literature never covered — an extinct order of
        // brachiopods — fossil photographs are the only reference there is.
        [latin, ''], [genus, ''], [ord, ''],
      ]), 4, 'plate'),
      metRefs(`${common || ordCommon || ord} ${lin}`.trim(), 3, rnd),
      lineageJob,
    ];
  }

  const q = b.subject.q || b.subject.v;
  const head = q.split(/\s+/).slice(0, 2).join(' ');
  return [
    metRefs(`${q} ${lin}`.trim(), 4, rnd),
    metRefs(q, 3, rnd),
    commonsCascade(rungs([[q, BHL_CAT], [q, 'engraving'], [q, ''], [head, 'engraving']]), 4, 'plate'),
    lineageJob,
  ];
}

// Build search rungs from [subject, qualifier] pairs, dropping any whose
// subject half is empty. Without this, a taxon with no common name produces a
// rung of bare "illustration" — which matches the entire archive, and quietly
// fills the plate column with pomegranates for a brachiopod.
const rungs = (pairs) => pairs
  .filter(([subject]) => subject && subject.trim())
  .map(([subject, qualifier]) => `${subject} ${qualifier}`.trim());

function loadWall(b) {
  const mine = ++token;
  wall = []; seen.clear();
  skeletons();
  $('wall-status').textContent = 'fetching…';
  let done = 0, failed = 0;
  const jobs = wallJobs(b);
  jobs.forEach((p) => p.then((refs) => {
    if (mine !== token) return;
    for (const r of refs) {
      // Archives hold whole series under near-identical names — three sheets of
      // the same deck of cards is one reference, not three. Dedupe on the URL
      // and on the title with its numbering filed off.
      const dupe = titleKey(r.title);
      if (!r.thumb || seen.has(r.full) || (dupe && seen.has(dupe))) continue;
      seen.add(r.full); if (dupe) seen.add(dupe);
      wall.push(r);
    }
    // Interleave sources so the wall doesn't come out in four solid blocks.
    wall = interleave(wall).slice(0, 16);
    renderWall();
  }).catch(() => { failed++; }).finally(() => {
    if (mine !== token) return;
    done++;
    if (done === jobs.length) {
      $('wall-status').innerHTML = wall.length
        ? (failed ? `<span class="err">${failed} source${failed > 1 ? 's' : ''} unreachable</span>` : '')
        : '<span class="err">no references found</span>';
      if (!wall.length) {
        $('wall').innerHTML = `<div class="wall-empty">
          Nothing came back for this one.<br>
          Either the archives have never heard of it — which is its own kind of brief —<br>
          or you are offline. The brief on the left stands either way.</div>`;
      }
    }
  }));
}

const titleKey = (t) => String(t || '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

function interleave(list) {
  const buckets = new Map();
  for (const r of list) { if (!buckets.has(r.badge)) buckets.set(r.badge, []); buckets.get(r.badge).push(r); }
  const out = []; const keys = [...buckets.keys()];
  for (let i = 0; out.length < list.length; i++) {
    let placed = false;
    for (const k of keys) { const b = buckets.get(k); if (b[i] !== undefined) { out.push(b[i]); placed = true; } }
    if (!placed) break;
  }
  return out;
}

// ------------------------------------------------------------------- actions
async function go(seed, keepLocks = false) {
  const prev = current;
  if (!keepLocks) locks = {};
  current = rollDecks(seed, locks, prev);
  renderBrief();
  if (await walkInSubject(current)) renderBrief();
  loadWall(current);
}

// Re-roll a single row without disturbing the others: draw from that deck alone
// with fresh entropy, which is why it doesn't use the brief's seeded stream.
async function spin(name) {
  if (!current) return;
  if (name === 'subject') {
    const rnd = makeRng(newSeed());
    const walked = current.subject.deck === 'taxon'
      ? await walkTaxon([rnd(), rnd(), rnd()]).catch(() => null)
      : null;
    if (walked) {
      current.subject = taxonSubject(walked);
    } else {
      current.subject = drawFrom('object', OBJECTS, Math.random());
    }
  } else {
    current[name] = drawFrom(name, DECKS[name], Math.random());
  }
  renderBrief();
  loadWall(current);
}

function briefText(b) {
  const prov = b.subject.deck === 'taxon'
    ? [b.subject.depth === 'order' ? null : b.subject.order.name, b.subject.root.name].filter(Boolean).join(', ')
    : '';
  const subj = b.subject.deck === 'taxon'
    ? `${b.subject.v}${b.subject.latin && b.subject.v !== b.subject.latin ? ` (${b.subject.latin})` : ''} — ${prov}`
    : b.subject.v;
  return [
    `SUBJECT     ${subj}`,
    `LINEAGE     ${b.lineage.v} — ${b.lineage.note}`,
    `TECHNIQUE   ${b.technique.v} — ${b.technique.note}`,
    `FORMAT      ${b.format.v} — ${b.format.note}`,
    `HARD RULE   ${b.constraint.v}`,
    `TWIST       ${b.twist.v}`,
    ``,
    `flash · seed ${b.seed}`,
  ].join('\n');
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.dataset.show = 'false'; }, 1700);
}

function saveBrief() {
  if (!current) return;
  if (store.saved.some((s) => s.seed === current.seed)) { toast('already on the shelf'); return; }
  store.saved.unshift({
    seed: current.seed,
    subject: current.subject.deck === 'taxon' ? (current.subject.v || current.subject.latin) : current.subject.v,
    latin: current.subject.latin || '',
    line: `${current.lineage.v} · ${current.technique.v} · ${current.format.v}`,
    rule: current.constraint.v,
    thumbs: wall.slice(0, 3).map((r) => ({ t: r.thumb, p: r.page })),
  });
  store.saved = store.saved.slice(0, 120);
  persist(); syncShelfCount(); toast('saved');
}

const syncShelfCount = () => { $('shelf-n').textContent = store.saved.length; };

// ------------------------------------------------------------------- drawer
let tab = 'briefs';
function renderDrawer() {
  const body = $('drawer-body');
  if (tab === 'briefs') {
    body.innerHTML = store.saved.length ? store.saved.map((s, i) => `
      <div class="saved-item">
        <div class="s-act">
          <button class="tool" data-act="open-saved" data-i="${i}" title="load this brief">↗</button>
          <button class="tool" data-act="drop-saved" data-i="${i}" title="remove">✕</button>
        </div>
        <div class="s-sub">${esc(s.subject)}</div>
        <div class="s-line">${esc(s.line)}</div>
        <div class="s-line"><b>${esc(s.rule)}</b></div>
        ${s.thumbs?.length ? `<div class="pinwall">${s.thumbs.map((t) => `<a href="${esc(t.p)}" target="_blank" rel="noopener"><img src="${esc(t.t)}" alt="" loading="lazy"></a>`).join('')}</div>` : ''}
        <div class="s-seed">seed ${esc(s.seed)}</div>
      </div>`).join('')
      : '<div class="empty-note">Nothing saved yet.<br>Press <b>s</b> on a brief you want to keep.</div>';
  } else if (tab === 'pins') {
    body.innerHTML = store.pins.length
      ? `<div class="pinwall" style="grid-template-columns:repeat(2,1fr)">${store.pins.map((p, i) => `
          <a href="${esc(p.page)}" target="_blank" rel="noopener" title="${esc(p.title)}"><img src="${esc(p.thumb)}" alt="" loading="lazy"></a>`).join('')}</div>
         <div class="empty-note">${store.pins.length} pinned. <button class="tool" data-act="clear-pins" style="width:auto;padding:0 7px">clear</button></div>`
      : '<div class="empty-note">No pinned references.<br>Hover a reference and press its <b>♥</b>.</div>';
  } else {
    const rows = Object.entries(store.weights).map(([key, w]) => {
      const [d, i] = key.split(':');
      let label = key;
      if (d === 'root') label = ROOTS.find((r) => String(r.id) === i)?.name || key;
      else if (d === 'route') label = 'organism subjects';
      else if (DECKS[d]) label = DECKS[d][+i]?.v || key;
      return { d, label, w };
    }).sort((a, b) => b.w - a.w);
    body.innerHTML = rows.length
      ? rows.map((r) => `<div class="heat-row ${r.w > 1 ? 'up' : 'down'}">
            <span class="hl">${esc(r.d)}</span>
            <span class="hv">${esc(r.label)}</span>
            <span class="hw">×${r.w.toFixed(2)}</span>
          </div>`).join('')
        + `<div class="empty-note">These weights bias every future roll — and mean a seed can produce a
             different brief once the deck has been tilted.<br>
             <button class="tool" data-act="cool" style="width:auto;padding:0 7px">reset the deck</button></div>`
      : '<div class="empty-note">The deck is flat.<br>Every entry is still equally likely.<br><br>Use <b>♥</b> and <b>✕</b> on the rows of a brief.</div>';
  }
}
function openDrawer(which) {
  tab = which || tab;
  document.querySelectorAll('.drawer-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('drawer').dataset.open = 'true';
  $('drawer').setAttribute('aria-hidden', 'false');
  renderDrawer();
}
const closeDrawer = () => { $('drawer').dataset.open = 'false'; $('drawer').setAttribute('aria-hidden', 'true'); };

// ---------------------------------------------------------------- lightbox
function openLightbox(r) {
  $('lb-img').src = r.full || r.thumb;
  $('lb-cap').innerHTML = `<b>${esc(r.title)}</b> — ${esc(r.credit)}<br>
    <a href="${esc(r.page)}" target="_blank" rel="noopener">open at the source ↗</a>`;
  $('lightbox').dataset.open = 'true';
}
const closeLightbox = () => { $('lightbox').dataset.open = 'false'; $('lb-img').src = ''; };

// ------------------------------------------------------------------- events
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (btn) {
    const act = btn.dataset.act;
    const name = btn.dataset.axis;
    const i = +btn.dataset.i;
    if (act === 'keep' || act === 'kill') {
      const a = current?.[name]; if (!a?.key) return;
      nudge(a.key, act === 'keep');
      renderBrief();
      toast(act === 'keep' ? 'more of that' : 'less of that');
      return;
    }
    if (act === 'spin') { spin(name); return; }
    if (act === 'lock') { locks[name] = !locks[name]; renderBrief(); return; }
    if (act === 'pin') {
      const r = wall[i]; if (!r) return;
      const at = store.pins.findIndex((p) => p.full === r.full);
      if (at >= 0) store.pins.splice(at, 1); else store.pins.unshift({ ...r });
      store.pins = store.pins.slice(0, 300);
      persist(); renderWall();
      return;
    }
    if (act === 'open-saved') { const s = store.saved[i]; if (s) { closeDrawer(); go(s.seed); } return; }
    if (act === 'drop-saved') { store.saved.splice(i, 1); persist(); syncShelfCount(); renderDrawer(); return; }
    if (act === 'clear-pins') { store.pins = []; persist(); renderDrawer(); return; }
    if (act === 'cool') { store.weights = {}; persist(); renderDrawer(); renderBrief(); toast('deck reset'); return; }
  }
  const shot = e.target.closest('.shot');
  if (shot) { const r = wall[+shot.closest('.ref').dataset.i]; if (r) openLightbox(r); return; }
  const tabBtn = e.target.closest('.drawer-tabs button');
  if (tabBtn) { openDrawer(tabBtn.dataset.tab); }
});

$('roll').onclick = () => go(newSeed());
$('reroll-open').onclick = () => go(newSeed(), true);
$('save').onclick = saveBrief;
$('copy').onclick = async () => {
  if (!current) return;
  try { await navigator.clipboard.writeText(briefText(current)); toast('brief copied'); }
  catch { toast('clipboard blocked'); }
};
$('shelf-open').onclick = () => openDrawer('briefs');
$('drawer-close').onclick = closeDrawer;
$('lb-close').onclick = closeLightbox;
$('lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
$('seed').addEventListener('change', (e) => {
  const v = e.target.value.trim();
  if (v && v !== current?.seed) go(v);
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') { closeLightbox(); closeDrawer(); return; }
  if (k === 'r') { e.preventDefault(); go(newSeed()); }
  else if (k === 'e') { e.preventDefault(); go(newSeed(), true); }
  else if (k === 's') { e.preventDefault(); saveBrief(); }
  else if (k === 'c') { e.preventDefault(); $('copy').click(); }
  else if (k === 'h') { e.preventDefault(); openDrawer('briefs'); }
});

// -------------------------------------------------------------- test surface
// Mirrors the shape the other sketches expose, so test.mjs can drive the
// deterministic half of this without ever touching the network.
window.__flash = {
  seed: () => current?.seed ?? null,
  ready: () => !!current,
  brief: () => current && Object.fromEntries(AXES.map((n) => [n, {
    deck: current[n].deck, idx: current[n].idx, key: current[n].key ?? null, v: current[n].v,
  }])),
  subjectRoute: () => current?.subject.deck ?? null,
  axes: () => AXES.slice(),
  locks: () => ({ ...locks }),
  setLock: (n, on) => { locks[n] = !!on; renderBrief(); },
  go: (seed, keep) => go(seed, keep),
  rollOffline: (seed) => {
    // The seeded half only — no fetch, so a test can assert reproducibility.
    const { brief, objectSubject } = rollSync(seed);
    return { ...Object.fromEntries(Object.entries(brief).map(([k, v]) => [k, v?.v ?? v])), subject: objectSubject.v };
  },
  weight: (key) => wOf(key),
  weights: () => ({ ...store.weights }),
  nudge: (key, up) => { nudge(key, up); renderBrief(); },
  saved: () => store.saved.slice(),
  pins: () => store.pins.slice(),
  wall: () => wall.slice(),
  wallCount: () => wall.length,
  reset: () => { store = blank(); persist(); locks = {}; renderBrief(); },
  decks: () => Object.fromEntries(Object.entries(DECKS).map(([k, v]) => [k, v.length])),
  briefText: () => (current ? briefText(current) : ''),
};

// ---------------------------------------------------------------------- boot
syncShelfCount();
go((location.hash || '').replace('#', '') || newSeed());
