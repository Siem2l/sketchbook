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
import { WAKE_N, WEIGHT_N } from './touch.js';

export const POINT_VS = `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uHeight;   // RG32F: surface, terrain — metres above the datum
uniform sampler2DArray uPhoto;    // RGBA8: the orthophoto

uniform mat4 uView, uProj;
uniform vec2 uCentre;             // world xz the square is framing
uniform vec2 uDir;                // unit travel direction, scene space
uniform vec4 uTilesA[13];          // per layer: origin x, origin z, span, resident
uniform vec4 uTilesB[13];
uniform float uBornA[13];          // when each layer landed, for the changeover
uniform int uGrid;                // cells across the drawn square
uniform float uCell, uHalf;
uniform float uToneLo, uToneGain;      // the place you are on
uniform float uToneLoB, uToneGainB;    // the place you are flying to
uniform float uMix, uTime, uArc, uLift, uSwing;
uniform float uColour, uPointK, uSpan, uDrop, uJump, uSize, uTop;
uniform vec4 uBands;                   // sub, low, mid, high, each 0..1
uniform float uAudio;                  // 0 closes the whole channel
// Everything this sketch adds on top of what was measured, each switchable, so
// the inference can be seen rather than taken on trust. All four at zero is the
// raster as PDOK sent it.
uniform float uWalls, uCanopy, uTone, uShade;

// The cursor, as a field. Both rings hold world x, world z, birth time and
// strength, and an expired entry has strength exactly 0.0 — so a square nobody
// is touching is the survey bit for bit, which is the property the rest-state
// test pins and the reason touch needs no switch of its own.
uniform vec4 uWake[${WAKE_N}];
uniform vec4 uWeights[${WEIGHT_N}];
uniform vec4 uWakeK;               // life, radius, lift, push
uniform vec4 uWeightK;             // life, radius, depth, rim

out vec3 vCol;
out float vAlive;

float hash1(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

// Which resident tile holds this ground, and where in it. Thirteen candidates is a
// loop the vertex unit does not notice, and it saves carrying a layer index per
// particle — which would mean writing to a buffer every time a tile moved.
int findLayer(vec4 tiles[13], vec2 w, out vec2 uv, out float span) {
  int best = -1;
  float finest = 1e9;
  for (int i = 0; i < 13; i++) {
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

Sample lookup(vec4 tiles[13], vec2 w, bool useBorn, float toneLo, float toneGain) {
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
  vec3 stretched = lum > 0.004 ? raw * (max(0.0, lum - toneLo) * toneGain / lum) : vec3(0.0);
  s.rgb = mix(raw, stretched, uTone);

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

  // The same three-way split hendriklaan gets handed by the survey, reached
  // here from the height field instead: how far off the deck a cell sits, how
  // rough it is in every direction at once, and whether it stands on a drop.
  // Ground answers the sub, the canopy answers the mids, roofs and facades
  // answer the highs — the same mapping, arrived at from geometry rather than
  // from a label.
  //
  // uAudio at zero makes this term exactly zero, not merely small, so silence
  // returns the square to the survey bit for bit.
  float ground = 1.0 - smoothstep(0.2, 0.8, s.hag);
  float canopy = step(2.5, s.hag) * smoothstep(0.25, 0.5, rough);
  float built = smoothstep(1.0, 1.6, drop);
  s.y += uAudio * 1.6 * (0.4 + hash1(w * 0.61))
       * (uBands.x * ground + uBands.y * 0.35 + uBands.z * canopy + uBands.w * built);
  //
  // What a cell is and whether to act on it are separate questions. Gating the
  // branches directly would let a switched-off canopy fall through into the
  // facade case and grow walls out of a tree.
  bool isCanopy = s.hag > 2.5 && rough > 0.35;
  bool isFacade = !isCanopy && drop > 1.2 && k < 0.7;
  if (isCanopy && uCanopy > 0.5) {
    s.y = (s.y - s.hag) + s.hag * (0.42 + 0.58 * sqrt(k));
  } else if (isFacade && uWalls > 0.5) {
    s.y -= drop * (k / 0.7);
  }

  s.born = useBorn ? uBornA[layer] : -1e4;
  return s;
}

// What the cursor does to this patch of ground, in metres. Returned rather than
// applied, because where it gets applied is the whole argument: on the drawn
// position and never on w. A particle shoved sideways carries its own roof
// colour and its own measured height with it; feeding the offset back into the
// lookup would have it resample whatever ground it flew over, which is the jump
// rule the wrong way round — there a particle keeps its ground and changes what
// it stands on, here it keeps what it stands on and changes its ground.
vec3 touchOf(vec2 w, float k) {
  vec3 d = vec3(0.0);

  // A wake. Each entry is somewhere the pointer passed and how fast it was
  // going there; particles near that line lift, get out of the way, and settle.
  // Lift is what makes it visible at all — a purely lateral dodge on a flat
  // street reads as nothing from an orbiting camera, and lift on its own reads
  // as a bulge rather than as something moving aside.
  vec3 wk = vec3(0.0);
  for (int i = 0; i < ${WAKE_N}; i++) {
    float s = uWake[i].w;
    if (s == 0.0) continue;
    vec2 rel = w - uWake[i].xy;
    float r = length(rel);
    if (r > uWakeK.y) continue;
    float fall = 1.0 - smoothstep(0.0, uWakeK.y, r);
    float age = clamp((uTime - uWake[i].z) / uWakeK.x, 0.0, 1.0);
    // Kicks in the first quarter of its life and settles through the rest, and
    // lands on exactly zero rather than approaching it — sine of the root is
    // zero at both ends, and the linear term makes the landing doubly flat.
    float env = sin(3.14159265 * sqrt(age)) * (1.0 - age);
    float a = s * fall * env;
    // Jittered by the same hash the canopy and the audio terms use, so what
    // passes is a scatter of particles and not a smooth dome travelling.
    wk.y += uWakeK.z * a * (0.45 + 1.1 * k);
    wk.xz += (rel / max(r, 1e-3)) * uWakeK.w * a * (0.6 + 0.8 * k);
  }
  // Samples overlap on purpose — that is what makes a trail of discs read as
  // one furrow — but a pointer scribbling in one place piles a dozen of them on
  // the same particle. Capped, so a vigorous sweep stays vigorous instead of
  // becoming a launch. Multiplying through zero still gives zero, so the cap
  // costs nothing at rest.
  wk.y = min(wk.y, uWakeK.z * 2.6);
  float lat = length(wk.xz);
  wk.xz *= lat > uWakeK.w * 2.2 ? (uWakeK.w * 2.2) / lat : 1.0;
  d += wk;

  // A weight, landed and relaxing. A bowl inside the radius and a ring of
  // thrown material at the rim: without the ring it reads as a hole punched
  // through the city rather than as something heavy sitting on it. The ring
  // carries most of the drama, and deliberately so — a point cloud shows what
  // is flung up into the light far better than what is pressed down into the
  // dark, and the first pass, which was almost all bowl, barely registered.
  vec3 wt = vec3(0.0);
  for (int i = 0; i < ${WEIGHT_N}; i++) {
    float s = uWeights[i].w;
    if (s == 0.0) continue;
    vec2 rel = w - uWeights[i].xy;
    float r = length(rel);
    if (r > uWeightK.y * 3.0) continue;
    float q = r / uWeightK.y;
    float bowl = exp(-q * q * 2.4);
    float ring = exp(-pow((q - 1.05) * 2.0, 2.0));
    float age = clamp((uTime - uWeights[i].z) / uWeightK.x, 0.0, 1.0);
    // Full depth on impact, then a damped rebound that overshoots flat, all of
    // it multiplied to exactly zero at the end of the life. A dent that merely
    // decayed towards flat would mean a settled square is no longer the survey.
    float env = (1.0 - age) * exp(-2.4 * age) * cos(age * 7.4);
    float amp = uWeightK.z * s * env * (0.75 + 0.5 * k);
    wt.y += amp * (uWeightK.w * ring - bowl);
    // The ring travels outward as well as upward, and reverses with the
    // envelope, so the rebound draws the material back in rather than leaving
    // it standing. Half the depth: enough to see it move, not enough to open a
    // clearing in the street.
    wt.xz += (rel / max(r, 1e-3)) * amp * ring * 0.5;
  }
  wt.y = clamp(wt.y, -uWeightK.z * 1.6, uWeightK.z * 1.6);
  float rad = length(wt.xz);
  wt.xz *= rad > uWeightK.z ? uWeightK.z / rad : 1.0;
  d += wt;

  return d;
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
  // One transition, and every particle in it at once. Spreading the start times
  // per particle made the field churn — two hundred thousand things each doing
  // their own errand reads as noise, not as a place becoming another place.
  // Eased rather than linear, so the city gathers itself, moves, and settles.
  float r = hash1(w * 0.37 + 2.9);
  float tJump = smoothstep(0.0, 1.0, uMix);
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
  // Height crosses over smoothly so a particle arcs from one roof to the next.
  // Colour switches at the top of that arc instead of blending: a red pantile
  // averaged with a grey road is mud, and the particle carrying its old colour
  // up and bringing the new one down is the thing worth watching. The spread
  // above means the population converts gradually even though each particle
  // flips at once.
  // Height and colour move on the same eased curve, so a roof travels to its
  // replacement carrying its own colour the whole way.
  float pick = uJump > 0.5 ? t : 0.0;
  float flip = pick;

  // A particle keeps its ground and changes what it is standing on. Displacing
  // it by the true offset between two places is the obvious reading and it is
  // wrong: 49 km puts every particle off screen by mid-flight.
  float y = mix(A.y, B.y, pick) - (1.0 - uJump) * uDrop * cross;
  vec3 rgb = mix(A.rgb, B.rgb, flip);
  vec3 n = normalize(mix(A.n, B.n, flip));

  // Nothing is thrown into the air on a jump. A lift reads as the picture being
  // swapped while you are not looking at it, and a lateral slide takes the
  // field out of a bounded square altogether. What moves is the ground itself:
  // roofs rise and fall into the roofs that replace them. Swing and lift are
  // kept only for the local changeover, where a tile arrives over new ground.
  vec2 stream = -uDir * uSwing * arc * (1.0 - uJump) * (0.5 + r);
  float lift = uLift * arc * (1.0 - uJump) * (0.35 + 1.1 * r);

  vec3 tch = touchOf(w, hash1(w * 1.13 + 5.7));

  vec3 p = vec3(w.x + stream.x - uCentre.x, y + lift, w.y + stream.y - uCentre.y) + tch;
  vec4 eye = uView * vec4(p, 1.0);
  gl_Position = uProj * eye;

  // Flat light when the sun is off: the orthophoto already has a sun in it.
  float diff = mix(1.0, 0.34 + 0.78 * max(0.0, dot(n, normalize(vec3(-0.42, 0.80, 0.42)))), uShade);
  // An orthophoto's midtone is a wet road; left linear the street disappears.
  vec3 photo = uTone > 0.5 ? pow(rgb, vec3(0.72)) : rgb;
  float ht = clamp(y / uTop, 0.0, 1.0);
  vec3 ramp = ht < 0.38 ? mix(vec3(0.09,0.10,0.19), vec3(0.20,0.44,0.47), ht/0.38)
            : ht < 0.76 ? mix(vec3(0.20,0.44,0.47), vec3(0.85,0.72,0.42), (ht-0.38)/0.38)
                        : mix(vec3(0.85,0.72,0.42), vec3(1.00,0.98,0.94), (ht-0.76)/0.24);
  float plum = dot(photo, vec3(0.299, 0.587, 0.114));

  // Kicked-up particles catch a little more light, the same small favour the
  // arc already does for a changeover. Only lift counts: a particle pressed
  // into a dent should not go dark, it should just be lower.
  vCol = (uColour < 0.5 ? photo * diff
        : uColour < 1.5 ? ramp * diff
                        : ramp * (0.45 + 1.1 * plum) * diff)
       + arc * 0.06 + max(0.0, tch.y) * 0.045;

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
