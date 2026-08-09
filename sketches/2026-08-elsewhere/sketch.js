// elsewhere — a square of the Netherlands you can slide across the country.
//
// Nothing here is generated. Heights are AHN, the national half-metre surface
// and terrain models; colour is the current orthophoto at 25 cm. Both arrive
// live from PDOK for whatever ground you are over and are decoded in the page —
// possible only because PDOK's coverage service is CORS-open. The AHN point
// cloud is not: the COPC tiles behind the hendriklaan sketch cannot be read
// from a browser at all, so this trades real classified returns for a regular
// grid and gets every address in the country in exchange.
//
// A place lives in textures. A particle is its gl_VertexID, and everything
// about it — where it stands, how high, what colour, which way it faces — is a
// texture lookup in the vertex shader. Nothing is written per particle, so
// sliding the window is a uniform and a tile arriving is one upload.
import { decodeFloatTiff } from './geotiff.js';
import { median, toneOf } from './place.js';
import { createSlots } from './slots.js';
import { createField, CELL, SPAN, HALF, GRID, TILE_SPAN, TILE_H, TILE_P, LAYERS } from './field.js';
import { cachedFetch, coverageUrl, orthoUrl, fetchTileKey, fetchTileBbox, geocode, journey } from './pdok.js';

const BAKED = '/data/elsewhere/prins-hendriklaan';
const NODATA_FLOOR = 1e30;
const $ = (id) => document.getElementById(id);
const note = (m) => { $('note').textContent = m ?? ''; };

const dot3 = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross3 = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm3 = (a) => { const l = Math.hypot(a[0],a[1],a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
const perspective = (fovy, aspect, near, far) => {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
};

async function decodePhoto(buf, size) {
  const bitmap = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }));
  const oc = new OffscreenCanvas(size, size);
  const c2 = oc.getContext('2d', { willReadFrequently: true });
  c2.drawImage(bitmap, 0, 0, size, size);
  return c2.getImageData(0, 0, size, size).data;
}

