// The whole visual contract in two programs. Every frame is uniforms plus one
// POINTS draw; nothing is recomputed on the CPU per frame.

export const POINT_VS = `#version 300 es
precision highp float;

in vec2 aWorld;       // world x,z in RD metres
in vec2 aY;           // height at A, height at B, metres above the datum
in float aBorn;       // when this particle's own changeover began
in vec4 aCA;          // colour at A
in vec4 aCB;          // colour at B
in vec4 aN;           // nx,nz at A and at B

uniform mat4 uView, uProj;
uniform vec3 uCentre;     // the world xz the square is framing
uniform vec2 uDir;        // unit travel direction, scene space
uniform float uMix, uTime, uArc, uLift, uSwing;
uniform float uColour, uPointK, uSpan, uDrop, uJump, uSize, uHalf, uTop;

out vec3 vCol;
out float vAlive;

float hash1(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

void main() {
  // Two ways a particle changes what it is standing on.
  //
  // Sliding the window: its own clock. aBorn is jittered per particle rather
  // than per tile, so an arriving tile is a scatter of pixels dropping out and
  // popping back instead of a 32x32 block appearing at once. Tile-level timing
  // is visible as chunks and reads as a loading bar.
  //
  // Jumping: one clock for everybody, staggered along the bearing, so the
  // departure edge leaves first and the far edge lands last.
  float u = dot(normalize(aWorld - uCentre.xz + 1e-4), uDir) * 0.5 + 0.5;
  float tJump = clamp(uMix * 1.55 - 0.55 * u, 0.0, 1.0);
  float tLocal = clamp((uTime - aBorn) / uSpan, 0.0, 1.0);
  float t = mix(tLocal, tJump, uJump);
  float arc = sin(t * 3.14159265) * uArc;

  // Through a local changeover the pixel falls away, vanishes, and the new one
  // pops up in its place. At no instant is a particle showing an average of two
  // places; it is showing one or the other.
  float cross = 1.0 - abs(t * 2.0 - 1.0);
  float side = step(0.5, t);
  float pick = mix(side, t, uJump);

  // A particle keeps its ground position and changes what it stands on.
  // Displacing it by the true offset between two places is the obvious reading
  // of "move to the new position" and it is wrong: 49 km puts every particle
  // off screen by mid-flight and the picture goes black. The journey lives in
  // the streaming below instead.
  vec2 w = aWorld;
  float y = mix(aY.x, aY.y, pick) - (1.0 - uJump) * uDrop * cross;

  vec2 stream = -uDir * uSwing * arc * (0.6 + 0.8 * hash1(aWorld));
  float lift = uLift * arc * (0.5 + hash1(aWorld + 3.7));

  vec3 p = vec3(w.x + stream.x - uCentre.x, y + lift, w.y + stream.y - uCentre.z);
  vec4 eye = uView * vec4(p, 1.0);
  gl_Position = uProj * eye;

  // Clip to the square. The ring caches a tile more than the frame shows, and
  // that margin is where new ground lands before it slides in. Without it the
  // leading edge is a hole however fast the loader is.
  vec2 rel = w - uCentre.xz;
  float inside = step(abs(rel.x), uHalf) * step(abs(rel.y), uHalf);

  vec3 n = mix(vec3(aN.x, 0.0, aN.y), vec3(aN.z, 0.0, aN.w), pick);
  n.y = sqrt(max(0.02, 1.0 - dot(n.xz, n.xz)));
  float diff = 0.34 + 0.78 * max(0.0, dot(normalize(n), normalize(vec3(-0.42, 0.80, 0.42))));

  // Stretched between the place's own percentiles upstream, then lifted here.
  // An orthophoto's midtone is a wet road, and left linear the whole street
  // sits at 0.37 and disappears into the background.
  vec3 photo = pow(mix(aCA.rgb, aCB.rgb, pick), vec3(0.72));
  float ht = clamp(y / uTop, 0.0, 1.0);
  vec3 ramp = ht < 0.38 ? mix(vec3(0.09,0.10,0.19), vec3(0.20,0.44,0.47), ht/0.38)
            : ht < 0.76 ? mix(vec3(0.20,0.44,0.47), vec3(0.85,0.72,0.42), (ht-0.38)/0.38)
                        : mix(vec3(0.85,0.72,0.42), vec3(1.00,0.98,0.94), (ht-0.76)/0.24);
  float lum = dot(photo, vec3(0.299, 0.587, 0.114));

  vec3 col = uColour < 0.5 ? photo * diff
           : uColour < 1.5 ? ramp * diff
                           : ramp * (0.45 + 1.1 * lum) * diff;
  vCol = col + arc * 0.06;
  vAlive = (1.0 - (1.0 - uJump) * cross) * inside;

  float d = max(-eye.z, 1.0);
  // Sized from the projection rather than from a constant: the true on-screen
  // size of one cell at this distance, times a grain factor below 1 so points
  // sit smaller than their spacing. That is what makes the square read as
  // particles instead of a skin, and a constant is wrong at every distance but
  // the one it was tuned at.
  gl_PointSize = clamp(uPointK * uSize / d * (1.0 + arc * 0.45) * vAlive, 0.6, 26.0);
}`;

export const POINT_FS = `#version 300 es
precision highp float;
in vec3 vCol;
in float vAlive;
out vec4 frag;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  if (vAlive < 0.06) discard;
  // Discarding the rim rather than blending it keeps depth writes honest, so
  // near roofs actually occlude far ones.
  float edge = 1.0 - smoothstep(0.13, 0.25, r2);
  frag = vec4(vCol * (0.68 + 0.32 * edge), 1.0);
}`;

export const FRAME_VS = `#version 300 es
precision highp float;
in vec3 aPos;
in vec3 aCol;
uniform mat4 uView, uProj;
out vec3 vC;
void main() { vC = aCol; gl_Position = uProj * uView * vec4(aPos, 1.0); }`;

export const FRAME_FS = `#version 300 es
precision highp float;
in vec3 vC;
out vec4 frag;
void main() { frag = vec4(vC, 1.0); }`;
