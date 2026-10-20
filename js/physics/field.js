// Forced-response displacement field of the plate at a given drive frequency.
//
// u(x, y) = sum_i w_i * phi_i(x, y)  over the few modes closest to resonance,
// with w_i the (signed) steady-state response of a damped oscillator.
// Domain coordinates: x, y in [-1, 1]; node (i, j) <-> x = -1 + 2i/(G-1), y = -1 + 2j/(G-1);
// arrays are row-major: data[j*G + i].

import { getModes } from './modes.js';

export const FREQ_MIN = 20;
export const FREQ_MAX = 5000;

const TOP_MODES = 6; // K: modes kept in the superposition
const DROP_RATIO = 0.02; // drop modes weaker than this fraction of the strongest
const MIN_ZETA = 1e-6; // keeps the response finite at exact resonance
const BASIS_CACHE_CAP = 64; // per-mode G*G basis grids kept in memory
const GRID_EPS = 1e-6; // tolerance (in grid cells) for points on the plate edge
const CIRCLE_EPS = 1e-9;

/**
 * @typedef {Object} Field
 * @property {'square'|'circle'} shape
 * @property {number} G                 grid size (G x G nodes)
 * @property {number} frequency         drive frequency, Hz
 * @property {number} damping           damping ratio zeta
 * @property {Float32Array} data        signed displacement u, max |u| = 1 inside the domain
 * @property {Uint8Array} mask          1 inside the domain (shared between fields; read-only)
 * @property {Float32Array} absGradX    d|u|/dx in domain units (0 outside the domain)
 * @property {Float32Array} absGradY    d|u|/dy in domain units (0 outside the domain)
 * @property {number} resonance         0..1, how close to a resonance peak
 * @property {{mode: import('./modes.js').Mode, weight: number}[]} topModes sorted by |weight| desc
 * @property {(x: number, y: number) => number} sample
 * @property {(x: number, y: number, out: ArrayLike<number>) => ArrayLike<number>} sampleAbsGrad
 */

/**
 * Signed amplitude response of a mode with natural frequency fi driven at f.
 * Positive below resonance (in phase), negative above (anti-phase).
 * @param {number} f drive frequency
 * @param {number} fi mode frequency
 * @param {number} zeta damping ratio
 * @returns {number}
 */
export function modeWeight(f, fi, zeta) {
  const r = f / fi;
  const d = 1 - r * r;
  const mag = 1 / Math.max(Math.sqrt(d * d + 4 * zeta * zeta * r * r), 1e-12);
  return d >= 0 ? mag : -mag; // sgn(0) = +1
}

/**
 * Displacement field of the plate driven at frequency f.
 * @param {'square'|'circle'} shape
 * @param {number} f drive frequency, Hz
 * @param {number} zeta damping ratio (e.g. 0.001 sharp .. 0.1 broad)
 * @param {number} [G=192] grid size
 * @returns {Field}
 */
