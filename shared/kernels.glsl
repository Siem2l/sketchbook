// Edge-detection kernels, written once and run in three places: the p5 WEBGL
// rig in sketches/2026-08-edge, the Hydra synth in sketches/2026-08-hydra-edge,
// and — with the header swap noted at the bottom — a TouchDesigner GLSL TOP.
//
// That portability is the whole point, so the operators agree on one contract
// and take nothing else:
//
//   tex     the source, already rendered to a texture. What produced it —
//           procedural, webcam, a frame out of TouchDesigner — is the host's
//           problem, not the operator's.
//   uv      the point being shaded, 0..1.
//   texel   one sampling step in uv. Hosts pass (1.0 / resolution) * spread,
//           so widening the stencil is a host-side knob and every operator
//           reacts to it the same way. Sub-pixel steps are legitimate: the
//           bilinear filter turns them into a cheap pre-blur.
//
// Every operator returns an unsigned edge magnitude, nominally 0..1, and none
// of them threshold, tint, or invert. Those are presentation, they differ per
// host, and baking them in here is what stops a kernel file being portable.
//
// GLSL ES 1.00 (WebGL1): p5's WEBGL mode, regl (which Hydra runs on), and
// TouchDesigner's GLSL TOP in its compatibility profile all accept this.

// Rec. 601 luma. Edge operators want perceived lightness, not the mean of the
// channels — on the mean, a saturated red/green boundary is a strong visual
// edge that reads as almost no edge at all.
float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

float lumaAt(sampler2D tex, vec2 uv) {
  return luma(texture2D(tex, uv).rgb);
}

// ---------------------------------------------------------------- operators

// Sobel — the default for good reason. The centre row/column weight of 2 is a
// crude smoothing pass folded into the derivative, so it is markedly steadier
// on noisy source than Roberts at the cost of a fatter line.
float sobel(sampler2D tex, vec2 uv, vec2 texel) {
  float tl = lumaAt(tex, uv + texel * vec2(-1.0, -1.0));
  float tm = lumaAt(tex, uv + texel * vec2( 0.0, -1.0));
  float tr = lumaAt(tex, uv + texel * vec2( 1.0, -1.0));
  float ml = lumaAt(tex, uv + texel * vec2(-1.0,  0.0));
  float mr = lumaAt(tex, uv + texel * vec2( 1.0,  0.0));
  float bl = lumaAt(tex, uv + texel * vec2(-1.0,  1.0));
  float bm = lumaAt(tex, uv + texel * vec2( 0.0,  1.0));
  float br = lumaAt(tex, uv + texel * vec2( 1.0,  1.0));
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (bl + 2.0 * bm + br) - (tl + 2.0 * tm + tr);
  return length(vec2(gx, gy)) * 0.25;   // /4: the weights sum to 4 per axis
}

// Sobel's gradient direction, in radians. Not an edge strength — hosts use it
// to tint by orientation, which is the clearest way to see that an operator
// found a direction and not just a magnitude.
float sobelAngle(sampler2D tex, vec2 uv, vec2 texel) {
  float tl = lumaAt(tex, uv + texel * vec2(-1.0, -1.0));
  float tm = lumaAt(tex, uv + texel * vec2( 0.0, -1.0));
  float tr = lumaAt(tex, uv + texel * vec2( 1.0, -1.0));
  float ml = lumaAt(tex, uv + texel * vec2(-1.0,  0.0));
  float mr = lumaAt(tex, uv + texel * vec2( 1.0,  0.0));
  float bl = lumaAt(tex, uv + texel * vec2(-1.0,  1.0));
  float bm = lumaAt(tex, uv + texel * vec2( 0.0,  1.0));
  float br = lumaAt(tex, uv + texel * vec2( 1.0,  1.0));
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (bl + 2.0 * bm + br) - (tl + 2.0 * tm + tr);
  return atan(gy, gx);
}

// Roberts cross — a 2x2 diagonal difference, the cheapest useful operator
// there is, and the thinnest line of the four. With no smoothing anywhere in
// it there is nothing to lift a shallow ramp, so it sits just under Sobel
// everywhere and drops off the soft edge entirely at default gain.
// Its stencil is off-centre by half a texel; that bias is inherent to the
// operator, not a bug to correct here.
float roberts(sampler2D tex, vec2 uv, vec2 texel) {
  float a = lumaAt(tex, uv);
  float b = lumaAt(tex, uv + texel * vec2(1.0, 0.0));
  float c = lumaAt(tex, uv + texel * vec2(0.0, 1.0));
  float d = lumaAt(tex, uv + texel);
  return length(vec2(a - d, b - c)) * 0.70710678;   // /sqrt(2)
}

// Laplacian, 8-neighbour — a second derivative, so it answers a different
// question. It responds to the *curvature* of intensity, not its slope, which
// makes it near-silent on anything smooth: on the test card it ignores the
// gradient ground, the soft vertical edge, and most of the noise patch, while
// Sobel lights all three up. The textbook warning that the Laplacian is the
// noisy one assumes pixel-level noise; against smooth grain it is the quiet
// one. The price is gain — a shallow ramp's second derivative is tiny, so it
// needs roughly an order of magnitude more than Sobel to speak at all.
float laplacian(sampler2D tex, vec2 uv, vec2 texel) {
  float sum = -8.0 * lumaAt(tex, uv);
  sum += lumaAt(tex, uv + texel * vec2(-1.0, -1.0));
  sum += lumaAt(tex, uv + texel * vec2( 0.0, -1.0));
  sum += lumaAt(tex, uv + texel * vec2( 1.0, -1.0));
  sum += lumaAt(tex, uv + texel * vec2(-1.0,  0.0));
  sum += lumaAt(tex, uv + texel * vec2( 1.0,  0.0));
  sum += lumaAt(tex, uv + texel * vec2(-1.0,  1.0));
  sum += lumaAt(tex, uv + texel * vec2( 0.0,  1.0));
  sum += lumaAt(tex, uv + texel * vec2( 1.0,  1.0));
  return abs(sum) * 0.125;
}

