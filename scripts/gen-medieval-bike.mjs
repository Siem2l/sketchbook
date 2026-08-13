#!/usr/bin/env node
// Medieval bike — "the blacksmith's contraption".
//
// Renders one 3D model from 8 camera yaws (2:1 isometric, 30 degree pitch) and
// quantises each render down to a small pixel-art palette. Doing it from a model
// rather than by hand is what keeps proportions, lighting and detail identical
// across all eight facings.
//
//   node scripts/gen-medieval-bike.mjs
//
// Tuning lives in CONFIG. Raise ROLL_PHASES to emit a rolling animation
// (spokes and cranks turn); the sheet gains one row per phase.

import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

const OUT_DIR = path.join(process.cwd(), 'sprites', 'medieval-bike')

const CONFIG = {
  W: 96, // frame width
  H: 96, // frame height
  SS: 3, // supersamples per axis before quantising
  PIVOT_X: 48, // where model origin (ground, between wheels) lands in frame
  PIVOT_Y: 68,
  ROLL_PHASES: Number(process.env.ROLL_PHASES) || 4, // wheel-roll frames per 45deg of wheel
  COVERAGE: 4 / 9, // subsamples needed before an output pixel is opaque
  BANDS: [0.3, 0.52, 0.74], // luminance cuts between the 4 shades of a ramp
}

const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

// ---------------------------------------------------------------- palette --

// Four shades per material, darkest first. Index into PALETTE is mat * 4 + shade.
const RAMPS = {
  iron: ['#23262e', '#3d434f', '#5a6270', '#838c9b'],
  darkiron: ['#15171d', '#242932', '#363c46', '#4a515c'],
  brass: ['#4a3413', '#8a6a24', '#c49230', '#ecc463'],
  leather: ['#2b190f', '#4d2c19', '#70452a', '#96603c'],
  wood: ['#33210f', '#55381d', '#7a5230', '#a0714a'],
  glass: ['#b0651a', '#e8a52c', '#ffd36b', '#fff3c4'],
}
const MATERIALS = Object.keys(RAMPS)
const MAT = Object.fromEntries(MATERIALS.map((name, i) => [name, i]))
const OUTLINE = '#10121a'

const PALETTE = MATERIALS.flatMap((name) => RAMPS[name].map(hexToRgb))
const OUTLINE_INDEX = PALETTE.push(hexToRgb(OUTLINE)) - 1
const EMISSIVE = MAT.glass

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// ------------------------------------------------------------------ model --

// Model space: +x is forward (the nose), +z is up, y is the lateral axis.
// One unit is one output pixel. Origin sits on the ground between the wheels.
const WHEEL_R = 15
const HUB_Z = WHEEL_R // hubs sit one radius above the ground plane
const REAR = [-22, 0, HUB_Z]
const FRONT = [22, 0, HUB_Z]
const BB = [-5, 0, 10] // bottom bracket
const HEAD_LO = [16, 0, 20]
const HEAD_HI = [20, 0, 30]
const SEAT = [-17, 0, 32]
const BAR = [21, 0, 33]
const LANTERN = [29, 0, 25]

const sphere = (m, x, y, z, r) => ({ t: 0, m, a: [x, y, z, r] })
const capsule = (m, a, b, r) => ({ t: 1, m, a: [...a, ...b, r] })
const torus = (m, c, R, r) => ({ t: 2, m, a: [...c, R, r] })
const cylY = (m, c, r, h) => ({ t: 3, m, a: [...c, r, h] })
const cylZ = (m, c, r, h) => ({ t: 4, m, a: [...c, r, h] })

// Oriented box between two points; thin axis is world y (all beams here lie in
// the xz plane, so a fixed lateral basis is enough).
function beam(m, a, b, halfW, halfH, shrink = 0) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const len = Math.hypot(...d)
  const u = d.map((v) => v / len)
  const v = [u[2], 0, -u[0]] // cross(u, (0,1,0)) for u in the xz plane
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  return { t: 5, m, a: [...mid, ...u, ...v, len / 2 - shrink, halfW, halfH], u, v, mid }
}