export function computeField(shape, f, zeta, G = 192) {
  const modes = getModes(shape);
  const geo = getGeometry(shape, G);
  const N = G * G;
  const z = Math.max(zeta, MIN_ZETA);

  // 1. weights -> top K modes by |w| (insertion into small sorted arrays)
  const topIdx = scratchIdx;
  const topAbs = scratchAbs;
  const topW = scratchW;
  let count = 0;
  for (let i = 0; i < modes.length; i++) {
    const w = modeWeight(f, modes[i].freq, z);
    const aw = w < 0 ? -w : w;
    if (count === TOP_MODES && aw <= topAbs[count - 1]) continue;
    let pos = count < TOP_MODES ? count++ : TOP_MODES - 1;
    while (pos > 0 && topAbs[pos - 1] < aw) {
      topIdx[pos] = topIdx[pos - 1];
      topAbs[pos] = topAbs[pos - 1];
      topW[pos] = topW[pos - 1];
      pos--;
    }
    topIdx[pos] = i;
    topAbs[pos] = aw;
    topW[pos] = w;
  }
  const maxAbsW = topAbs[0];
  let kept = 0;
  while (kept < count && topAbs[kept] >= DROP_RATIO * maxAbsW) kept++;

  // 2. u = sum w_i * phi_i  (weights pre-divided by the largest one)
  const data = new Float32Array(N);
  const topModes = new Array(kept);
  const inv0 = 1 / maxAbsW;
  for (let t = 0; t < kept; t++) {
    const mode = modes[topIdx[t]];
    topModes[t] = { mode, weight: topW[t] };
    const basis = getBasis(mode, geo);
    const w = topW[t] * inv0;
    if (t === 0) for (let p = 0; p < N; p++) data[p] = w * basis[p];
    else for (let p = 0; p < N; p++) data[p] += w * basis[p];
  }

  // 3. normalise so that max |u| = 1 (basis grids are 0 outside the domain)
  let maxU = 0;
  for (let p = 0; p < N; p++) {
    const a = data[p] < 0 ? -data[p] : data[p];
    if (a > maxU) maxU = a;
  }
  if (maxU > 1e-30) {
    const s = 1 / maxU;
    for (let p = 0; p < N; p++) data[p] *= s;
  }

  // 4. resonance indicator: peak response at exact resonance is 1/(2 zeta)
  const resonance = Math.min(1, Math.max(0, maxAbsW * 2 * z));

  // 5. gradient of |u|
  const absGradX = new Float32Array(N);
  const absGradY = new Float32Array(N);
  computeAbsGradient(data, geo.mask, G, geo.circle, absGradX, absGradY);

  const { sample, sampleAbsGrad } = makeSamplers(data, absGradX, absGradY, geo);

  return {
    shape,
    G,
    frequency: f,
    damping: zeta,
    data,
    mask: geo.mask,
    absGradX,
    absGradY,
    resonance,
    topModes,
    sample,
    sampleAbsGrad,
  };
}

/**
 * Neighbouring resonances around frequency f.
 * @param {'square'|'circle'} shape
 * @param {number} f Hz
 * @returns {{prev: import('./modes.js').Mode|null, next: import('./modes.js').Mode|null, nearest: import('./modes.js').Mode}}
 */
export function findResonances(shape, f) {
  const modes = getModes(shape);
  const lo = f * (1 - 1e-6);
  const hi = f * (1 + 1e-6);
  let prev = null;
  let next = null;
  let nearest = modes[0];
  let bestDist = Infinity;
  for (let i = 0; i < modes.length; i++) {
    const m = modes[i];
    if (m.freq < lo) prev = m; // ascending order: keeps the highest one below f
    else if (m.freq > hi && next === null) next = m;
    const dist = Math.abs(Math.log(m.freq / f));
    if (dist < bestDist) {
      bestDist = dist;
      nearest = m;
    }
  }
  return { prev, next, nearest };
}

// ------------------------------------------------------------ internals

const scratchIdx = new Int32Array(TOP_MODES);
const scratchAbs = new Float64Array(TOP_MODES);
const scratchW = new Float64Array(TOP_MODES);

// ---- per-(shape, G) geometry: mask, polar grids, cosine tables

const geometryCache = new Map();

function getGeometry(shape, G) {
  const key = `${shape}@${G}`;
  let geo = geometryCache.get(key);
  if (geo) return geo;
  const N = G * G;
  const mask = new Uint8Array(N);
  if (shape === 'square') {
    mask.fill(1);
    geo = { shape, G, circle: false, mask, cosRows: [] };
  } else if (shape === 'circle') {
    const r = new Float64Array(N);
    const theta = new Float64Array(N);
    for (let j = 0; j < G; j++) {
      const y = -1 + (2 * j) / (G - 1);
      for (let i = 0; i < G; i++) {
        const x = -1 + (2 * i) / (G - 1);
        const p = j * G + i;
        const r2 = x * x + y * y;
        r[p] = Math.sqrt(r2);
        theta[p] = Math.atan2(y, x);
        mask[p] = r2 <= 1 + CIRCLE_EPS ? 1 : 0;
      }
    }
    // full[p] = 1 when all four corners of cell p (nodes p, p+1, p+G, p+G+1) are inside
    const full = new Uint8Array(N);
    for (let j = 0; j < G - 1; j++) {
      for (let i = 0; i < G - 1; i++) {
        const p = j * G + i;
        full[p] = mask[p] & mask[p + 1] & mask[p + G] & mask[p + G + 1];
      }
    }
    geo = { shape, G, circle: true, mask, full, r, theta, cosN: [] };
  } else {
    throw new Error(`Unknown plate shape: ${shape}`);
  }
  geometryCache.set(key, geo);
  return geo;
}

