// Physics tests — plain Node, no framework:  node tests/physics.test.mjs
import assert from 'node:assert/strict';
import {
  besselJ,
  besselJPrime,
  besselJPrimeZeros,
  besselJSamples,
} from '../js/physics/bessel.js';
import { getModes, evalMode, SQUARE_F0, CIRCLE_F0 } from '../js/physics/modes.js';
import {
  FREQ_MIN,
  FREQ_MAX,
  modeWeight,
  computeField,
  findResonances,
} from '../js/physics/field.js';

const failures = [];
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${String(err.message).split('\n').join('\n       ')}`);
  }
}

// deterministic pseudo-random numbers in [0, 1)
let seed = 12345;
function rand() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}

/** Modes whose frequency no other mode shares (so "dominant mode" is unambiguous). */
function uniqueFreqModes(shape) {
  const modes = getModes(shape);
  return modes.filter((m) => modes.filter((o) => o.freq === m.freq).length === 1);
}

console.log('bessel');

test('besselJ reference values', () => {
  assert.ok(Math.abs(besselJ(0, 1) - 0.7651976866) < 1e-8);
  assert.ok(Math.abs(besselJ(1, 2.5) - 0.4970941025) < 1e-8);
  assert.ok(Math.abs(besselJ(5, 10) - -0.2340615282) < 1e-8);
  assert.ok(Math.abs(besselJ(0, 0) - 1) < 1e-12);
  assert.ok(Math.abs(besselJ(3, 0)) < 1e-12);
  assert.ok(Math.abs(besselJ(2, 100) - -0.0215)  < 5e-4); // large argument (J_2(100) = -0.021...)
});

test('besselJPrime matches a numerical derivative', () => {
  for (const [n, x] of [[0, 2], [1, 3], [4, 7.5], [9, 12]]) {
    const h = 1e-5;
    const num = (besselJ(n, x + h) - besselJ(n, x - h)) / (2 * h);
    assert.ok(Math.abs(besselJPrime(n, x) - num) < 1e-8, `n=${n} x=${x}`);
  }
});

test("zeros of J0', J1', J2'", () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-4, `${a} vs ${b}`);
  const z0 = besselJPrimeZeros(0, 2);
  close(z0[0], 3.83171);
  close(z0[1], 7.01559);
  const z1 = besselJPrimeZeros(1, 2);
  close(z1[0], 1.84118);
  close(z1[1], 5.33144);
  const z2 = besselJPrimeZeros(2, 2);
  close(z2[0], 3.05424);
  close(z2[1], 6.70613);
});

test("zeros: exactly `count`, ascending, J_n' vanishes, high order has no spurious roots", () => {
  for (const n of [0, 3, 10]) {
    const z = besselJPrimeZeros(n, 6);
    assert.equal(z.length, 6);
    for (let i = 0; i < z.length; i++) {
      assert.ok(Math.abs(besselJPrime(n, z[i])) < 1e-9, `n=${n} zero ${i}`);
      if (i > 0) assert.ok(z[i] > z[i - 1] + 1);
    }
    assert.ok(z[0] > n, `first zero of J_${n}' must exceed ${n}`);
  }
  assert.ok(Math.abs(besselJPrimeZeros(10, 1)[0] - 11.77088) < 1e-4);
});

test('besselJSamples agrees with besselJ', () => {
  for (const [n, xm] of [[0, 3.8], [3, 12.3], [10, 30.5], [7, 0.5]]) {
    const s = besselJSamples(n, xm, 257);
    for (let i = 0; i < 257; i += 8) {
      assert.ok(Math.abs(s[i] - besselJ(n, (xm * i) / 256)) < 1e-12, `n=${n} i=${i}`);
    }
  }
});

console.log('modes');

test('getModes: counts, sorted ascending, cached, unique ids', () => {
  const sq = getModes('square');
  const ci = getModes('circle');
  // pairs 0<=m<=n<=12: 91 incl. (0,0); 78 with m!=n (2 modes each) + 12 diagonal
  assert.equal(sq.length, 2 * 78 + 13 - 1);
  assert.equal(ci.length, 11 * 6);
  assert.equal(getModes('square'), sq);
  for (const modes of [sq, ci]) {
    for (let i = 1; i < modes.length; i++) assert.ok(modes[i].freq >= modes[i - 1].freq);
    assert.equal(new Set(modes.map((m) => m.id)).size, modes.length);
    for (const m of modes) {
      assert.ok(m.freq > 0 && m.freq < FREQ_MAX, `${m.id} freq ${m.freq}`);
      assert.ok(m.norm > 0);
      assert.equal(typeof m.label, 'string');
    }
  }
});