function wheel(cx, spokeAngle) {
  const c = [cx, 0, HUB_Z]
  // Outer band tops out at exactly WHEEL_R so the tyre meets the ground plane.
  const prims = [
    torus(MAT.iron, c, WHEEL_R - 1.1, 1.1), // iron tyre band
    torus(MAT.wood, c, 11.9, 1.5), // wooden rim
    cylY(MAT.iron, c, 2.8, 1.8), // hub
  ]
  for (let i = 0; i < 8; i++) {
    const a = spokeAngle + (i * Math.PI * 2) / 8
    prims.push(
      capsule(
        MAT.iron,
        [cx + Math.cos(a) * 2.2, 0, HUB_Z + Math.sin(a) * 2.2],
        [cx + Math.cos(a) * 11.2, 0, HUB_Z + Math.sin(a) * 11.2],
        0.9,
      ),
    )
  }
  return { cx, cy: 0, cz: HUB_Z, r: WHEEL_R + 1, prims }
}

function buildScene(phase) {
  const spokeAngle = (phase * Math.PI * 2) / 8 // 8 spokes: the wheel repeats every 45deg
  // The crank is parked, and that is a decision rather than an oversight. A
  // seamless loop needs every moving part back where it started at the end of
  // it. The spokes get there after 45 degrees of wheel; the crank only after
  // 360, and at this gearing that is two full wheel revolutions — 32-odd phases
  // instead of 4, for a part four pixels across. Turning it at the spoke rate
  // instead would spin it at some 300 rpm against the road speed, which reads
  // as broken rather than as fast. With no rider's legs on it, a still crank
  // reads as nothing at all.
  const crankAngle = 0

  const frame = [
    beam(MAT.iron, BB, HEAD_LO, 1.7, 1.7), // down tube
    beam(MAT.iron, SEAT, HEAD_HI, 1.5, 1.5), // top tube
    beam(MAT.iron, BB, SEAT, 1.6, 1.6), // seat tube
    beam(MAT.iron, HEAD_LO, HEAD_HI, 2.2, 2.2), // head tube
    capsule(MAT.iron, HEAD_HI, BAR, 1.5), // stem
  ]
  for (const side of [-1, 1]) {
    const y = 2.6 * side
    frame.push(capsule(MAT.iron, [BB[0], y, BB[2]], [REAR[0], y, REAR[2]], 1.2)) // chain stay
    frame.push(capsule(MAT.iron, [SEAT[0], y, SEAT[2]], [REAR[0], y, REAR[2]], 1.15)) // seat stay
    frame.push(capsule(MAT.iron, [HEAD_LO[0], y * 1.1, HEAD_LO[2] + 1], [FRONT[0], y * 1.1, FRONT[2]], 1.4)) // fork
  }

  // Riveted gusset plate down the front of the down tube.
  const plate = beam(MAT.iron, BB, HEAD_LO, 0.6, 3.1, 3.4)
  frame.push(plate)
  for (let i = -1; i <= 1; i++) {
    for (const side of [-1, 1]) {
      const t = i * 5.2
      frame.push(
        sphere(
          MAT.brass,
          plate.mid[0] + plate.u[0] * t,
          plate.mid[1] + 0.75 * side,
          plate.mid[2] + plate.u[2] * t,
          0.85,
        ),
      )
    }
  }

  const cockpit = [
    capsule(MAT.iron, [BAR[0], -10.5, BAR[2]], [BAR[0], 10.5, BAR[2]], 1.3), // handlebar
    capsule(MAT.leather, [BAR[0], 6.4, BAR[2]], [BAR[0], 10.6, BAR[2]], 1.9), // grips
    capsule(MAT.leather, [BAR[0], -6.4, BAR[2]], [BAR[0], -10.6, BAR[2]], 1.9),
  ]

  const chainringZ = BB[2]
  const drive = [
    torus(MAT.brass, [BB[0], 3.6, chainringZ], 6.2, 0.75), // chainring
    cylY(MAT.brass, [BB[0], 3.6, chainringZ], 1.9, 0.6), // chainring hub
    cylY(MAT.brass, REAR, 3.4, 0.5), // rear cog
    capsule(MAT.darkiron, [BB[0], 3.4, chainringZ + 6.2], [REAR[0], 3.4, REAR[2] + 3.4], 0.6), // chain
    capsule(MAT.darkiron, [BB[0], 3.4, chainringZ - 6.2], [REAR[0], 3.4, REAR[2] - 3.4], 0.6),
  ]
  for (const side of [-1, 1]) {
    const a = crankAngle + (side < 0 ? Math.PI : 0)
    const y = 4.4 * side
    const tip = [BB[0] + Math.cos(a) * 6.4, y, BB[2] + Math.sin(a) * 6.4]
    drive.push(capsule(MAT.iron, [BB[0], y, BB[2]], tip, 1.0)) // crank arm
    drive.push(capsule(MAT.wood, [tip[0], y - 1.6 * side, tip[2]], [tip[0], y + 1.8 * side, tip[2]], 1.3)) // pedal
  }

  // Caged lantern hung off a bracket in front of the head tube. Kept clear of the
  // handlebar so the glow stays a readable blob from every facing.
  const lantern = [
    capsule(MAT.iron, [HEAD_HI[0] - 1, 0, HEAD_HI[2] - 1], [LANTERN[0], 0, LANTERN[2] + 4.6], 1.0), // bracket
    sphere(EMISSIVE, ...LANTERN, 3.3),
    cylZ(MAT.iron, [LANTERN[0], LANTERN[1], LANTERN[2] + 3.6], 3.7, 0.8), // cap
    cylZ(MAT.iron, [LANTERN[0], LANTERN[1], LANTERN[2] - 3.6], 3.4, 0.7), // base
  ]
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 + 0.6
    const x = LANTERN[0] + Math.cos(a) * 3.2
    const y = LANTERN[1] + Math.sin(a) * 3.2
    lantern.push(capsule(MAT.iron, [x, y, LANTERN[2] - 3.6], [x, y, LANTERN[2] + 3.6], 0.6)) // cage bar
  }

  const saddle = [
    { t: 6, m: MAT.leather, a: [SEAT[0] - 0.8, 0, SEAT[2] + 1.9, 5.0, 2.6, 0.9, 0.8] },
    capsule(MAT.leather, [SEAT[0] + 3.6, 0, SEAT[2] + 1.8], [SEAT[0] + 6.8, 0, SEAT[2] + 1.3], 1.1), // nose
    // Strapped satchel behind the saddle: gives the rear a mass the front lacks,
    // so facing stays readable in silhouette.
    { t: 6, m: MAT.leather, a: [SEAT[0] - 6.8, 0, SEAT[2] + 0.6, 2.1, 2.9, 2.2, 0.9] },
    sphere(MAT.brass, SEAT[0] - 8.8, 0, SEAT[2] + 0.4, 0.95), // buckle
  ]

  return [
    wheel(REAR[0], spokeAngle),
    wheel(FRONT[0], spokeAngle),
    { cx: 2, cy: 0, cz: 22, r: 26, prims: frame },
    { cx: BAR[0], cy: 0, cz: BAR[2], r: 13, prims: cockpit },
    { cx: -13, cy: 3, cz: 13, r: 15, prims: drive },
    { cx: LANTERN[0], cy: 0, cz: LANTERN[2], r: 13, prims: lantern },
    { cx: SEAT[0] - 3, cy: 0, cz: SEAT[2] + 1.8, r: 13, prims: saddle },
  ]
}