/** cos(k*pi*X) at the G node positions X = i/(G-1). */
function squareCosRow(geo, k) {
  let row = geo.cosRows[k];
  if (!row) {
    const G = geo.G;
    row = new Float64Array(G);
    for (let i = 0; i < G; i++) row[i] = Math.cos((k * Math.PI * i) / (G - 1));
    geo.cosRows[k] = row;
  }
  return row;
}

/** cos(n*theta) on the grid (circle only). */
function circleAngular(geo, n) {
  let grid = geo.cosN[n];
  if (!grid) {
    const theta = geo.theta;
    grid = new Float64Array(theta.length);
    for (let p = 0; p < theta.length; p++) grid[p] = Math.cos(n * theta[p]);
    geo.cosN[n] = grid;
  }
  return grid;
}

// ---- per-mode basis grids (normalised mode values on the G x G grid)

const basisCache = new Map(); // insertion order = age; evict the oldest

function getBasis(mode, geo) {
  const key = `${mode.id}@${geo.G}`;
  let basis = basisCache.get(key);
  if (basis) return basis;
  basis = geo.circle ? buildCircleBasis(mode, geo) : buildSquareBasis(mode, geo);
  if (basisCache.size >= BASIS_CACHE_CAP) {
    basisCache.delete(basisCache.keys().next().value);
  }
  basisCache.set(key, basis);
  return basis;
}

function buildSquareBasis(mode, geo) {
  const G = geo.G;
  const { m, n, s } = mode.params;
  const cm = squareCosRow(geo, m);
  const cn = squareCosRow(geo, n);
  const invNorm = 1 / mode.norm;
  const out = new Float32Array(G * G);
  for (let j = 0; j < G; j++) {
    const cnj = cn[j];
    const cmj = cm[j];
    const row = j * G;
    for (let i = 0; i < G; i++) {
      out[row + i] = (cm[i] * cnj + s * cn[i] * cmj) * invNorm;
    }
  }
  return out;
}

function buildCircleBasis(mode, geo) {
  const { n, table } = mode.params;
  const last = table.length - 1;
  const { r, mask } = geo;
  const ang = circleAngular(geo, n);
  const invNorm = 1 / mode.norm;
  const out = new Float32Array(r.length);
  for (let p = 0; p < r.length; p++) {
    if (mask[p] === 0) continue;
    const t = Math.min(r[p], 1) * last;
    let i0 = t | 0;
    if (i0 > last - 1) i0 = last - 1;
    const radial = table[i0] + (table[i0 + 1] - table[i0]) * (t - i0);
    out[p] = radial * ang[p] * invNorm;
  }
  return out;
}

// ---- gradient of |u|

/**
 * Central differences of |u| in domain units (node spacing h = 2/(G-1)).
 * One-sided at the grid edge and at the circle rim, where the neighbour
 * outside the plate would otherwise fake a huge slope.
 */
