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
import { decodeFloatTiff } from '../../shared/geotiff.js';
import { median, toneOf } from './place.js';
import { createSlots } from './slots.js';
import { createField, CELL, SPAN, HALF, GRID, TILE_SPAN, TILE_H, TILE_P, LAYERS } from './field.js';
import { createTouch } from './touch.js';
import { cachedFetch, coverageUrl, orthoUrl, fetchTileKey, fetchTileBbox, geocode, journey } from '../../shared/pdok.js';
import { Listener } from '../../shared/audio.js';
import { DEFAULT, clone } from '../../shared/beat.js';

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
  const layerOf = (idx) => idx;          // nine ring slots, nine layers

  // Two pairs that alternate. A pair is a wide 480 m frame at one metre, which
  // is what the edges of the square stand on, and a sharp 240 m centre at half
  // a metre, which is what you actually look at. One pair holds the place you
  // are on, the other the place you are flying to, and landing swaps them.
  const PAIRS = [[9, 10], [11, 12]];
  let pairAt = 0;
  const wideOf = () => PAIRS[pairAt][0];
  let phase = 'roam';
  let flight = null;
  let held = false;

  let lastTile = '';
  const place = { datum: 0, tone: { lo: 0, hi: 255 }, centre: [0, 0], name: '—' };
  // Each of these is something the sketch adds on top of what was measured.
  // They are switchable so the inference can be seen rather than taken on
  // trust; with all four off, what is drawn is the raster as PDOK sent it.
  const view = { colour: 1, grain: 0.9, clock: 0, walls: 1, canopy: 1, tone: 1, shade: 1 };

  // Off by default. What this square shows is the survey as measured, and a
  // test pins two frames a second apart as byte-identical; an always-on source
  // would trade a property worth keeping for a livelier first impression.
  const audio = new Listener(clone(DEFAULT));
  let audioOn = false;
  let beats = 0;
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
    setLayer(tilesA, PAIRS[0][0], meta.bbox[0], meta.bbox[1], meta.bbox[2] - meta.bbox[0]);
    bornA[PAIRS[0][0]] = -1e4;                      // no changeover on first paint
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
        // A tile that merely sharpens ground the coarse frame is already
        // showing is a refinement, not a change of place, and should arrive
        // without ceremony. Firing the fall-and-pop for those meant every
        // landing was followed by the whole square sinking and popping back,
        // which read as the transition happening twice.
        const wide = wideOf();
        const cx = tilesA[wide * 4], cz = tilesA[wide * 4 + 1];
        const cs = tilesA[wide * 4 + 2];
        // Overlap, not containment: a 240 m tile on a fixed grid rarely sits
        // wholly inside a 480 m window, and the straddling ones were still
        // firing, so a corner of the square kept sinking after every landing.
        const shown = bbox[0] < cx + cs && bbox[0] + TILE_SPAN > cx
          && bbox[1] < cz + cs && bbox[1] + TILE_SPAN > cz;
        bornA[layer] = shown ? -1e4 : view.clock;
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
      // The basis the view matrix was built from. Handed back so a pointer ray
      // can be assembled directly instead of inverting the matrix again.
      basis: { eye, x, y, z },
    };
  }

  // ------------------------------------------------------------------ touch
  const touch = createTouch();

  // uTime's own timeline, but read between frames rather than on them. Handing
  // the pointer view.clock directly looked right and was not: it only advances
  // once a frame, so several pointermoves inside one frame all arrive with the
  // same timestamp, every velocity comes out as a division by zero and is
  // discarded, and a hard swipe lands at the same strength as a slow drift.
  //
  // Clamped by the same 0.05 the frame loop clamps its own dt with, and for the
  // same reason. Without it a stalled frame — a readback, a texture upload —
  // stamps a sample further ahead than view.clock will reach on the next tick,
  // and a birth in the future is a sample that never expires. The pointer's
  // real elapsed time goes separately to touch(), which is what a velocity
  // actually wants; a birth stamp wants to be on the clock it is compared to.
  const nowClock = () => view.clock + Math.min(0.05, (performance.now() - lastFrame) / 1000);

  // Where the pointer is standing, in RD. The heights only ever exist in a
  // texture, so this meets the datum plane rather than the surface; at this
  // framing a roof is a couple of metres out, well inside the radius of
  // anything touch does with the answer.
  function groundAt(clientX, clientY) {
    const w = innerWidth, h = innerHeight;
    const b = matrices(w, h).basis;
    const tan = Math.tan(FOV / 2);
    const sx = ((clientX / w) * 2 - 1) * tan * (w / h);
    const sy = (1 - (clientY / h) * 2) * tan;
    const dir = norm3([
      sx * b.x[0] + sy * b.y[0] - b.z[0],
      sx * b.x[1] + sy * b.y[1] - b.z[1],
      sx * b.x[2] + sy * b.y[2] - b.z[2],
    ]);
    // Level with the horizon or above it: there is no ground under the pointer,
    // and the intersection would be behind the camera or at infinity.
    if (dir[1] > -1e-4) return null;
    const k = -b.eye[1] / dir[1];
    return [b.eye[0] + dir[0] * k + cam.x, b.eye[2] + dir[2] * k + cam.z];
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
    // Both scaled to the square rather than to the journey: a 240 m window
    // framed from 300 m cannot show a 105 m lift, which is what a 49 km flight
    // used to ask for. Distance still shades the motion, between a hop and a
    // proper heave, but everything stays in the picture.
    // Lift and swing belong to the local changeover only — a jump is a morph in
    // place, with nothing thrown into the air.
    gl.uniform1f(u.uArc, 1);
    gl.uniform1f(u.uLift, 9);
    gl.uniform1f(u.uSwing, 4);
    gl.uniform1f(u.uColour, view.colour);
    gl.uniform1f(u.uPointK, m.pointK);
    gl.uniform1f(u.uSpan, 0.55);
    gl.uniform1f(u.uDrop, 11);
    gl.uniform1f(u.uJump, phase === 'flying' || phase === 'gathering' ? 1 : 0);
    gl.uniform1f(u.uSize, view.grain);
    gl.uniform1f(u.uTop, 18);
    gl.uniform4fv(u.uBands, audio.bands);
    gl.uniform1f(u.uAudio, audioOn ? 1 : 0);
    gl.uniform1f(u.uWalls, view.walls);
    gl.uniform1f(u.uCanopy, view.canopy);
    gl.uniform1f(u.uTone, view.tone);
    gl.uniform1f(u.uShade, view.shade);
    gl.uniform4fv(u.uWake, touch.wake);
    gl.uniform4fv(u.uWeights, touch.weights);
    gl.uniform4fv(u.uWakeK, touch.wakeK);
    gl.uniform4fv(u.uWeightK, touch.weightK);
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
    // Every particle has to know where it is going before any of them moves,
    // and at the resolution it is going to be seen at. Gathering only a wide
    // frame meant morphing from a half-metre city into a one-metre one, so the
    // destination arrives as both: the sharp centre you look at, and the wide
    // frame the edges stand on once the ring reloads. Six requests, both in
    // hand before the first particle stirs.
    phase = 'gathering';
    $('go').disabled = true;
    note(`gathering ${dest.name} — nothing has moved yet`);
    // Only the sharp centre is gathered before the flight. It is the only thing
    // the transition can actually show — it covers the drawn square exactly —
    // and the wide frame the edges will need once you start sliding again can
    // load after you have landed, while you are looking at the new place. Three
    // requests rather than six, which halves the wait for nothing lost.
    const [wide, sharp] = PAIRS[1 - pairAt];
    let sharpMeta;
    try {
      sharpMeta = await loadCoarse([dest.x, dest.y], sharp, SPAN + 32);
    } catch (e) {
      phase = 'roam';
      $('go').disabled = false;
      note('could not reach that place: ' + e.message);
      return;
    }

    // The destination is framed where the camera already is, because a particle
    // keeps its ground and changes what it stands on. Offsetting it by the true
    // 49 km would put every particle off screen by mid-flight.
    const dx = cam.x - dest.x, dz = cam.z - dest.y;
    tilesB.fill(0);
    setLayer(tilesB, sharp, sharpMeta.bbox[0] + dx, sharpMeta.bbox[1] + dz, sharpMeta.span);

    flight = { j, dest, wide, sharp, meta: sharpMeta, mix: 0, started: view.clock };
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
    pairAt = 1 - pairAt;
    place.datum = f.meta.datum;
    place.tone = f.meta.tone;
    place.name = f.dest.name;
    place.centre = [f.dest.x, f.dest.y];
    tilesA.fill(0);
    bornA.fill(-1e4);
    setLayer(tilesA, f.sharp, f.meta.bbox[0], f.meta.bbox[1], f.meta.span);
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

    // The wide frame catches up now, in the background, so the edges of the
    // square have something to stand on the moment you start sliding.
    loadCoarse([f.dest.x, f.dest.y], f.wide, 480)
      .then((m) => {
        if (place.centre[0] !== f.dest.x) return;   // already gone somewhere else
        setLayer(tilesA, f.wide, m.bbox[0], m.bbox[1], m.span);
        bornA[f.wide] = -1e4;
      })
      .catch(() => { /* the sharp ring covers the square on its own */ });
  }

  // --------------------------------------------------------------- controls
  const SOURCES = ['off', 'field', 'tone', 'mic'];
  async function setAudio(mode) {
    if (mode === 'off') {
      audioOn = false;
      audio.bands.fill(0);          // exact, not merely still
      $('audio').value = 'off';
      note('');
      return;
    }
    await audio.setMode(mode);      // falls back to field if the mic is refused
    audioOn = true;
    $('audio').value = audio.mode;   // may not be what was asked for
    note(audio.error || (audio.mode === 'mic' ? 'listening to the room'
      : audio.mode === 'tone' ? 'the built-in pattern, now audible' : ''));
  }
  // A menu, not a cycling button: four sources hidden behind one label meant
  // you could not see that `tone` existed without clicking past it.
  $('audio').onchange = (e) => setAudio(e.target.value);

  // --------------------------------------------------------- inferred layer
  const INFERRED = ['walls', 'canopy', 'tone', 'shade'];
  function setInferred(name, on) {
    view[name] = on ? 1 : 0;
    $('t-' + name).classList.toggle('on', !!on);
    $('measured').classList.toggle('on', INFERRED.every((n) => !view[n]));
  }
  for (const n of INFERRED) $('t-' + n).onclick = () => setInferred(n, !view[n]);
  function measuredOnly() {
    const anyOn = INFERRED.some((n) => view[n]);
    for (const n of INFERRED) setInferred(n, !anyOn);
    note(anyOn ? 'the raster as it was surveyed — nothing added' : '');
  }
  $('measured').onclick = measuredOnly;

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
  // One table, and the only place in this sketch where a key is spelled.
  // Dispatch reads it, the hint line is written from it, and binding the same
  // key twice throws on load rather than shipping. That is deliberate: `s` once
  // meant both walk-backwards and save-a-PNG, and `a` meant both strafe-left
  // and listen, and both of those shipped. A held key collides with a tapped
  // one just as badly as two tapped ones, so they share one table and one check.
  const KEYMAP = [
    { key: 'w', held: true },
    { key: 'a', held: true },
    { key: 's', held: true },
    { key: 'd', held: true, group: 'W A S D', label: 'slide the window' },
    { key: 'shift', held: true, group: 'shift', label: 'faster' },
    { key: 'c', label: 'colour', run: () => setColour((view.colour + 1) % COLOURS.length) },
    { key: 'm', label: 'measured only', run: () => measuredOnly() },
    { key: 'p', label: 'png ×3', run: () => savePNG() },
    { key: 'h', label: 'hide', run: () => {
      document.querySelectorAll('#ui, #meta, #hint').forEach((n) => {
        n.style.display = n.style.display === 'none' ? '' : 'none';
      });
    } },
  ];

  const bound = new Map();
  for (const b of KEYMAP) {
    const clash = bound.get(b.key);
    if (clash) {
      throw new Error(`the key "${b.key}" is bound twice: `
        + `${clash.label ?? 'movement'} and ${b.label ?? 'movement'}`);
    }
    bound.set(b.key, b);
  }

  // Written from the same table, so the legend cannot drift from the bindings.
  $('keyhint').innerHTML = KEYMAP.filter((b) => b.label)
    .map((b) => `<kbd>${b.group ?? b.key}</kbd> ${b.label}`).join(' · ');

  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const b = bound.get(e.key.toLowerCase());
    if (!b) return;
    keys.add(e.key.toLowerCase());
    if (b.held) e.preventDefault();
    if (b.run) b.run();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  // Press-drag orbits and the wheel dollies, both from before. What was still
  // free is hovering and pressing without going anywhere, which is exactly the
  // two gestures touch wants, so nothing here has been rebound.
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    canvas.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) {
      const g = groundAt(e.clientX, e.clientY);
      if (g) touch.move(g[0], g[1], e.clientX, e.clientY, nowClock(), e.timeStamp / 1000);
      else touch.leave();       // over the horizon is off the ground
      return;
    }
    // Travel accumulated rather than measured start to end: a drag that comes
    // back to where it began is still a drag, and should not drop anything.
    drag.moved += Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    cam.yaw -= (e.clientX - drag.x) * 0.004;
    cam.pitch = Math.max(0.06, Math.min(1.45, cam.pitch + (e.clientY - drag.y) * 0.003));
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const endDrag = () => { drag = null; canvas.classList.remove('dragging'); touch.leave(); };
  canvas.addEventListener('pointerup', (e) => {
    if (drag && drag.moved < 5) {
      const g = groundAt(e.clientX, e.clientY);
      if (g) touch.drop(g[0], g[1], nowClock());
    }
    endDrag();
  });
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => touch.leave());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = Math.max(60, Math.min(1800, cam.dist * Math.exp(e.deltaY * 0.0011)));
  }, { passive: false });

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    view.clock += dt;
    lastFrame = now;
    // Before the upload, so anything past its life is a hard zero on the way to
    // the GPU rather than a small number the shader has to tolerate.
    touch.expire(view.clock);

    if (phase === 'flying' && !held) {
      flight.mix = Math.min(1, (view.clock - flight.started) / flight.j.seconds);
      $('mix').value = String(flight.mix);
      $('mixv').textContent = flight.mix.toFixed(3);
      if (flight.mix >= 1) land();
    }

    // Movement is locked while a jump is in the air: reshelving mid-flight
    // would evict the very layers carrying particles across the country.
    if (audioOn) {
      // beats is tempo-relative and t is seconds; they are separate on purpose,
      // so changing the tempo does not rescale all elapsed history at once.
      beats += dt * (audio.pattern.bpm / 60);
      audio.update(view.clock, beats);
    }

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

  // A fresh render and a readback of the middle of it. Rendering here rather
  // than trusting the last frame is what makes both readers below answer for
  // the state as it is at the moment of the call.
  function readCentre() {
    render(canvas.width, canvas.height);
    const s = Math.min(600, canvas.width, canvas.height);
    const px = new Uint8Array(s * s * 4);
    gl.readPixels((canvas.width - s) >> 1, (canvas.height - s) >> 1, s, s, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { px, s };
  }

  window.__elsewhere = {
    // the wide frame of whichever pair is current, not layer 0 — the pairs
    // alternate, and layer 0 is a ring slot now
    ready: () => tilesA[wideOf() * 4 + 3] > 0.5 || tilesA[PAIRS[pairAt][1] * 4 + 3] > 0.5,
    count: () => field.count,
    place: () => ({ ...place }),
    state: () => ({ ...view }),
    centre: () => ({ x: cam.x, z: cam.z }),
    cam: () => ({ ...cam }),
    loading: () => queue.length + inflight,
    layers: () => Array.from({ length: LAYERS }, (_, i) => tilesA[i * 4 + 3] > 0.5),
    setColour,
    setCam: (o) => Object.assign(cam, o),
    audioMode: () => (audioOn ? audio.mode : 'off'),
    keymap: () => KEYMAP.map(({ key, held, label }) => ({ key, held: !!held, label: label ?? null })),
    inferred: () => Object.fromEntries(INFERRED.map((n) => [n, !!view[n]])),
    setInferred,
    measuredOnly,
    bands: () => Array.from(audio.bands),
    setAudio,
    phase: () => phase,
    mix: () => (flight ? flight.mix : 0),
    jumpTo,
    touch: () => touch.live(),
    groundAt,
    // A shader that failed to link still leaves a canvas; it just leaves a
    // black one, so coverage is the only assertion that catches it.
    coverage: () => {
      const { px, s } = readCentre();
      let lit = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i+1] + px[i+2] > 60) lit++;
      return lit / (s * s);
    },
    // The same pixels, as one number. A screenshot is the honest way to compare
    // two frames and it is far too slow to catch a wake in the act — the round
    // trip outlasts the 0.8 s the furrow is alive. This renders and hashes in
    // one call, so a test can ask what is on screen *now*.
    digest: () => {
      const { px } = readCentre();
      let h = 2166136261;
      for (let i = 0; i < px.length; i++) { h ^= px[i]; h = Math.imul(h, 16777619); }
      return h >>> 0;
    },
  };
}

main();
