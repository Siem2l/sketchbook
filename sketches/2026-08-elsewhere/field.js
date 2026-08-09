// The vertex buffer and everything that writes into it.
//
// Allocated once and never resized. A particle is never created and never
// destroyed for the life of the page; loading a place writes into it, and
// jumping tells every particle where to stand next. That rule is the reason a
// jump has to have the destination in hand before anything moves.
import { POINT_VS, POINT_FS, FRAME_VS, FRAME_FS } from './shaders.js';

export const CELL = 0.5;                          // AHN's native grid
export const TILE_CELLS = 32;
export const TILE_SPAN = TILE_CELLS * CELL;       // 16 m
export const RING = 12;                           // cached
export const SHOWN = 10;                          // drawn — the difference is the margin
export const SPAN = SHOWN * TILE_SPAN;            // 160 m
export const HALF = SPAN / 2;
export const STRIDE = 32;
const PER_TILE = TILE_CELLS * TILE_CELLS;

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

export const emptyTile = () => ({
  y: new Float32Array(PER_TILE),
  colour: new Uint8Array(PER_TILE * 3),
  normal: new Int8Array(PER_TILE * 2),
});

export function createField(gl) {
  const count = RING * RING * PER_TILE;
  const buf = new ArrayBuffer(count * STRIDE);
  const f32 = new Float32Array(buf);
  const u8 = new Uint8Array(buf);
  const i8 = new Int8Array(buf);

  const program = link(gl, POINT_VS, POINT_FS);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, buf.byteLength, gl.DYNAMIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const attr = (name, size, type, norm, off) => {
    const l = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, size, type, norm, STRIDE, off);
  };
  attr('aWorld', 2, gl.FLOAT, false, 0);
  attr('aY', 2, gl.FLOAT, false, 8);
  attr('aBorn', 1, gl.FLOAT, false, 16);
  attr('aCA', 4, gl.UNSIGNED_BYTE, true, 20);
  attr('aCB', 4, gl.UNSIGNED_BYTE, true, 24);
  attr('aN', 4, gl.BYTE, true, 28);
  gl.bindVertexArray(null);

  const names = ['uView','uProj','uCentre','uDir','uMix','uTime','uArc','uLift','uSwing',
    'uColour','uPointK','uSpan','uDrop','uJump','uSize','uHalf','uTop'];
  const uniforms = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]));
  const EMPTY = emptyTile();

  // A render tile is TILE_CELLS squared particles and contiguous in the buffer,
  // so recycling one is a single upload. That is the only reason render tiles
  // are 16 m while the tiles fetched from PDOK are 240 m.
  function writeTile(idx, { tx, tz, prev, next, born }) {
    const A = prev ?? EMPTY, B = next ?? prev ?? EMPTY;
    const base = idx * PER_TILE;
    const ox = tx * TILE_SPAN, oz = tz * TILE_SPAN;
    for (let p = 0; p < PER_TILE; p++) {
      const o = (base + p) * STRIDE, w = o >> 2;
      f32[w] = ox + (p % TILE_CELLS) * CELL;
      f32[w + 1] = oz + ((p / TILE_CELLS) | 0) * CELL;
      f32[w + 2] = A.y[p];
      f32[w + 3] = B.y[p];
      // Jittered per particle, not per tile. This one line is the difference
      // between a tile arriving as a block and a tile arriving as a scatter.
      if (born !== undefined) f32[w + 4] = born + ((p * 2654435761) % 1013) / 1013 * 0.65;
      u8[o + 20] = A.colour[p*3]; u8[o + 21] = A.colour[p*3+1]; u8[o + 22] = A.colour[p*3+2]; u8[o + 23] = 255;
      u8[o + 24] = B.colour[p*3]; u8[o + 25] = B.colour[p*3+1]; u8[o + 26] = B.colour[p*3+2]; u8[o + 27] = 255;
      i8[o + 28] = A.normal[p*2]; i8[o + 29] = A.normal[p*2+1];
      i8[o + 30] = B.normal[p*2]; i8[o + 31] = B.normal[p*2+1];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, base * STRIDE, u8, base * STRIDE, PER_TILE * STRIDE);
  }

  // The square's own edge, drawn rather than faded. Fog hides the fact that the
  // world stops; a frame says so, and says how big the sample is.
  const frameProgram = link(gl, FRAME_VS, FRAME_FS);
  const frameU = {
    uView: gl.getUniformLocation(frameProgram, 'uView'),
    uProj: gl.getUniformLocation(frameProgram, 'uProj'),
  };
  const frameVao = gl.createVertexArray();
  const L = [];
  {
    const seg = (a, b, c) => L.push(a[0], a[1], a[2], ...c, b[0], b[1], b[2], ...c);
    const dim = [0.22, 0.22, 0.27], amber = [0.88, 0.64, 0.09];
    const H = HALF, gy = -0.5, tick = 18;
    seg([-H, gy, -H], [H, gy, -H], dim); seg([H, gy, -H], [H, gy, H], dim);
    seg([H, gy, H], [-H, gy, H], dim);   seg([-H, gy, H], [-H, gy, -H], dim);
    for (const [sx, sz] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
      seg([sx*H, gy, sz*H], [sx*(H-tick), gy, sz*H], amber);
      seg([sx*H, gy, sz*H], [sx*H, gy, sz*(H-tick)], amber);
      seg([sx*H, gy, sz*H], [sx*H, gy + 10, sz*H], amber);
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
    count, program, uniforms, writeTile,
    drawFrame(view, proj) {
      gl.useProgram(frameProgram);
      gl.uniformMatrix4fv(frameU.uView, false, view);
      gl.uniformMatrix4fv(frameU.uProj, false, proj);
      gl.bindVertexArray(frameVao);
      gl.drawArrays(gl.LINES, 0, frameVerts);
    },
    drawPoints() {
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.bindVertexArray(null);
    },
  };
}