test('mode formulas: frequencies, labels, ids', () => {
  const sq = getModes('square');
  const m23p = sq.find((m) => m.id === 'sq-2-3-+');
  assert.equal(m23p.label, '(2,3)+');
  assert.deepEqual({ m: m23p.params.m, n: m23p.params.n, s: m23p.params.s }, { m: 2, n: 3, s: 1 });
  assert.ok(Math.abs(m23p.freq - SQUARE_F0 * 13 * 1.03) < 1e-9);
  const m23m = sq.find((m) => m.id === 'sq-2-3--');
  assert.equal(m23m.label, '(2,3)−');
  assert.ok(Math.abs(m23m.freq - SQUARE_F0 * 13 * 0.97) < 1e-9);
  const m22 = sq.find((m) => m.id === 'sq-2-2-+');
  assert.equal(m22.label, '(2,2)');
  assert.ok(Math.abs(m22.freq - SQUARE_F0 * 8) < 1e-9);
  assert.ok(!sq.some((m) => m.id === 'sq-2-2--' || m.id === 'sq-0-0-+'));

  const ci = getModes('circle');
  const c21 = ci.find((m) => m.id === 'ci-2-1');
  assert.equal(c21.label, 'n=2 · k=1');
  assert.ok(Math.abs(c21.params.alpha - 3.05424) < 1e-4);
  assert.ok(Math.abs(c21.freq - CIRCLE_F0 * c21.params.alpha ** 2) < 1e-9);
  assert.equal(c21.params.table.length, 1024);
});

test('evalMode: |value| <= 1 on aligned and unaligned grids, maximum reaches 1', () => {
  for (const shape of ['square', 'circle']) {
    for (const mode of getModes(shape)) {
      let peak = 0;
      for (const N of [129, 193]) {
        for (let j = 0; j < N; j++) {
          const y = -1 + (2 * j) / (N - 1);
          for (let i = 0; i < N; i++) {
            const v = Math.abs(evalMode(mode, -1 + (2 * i) / (N - 1), y));
            if (v > peak) peak = v;
          }
        }
      }
      assert.ok(peak <= 1 + 1e-6, `${mode.id} peak ${peak}`);
      assert.ok(peak > 0.99, `${mode.id} peak only ${peak}: norm too large?`);
    }
  }
});

test('evalMode: exactly 1 at the circle antinode, zero outside the domain', () => {
  const c01 = getModes('circle').find((m) => m.id === 'ci-0-1');
  assert.ok(Math.abs(evalMode(c01, 0, 0) - 1) < 1e-4);
  assert.equal(evalMode(c01, 1.01, 0), 0);
  assert.equal(evalMode(c01, 0.8, 0.8), 0);
  const s = getModes('square')[0];
  assert.equal(evalMode(s, 1.2, 0), 0);
  assert.equal(evalMode(s, 0, -1.2), 0);
});

console.log('field');

test('modeWeight: sign, resonance peak, sgn(0) = +1', () => {
  assert.ok(modeWeight(50, 100, 0.01) > 0);
  assert.ok(modeWeight(200, 100, 0.01) < 0);
  assert.ok(Math.abs(modeWeight(100, 100, 0.01) - 50) < 1e-9);
  assert.ok(modeWeight(100, 100, 0.001) > 0);
  assert.ok(Math.abs(modeWeight(100, 100, 0.001) - 500) < 1e-9);
  assert.ok(Math.abs(modeWeight(0, 100, 0.01) - 1) < 1e-12);
  assert.ok(Number.isFinite(modeWeight(100, 100, 0)));
});

test('constants', () => {
  assert.equal(FREQ_MIN, 20);
  assert.equal(FREQ_MAX, 5000);
});

