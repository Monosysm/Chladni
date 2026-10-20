// Analytic vibration modes of the plate.
//
//   square: free-plate Ritz/Chladni approximation  cos(m*pi*X)cos(n*pi*Y) +/- cos(n*pi*X)cos(m*pi*Y)
//   circle: J_n(alpha_nk * r) * cos(n*theta), alpha_nk = k-th positive zero of J_n'
//
// Domain coordinates: x, y in [-1, 1]; square = whole box, circle = x^2 + y^2 <= 1.
// Every mode is normalised so that max |evalMode| over the domain is 1.

import { besselJSamples, besselJPrimeZeros } from './bessel.js';

export const SQUARE_F0 = 16; // Hz scale for the square
export const CIRCLE_F0 = 5; // Hz scale for the circle

const PI = Math.PI;
const SQUARE_MAX_ORDER = 12; // 0 <= m <= n <= 12
const SQUARE_SPLIT = 0.03; // frequency split of the +/- degeneracy
const CIRCLE_MAX_N = 10; // n = 0..10
const CIRCLE_MAX_K = 6; // k = 1..6
const TABLE_SIZE = 1024; // radial lookup samples on r in [0, 1]
const DOMAIN_EPS = 1e-9;

/**
 * @typedef {Object} Mode
 * @property {string} id       unique id, e.g. "sq-2-3-+" or "ci-1-2"
 * @property {string} shape    'square' | 'circle'
 * @property {string} label    human readable, e.g. "(2,3)+" or "n=1 · k=2"
 * @property {number} freq     resonance frequency in Hz
 * @property {Object} params   square: {m, n, s}; circle: {n, k, alpha, table}
 * @property {number} norm     max |raw phi| over the domain
 */

const cache = new Map();

/**
 * All modes of a shape, sorted by frequency ascending (cached; do not mutate).
 * @param {'square'|'circle'} shape
 * @returns {Mode[]}
 */
export function getModes(shape) {
  let modes = cache.get(shape);
  if (!modes) {
    if (shape === 'square') modes = buildSquareModes();
    else if (shape === 'circle') modes = buildCircleModes();
    else throw new Error(`Unknown plate shape: ${shape}`);
    modes.sort((a, b) => a.freq - b.freq);
    cache.set(shape, modes);
  }
  return modes;
}

/**
 * Normalised mode value at domain point (x, y); 0 outside the domain.
 * @param {Mode} mode
 * @param {number} x
 * @param {number} y
 * @returns {number} value with max |value| over the domain = 1
 */
export function evalMode(mode, x, y) {
  if (mode.shape === 'square') {
    if (!(Math.abs(x) <= 1 + DOMAIN_EPS && Math.abs(y) <= 1 + DOMAIN_EPS)) return 0;
    const { m, n, s } = mode.params;
    const X = (x + 1) * 0.5;
    const Y = (y + 1) * 0.5;
    const raw =
      Math.cos(m * PI * X) * Math.cos(n * PI * Y) +
      s * Math.cos(n * PI * X) * Math.cos(m * PI * Y);
    return raw / mode.norm;
  }
  const r2 = x * x + y * y;
  if (!(r2 <= 1 + DOMAIN_EPS)) return 0;
  const { n, table } = mode.params;
  const t = Math.min(Math.sqrt(r2), 1) * (TABLE_SIZE - 1);
  let i0 = t | 0;
  if (i0 > TABLE_SIZE - 2) i0 = TABLE_SIZE - 2;
  const radial = table[i0] + (table[i0 + 1] - table[i0]) * (t - i0);
  return (radial * Math.cos(n * Math.atan2(y, x))) / mode.norm;
}

// ---------------------------------------------------------------- square

function buildSquareModes() {
  const modes = [];
  for (let n = 0; n <= SQUARE_MAX_ORDER; n++) {
    for (let m = 0; m <= n; m++) {
      if (m === 0 && n === 0) continue;
      for (const s of m === n ? [1] : [1, -1]) {
        const sign = s > 0 ? '+' : '-';
        const suffix = m === n ? '' : s > 0 ? '+' : '−';
        modes.push({
          id: `sq-${m}-${n}-${sign}`,
          shape: 'square',
          label: `(${m},${n})${suffix}`,
          freq: SQUARE_F0 * (m * m + n * n) * (m === n ? 1 : 1 + SQUARE_SPLIT * s),
          params: { m, n, s },
          norm: squareNorm(m, n, s),
        });
      }
    }
  }
  return modes;
}