// ------------------------------------------------------------------- sdfs --

let HIT_MAT = 0

function primDist(pr, px, py, pz) {
  const a = pr.a
  switch (pr.t) {
    case 0: {
      const dx = px - a[0], dy = py - a[1], dz = pz - a[2]
      return Math.sqrt(dx * dx + dy * dy + dz * dz) - a[3]
    }
    case 1: {
      const bax = a[3] - a[0], bay = a[4] - a[1], baz = a[5] - a[2]
      const pax = px - a[0], pay = py - a[1], paz = pz - a[2]
      let h = (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)
      h = h < 0 ? 0 : h > 1 ? 1 : h
      const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h
      return Math.sqrt(dx * dx + dy * dy + dz * dz) - a[6]
    }
    case 2: {
      const dx = px - a[0], dy = py - a[1], dz = pz - a[2]
      const q = Math.sqrt(dx * dx + dz * dz) - a[3]
      return Math.sqrt(q * q + dy * dy) - a[4]
    }
    case 3: {
      const dx = px - a[0], dz = pz - a[2]
      const dr = Math.sqrt(dx * dx + dz * dz) - a[3]
      const dy = Math.abs(py - a[1]) - a[4]
      const ox = dr > 0 ? dr : 0, oy = dy > 0 ? dy : 0
      return Math.min(Math.max(dr, dy), 0) + Math.sqrt(ox * ox + oy * oy)
    }
    case 4: {
      const dx = px - a[0], dy = py - a[1]
      const dr = Math.sqrt(dx * dx + dy * dy) - a[3]
      const dz = Math.abs(pz - a[2]) - a[4]
      const ox = dr > 0 ? dr : 0, oz = dz > 0 ? dz : 0
      return Math.min(Math.max(dr, dz), 0) + Math.sqrt(ox * ox + oz * oz)
    }
    case 5: {
      const rx = px - a[0], ry = py - a[1], rz = pz - a[2]
      const qu = Math.abs(rx * a[3] + ry * a[4] + rz * a[5]) - a[9]
      const qw = Math.abs(ry) - a[10]
      const qv = Math.abs(rx * a[6] + ry * a[7] + rz * a[8]) - a[11]
      const ox = qu > 0 ? qu : 0, oy = qw > 0 ? qw : 0, oz = qv > 0 ? qv : 0
      return Math.min(Math.max(qu, Math.max(qw, qv)), 0) + Math.sqrt(ox * ox + oy * oy + oz * oz)
    }
    case 6: {
      const qx = Math.abs(px - a[0]) - a[3] + a[6]
      const qy = Math.abs(py - a[1]) - a[4] + a[6]
      const qz = Math.abs(pz - a[2]) - a[5] + a[6]
      const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0
      return Math.min(Math.max(qx, Math.max(qy, qz)), 0) + Math.sqrt(ox * ox + oy * oy + oz * oz) - a[6]
    }
  }
  return 1e9
}