test('Field object contract', () => {
  for (const shape of ['square', 'circle']) {
    const G = 96;
    const f = computeField(shape, 400, 0.02, G);
    assert.equal(f.shape, shape);
    assert.equal(f.G, G);
    assert.equal(f.frequency, 400);
    assert.equal(f.damping, 0.02);
    assert.ok(f.data instanceof Float32Array && f.data.length === G * G);
    assert.ok(f.mask instanceof Uint8Array && f.mask.length === G * G);
    assert.ok(f.absGradX instanceof Float32Array && f.absGradX.length === G * G);
    assert.ok(f.absGradY instanceof Float32Array && f.absGradY.length === G * G);
    assert.ok(f.resonance >= 0 && f.resonance <= 1);
    assert.ok(f.topModes.length >= 1 && f.topModes.length <= 6);
    for (let i = 1; i < f.topModes.length; i++) {
      assert.ok(Math.abs(f.topModes[i - 1].weight) >= Math.abs(f.topModes[i].weight));
    }
    const maxW = Math.abs(f.topModes[0].weight);
    for (const t of f.topModes) {
      assert.ok(t.mode && typeof t.weight === 'number');
      assert.ok(Math.abs(t.weight) >= 0.02 * maxW);
    }
    assert.equal(typeof f.sample, 'function');
    const out = [0, 0];
    assert.equal(f.sampleAbsGrad(0.1, 0.2, out), out);
    for (let p = 0; p < G * G; p++) {
      assert.ok(Number.isFinite(f.data[p]) && Number.isFinite(f.absGradX[p]) && Number.isFinite(f.absGradY[p]));
    }
  }
});

test('mask: all ones for square, unit disk for circle; circle data/gradient are 0 outside', () => {
  const G = 192;
  const sq = computeField('square', 900, 0.01, G);
  assert.ok(sq.mask.every((v) => v === 1));
  const f = computeField('circle', 900, 0.01, G);
  let inside = 0;
  for (let j = 0; j < G; j++) {
    const y = -1 + (2 * j) / (G - 1);
    for (let i = 0; i < G; i++) {
      const x = -1 + (2 * i) / (G - 1);
      const p = j * G + i;
      const expect = x * x + y * y <= 1 ? 1 : 0;
      assert.equal(f.mask[p], expect, `mask at (${i},${j})`);
      if (!expect) {
        assert.equal(f.data[p], 0);
        assert.equal(f.absGradX[p], 0);
        assert.equal(f.absGradY[p], 0);
      } else inside++;
    }
  }
  assert.ok(Math.abs(inside / (G * G) - Math.PI / 4) < 0.01);
});

test('at an exact mode frequency the field is that mode (square and circle)', () => {
  for (const shape of ['square', 'circle']) {
    const uniq = uniqueFreqModes(shape);
    const step = Math.max(1, Math.floor(uniq.length / 12));
    for (let k = 0; k < uniq.length; k += step) {
      const mode = uniq[k];
      const f = computeField(shape, mode.freq, 0.01);
      assert.equal(f.topModes[0].mode.id, mode.id, `${shape} ${mode.id}`);
      assert.ok(f.resonance > 0.9, `${mode.id} resonance ${f.resonance}`);
      let maxAbs = 0;
      for (let p = 0; p < f.data.length; p++) maxAbs = Math.max(maxAbs, Math.abs(f.data[p]));
      assert.ok(Math.abs(maxAbs - 1) < 1e-6, `${mode.id} max|data| ${maxAbs}`);
    }
  }
});

test('degenerate (equal-frequency) modes: a member of the degenerate set dominates', () => {
  const modes = getModes('square');
  const dup = modes.find((m) => modes.filter((o) => o.freq === m.freq).length > 1);
  assert.ok(dup, 'expected at least one degenerate pair');
  const f = computeField('square', dup.freq, 0.01);
  assert.equal(f.topModes[0].mode.freq, dup.freq);
  assert.ok(f.resonance > 0.9);
});

test('field equals the weighted sum of its top modes (evalMode), normalised', () => {
  for (const [shape, f0] of [['square', 214.2], ['square', 403.5], ['square', 777], ['circle', 246.1], ['circle', 321.2], ['circle', 1234]]) {
    const G = 96;
    const f = computeField(shape, f0, 0.003, G);
    const expect = new Float64Array(G * G);
    let peak = 0;
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const p = j * G + i;
        if (!f.mask[p]) continue;
        let u = 0;
        for (const t of f.topModes) u += t.weight * evalMode(t.mode, -1 + (2 * i) / (G - 1), -1 + (2 * j) / (G - 1));
        expect[p] = u;
        peak = Math.max(peak, Math.abs(u));
      }
    }
    let worst = 0;
    for (let p = 0; p < G * G; p++) worst = Math.max(worst, Math.abs(f.data[p] - expect[p] / peak));
    assert.ok(worst < 2e-3, `${shape} ${f0} Hz deviates by ${worst}`);
  }
});