function computeAbsGradient(data, mask, G, circle, gx, gy) {
  const inv2h = (G - 1) / 4;
  const invh = (G - 1) / 2;
  for (let j = 0; j < G; j++) {
    const row = j * G;
    for (let i = 0; i < G; i++) {
      const p = row + i;
      if (circle && mask[p] === 0) continue;
      const c = data[p] < 0 ? -data[p] : data[p];

      // x direction
      let hasL = i > 0;
      let hasR = i < G - 1;
      if (circle) {
        hasL = hasL && mask[p - 1] === 1;
        hasR = hasR && mask[p + 1] === 1;
      }
      if (hasL && hasR) {
        const l = data[p - 1];
        const r = data[p + 1];
        gx[p] = ((r < 0 ? -r : r) - (l < 0 ? -l : l)) * inv2h;
      } else if (hasR) {
        const r = data[p + 1];
        gx[p] = ((r < 0 ? -r : r) - c) * invh;
      } else if (hasL) {
        const l = data[p - 1];
        gx[p] = (c - (l < 0 ? -l : l)) * invh;
      }

      // y direction
      let hasD = j > 0;
      let hasU = j < G - 1;
      if (circle) {
        hasD = hasD && mask[p - G] === 1;
        hasU = hasU && mask[p + G] === 1;
      }
      if (hasD && hasU) {
        const d = data[p - G];
        const u = data[p + G];
        gy[p] = ((u < 0 ? -u : u) - (d < 0 ? -d : d)) * inv2h;
      } else if (hasU) {
        const u = data[p + G];
        gy[p] = ((u < 0 ? -u : u) - c) * invh;
      } else if (hasD) {
        const d = data[p - G];
        gy[p] = (c - (d < 0 ? -d : d)) * invh;
      }
    }
  }
}

// ---- bilinear samplers (allocation-free)
//
// One factory per shape so each closure's code stays monomorphic. Outside the
// plate the result is 0. In a circle's rim cells, corner nodes outside the plate
// are left out and the remaining weights renormalised, so the rim is not damped.

function makeSamplers(data, gx, gy, geo) {
  return geo.circle
    ? makeCircleSamplers(data, gx, gy, geo.mask, geo.full, geo.G)
    : makeSquareSamplers(data, gx, gy, geo.G);
}

function makeSquareSamplers(data, gx, gy, G) {
  const G1 = G - 1;
  const half = G1 / 2;

  function sample(x, y) {
    let cx = (x + 1) * half;
    let cy = (y + 1) * half;
    if (!(cx >= -GRID_EPS && cx <= G1 + GRID_EPS && cy >= -GRID_EPS && cy <= G1 + GRID_EPS)) return 0;
    if (cx < 0) cx = 0; else if (cx > G1) cx = G1;
    if (cy < 0) cy = 0; else if (cy > G1) cy = G1;
    let i0 = cx | 0;
    let j0 = cy | 0;
    if (i0 > G - 2) i0 = G - 2;
    if (j0 > G - 2) j0 = G - 2;
    const fx = cx - i0;
    const fy = cy - j0;
    const p = j0 * G + i0;
    const a = data[p];
    const top = a + (data[p + 1] - a) * fx;
    const b = data[p + G];
    const bot = b + (data[p + G + 1] - b) * fx;
    return top + (bot - top) * fy;
  }

  function sampleAbsGrad(x, y, out) {
    let cx = (x + 1) * half;
    let cy = (y + 1) * half;
    if (!(cx >= -GRID_EPS && cx <= G1 + GRID_EPS && cy >= -GRID_EPS && cy <= G1 + GRID_EPS)) {
      out[0] = 0;
      out[1] = 0;
      return out;
    }
    if (cx < 0) cx = 0; else if (cx > G1) cx = G1;
    if (cy < 0) cy = 0; else if (cy > G1) cy = G1;
    let i0 = cx | 0;
    let j0 = cy | 0;
    if (i0 > G - 2) i0 = G - 2;
    if (j0 > G - 2) j0 = G - 2;
    const fx = cx - i0;
    const fy = cy - j0;
    const p = j0 * G + i0;
    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx * fy;
    out[0] = w00 * gx[p] + w10 * gx[p + 1] + w01 * gx[p + G] + w11 * gx[p + G + 1];
    out[1] = w00 * gy[p] + w10 * gy[p + 1] + w01 * gy[p + G] + w11 * gy[p + G + 1];
    return out;
  }

  return { sample, sampleAbsGrad };
}