/**
 * Exact max |phi| of a square mode: coarse 129x129 scan, then Newton
 * refinement of every strong local maximum (so |evalMode| <= 1 on any grid).
 */
function squareNorm(m, n, s) {
  const N = 129;
  const cm = new Float64Array(N);
  const cn = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    cm[i] = Math.cos((m * PI * i) / (N - 1));
    cn[i] = Math.cos((n * PI * i) / (N - 1));
  }
  const vals = new Float64Array(N * N);
  let gridMax = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const v = cm[i] * cn[j] + s * cn[i] * cm[j];
      vals[j * N + i] = Math.abs(v);
      if (Math.abs(v) > gridMax) gridMax = Math.abs(v);
    }
  }
  let best = gridMax;
  const threshold = 0.85 * gridMax;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const v = vals[j * N + i];
      if (v < threshold) continue;
      let isPeak = true;
      for (let dj = -1; dj <= 1 && isPeak; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
          if (vals[jj * N + ii] > v) {
            isPeak = false;
            break;
          }
        }
      }
      if (!isPeak) continue;
      const refined = refineSquarePeak(m, n, s, i / (N - 1), j / (N - 1));
      if (refined > best) best = refined;
    }
  }
  return best;
}

/** Newton iteration on grad(phi) = 0 starting at (X, Y); returns |phi| there. */
function refineSquarePeak(m, n, s, X, Y) {
  const mp = m * PI;
  const np = n * PI;
  for (let it = 0; it < 10; it++) {
    const ca = Math.cos(mp * X), sa = Math.sin(mp * X);
    const cb = Math.cos(np * Y), sb = Math.sin(np * Y);
    const cc = Math.cos(np * X), sc = Math.sin(np * X);
    const cd = Math.cos(mp * Y), sd = Math.sin(mp * Y);
    const gX = -mp * sa * cb - s * np * sc * cd;
    const gY = -np * ca * sb - s * mp * cc * sd;
    const hXX = -mp * mp * ca * cb - s * np * np * cc * cd;
    const hYY = -np * np * ca * cb - s * mp * mp * cc * cd;
    const hXY = mp * np * (sa * sb + s * sc * sd);
    const det = hXX * hYY - hXY * hXY;
    if (!(Math.abs(det) > 1e-12)) break;
    const dX = -(hYY * gX - hXY * gY) / det;
    const dY = -(hXX * gY - hXY * gX) / det;
    if (!(Math.abs(dX) < 0.05 && Math.abs(dY) < 0.05)) break;
    X += dX;
    Y += dY;
    if (Math.abs(dX) + Math.abs(dY) < 1e-14) break;
  }
  // phi is even about X, Y = 0 and 1, so any (X, Y) maps to a point in the box
  return Math.abs(
    Math.cos(mp * X) * Math.cos(np * Y) + s * Math.cos(np * X) * Math.cos(mp * Y)
  );
}

// ---------------------------------------------------------------- circle

function buildCircleModes() {
  const modes = [];
  for (let n = 0; n <= CIRCLE_MAX_N; n++) {
    const zeros = besselJPrimeZeros(n, CIRCLE_MAX_K);
    for (let k = 1; k <= CIRCLE_MAX_K; k++) {
      const alpha = zeros[k - 1];
      const table = besselJSamples(n, alpha, TABLE_SIZE); // J_n(alpha * r), r = i/(TABLE_SIZE-1)
      let norm = 0;
      for (let i = 0; i < TABLE_SIZE; i++) norm = Math.max(norm, Math.abs(table[i]));
      modes.push({
        id: `ci-${n}-${k}`,
        shape: 'circle',
        label: `n=${n} · k=${k}`,
        freq: CIRCLE_F0 * alpha * alpha,
        params: { n, k, alpha, table },
        norm, // cos(n*theta) = 1 at theta = 0, so max |phi| = max |radial|
      });
    }
  }
  return modes;
}