test('a sharp resonance is dominated by one mode (low damping)', () => {
  for (const [shape, id] of [['square', 'sq-2-3-+'], ['circle', 'ci-3-2'], ['circle', 'ci-0-2']]) {
    const mode = getModes(shape).find((m) => m.id === id);
    const f = computeField(shape, mode.freq, 0.0005, 96);
    assert.equal(f.topModes[0].mode.id, id);
    const sign = Math.sign(f.topModes[0].weight);
    let worst = 0;
    for (let j = 0; j < 96; j++) {
      for (let i = 0; i < 96; i++) {
        const p = j * 96 + i;
        if (!f.mask[p]) continue;
        const e = evalMode(mode, -1 + (2 * i) / 95, -1 + (2 * j) / 95);
        worst = Math.max(worst, Math.abs(f.data[p] - sign * e));
      }
    }
    assert.ok(worst < 0.06, `${id} deviates by ${worst}`);
  }
});

test('basis cache eviction does not change results', () => {
  const first = computeField('square', 123.4, 0.01);
  const copy = Float32Array.from(first.data);
  for (let i = 0; i < 150; i++) computeField('square', 20 * Math.pow(250, i / 150), 0.02);
  const again = computeField('square', 123.4, 0.01);
  assert.deepEqual(Array.from(again.data), Array.from(copy));
});

test('works for other grid sizes (odd, small) and extreme damping', () => {
  for (const G of [33, 65, 129]) {
    for (const shape of ['square', 'circle']) {
      for (const zeta of [0, 0.001, 0.1]) {
        const f = computeField(shape, 777, zeta, G);
        assert.equal(f.data.length, G * G);
        let maxAbs = 0;
        for (const v of f.data) {
          assert.ok(Number.isFinite(v));
          maxAbs = Math.max(maxAbs, Math.abs(v));
        }
        assert.ok(Math.abs(maxAbs - 1) < 1e-6);
      }
    }
  }
});

test('off resonance gives a low resonance reading', () => {
  const f = computeField('square', 24, 0.01); // between (0,1)+ at 16.5 Hz and (1,1) at 32 Hz
  assert.ok(f.resonance < 0.1, `resonance ${f.resonance}`);
});

test('square (0,1)+: point-antisymmetric field with a diagonal nodal line', () => {
  const mode = getModes('square').find((m) => m.id === 'sq-0-1-+');
  const f = computeField('square', mode.freq, 0.0005);
  for (let i = 0; i < 40; i++) {
    const x = rand() * 1.8 - 0.9;
    const y = rand() * 1.8 - 0.9;
    assert.ok(Math.abs(f.sample(x, y) + f.sample(-x, -y)) < 0.02);
  }
  // nodal line is cos(pi X) + cos(pi Y) = 0  <=>  X + Y = 1  <=>  y = -x
  for (const x of [-0.7, -0.3, 0.2, 0.6]) assert.ok(Math.abs(f.sample(x, -x)) < 0.02);
  assert.ok(f.sample(0.5, 0.5) * f.sample(-0.5, -0.5) < 0);
});

test('circle n=0,k=2: two nodal circles on a radius; n=0,k=1 nodal circle at r = 0.6276', () => {
  const m2 = getModes('circle').find((m) => m.id === 'ci-0-2');
  const f2 = computeField('circle', m2.freq, 0.0005);
  let changes = 0;
  let prev = Math.sign(f2.sample(0.001, 0));
  for (let r = 0.01; r <= 0.99; r += 0.005) {
    const s = Math.sign(f2.sample(r, 0));
    if (s !== 0 && s !== prev) changes++;
    if (s !== 0) prev = s;
  }
  assert.equal(changes, 2);

  const m1 = getModes('circle').find((m) => m.id === 'ci-0-1');
  const f1 = computeField('circle', m1.freq, 0.0005);
  assert.ok(Math.abs(f1.sample(0.6276, 0)) < 0.02);
  assert.ok(f1.sample(0.0, 0) * f1.sample(0.95, 0) < 0);
});