// 3x3 binomial blur (1 2 1 / 2 4 2 / 1 2 1) / 16 — the narrow lobe of the DoG.
float blur3(sampler2D tex, vec2 uv, vec2 texel) {
  float s = 4.0 * lumaAt(tex, uv);
  s += 2.0 * (lumaAt(tex, uv + texel * vec2( 1.0, 0.0)) +
              lumaAt(tex, uv + texel * vec2(-1.0, 0.0)) +
              lumaAt(tex, uv + texel * vec2(0.0,  1.0)) +
              lumaAt(tex, uv + texel * vec2(0.0, -1.0)));
  s += lumaAt(tex, uv + texel * vec2( 1.0,  1.0)) +
       lumaAt(tex, uv + texel * vec2(-1.0,  1.0)) +
       lumaAt(tex, uv + texel * vec2( 1.0, -1.0)) +
       lumaAt(tex, uv + texel * vec2(-1.0, -1.0));
  return s / 16.0;
}

// Difference of gaussians — a band-pass, and the only operator here with a
// tunable scale. `ratio` is how much wider the second lobe is; around 1.6 it
// approximates the Laplacian-of-Gaussian, and pushing it higher selects
// progressively coarser structure while ignoring fine texture. This is the one
// to reach for when the source is noisy and you want shapes, not grain.
float dog(sampler2D tex, vec2 uv, vec2 texel, float ratio) {
  return abs(blur3(tex, uv, texel) - blur3(tex, uv, texel * ratio)) * 4.0;
}

// -------------------------------------------------------------- test source

// A procedural test card, shared by both sketches so the operators are always
// compared on identical input.
//
// It is laid out y-up and stored that way, once. Both hosts here put it on
// screen upside down and so both flip y before calling in — p5 because
// aTexCoord is y-down, Hydra because of where its output lands after
// compositing. Texture orientation is a host concern, and a flip baked in
// here would only move the problem to whichever host disagrees next.
//
// Each region answers a different question:
// hard straight edges at an arbitrary angle (aliasing), a circle (curvature),
// a frequency sweep (where an operator stops resolving), a noise patch
// (texture vs. edge discrimination), and a smooth gradient (false positives —
// a good operator finds nothing here).

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i),                 hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec3 testCard(vec2 uv, float time) {
  // Smooth ground: a gentle gradient, and nothing here should light up. This
  // is the false-positive test — an operator that finds an edge in it is
  // telling you its gain is too high.
  float v = 0.30 + 0.20 * uv.y;

  // A soft vertical edge up the clear corridor between the four regions, and
  // the sharpest disagreement on the card: at the default gain of 2, Sobel is
  // the only operator that clears the threshold on it. Its 2-weighted centre
  // row is a smoothing pass that lifts a shallow ramp; Roberts lands just
  // under, and the Laplacian and DoG produce almost nothing at any gain the
  // slider offers, because the second derivative of a gentle ramp is tiny.
  // The 0.02 width is load-bearing — widen it and even Sobel goes dark, which
  // is the same lesson from the other direction.
  v += 0.42 * smoothstep(0.49, 0.51, uv.x);

  // Rotating hard-edged square, top left. Turning it is what exposes how each
  // operator handles an edge that is not axis-aligned.
  vec2 q = uv - vec2(0.28, 0.72);
  float a = time * 0.25;
  q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
  if (max(abs(q.x), abs(q.y)) < 0.11) v = 0.92;

  // Circle, top right — curvature, and a boundary with no preferred direction.
  if (length(uv - vec2(0.72, 0.72)) < 0.12) v = 0.08;

  // Frequency sweep, bottom left: bars that get finer to the right until they
  // pass under the sampling stencil and the operator stops seeing them.
  vec2 s = uv - vec2(0.10, 0.10);
  if (s.x > 0.0 && s.x < 0.34 && s.y > 0.0 && s.y < 0.26) {
    float f = 14.0 + s.x * 620.0;
    v = step(0.0, sin(s.x * f)) * 0.75 + 0.12;
  }

  // Noise patch, bottom right — grain an edge detector should mostly ignore,
  // inside a hard rectangle it certainly should not.
  vec2 n = uv - vec2(0.58, 0.10);
  if (n.x > 0.0 && n.x < 0.32 && n.y > 0.0 && n.y < 0.26) {
    v = 0.25 + 0.5 * vnoise(uv * 90.0 + time * 0.5);
  }

  return vec3(v);
}

// ------------------------------------------------------- TouchDesigner note
//
// To run an operator in a GLSL TOP, keep everything above and change only the
// host layer around it:
//
//   texture2D(...)  ->  texture(...)        TD's default profile is GLSL 3.30+
//   gl_FragColor    ->  out vec4 fragColor  declared with `layout(location=0)`
//   sampler2D tex   ->  sTD2DInputs[0]
//   uv              ->  vUV.st
//   texel           ->  1.0 / uTD2DInfos[0].res.zw
//
// Nothing in the operators themselves changes, which is the property worth
// keeping: prototype the chain on TD's node graph, then paste the kernel back
// here and it runs on the web without a rewrite.