// Cluster bounding spheres are a conservative lower bound, so skipping a cluster
// whose bound already loses to the running best is safe for sphere tracing.
function sceneDist(clusters, px, py, pz) {
  let best = 1e9
  let mat = 0
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]
    const dx = px - c.cx, dy = py - c.cy, dz = pz - c.cz
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) - c.r >= best) continue
    const prims = c.prims
    for (let j = 0; j < prims.length; j++) {
      const d = primDist(prims[j], px, py, pz)
      if (d < best) {
        best = d
        mat = prims[j].m
      }
    }
  }
  HIT_MAT = mat
  return best
}

function normalAt(clusters, x, y, z) {
  const e = 0.12
  const a = sceneDist(clusters, x + e, y - e, z - e)
  const b = sceneDist(clusters, x - e, y - e, z + e)
  const c = sceneDist(clusters, x - e, y + e, z - e)
  const d = sceneDist(clusters, x + e, y + e, z + e)
  const nx = a - b - c + d
  const ny = -a - b + c + d
  const nz = -a + b - c + d
  const len = Math.hypot(nx, ny, nz) || 1
  return [nx / len, ny / len, nz / len]
}

function ambientOcclusion(clusters, p, n) {
  let occ = 0
  let scale = 1
  for (let i = 1; i <= 4; i++) {
    const h = 0.5 + 1.7 * i
    const d = sceneDist(clusters, p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h)
    occ += (h - d) * scale
    scale *= 0.72
  }
  const ao = 1 - 0.09 * occ
  return ao < 0 ? 0 : ao > 1 ? 1 : ao
}

// ---------------------------------------------------------------- camera ---

const SIN_PITCH = 0.5 // 2:1 isometric
const COS_PITCH = Math.sqrt(1 - SIN_PITCH * SIN_PITCH)
const DIST = 200

function camera(yaw) {
  const forward = [COS_PITCH * Math.cos(yaw), COS_PITCH * Math.sin(yaw), -SIN_PITCH]
  const right = [-Math.sin(yaw), Math.cos(yaw), 0]
  const up = [SIN_PITCH * Math.cos(yaw), SIN_PITCH * Math.sin(yaw), COS_PITCH]
  // Light is fixed in camera space, so it stays put on screen as the model turns.
  const lc = [-0.52, 0.72, 0.46]
  const light = [
    right[0] * lc[0] + up[0] * lc[1] - forward[0] * lc[2],
    right[1] * lc[0] + up[1] * lc[1] - forward[1] * lc[2],
    right[2] * lc[0] + up[2] * lc[1] - forward[2] * lc[2],
  ]
  const len = Math.hypot(...light)
  return { forward, right, up, light: light.map((v) => v / len) }
}

function boundsOf(clusters) {
  const lo = [1e9, 1e9, 1e9]
  const hi = [-1e9, -1e9, -1e9]
  for (const c of clusters) {
    const center = [c.cx, c.cy, c.cz]
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], center[i] - c.r)
      hi[i] = Math.max(hi[i], center[i] + c.r)
    }
  }
  return { lo, hi }
}

