// The GPU side: two texture arrays and a draw call with no vertex buffer.
//
// A place lives in textures, not in a vertex buffer. Heights go up as RG32F —
// surface and terrain, in metres above the place's datum — and the orthophoto
// as RGBA8 at four times the height resolution, because the photo's source is
// 8 cm and there is no reason for colour to inherit the half-metre grid the
// heights are stuck with.
//
// The consequences are the point of the whole rewrite. A tile arriving is one
// texSubImage3D instead of a thousand vertex writes. Sliding the window is a
// uniform. Nothing is written per particle at any time, so the drawn resolution
// is free to be finer than the survey wherever the colour can carry it.
import { POINT_VS, POINT_FS, FRAME_VS, FRAME_FS } from './shaders.js';

export const CELL = 0.5;                     // AHN's native grid
export const SPAN = 240;                     // the drawn square, matching hendriklaan
export const HALF = SPAN / 2;
export const GRID = Math.round(SPAN / CELL); // 480 cells across = 230,400 particles
export const TILE_SPAN = 240;                // a fetch tile, on a global grid
export const TILE_H = 480;                   // height texels a tile edge — 0.5 m
export const TILE_P = 960;                   // photo texels a tile edge — 25 cm
// Nine layers for the sharp ring (0..8), then two pairs that alternate: 9,10
// for the place you are standing on and 11,12 for the place you are flying to,
// each pair being a wide 480 m frame at one metre and a sharp 240 m centre at
// half a metre. The sharp centre exists so a jump morphs between two places at
// the same resolution rather than dissolving into a blurred one; the wide frame
// is what the edges of the square stand on until the ring reloads.
export const LAYERS = 13;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function link(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function makeArray(gl, internal, format, type, size, layers, filter) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, internal, size, size, layers);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export function createField(gl) {
  // R32F is not filterable without OES_texture_float_linear, and the heights
  // must not be smoothed across a roof edge anyway — a bilinear height would
  // ramp the facades into slopes. Nearest for heights, linear for the photo.
  if (!gl.getExtension('EXT_color_buffer_float')) { /* not needed to sample, only to render to */ }
  const height = makeArray(gl, gl.RG32F, gl.RG, gl.FLOAT, TILE_H, LAYERS, gl.NEAREST);
  const photo = makeArray(gl, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, TILE_P, LAYERS, gl.LINEAR);

  const program = link(gl, POINT_VS, POINT_FS);
  const names = ['uHeight','uPhoto','uView','uProj','uCentre','uDir','uGrid','uCell','uHalf',
    'uToneLo','uToneGain','uToneLoB','uToneGainB','uMix','uTime','uArc','uLift','uSwing','uColour','uPointK','uSpan','uDrop',
    'uJump','uSize','uTop'];
  const u = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]));
  u.uTilesA = gl.getUniformLocation(program, 'uTilesA');
  u.uTilesB = gl.getUniformLocation(program, 'uTilesB');
  u.uBornA = gl.getUniformLocation(program, 'uBornA');

  // WebGL2 still wants a bound VAO even when nothing is in it.
  const emptyVao = gl.createVertexArray();

  function uploadHeight(layer, dsm, dtm) {
    // interleaved RG so one fetch in the shader gives both
    const rg = new Float32Array(TILE_H * TILE_H * 2);
    for (let i = 0; i < TILE_H * TILE_H; i++) { rg[i * 2] = dsm[i]; rg[i * 2 + 1] = dtm[i]; }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, height);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, TILE_H, TILE_H, 1, gl.RG, gl.FLOAT, rg);
  }

  function uploadPhoto(layer, rgba) {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, photo);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, TILE_P, TILE_P, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  }

  // The square's edge, drawn rather than faded. Fog hides the fact that the
  // world stops; a frame says so, and says how big the sample is.
  const frameProgram = link(gl, FRAME_VS, FRAME_FS);
  const fu = {
    uView: gl.getUniformLocation(frameProgram, 'uView'),
    uProj: gl.getUniformLocation(frameProgram, 'uProj'),
  };
  const frameVao = gl.createVertexArray();
  const L = [];
  {
    const seg = (a, b, c) => L.push(a[0], a[1], a[2], ...c, b[0], b[1], b[2], ...c);
    const dim = [0.22, 0.22, 0.27], amber = [0.88, 0.64, 0.09];
    const H = HALF, gy = -0.5, tick = 26;
    seg([-H, gy, -H], [H, gy, -H], dim); seg([H, gy, -H], [H, gy, H], dim);
    seg([H, gy, H], [-H, gy, H], dim);   seg([-H, gy, H], [-H, gy, -H], dim);
    for (const [sx, sz] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
      seg([sx*H, gy, sz*H], [sx*(H-tick), gy, sz*H], amber);
      seg([sx*H, gy, sz*H], [sx*H, gy, sz*(H-tick)], amber);
      seg([sx*H, gy, sz*H], [sx*H, gy + 12, sz*H], amber);
    }
    gl.bindVertexArray(frameVao);
    const fb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(L), gl.STATIC_DRAW);
    const lp = gl.getAttribLocation(frameProgram, 'aPos');
    const lc = gl.getAttribLocation(frameProgram, 'aCol');
    gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(lc); gl.vertexAttribPointer(lc, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
  }
  const frameVerts = L.length / 6;

  return {
    count: GRID * GRID,
    program, uniforms: u, uploadHeight, uploadPhoto,
    bindTextures() {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, height);
      gl.uniform1i(u.uHeight, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, photo);
      gl.uniform1i(u.uPhoto, 1);
    },
    drawFrame(view, proj) {
      gl.useProgram(frameProgram);
      gl.uniformMatrix4fv(fu.uView, false, view);
      gl.uniformMatrix4fv(fu.uProj, false, proj);
      gl.bindVertexArray(frameVao);
      gl.drawArrays(gl.LINES, 0, frameVerts);
    },
    drawPoints() {
      gl.bindVertexArray(emptyVao);
      gl.drawArrays(gl.POINTS, 0, GRID * GRID);
      gl.bindVertexArray(null);
    },
  };
}