/** Index of the first corner of cell p that lies inside the plate, or -1. */
function insideCorner(mask, p, G) {
  if (mask[p] === 1) return p;
  if (mask[p + 1] === 1) return p + 1;
  if (mask[p + G] === 1) return p + G;
  if (mask[p + G + 1] === 1) return p + G + 1;
  return -1;
}

function makeCircleSamplers(data, gx, gy, mask, full, G) {
  const G1 = G - 1;
  const half = G1 / 2;
  const limit = 1 + CIRCLE_EPS;

  function sample(x, y) {
    if (!(x * x + y * y <= limit)) return 0; // also rejects NaN
    let cx = (x + 1) * half;
    let cy = (y + 1) * half;
    if (cx < 0) cx = 0; else if (cx > G1) cx = G1;
    if (cy < 0) cy = 0; else if (cy > G1) cy = G1;
    let i0 = cx | 0;
    let j0 = cy | 0;
    if (i0 > G - 2) i0 = G - 2;
    if (j0 > G - 2) j0 = G - 2;
    const fx = cx - i0;
    const fy = cy - j0;
    const p = j0 * G + i0;
    if (full[p] === 1) {
      const a = data[p];
      const top = a + (data[p + 1] - a) * fx;
      const b = data[p + G];
      const bot = b + (data[p + G + 1] - b) * fx;
      return top + (bot - top) * fy;
    }
    const w00 = (1 - fx) * (1 - fy) * mask[p];
    const w10 = fx * (1 - fy) * mask[p + 1];
    const w01 = (1 - fx) * fy * mask[p + G];
    const w11 = fx * fy * mask[p + G + 1];
    const ws = w00 + w10 + w01 + w11;
    if (ws < 1e-9) {
      // point sits exactly on a grid line whose nodes are all outside: use an inside corner
      const q = insideCorner(mask, p, G);
      return q < 0 ? 0 : data[q];
    }
    return (w00 * data[p] + w10 * data[p + 1] + w01 * data[p + G] + w11 * data[p + G + 1]) / ws;
  }

  function sampleAbsGrad(x, y, out) {
    if (!(x * x + y * y <= limit)) {
      out[0] = 0;
      out[1] = 0;
      return out;
    }
    let cx = (x + 1) * half;
    let cy = (y + 1) * half;
    if (cx < 0) cx = 0; else if (cx > G1) cx = G1;
    if (cy < 0) cy = 0; else if (cy > G1) cy = G1;
    let i0 = cx | 0;
    let j0 = cy | 0;
    if (i0 > G - 2) i0 = G - 2;
    if (j0 > G - 2) j0 = G - 2;
    const fx = cx - i0;
    const fy = cy - j0;
    const p = j0 * G + i0;
    let w00 = (1 - fx) * (1 - fy);
    let w10 = fx * (1 - fy);
    let w01 = (1 - fx) * fy;
    let w11 = fx * fy;
    if (full[p] === 0) {
      w00 *= mask[p];
      w10 *= mask[p + 1];
      w01 *= mask[p + G];
      w11 *= mask[p + G + 1];
      const ws = w00 + w10 + w01 + w11;
      if (ws < 1e-9) {
        const q = insideCorner(mask, p, G);
        out[0] = q < 0 ? 0 : gx[q];
        out[1] = q < 0 ? 0 : gy[q];
        return out;
      }
      const k = 1 / ws;
      w00 *= k; w10 *= k; w01 *= k; w11 *= k;
    }
    out[0] = w00 * gx[p] + w10 * gx[p + 1] + w01 * gx[p + G] + w11 * gx[p + G + 1];
    out[1] = w00 * gy[p] + w10 * gy[p + 1] + w01 * gy[p + G] + w11 * gy[p + G + 1];
    return out;
  }

  return { sample, sampleAbsGrad };
}
