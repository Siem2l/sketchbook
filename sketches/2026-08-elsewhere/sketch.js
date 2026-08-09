// elsewhere — a square of the Netherlands you can slide across the country.
//
// Nothing here is generated. Heights are AHN, the national half-metre surface
// and terrain models; colour is the current orthophoto. Both arrive live from
// PDOK for whatever address you ask for and are decoded in the page — which is
// possible only because PDOK's coverage service is CORS-open. The AHN point
// cloud is not: the COPC tiles behind the hendriklaan sketch cannot be read
// from a browser at all, so this trades real classified returns for a regular
// grid and gets every Dutch address in exchange.
//
// The rule the whole thing is built around: there are N particles, allocated
// once, and nothing ever creates or destroys one. Sliding the window re-points
// them at new ground. Jumping tells all of them where to stand next.
import { decodeFloatTiff } from './geotiff.js';
import { assemble } from './place.js';
import { createSlots } from './slots.js';
import { createField, emptyTile, CELL, TILE_CELLS, TILE_SPAN, RING, SPAN, HALF } from './field.js';
import { cachedFetch } from './pdok.js';

const BAKED = '/data/elsewhere/prins-hendriklaan';
const $ = (id) => document.getElementById(id);
const note = (m) => { $('note').textContent = m ?? ''; };