test('sample: node values, bilinear midpoint, zero outside the plate', () => {
  for (const shape of ['square', 'circle']) {
    const G = 192;
    const f = computeField(shape, 900, 0.01, G);
    for (let t = 0; t < 50; t++) {
      const i = 1 + Math.floor(rand() * (G - 3));
      const j = 1 + Math.floor(rand() * (G - 3));
      const p = j * G + i;
      if (!(f.mask[p] && f.mask[p + 1] && f.mask[p + G] && f.mask[p + G + 1])) continue;
      const x = -1 + (2 * i) / (G - 1);
      const y = -1 + (2 * j) / (G - 1);
      assert.ok(Math.abs(f.sample(x, y) - f.data[p]) < 1e-6);
      const h = 1 / (G - 1); // half a cell
      const mid = (f.data[p] + f.data[p + 1] + f.data[p + G] + f.data[p + G + 1]) / 4;
      assert.ok(Math.abs(f.sample(x + h, y + h) - mid) < 1e-6);
    }
    assert.equal(f.sample(-1.2, 0), 0);
    assert.equal(f.sample(0, 1.2), 0);
    assert.equal(f.sample(NaN, 0), 0);
    assert.ok(Math.abs(f.sample(1, 1) - (shape === 'square' ? f.data[G * G - 1] : 0)) < 1e-6);
  }
  const c = computeField('circle', 900, 0.01);
  assert.equal(c.sample(0.9, 0.9), 0);
  assert.equal(c.sample(0.75, 0.75), 0);
});

test('sample near the circle rim is not damped (antinode at the rim)', () => {
  const mode = getModes('circle').find((m) => m.id === 'ci-0-1');
  const f = computeField('circle', mode.freq, 0.0005);
  const expect = evalMode(mode, 0.9995, 0);
  assert.ok(Math.abs(expect) > 0.3);
  for (const x of [0.9995, 0.9999, 1.0]) {
    assert.ok(Math.abs(f.sample(x, 0) - evalMode(mode, x, 0)) < 0.02, `x=${x}: ${f.sample(x, 0)}`);
  }
  const out = new Float32Array(2);
  f.sampleAbsGrad(0.9995, 0, out);
  assert.ok(Number.isFinite(out[0]) && Math.abs(out[0]) < 10);
});

test('sampleAbsGrad: matches d|u|/dx, d|u|/dy in smooth regions', () => {
  for (const [shape, id] of [['square', 'sq-2-3-+'], ['circle', 'ci-2-2']]) {
    const mode = getModes(shape).find((m) => m.id === id);
    const f = computeField(shape, mode.freq, 0.002);
    const out = new Float32Array(2);
    const h = 0.004;
    let checked = 0;
    let worst = 0;
    for (let t = 0; t < 400 && checked < 60; t++) {
      const x = rand() * 1.6 - 0.8;
      const y = rand() * 1.6 - 0.8;
      if (shape === 'circle' && x * x + y * y > 0.7) continue;
      if (Math.abs(f.sample(x, y)) < 0.25) continue; // keep away from nodal lines
      f.sampleAbsGrad(x, y, out);
      const nx = (Math.abs(f.sample(x + h, y)) - Math.abs(f.sample(x - h, y))) / (2 * h);
      const ny = (Math.abs(f.sample(x, y + h)) - Math.abs(f.sample(x, y - h))) / (2 * h);
      worst = Math.max(worst, Math.abs(out[0] - nx), Math.abs(out[1] - ny));
      checked++;
    }
    assert.ok(checked >= 30, `only ${checked} points checked`);
    assert.ok(worst < 0.5, `${id} worst deviation ${worst}`);
  }
});

test('sampleAbsGrad: -grad points toward nodal lines (|u| decreases)', () => {
  for (const [shape, id] of [['square', 'sq-1-4--'], ['circle', 'ci-3-2']]) {
    const mode = getModes(shape).find((m) => m.id === id);
    const f = computeField(shape, mode.freq, 0.005);
    const out = new Float32Array(2);
    let ok = 0;
    let total = 0;
    for (let t = 0; t < 400 && total < 150; t++) {
      const x = rand() * 1.8 - 0.9;
      const y = rand() * 1.8 - 0.9;
      if (shape === 'circle' && x * x + y * y > 0.8) continue;
      const a = Math.abs(f.sample(x, y));
      if (a < 0.1) continue;
      f.sampleAbsGrad(x, y, out);
      const g = Math.hypot(out[0], out[1]);
      if (g < 1e-3) continue;
      const e = 0.002 / g;
      const b = Math.abs(f.sample(x - out[0] * e, y - out[1] * e));
      total++;
      if (b < a) ok++;
    }
    assert.ok(total > 50);
    assert.ok(ok / total > 0.95, `${id}: ${ok}/${total} points descend`);
  }
});