function slab(origin, dir, lo, hi) {
  let tmin = -1e9
  let tmax = 1e9
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-9) {
      if (origin[i] < lo[i] || origin[i] > hi[i]) return null
      continue
    }
    const inv = 1 / dir[i]
    let t0 = (lo[i] - origin[i]) * inv
    let t1 = (hi[i] - origin[i]) * inv
    if (t0 > t1) [t0, t1] = [t1, t0]
    tmin = Math.max(tmin, t0)
    tmax = Math.min(tmax, t1)
    if (tmin > tmax) return null
  }
  return [tmin, tmax]
}

// ---------------------------------------------------------------- render ---

function shadeIndex(mat, lum) {
  if (mat === EMISSIVE) return mat * 4 + (lum > 0.45 ? 3 : 2)
  const [a, b, c] = CONFIG.BANDS
  const shade = lum < a ? 0 : lum < b ? 1 : lum < c ? 2 : 3
  return mat * 4 + shade
}

function renderFrame(clusters, yaw) {
  const { W, H, SS, PIVOT_X, PIVOT_Y } = CONFIG
  const cam = camera(yaw)
  const { lo, hi } = boundsOf(clusters)
  const sw = W * SS
  const sh = H * SS
  const samples = new Int16Array(sw * sh).fill(-1)

  for (let sy = 0; sy < sh; sy++) {
    const v = PIVOT_Y - (sy + 0.5) / SS
    for (let sx = 0; sx < sw; sx++) {
      const u = (sx + 0.5) / SS - PIVOT_X
      const ox = cam.right[0] * u + cam.up[0] * v - cam.forward[0] * DIST
      const oy = cam.right[1] * u + cam.up[1] * v - cam.forward[1] * DIST
      const oz = cam.right[2] * u + cam.up[2] * v - cam.forward[2] * DIST
      const span = slab([ox, oy, oz], cam.forward, lo, hi)
      if (!span) continue

      let t = Math.max(span[0], 0)
      const tmax = span[1]
      let hit = false
      for (let step = 0; step < 96 && t < tmax; step++) {
        const px = ox + cam.forward[0] * t
        const py = oy + cam.forward[1] * t
        const pz = oz + cam.forward[2] * t
        const d = sceneDist(clusters, px, py, pz)
        if (d < 0.08) {
          const mat = HIT_MAT
          const n = normalAt(clusters, px, py, pz)
          const ao = ambientOcclusion(clusters, [px, py, pz], n)
          const diff = Math.max(0, n[0] * cam.light[0] + n[1] * cam.light[1] + n[2] * cam.light[2])
          const lum = 0.82 * (0.08 + 0.92 * diff) + 0.18 * ao
          samples[sy * sw + sx] = shadeIndex(mat, lum)
          break
        }
        t += Math.max(d, 0.05)
      }
    }
  }
  return samples
}

// Mode-filter the supersamples: keeps colours crisp where averaging would smear
// the ramp into off-palette mud.
function quantise(samples) {
  const { W, H, SS, COVERAGE } = CONFIG
  const sw = W * SS
  const out = new Int16Array(W * H).fill(-1)
  const counts = new Map()
  const needed = Math.ceil(COVERAGE * SS * SS)

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      counts.clear()
      let hits = 0
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const s = samples[(y * SS + j) * sw + (x * SS + i)]
          if (s < 0) continue
          hits++
          counts.set(s, (counts.get(s) || 0) + 1)
        }
      }
      if (hits < needed) continue
      let bestIdx = -1
      let bestCount = 0
      for (const [idx, count] of counts) {
        // Ties break toward the brighter shade so highlights survive downsampling.
        if (count > bestCount || (count === bestCount && idx > bestIdx)) {
          bestIdx = idx
          bestCount = count
        }
      }
      out[y * W + x] = bestIdx
    }
  }
  return out
}

function outline(indices) {
  const { W, H } = CONFIG
  const out = Int16Array.from(indices)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (indices[y * W + x] >= 0) continue
      const near =
        (x > 0 && indices[y * W + x - 1] >= 0) ||
        (x < W - 1 && indices[y * W + x + 1] >= 0) ||
        (y > 0 && indices[(y - 1) * W + x] >= 0) ||
        (y < H - 1 && indices[(y + 1) * W + x] >= 0)
      if (near) out[y * W + x] = OUTLINE_INDEX
    }
  }
  return out
}

function toRgba(indices) {
  const { W, H } = CONFIG
  const buf = Buffer.alloc(W * H * 4)
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i]
    if (idx < 0) continue
    const [r, g, b] = PALETTE[idx]
    buf[i * 4] = r
    buf[i * 4 + 1] = g
    buf[i * 4 + 2] = b
    buf[i * 4 + 3] = 255
  }
  return buf
}

