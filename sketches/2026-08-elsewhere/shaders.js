// Two programs, and no vertex buffer at all.
//
// A particle is its gl_VertexID and nothing else. Its ground position comes from
// that index and a uniform; its height, its colour and its normal come from
// textures. The consequence worth having is that colour resolution stops being
// tied to geometry resolution: heights are stuck at AHN's half metre, but the
// orthophoto is sampled at 25 cm with bilinear filtering, and a particle can sit
// anywhere in between. Binding the two together is what made the first version
// look like a diagram of a city rather than a city.
//
// Sliding the window is now a uniform. Nothing is written per particle, ever.

export const POINT_VS = `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uHeight;   // RG32F: surface, terrain — metres above the datum
uniform sampler2DArray uPhoto;    // RGBA8: the orthophoto

uniform mat4 uView, uProj;
uniform vec2 uCentre;             // world xz the square is framing
uniform vec2 uDir;                // unit travel direction, scene space
uniform vec4 uTilesA[12];          // per layer: origin x, origin z, span, resident
uniform vec4 uTilesB[12];
uniform float uBornA[12];          // when each layer landed, for the changeover
uniform int uGrid;                // cells across the drawn square
uniform float uCell, uHalf;
uniform float uToneLo, uToneGain;      // the place you are on
uniform float uToneLoB, uToneGainB;    // the place you are flying to
uniform float uMix, uTime, uArc, uLift, uSwing;
uniform float uColour, uPointK, uSpan, uDrop, uJump, uSize, uTop;

out vec3 vCol;
out float vAlive;

float hash1(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

// Which resident tile holds this ground, and where in it. Twelve candidates is a
// loop the vertex unit does not notice, and it saves carrying a layer index per
// particle — which would mean writing to a buffer every time a tile moved.
int findLayer(vec4 tiles[12], vec2 w, out vec2 uv, out float span) {
  int best = -1;
  float finest = 1e9;
  for (int i = 0; i < 12; i++) {
    if (tiles[i].w < 0.5) continue;
    vec2 rel = w - tiles[i].xy;
    float sp = tiles[i].z;
    if (rel.x < 0.0 || rel.y < 0.0 || rel.x >= sp || rel.y >= sp) continue;
    // Layers overlap: the coarse opening frame covers ground that sharp tiles
    // later cover too. Prefer the smallest span, which is the sharpest.
    if (sp < finest) {
      finest = sp; best = i;
      // rasters are north-up, so v runs the other way to northing
      uv = vec2(rel.x / sp, 1.0 - rel.y / sp);
    }
  }
  span = finest;
  uv = best < 0 ? vec2(0.0) : uv;
  return best;
}

struct Sample { float y; float hag; vec3 rgb; vec3 n; float born; float found; };

Sample lookup(vec4 tiles[12], vec2 w, bool useBorn, float toneLo, float toneGain) {
  Sample s;
  vec2 uv; float span;
  int layer = findLayer(tiles, w, uv, span);
  s.found = layer < 0 ? 0.0 : 1.0;
  if (layer < 0) { s.y = 0.0; s.hag = 0.0; s.rgb = vec3(0.0); s.n = vec3(0.0, 1.0, 0.0); s.born = -1e4; return s; }

  vec2 texel = vec2(1.0) / vec2(textureSize(uHeight, 0).xy);
  float mpt = span / float(textureSize(uHeight, 0).x);   // metres a height texel
  vec2 h = texture(uHeight, vec3(uv, float(layer))).rg;
  s.y = h.r;
  s.hag = max(0.0, h.r - h.g);
  // The percentile stretch, done here rather than on the way in. An orthophoto
  // occupies a narrow low slice — 56 to 196 of 255 on this window — and left
  // alone the street sinks into the background. Stretching luminance and
  // carrying the chroma along keeps the hue that was photographed; per channel,
  // a shadow at (60,70,85) comes out (7,27,55) and the square goes blue.
  vec3 raw = texture(uPhoto, vec3(uv, float(layer))).rgb;
  float lum = dot(raw, vec3(0.299, 0.587, 0.114));
  s.rgb = lum > 0.004 ? raw * (max(0.0, lum - toneLo) * toneGain / lum) : vec3(0.0);

  // Normals from the height field itself. An orthophoto is flat light with the
  // sun already in it; the gradient is the only thing that can make a roof face
  // the sun and an alley fall into shadow.
  float l = texture(uHeight, vec3(uv - vec2(texel.x, 0.0), float(layer))).r;
  float r = texture(uHeight, vec3(uv + vec2(texel.x, 0.0), float(layer))).r;
  float d = texture(uHeight, vec3(uv - vec2(0.0, texel.y), float(layer))).r;
  float u = texture(uHeight, vec3(uv + vec2(0.0, texel.y), float(layer))).r;
  float dx = (r - l) / (2.0 * mpt);
  float dz = (d - u) / (2.0 * mpt);
  s.n = normalize(vec3(-dx, 1.0, -dz));

  // A surface model has no walls and no canopy volume. Seen from above a facade
  // is a discontinuity between two cells rather than a surface, so it collects
  // nothing; and a tree is one opaque number where a laser would have returned
  // from leaves, a branch and the ground in the same column. In the hendriklaan
  // window that multi-return population was 62% of every point in the cloud.
  //
  // So cells on a sharp drop are spent partway down the face they stand on, and
  // cells that look like vegetation are spread through the crown. Vegetation is
  // found by curvature rather than slope, so a pitched roof stays the plane it
  // is and only a crown is rough in every direction at once. The heights stay
  // measured; where a particle sits between two of them is inferred.
  float k = hash1(floor(w / uCell));
  float drop = max(max(s.y - l, s.y - r), max(s.y - d, s.y - u));
  float rough = abs(4.0 * s.y - (l + r + d + u)) * 0.25;
  if (s.hag > 2.5 && rough > 0.35) {
    s.y = (s.y - s.hag) + s.hag * (0.42 + 0.58 * sqrt(k));
  } else if (drop > 1.2 && k < 0.7) {
    s.y -= drop * (k / 0.7);
  }

  s.born = useBorn ? uBornA[layer] : -1e4;
  return s;
}

void main() {
  // No vertex buffer: the particle is its index.
  int id = gl_VertexID;
  int gx = id % uGrid, gz = id / uGrid;
  vec2 w = uCentre - vec2(uHalf) + (vec2(float(gx), float(gz)) + 0.5) * uCell;

  Sample A = lookup(uTilesA, w, true, uToneLo, uToneGain);
  Sample B = lookup(uTilesB, w, false, uToneLoB, uToneGainB);

  // Two ways a particle changes what it stands on. Sliding the window: its own
  // clock, keyed off when its tile landed and jittered per particle, so an
  // arriving tile is a scatter of pixels dropping out and popping back rather
  // than a block appearing at once. Jumping: one clock for everybody, staggered
  // along the bearing, so the departure edge leaves first.
  float u = dot(normalize(w - uCentre + 1e-4), uDir) * 0.5 + 0.5;
  float tJump = clamp(uMix * 1.55 - 0.55 * u, 0.0, 1.0);
  float jitter = hash1(w + 7.1) * 0.65;
  float tLocal = clamp((uTime - A.born - jitter) / uSpan, 0.0, 1.0);
  float t = mix(tLocal, tJump, uJump);
  float arc = sin(t * 3.14159265) * uArc;

  // Through a local changeover the pixel falls away, vanishes, and comes back
  // carrying whatever the new tile put there. There is nothing to blend between
  // — the texture it was reading has already been overwritten — so the dip and
  // the size fade are the whole effect, and A is read throughout. Only a jump
  // has two places resident at once, and only a jump interpolates.
  float cross = 1.0 - abs(t * 2.0 - 1.0);
  float pick = uJump > 0.5 ? tJump : 0.0;

  // A particle keeps its ground and changes what it is standing on. Displacing
  // it by the true offset between two places is the obvious reading and it is
  // wrong: 49 km puts every particle off screen by mid-flight.
  float y = mix(A.y, B.y, pick) - (1.0 - uJump) * uDrop * cross;
  vec3 rgb = mix(A.rgb, B.rgb, pick);
  vec3 n = normalize(mix(A.n, B.n, pick));

  vec2 stream = -uDir * uSwing * arc * (0.6 + 0.8 * hash1(w));
  float lift = uLift * arc * (0.5 + hash1(w + 3.7));

  vec3 p = vec3(w.x + stream.x - uCentre.x, y + lift, w.y + stream.y - uCentre.y);
  vec4 eye = uView * vec4(p, 1.0);
  gl_Position = uProj * eye;

  float diff = 0.34 + 0.78 * max(0.0, dot(n, normalize(vec3(-0.42, 0.80, 0.42))));
  // An orthophoto's midtone is a wet road; left linear the street disappears.
  vec3 photo = pow(rgb, vec3(0.72));
  float ht = clamp(y / uTop, 0.0, 1.0);
  vec3 ramp = ht < 0.38 ? mix(vec3(0.09,0.10,0.19), vec3(0.20,0.44,0.47), ht/0.38)
            : ht < 0.76 ? mix(vec3(0.20,0.44,0.47), vec3(0.85,0.72,0.42), (ht-0.38)/0.38)
                        : mix(vec3(0.85,0.72,0.42), vec3(1.00,0.98,0.94), (ht-0.76)/0.24);
  float plum = dot(photo, vec3(0.299, 0.587, 0.114));

  vCol = (uColour < 0.5 ? photo * diff
        : uColour < 1.5 ? ramp * diff
                        : ramp * (0.45 + 1.1 * plum) * diff) + arc * 0.06;

  // Residency is whether a layer actually holds this ground, not anything to do
  // with the clock. Conflating the two drew nothing at all: the opening frame
  // is marked as long settled, and "settled" was reading as "absent".
  float resident = max(A.found, uJump * B.found);
  vAlive = (1.0 - (1.0 - uJump) * cross) * resident;

  float dist = max(-eye.z, 1.0);
  // Sized from the projection: the on-screen size of one cell at this distance,
  // times a grain factor. A constant is wrong at every distance but one.
  gl_PointSize = clamp(uPointK * uSize / dist * (1.0 + arc * 0.45) * vAlive, 0.6, 26.0);
}`;

export const POINT_FS = `#version 300 es
precision highp float;
in vec3 vCol;
in float vAlive;
out vec4 frag;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25 || vAlive < 0.06) discard;
  // Discarding the rim rather than blending it keeps depth writes honest, so
  // near roofs actually occlude far ones.
  frag = vec4(vCol * (0.68 + 0.32 * (1.0 - smoothstep(0.13, 0.25, r2))), 1.0);
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