test('sampleAbsGrad: zero outside, writes the given array, no rim artefacts', () => {
  const f = computeField('circle', 900, 0.01);
  const out = [9, 9];
  assert.equal(f.sampleAbsGrad(0.95, 0.95, out), out);
  assert.deepEqual(out, [0, 0]);
  f.sampleAbsGrad(5, 5, out);
  assert.deepEqual(out, [0, 0]);
  // the rim must not carry the huge slope of a fake drop to u = 0 outside the plate
  const G = f.G;
  let maxRim = 0;
  for (let p = 0; p < G * G; p++) maxRim = Math.max(maxRim, Math.abs(f.absGradX[p]), Math.abs(f.absGradY[p]));
  assert.ok(maxRim < 40, `max gradient ${maxRim}`);
});

test('findResonances: prev < f < next, nearest is closest in log distance', () => {
  for (const shape of ['square', 'circle']) {
    const modes = getModes(shape);
    for (let t = 0; t < 200; t++) {
      const f = 20 * Math.pow(250, rand());
      const r = findResonances(shape, f);
      if (r.prev) assert.ok(r.prev.freq < f);
      if (r.next) assert.ok(r.next.freq > f);
      if (r.prev && r.next) {
        assert.ok(!modes.some((m) => m.freq > r.prev.freq && m.freq < f * (1 - 1e-6)));
        assert.ok(!modes.some((m) => m.freq < r.next.freq && m.freq > f * (1 + 1e-6)));
      }
      const dist = (m) => Math.abs(Math.log(m.freq / f));
      for (const m of modes) assert.ok(dist(r.nearest) <= dist(m) + 1e-12);
    }
    // exactly on a mode: that mode is nearest, neighbours are strictly either side
    const mid = modes[Math.floor(modes.length / 2)];
    const r = findResonances(shape, mid.freq);
    assert.equal(r.nearest.freq, mid.freq);
    assert.ok(r.prev.freq < mid.freq && r.next.freq > mid.freq);
    // ends
    assert.equal(findResonances(shape, 1).prev, null);
    assert.equal(findResonances(shape, 10000).next, null);
    assert.ok(findResonances(shape, 1).next === modes[0]);
  }
});

console.log('performance');

function timeField(shape, f, zeta, runs = 200) {
  for (let i = 0; i < 20; i++) computeField(shape, f, zeta); // warm caches + JIT
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) computeField(shape, f, zeta);
  return (performance.now() - t0) / runs;
}

test('timing: computeField, G=192, warm cache', () => {
  const circle = timeField('circle', 1000, 0.01);
  const square = timeField('square', 1000, 0.01);
  console.log(`       circle 1000 Hz, zeta 0.01: ${circle.toFixed(2)} ms/call`);
  console.log(`       square 1000 Hz, zeta 0.01: ${square.toFixed(2)} ms/call`);
  if (circle > 8 || square > 8) console.log('       WARNING: slower than the 8 ms target');
  assert.ok(circle < 40 && square < 40, 'computeField is unreasonably slow');
});

test('timing: 40k sample + sampleAbsGrad calls', () => {
  const f = computeField('circle', 1000, 0.01);
  const M = 40000;
  const xs = new Float32Array(M);
  const ys = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    xs[i] = rand() * 1.6 - 0.8;
    ys[i] = rand() * 1.6 - 0.8;
  }
  const out = new Float32Array(2);
  let sink = 0;
  for (let rep = 0; rep < 3; rep++) {
    for (let i = 0; i < M; i++) {
      sink += f.sample(xs[i], ys[i]);
      f.sampleAbsGrad(xs[i], ys[i], out);
      sink += out[0];
    }
  }
  const t0 = performance.now();
  for (let i = 0; i < M; i++) {
    sink += f.sample(xs[i], ys[i]);
    f.sampleAbsGrad(xs[i], ys[i], out);
    sink += out[0];
  }
  const ms = performance.now() - t0;
  console.log(`       40k x (sample + sampleAbsGrad): ${ms.toFixed(2)} ms`);
  assert.ok(Number.isFinite(sink));
  assert.ok(ms < 100);
});

console.log('');
if (failures.length) {
  console.log(`${failures.length} FAILED, ${passed} passed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`${passed} tests passed`);
console.log('ALL PHYSICS TESTS PASSED');
