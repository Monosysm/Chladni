// Bessel functions of the first kind, integer order. No dependencies.
//
// J_n(x) = (1/pi) * integral_0^pi cos(n*t - x*sin t) dt
// The integrand is even and 2*pi-periodic, so the trapezoid rule converges
// geometrically (spectral accuracy) once the panel count exceeds ~x + n.

const PI = Math.PI;

/**
 * Bessel function of the first kind J_n(x), integer n >= 0.
 * @param {number} n integer order (>= 0)
 * @param {number} x argument (negative values use J_n(-x) = (-1)^n J_n(x))
 * @returns {number}
 */
export function besselJ(n, x) {
  if (x < 0) return (n & 1 ? -1 : 1) * besselJ(n, -x);
  const N = Math.max(64, Math.ceil(2 * x) + n + 32);
  // End points of the trapezoid rule: t = 0 -> cos(0) = 1, t = pi -> cos(n*pi).
  let sum = 0.5 * (1 + (n & 1 ? -1 : 1));
  const h = PI / N;
  for (let k = 1; k < N; k++) {
    const t = k * h;
    sum += Math.cos(n * t - x * Math.sin(t));
  }
  return sum / N; // (1/pi) * h * sum
}

/**
 * J_n sampled on the uniform grid x_i = xMax * i / (count - 1), i = 0..count-1.
 * Same quadrature as besselJ, but the phase n*t - x*sin t is advanced by a
 * complex rotation per grid step, so no trigonometry runs in the inner loop
 * (~15x faster than calling besselJ per sample; used for radial lookup tables).
 * @param {number} n integer order (>= 0)
 * @param {number} xMax largest argument (>= 0)
 * @param {number} count number of samples (>= 2)
 * @returns {Float64Array}
 */
export function besselJSamples(n, xMax, count) {
  const out = new Float64Array(count);
  const N = Math.max(64, Math.ceil(2 * xMax) + n + 32);
  const h = PI / N;
  const dx = xMax / (count - 1);
  out.fill(0.5 * (1 + (n & 1 ? -1 : 1)));
  for (let k = 1; k < N; k++) {
    const t = k * h;
    const sinT = Math.sin(t);
    let re = Math.cos(n * t);
    let im = Math.sin(n * t);
    const rc = Math.cos(dx * sinT);
    const rs = -Math.sin(dx * sinT);
    for (let i = 0; i < count; i++) {
      out[i] += re;
      const nre = re * rc - im * rs;
      im = re * rs + im * rc;
      re = nre;
    }
  }
  for (let i = 0; i < count; i++) out[i] /= N;
  return out;
}

/**
 * Derivative J_n'(x).  J_0' = -J_1,  J_n' = (J_{n-1} - J_{n+1}) / 2.
 * @param {number} n integer order (>= 0)
 * @param {number} x argument
 * @returns {number}
 */
export function besselJPrime(n, x) {
  if (n === 0) return -besselJ(1, x);
  return 0.5 * (besselJ(n - 1, x) - besselJ(n + 1, x));
}

/**
 * First `count` positive zeros of J_n' (x = 0 excluded), ascending.
 * Sign-change scan in steps of 0.05 followed by 60 bisection steps.
 *
 * The scan starts at max(0.1, n): J_n' is positive on (0, j'_{n,1}) and
 * j'_{n,1} > n, but for large n it is ~1e-20 there, i.e. below the round-off of
 * the integral, which would produce spurious sign changes.
 * @param {number} n integer order (>= 0)
 * @param {number} count number of zeros wanted
 * @returns {number[]}
 */
export function besselJPrimeZeros(n, count) {
  const STEP = 0.05;
  const x0 = Math.max(0.1, n);
  const zeros = [];
  let xa = x0;
  let fa = besselJPrime(n, xa);
  for (let i = 1; zeros.length < count && i < 100000; i++) {
    const xb = x0 + i * STEP;
    const fb = besselJPrime(n, xb);
    if (fb === 0) {
      zeros.push(xb);
    } else if (fa !== 0 && (fa < 0) !== (fb < 0)) {
      let lo = xa;
      let hi = xb;
      let flo = fa;
      for (let it = 0; it < 60; it++) {
        const mid = 0.5 * (lo + hi);
        const fm = besselJPrime(n, mid);
        if ((fm < 0) === (flo < 0)) {
          lo = mid;
          flo = fm;
        } else {
          hi = mid;
        }
      }
      zeros.push(0.5 * (lo + hi));
    }
    xa = xb;
    fa = fb;
  }
  return zeros;
}