const dot3 = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross3 = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm3 = (a) => { const l = Math.hypot(a[0],a[1],a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
const perspective = (fovy, aspect, near, far) => {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
};

async function decodeOrtho(blob, width, height) {
  const bitmap = await createImageBitmap(blob);
  const oc = new OffscreenCanvas(width, height);
  const c2 = oc.getContext('2d');
  c2.drawImage(bitmap, 0, 0, width, height);
  return c2.getImageData(0, 0, width, height).data;
}

// The opening frame is baked into the repo as PDOK's own three files, so first
// paint costs no round trip and the thumbnail is deterministic. It is baked
// coarse — 480 m at 1 m cells — because that is 1.3 MB rather than the 4.8 MB
// four sharp tiles would cost, and the sharp tiles stream over it anyway.
async function loadBaked(base, cache) {
  const meta = await (await fetch(`${base}/place.json`)).json();
  const [dsmBuf, dtmBuf, orthoBuf] = await Promise.all([
    cachedFetch(`${base}/dsm.tif`, cache),
    cachedFetch(`${base}/dtm.tif`, cache),
    cachedFetch(`${base}/ortho.jpg`, cache),
  ]);
  const [dsm, dtm] = await Promise.all([decodeFloatTiff(dsmBuf), decodeFloatTiff(dtmBuf)]);
  const rgb = await decodeOrtho(new Blob([orthoBuf], { type: 'image/jpeg' }), dsm.width, dsm.height);
  return { meta, data: assemble({ dsm, dtm, rgb, width: dsm.width, height: dsm.height }) };
}

// A raster covers a bbox at some cell size; a render tile wants TILE_CELLS
// squared samples starting at a world corner. Nearest-neighbour is right here:
// the baked opening frame is coarser than the field, and interpolating it would
// invent detail the survey does not have.
function sampleTile(src, meta, tx, tz) {
  const out = emptyTile();
  const [minx, , , maxy] = meta.bbox;
  for (let j = 0; j < TILE_CELLS; j++) {
    for (let i = 0; i < TILE_CELLS; i++) {
      const wx = tx * TILE_SPAN + i * CELL;
      const wz = tz * TILE_SPAN + j * CELL;
      const sx = Math.round((wx - minx) / meta.cell);
      // rasters are north-up: row 0 is the top edge, which is maxy
      const sy = Math.round((maxy - wz) / meta.cell);
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
      const p = j * TILE_CELLS + i, q = sy * src.width + sx;
      out.y[p] = src.y[q];
      out.colour[p*3] = src.colour[q*3];
      out.colour[p*3+1] = src.colour[q*3+1];
      out.colour[p*3+2] = src.colour[q*3+2];
      out.normal[p*2] = src.normal[q*2];
      out.normal[p*2+1] = src.normal[q*2+1];
    }
  }
  return out;
}

async function main() {
  const canvas = document.createElement('canvas');
  document.body.insertBefore(canvas, document.body.firstChild);
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) { $('veil').textContent = 'this sketch needs WebGL2'; return; }

  const cache = 'caches' in window ? await caches.open('elsewhere-v1').catch(() => null) : null;
  let baked;
  try {
    baked = await loadBaked(BAKED, cache);
  } catch (e) {
    $('veil').textContent = 'could not read the opening place: ' + e.message;
    return;
  }

  const field = createField(gl);
  const slots = createSlots({ ring: RING });
  const cam = { x: baked.meta.centre[0], z: baked.meta.centre[1], yaw: 0.72, pitch: 0.40, dist: 215 };
  const view = { colour: 1, grain: 0.9, clock: 0 };   // the ramp opens; c reaches the photograph

  function fill() {
    const ctx = Math.floor(cam.x / TILE_SPAN), ctz = Math.floor(cam.z / TILE_SPAN);
    for (const job of slots.reshelve(ctx, ctz)) {
      const slot = slots.slots[job.idx];
      const next = sampleTile(baked.data, baked.meta, job.tx, job.tz);
      field.writeTile(job.idx, { tx: job.tx, tz: job.tz, prev: next, next, born: -10 });
      slot.data = next;
      slots.markReady(job.idx);
    }
  }
  fill();

  $('m-place').textContent = baked.meta.name;
  $('m-n').textContent = field.count.toLocaleString('en-US');
  $('m-datum').textContent = baked.data.datum.toFixed(2);
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
    gl.uniformMatrix4fv(u.uView, false, m.view);
    gl.uniformMatrix4fv(u.uProj, false, m.proj);
    gl.uniform3f(u.uCentre, cam.x, 0, cam.z);
    gl.uniform2f(u.uDir, 0, 1);
    gl.uniform1f(u.uMix, 0);
    gl.uniform1f(u.uTime, view.clock);
    gl.uniform1f(u.uArc, 0);
    gl.uniform1f(u.uLift, 0);
    gl.uniform1f(u.uSwing, 0);
    gl.uniform1f(u.uColour, view.colour);
    gl.uniform1f(u.uPointK, m.pointK);
    gl.uniform1f(u.uSpan, 0.55);
    gl.uniform1f(u.uDrop, 11);
    gl.uniform1f(u.uJump, 0);
    gl.uniform1f(u.uSize, view.grain);
    gl.uniform1f(u.uHalf, HALF);
    gl.uniform1f(u.uTop, 18);
    field.drawPoints();
  }

  // ------------------------------------------------------------- controls
  const COLOURS = ['lit photo', 'height ramp', 'photo texture'];
  const setColour = (i) => { view.colour = i; $('colour').textContent = COLOURS[i]; };
  setColour(view.colour);
  $('colour').onclick = () => setColour((view.colour + 1) % COLOURS.length);
  $('grain').oninput = (e) => { view.grain = +e.target.value; };

  function savePNG() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * 3);
    canvas.height = Math.round(innerHeight * 3);
    render(canvas.width, canvas.height);
    // Read it back in the same tick: without preserveDrawingBuffer the
    // composite is gone the moment the frame yields.
    const url = canvas.toDataURL('image/png');
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    const a = document.createElement('a');
    a.href = url;
    a.download = `elsewhere-${Math.round(cam.x)}-${Math.round(cam.z)}.png`;
    a.click();
    note('saved at ×3');
  }
  $('save').onclick = savePNG;

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
    cam.dist = Math.max(90, Math.min(1800, cam.dist * Math.exp(e.deltaY * 0.0011)));
  }, { passive: false });

  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'c') setColour((view.colour + 1) % COLOURS.length);
    else if (k === 's') savePNG();
    else if (k === 'h') document.querySelectorAll('#ui, #meta, #hint').forEach((n) => {
      n.style.display = n.style.display === 'none' ? '' : 'none';
    });
  });

  let last = performance.now();
  function frame(now) {
    view.clock += Math.min(0.05, (now - last) / 1000);
    last = now;
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
    ready: () => slots.readyCount() === RING * RING,
    place: () => baked.meta,
    count: () => field.count,
    state: () => ({ ...view }),
    setColour: (i) => { view.colour = i; },
    setCam: (o) => Object.assign(cam, o),
    centre: () => ({ x: cam.x, z: cam.z }),
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