async function main() {
  const canvas = document.createElement('canvas');
  document.body.insertBefore(canvas, document.body.firstChild);
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) { $('veil').textContent = 'this sketch needs WebGL2'; return; }

  const cache = 'caches' in window ? await caches.open('elsewhere-v2').catch(() => null) : null;
  let field;
  try {
    field = createField(gl);
  } catch (e) {
    $('veil').textContent = 'the shaders would not compile: ' + e.message;
    return;
  }

  // Nine texture layers, addressed by which ground they hold. Layer 0 is the
  // coarse opening frame — 480 m at one metre, never evicted — and layers 1..8
  // are 240 m tiles at half a metre, recycled as the window moves. A layer
  // carries its own span, so both kinds live in the same array and the shader
  // takes whichever is finest over a given patch of ground.
  const tilesA = new Float32Array(LAYERS * 4);
  const tilesB = new Float32Array(LAYERS * 4);
  const bornA = new Float32Array(LAYERS).fill(-1e4);
  const slots = createSlots({ ring: 3 });
  // One layer per ring slot, and layer 0 reserved for the baked frame. With one
  // fewer than this, two slots shared a layer and overwrote each other.
  const layerOf = (idx) => 1 + idx;

  // Three whole-window coarse layers that rotate: one under the place you are
  // on, one under the place you are flying to, one free so a second jump never
  // waits for the first one's memory back.
  const COARSE = [0, 10, 11];
  let coarseAt = 0;
  let phase = 'roam';
  let flight = null;
  let held = false;

  let lastTile = '';
  const place = { datum: 0, tone: { lo: 0, hi: 255 }, centre: [0, 0], name: '—' };
  const view = { colour: 1, grain: 0.9, clock: 0 };
  const cam = { x: 0, z: 0, yaw: 0.72, pitch: 0.40, dist: 300 };

  function setLayer(arr, layer, ox, oz, span) {
    arr[layer * 4] = ox; arr[layer * 4 + 1] = oz;
    arr[layer * 4 + 2] = span; arr[layer * 4 + 3] = 1;
  }

  // Heights go to the GPU as metres above the place's datum, with no-return
  // cells dropped to the terrain beneath them. Every tile is levelled to the
  // same datum: per tile the median ground moves, and adjacent tiles would step
  // against each other wherever the land does.
  function levelled(dsm, dtm, datum) {
    const n = dsm.length;
    const surf = new Float32Array(n), terr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const g = dtm[i] < NODATA_FLOOR ? dtm[i] : datum;
      const s = dsm[i] < NODATA_FLOOR ? dsm[i] : g;
      surf[i] = s - datum;
      terr[i] = g - datum;
    }
    return { surf, terr };
  }

  // A whole window in three requests, at half the detail of a fetch tile. This
  // is what a jump gathers: 144 sharp tiles would be 432 requests and ten
  // seconds of waiting, where one coarse window is three and under a second.
  // You arrive at a soft version of the place and the sharp tiles refine over
  // it once you have landed.
  async function loadCoarse(centre, layer, span = 480) {
    const half = span / 2;
    const bbox = [centre[0] - half, centre[1] - half, centre[0] + half, centre[1] + half];
    const [dsmBuf, dtmBuf, photoBuf] = await Promise.all([
      cachedFetch(coverageUrl('dsm_05m', bbox, TILE_H), cache),
      cachedFetch(coverageUrl('dtm_05m', bbox, TILE_H), cache),
      cachedFetch(orthoUrl(bbox, TILE_P), cache),
    ]);
    const [dsm, dtm] = await Promise.all([decodeFloatTiff(dsmBuf), decodeFloatTiff(dtmBuf)]);
    const rgba = await decodePhoto(photoBuf, TILE_P);
    const datum = median(dtm.data);
    const tone = toneOf(rgba, TILE_P * TILE_P);
    const { surf, terr } = levelled(dsm.data, dtm.data, datum);
    field.uploadHeight(layer, surf, terr);
    field.uploadPhoto(layer, rgba);
    return { bbox, span, datum, tone };
  }

  async function loadOpening() {
    const meta = await (await fetch(`${BAKED}/place.json`)).json();
    const [dsmBuf, dtmBuf, photoBuf] = await Promise.all([
      cachedFetch(`${BAKED}/dsm.tif`, cache),
      cachedFetch(`${BAKED}/dtm.tif`, cache),
      cachedFetch(`${BAKED}/ortho.jpg`, cache),
    ]);
    const [dsm, dtm] = await Promise.all([decodeFloatTiff(dsmBuf), decodeFloatTiff(dtmBuf)]);
    const rgba = await decodePhoto(photoBuf, TILE_P);
    place.datum = median(dtm.data);
    place.tone = toneOf(rgba, TILE_P * TILE_P);
    place.centre = meta.centre;
    place.name = meta.name;
    const { surf, terr } = levelled(dsm.data, dtm.data, place.datum);
    field.uploadHeight(0, surf, terr);
    field.uploadPhoto(0, rgba);
    setLayer(tilesA, 0, meta.bbox[0], meta.bbox[1], meta.bbox[2] - meta.bbox[0]);
    bornA[0] = -1e4;                                // no changeover on first paint
  }

  let inflight = 0;
  const queue = [];
  const CONCURRENCY = 4;

  function pump() {
    while (inflight < CONCURRENCY && queue.length) {
      const job = queue.shift();
      const slot = slots.slots[job.idx];
      if (slot.tx !== job.tx || slot.tz !== job.tz) continue;   // the window moved on
      inflight++;
      const bbox = fetchTileBbox(`${job.tx}:${job.tz}`);
      (async () => {
        const [dsmBuf, dtmBuf, photoBuf] = await Promise.all([
          cachedFetch(coverageUrl('dsm_05m', bbox, TILE_H), cache),
          cachedFetch(coverageUrl('dtm_05m', bbox, TILE_H), cache),
          cachedFetch(orthoUrl(bbox, TILE_P), cache),
        ]);
        const [dsm, dtm] = await Promise.all([decodeFloatTiff(dsmBuf), decodeFloatTiff(dtmBuf)]);
        const rgba = await decodePhoto(photoBuf, TILE_P);
        if (slot.tx !== job.tx || slot.tz !== job.tz) return;
        const layer = layerOf(job.idx);
        const { surf, terr } = levelled(dsm.data, dtm.data, place.datum);
        field.uploadHeight(layer, surf, terr);
        field.uploadPhoto(layer, rgba);
        setLayer(tilesA, layer, bbox[0], bbox[1], TILE_SPAN);
        bornA[layer] = view.clock;
        slots.markReady(job.idx);
      })()
        .catch((e) => note('could not read the ground there: ' + e.message))
        .finally(() => { inflight--; pump(); });
    }
  }

  function reshelve() {
    const ctx = Math.floor(cam.x / TILE_SPAN), ctz = Math.floor(cam.z / TILE_SPAN);
    for (const job of slots.reshelve(ctx, ctz)) {
      // A recycled layer stops being resident the moment it is repointed, so
      // the shader falls back to the coarse frame rather than drawing ground
      // from somewhere else in the country.
      tilesA[layerOf(job.idx) * 4 + 3] = 0;
      queue.push(job);
    }
    pump();
  }

  try {
    await loadOpening();
  } catch (e) {
    $('veil').textContent = 'could not read the opening place: ' + e.message;
    return;
  }
  cam.x = place.centre[0];
  cam.z = place.centre[1];
  reshelve();

  $('m-place').textContent = place.name;
  $('m-n').textContent = field.count.toLocaleString('en-US');
  $('m-datum').textContent = place.datum.toFixed(2);
  $('m-span').textContent = String(SPAN);

  const FOV = 0.82;
  function matrices(w, h) {
    // The camera orbits the square and never translates. WASD slides the framed
    // coordinates instead, so the frame is stationary and the country moves
    // through it.
    const target = [0, 22, 0];
    const eye = [
      Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist,
      target[1] + Math.sin(cam.pitch) * cam.dist,
      Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist,
    ];
    const z = norm3([eye[0]-target[0], eye[1]-target[1], eye[2]-target[2]]);
    const x = norm3(cross3([0,1,0], z));
    const y = cross3(z, x);
    return {
      view: new Float32Array([
        x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
        -dot3(x,eye), -dot3(y,eye), -dot3(z,eye), 1,
      ]),
      proj: perspective(FOV, w / h, 1, 6000),
      // one cell, projected: half the framebuffer height over tan of half the fov
      pointK: CELL * (h * 0.5) / Math.tan(FOV / 2) * 1.15,
    };
  }

  function render(w, h) {
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.055, 0.055, 0.067, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const m = matrices(w, h);
    field.drawFrame(m.view, m.proj);
    gl.useProgram(field.program);
    const u = field.uniforms;
    field.bindTextures();
    gl.uniformMatrix4fv(u.uView, false, m.view);
    gl.uniformMatrix4fv(u.uProj, false, m.proj);
    gl.uniform2f(u.uCentre, cam.x, cam.z);
    gl.uniform2f(u.uDir, flight ? flight.j.dirX : 0, flight ? flight.j.dirZ : 1);
    gl.uniform4fv(u.uTilesA, tilesA);
    gl.uniform4fv(u.uTilesB, tilesB);
    gl.uniform1fv(u.uBornA, bornA);
    gl.uniform1i(u.uGrid, GRID);
    gl.uniform1f(u.uCell, CELL);
    gl.uniform1f(u.uHalf, HALF);
    gl.uniform1f(u.uToneLo, place.tone.lo / 255);
    gl.uniform1f(u.uToneGain, 255 / Math.max(1, place.tone.hi - place.tone.lo));
    const tb = flight ? flight.meta.tone : place.tone;
    gl.uniform1f(u.uToneLoB, tb.lo / 255);
    gl.uniform1f(u.uToneGainB, 255 / Math.max(1, tb.hi - tb.lo));
    gl.uniform1f(u.uMix, flight ? flight.mix : 0);
    gl.uniform1f(u.uTime, view.clock);
    const km = flight ? flight.j.km : 0;
    gl.uniform1f(u.uArc, phase === 'flying' ? 1 : 0);
    gl.uniform1f(u.uLift, flight ? Math.min(120, 24 + 30 * Math.log10(1 + km * 10)) : 0);
    gl.uniform1f(u.uSwing, flight ? Math.min(210, 34 + 40 * Math.log10(1 + km * 10)) : 0);
    gl.uniform1f(u.uColour, view.colour);
    gl.uniform1f(u.uPointK, m.pointK);
    gl.uniform1f(u.uSpan, 0.55);
    gl.uniform1f(u.uDrop, 11);
    gl.uniform1f(u.uJump, phase === 'flying' || phase === 'gathering' ? 1 : 0);
    gl.uniform1f(u.uSize, view.grain);
    gl.uniform1f(u.uTop, 18);
    field.drawPoints();
  }

  // ------------------------------------------------------------------- jump
  async function jumpTo(query) {
    if (phase !== 'roam') return;
    if (!query || !query.trim()) { note('type a Dutch address first'); return; }
    note('looking that up…');
    let dest;
    try {
      dest = await geocode(query);
    } catch (e) {
      note(e.message);
      return;
    }

    const j = journey([cam.x, cam.z], [dest.x, dest.y]);
    if (j.km < 0.02) { note('you are already there'); return; }

    // The destination has to be in hand before a single particle moves: a
    // particle cannot walk to a position that has not been fetched. Gathering
    // happens behind the place still on screen, and nothing changes until it
    // is all here.
    phase = 'gathering';
    $('go').disabled = true;
    note(`gathering ${dest.name} — nothing has moved yet`);
    const layer = COARSE[(COARSE.indexOf(coarseAt) + 1) % COARSE.length];
    let meta;
    try {
      meta = await loadCoarse([dest.x, dest.y], layer);
    } catch (e) {
      phase = 'roam';
      $('go').disabled = false;
      note('could not reach that place: ' + e.message);
      return;
    }

    // The destination is framed where the camera already is, because a particle
    // keeps its ground and changes what it stands on. Offsetting it by the true
    // 49 km would put every particle off screen by mid-flight.
    tilesB.fill(0);
    setLayer(tilesB, layer, meta.bbox[0] + (cam.x - dest.x), meta.bbox[1] + (cam.z - dest.y), meta.span);

    flight = { j, dest, layer, meta, mix: 0, started: view.clock };
    phase = 'flying';
    held = false;
    $('hold').classList.remove('on');
    $('mix').disabled = false;
    $('flight').textContent = `${j.km.toFixed(1)} km · ${j.bearing.toFixed(0)}° ${j.rose}`;
    note(`flying ${j.rose} — every particle is walking to its new position`);
  }

  function land() {
    const f = flight;
    // A becomes B with no fetch and no reallocation: the destination is already
    // in a layer, so this is a relabel and a re-anchor.
    cam.x = f.dest.x;
    cam.z = f.dest.y;
    coarseAt = f.layer;
    place.datum = f.meta.datum;
    place.tone = f.meta.tone;
    place.name = f.dest.name;
    place.centre = [f.dest.x, f.dest.y];
    tilesA.fill(0);
    bornA.fill(-1e4);
    setLayer(tilesA, f.layer, f.meta.bbox[0], f.meta.bbox[1], f.meta.span);
    tilesB.fill(0);
    flight = null;
    phase = 'roam';
    lastTile = '';                       // force the sharp ring to reload here
    $('m-place').textContent = place.name;
    $('m-datum').textContent = place.datum.toFixed(2);
    $('go').disabled = false;
    $('mix').disabled = true;
    $('mixv').textContent = '—';
    $('flight').innerHTML = '&nbsp;';
    note('landed — WASD slides the window from here');
  }

  // --------------------------------------------------------------- controls
  const COLOURS = ['lit photo', 'height ramp', 'photo texture'];
  const setColour = (i) => { view.colour = i; $('colour').textContent = COLOURS[i]; };
  setColour(view.colour);
  $('colour').onclick = () => setColour((view.colour + 1) % COLOURS.length);
  $('grain').oninput = (e) => { view.grain = +e.target.value; };
  $('go').onclick = () => jumpTo($('address').value);
  $('address').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); jumpTo($('address').value); }
  });
  $('mix').oninput = (e) => {
    if (!flight) return;
    held = true;
    $('hold').classList.add('on');
    flight.mix = +e.target.value;
    $('mixv').textContent = flight.mix.toFixed(3);
  };
  $('hold').onclick = (e) => {
    held = !held;
    e.target.classList.toggle('on', held);
    // resume where the scrub left it, or releasing hold snaps the journey
    if (!held && flight) flight.started = view.clock - flight.mix * flight.j.seconds;
  };

  function savePNG() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * 3);
    canvas.height = Math.round(innerHeight * 3);
    render(canvas.width, canvas.height);
    // Read back in the same tick: without preserveDrawingBuffer the composite
    // is gone the moment the frame yields.
    const url = canvas.toDataURL('image/png');
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    const a = document.createElement('a');
    a.href = url;
    a.download = `elsewhere-${Math.round(cam.x)}-${Math.round(cam.z)}.png`;
    a.click();
    note('saved at x3');
  }
  $('save').onclick = savePNG;

  const keys = new Set();
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    keys.add(k);
    if (['w','a','s','d'].includes(k)) e.preventDefault();
    // p, not s: s is backward. Binding both to one key meant every step back
    // also downloaded a PNG.
    if (k === 'c') setColour((view.colour + 1) % COLOURS.length);
    else if (k === 'p') savePNG();
    else if (k === 'h') document.querySelectorAll('#ui, #meta, #hint').forEach((n) => {
      n.style.display = n.style.display === 'none' ? '' : 'none';
    });
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cam.yaw -= (e.clientX - drag.x) * 0.004;
    cam.pitch = Math.max(0.06, Math.min(1.45, cam.pitch + (e.clientY - drag.y) * 0.003));
    drag = { x: e.clientX, y: e.clientY };
  });
  const endDrag = () => { drag = null; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = Math.max(60, Math.min(1800, cam.dist * Math.exp(e.deltaY * 0.0011)));
  }, { passive: false });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    view.clock += dt;
    last = now;

    if (phase === 'flying' && !held) {
      flight.mix = Math.min(1, (view.clock - flight.started) / flight.j.seconds);
      $('mix').value = String(flight.mix);
      $('mixv').textContent = flight.mix.toFixed(3);
      if (flight.mix >= 1) land();
    }

    // Movement is locked while a jump is in the air: reshelving mid-flight
    // would evict the very layers carrying particles across the country.
    const speed = phase === 'roam' ? 34 * (keys.has('shift') ? 4 : 1) * dt : 0;
    const fwd = [-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw)];
    const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
    const go = (v, k) => { cam.x += v[0] * k; cam.z += v[2] * k; };
    if (keys.has('w')) go(fwd, speed);
    if (keys.has('s')) go(fwd, -speed);
    if (keys.has('d')) go(right, speed);
    if (keys.has('a')) go(right, -speed);
    // Reshelve only when the window crosses into a new fetch tile. Sliding
    // inside one costs nothing at all, because the window is a uniform.
    const here = fetchTileKey(cam.x, cam.z);
    if (phase === 'roam' && here !== lastTile) { lastTile = here; reshelve(); }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    render(w, h);
    $('m-x').textContent = cam.x.toFixed(0);
    $('m-z').textContent = cam.z.toFixed(0);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  $('veil').classList.add('gone');

  window.__elsewhere = {
    ready: () => tilesA[3] > 0.5,
    count: () => field.count,
    place: () => ({ ...place }),
    state: () => ({ ...view }),
    centre: () => ({ x: cam.x, z: cam.z }),
    loading: () => queue.length + inflight,
    layers: () => Array.from({ length: LAYERS }, (_, i) => tilesA[i * 4 + 3] > 0.5),
    setColour,
    setCam: (o) => Object.assign(cam, o),
    phase: () => phase,
    mix: () => (flight ? flight.mix : 0),
    jumpTo,
    // A shader that failed to link still leaves a canvas; it just leaves a
    // black one, so coverage is the only assertion that catches it.
    coverage: () => {
      render(canvas.width, canvas.height);
      const s = Math.min(600, canvas.width, canvas.height);
      const px = new Uint8Array(s * s * 4);
      gl.readPixels((canvas.width - s) >> 1, (canvas.height - s) >> 1, s, s, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lit = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i+1] + px[i+2] > 60) lit++;
      return lit / (s * s);
    },
  };
}

main();