// Ground-plane blob under the wheels, unprojected per facing so it squashes and
// swings correctly with the camera.
function renderShadow(yaw) {
  const { W, H, PIVOT_X, PIVOT_Y } = CONFIG
  const cam = camera(yaw)
  const buf = Buffer.alloc(W * H * 4)
  for (let y = 0; y < H; y++) {
    const v = PIVOT_Y - (y + 0.5)
    const k = -(cam.up[2] * v) / cam.forward[2]
    for (let x = 0; x < W; x++) {
      const u = x + 0.5 - PIVOT_X
      const wx = cam.right[0] * u + cam.up[0] * v + cam.forward[0] * k
      const wy = cam.right[1] * u + cam.up[1] * v + cam.forward[1] * k
      const h = Math.min(Math.max((wx + 22) / 44, 0), 1)
      const d = Math.hypot(wx - (-22 + 44 * h), wy)
      const alpha = d < 5.5 ? 110 : d < 8.5 ? 55 : 0
      if (!alpha) continue
      const i = (y * W + x) * 4
      buf[i] = 12
      buf[i + 1] = 14
      buf[i + 2] = 22
      buf[i + 3] = alpha
    }
  }
  return buf
}

// ------------------------------------------------------------------- png ----

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour + alpha
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function blit(dest, destW, src, srcW, srcH, x0, y0) {
  for (let y = 0; y < srcH; y++) {
    src.copy(dest, ((y0 + y) * destW + x0) * 4, y * srcW * 4, (y + 1) * srcW * 4)
  }
}

// ------------------------------------------------------------------- main ---

const { W, H, ROLL_PHASES } = CONFIG
fs.mkdirSync(OUT_DIR, { recursive: true })

const sheet = Buffer.alloc(W * 8 * H * ROLL_PHASES * 4)
const shadowSheet = Buffer.alloc(W * 8 * H * 4)
const started = Date.now()

for (let phase = 0; phase < ROLL_PHASES; phase++) {
  const clusters = buildScene(phase / ROLL_PHASES)
  for (let d = 0; d < 8; d++) {
    const yaw = (-d * Math.PI * 2) / 8 // clockwise: N, NE, E, SE, S, SW, W, NW
    const rgba = toRgba(outline(quantise(renderFrame(clusters, yaw))))
    blit(sheet, W * 8, rgba, W, H, d * W, phase * H)
    if (phase === 0) {
      fs.writeFileSync(path.join(OUT_DIR, `bike_iso_${DIRECTIONS[d]}.png`), encodePng(W, H, rgba))
      blit(shadowSheet, W * 8, renderShadow(yaw), W, H, d * W, 0)
    }
    process.stdout.write(`\r  rendered ${phase * 8 + d + 1}/${8 * ROLL_PHASES} frames`)
  }
}

fs.writeFileSync(path.join(OUT_DIR, 'bike_iso_8dir.png'), encodePng(W * 8, H * ROLL_PHASES, sheet))
fs.writeFileSync(path.join(OUT_DIR, 'bike_iso_8dir_shadow.png'), encodePng(W * 8, H, shadowSheet))
fs.writeFileSync(
  path.join(OUT_DIR, 'palette.json'),
  JSON.stringify(
    {
      name: 'medieval-bike / blacksmith-contraption',
      frame: { width: W, height: H, pivot: { x: CONFIG.PIVOT_X, y: CONFIG.PIVOT_Y } },
      projection: { type: '2:1 isometric', pitchDegrees: 30, yawStepDegrees: 45 },
      sheet: { columns: 8, rows: ROLL_PHASES, order: DIRECTIONS },
      // One roll cycle is 45 degrees of wheel, so a rider covers an eighth of
      // the circumference per cycle. Anything animating this sheet should step
      // the row from distance travelled, not from a timer, or the wheels skate.
      roll: { phases: ROLL_PHASES, wheelRadius: WHEEL_R, travelPerCycle: (2 * Math.PI * WHEEL_R) / 8 },
      outline: OUTLINE,
      ramps: RAMPS,
    },
    null,
    2,
  ) + '\n',
)

process.stdout.write(`\r  rendered ${8 * ROLL_PHASES} frames in ${((Date.now() - started) / 1000).toFixed(1)}s\n`)
console.log(`  wrote ${path.relative(process.cwd(), OUT_DIR)}/`)
