// Sand particle system: grains jitter in proportion to local plate amplitude |u|
// and drift down the gradient of |u|, so they pile up on the nodal lines.

export const KICK = 0.02;    // random-walk step scale (domain units per frame at |u| = 1)
export const DRIFT = 0.0004; // pull toward |u| minima (domain units per frame per unit gradient)
export const MAX_PARTICLES = 40000;

const MAX_DT = 1 / 30;
const EDGE = 0.999;

export class SandSystem {
  /**
   * @param {number} count number of particles
   * @param {'square'|'circle'} shape
   */
  constructor(count, shape) {
    this.shape = shape;
    this.count = 0;
    this.positions = new Float32Array(2 * Math.max(1, Math.min(count | 0, MAX_PARTICLES)));
    this._grad = new Float32Array(2);
    this.setCount(count);
  }

  /** Grow (new particles uniform in the domain) or shrink; existing particles are kept. */
  setCount(n) {
    n = Math.max(0, Math.min(Math.floor(n) || 0, MAX_PARTICLES));
    if (2 * n > this.positions.length) {
      const grown = new Float32Array(2 * n);
      grown.set(this.positions.subarray(0, 2 * this.count));
      this.positions = grown;
    }
    const old = this.count;
    this.count = n;
    if (n > old) this._scatterRange(old, n);
  }

  setShape(shape) {
    this.shape = shape;
    this.scatter();
  }

  /** Re-randomize all particles uniformly over the domain. */
  scatter() {
    this._scatterRange(0, this.count);
  }

  _scatterRange(from, to) {
    const p = this.positions;
    const circle = this.shape === 'circle';
    for (let i = from; i < to; i++) {
      let x, y;
      if (circle) {
        do {
          x = Math.random() * 2 - 1;
          y = Math.random() * 2 - 1;
        } while (x * x + y * y > 1);
      } else {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
      }
      p[2 * i] = x;
      p[2 * i + 1] = y;
    }
  }

  /**
   * Advance the simulation.
   * @param {object} field Field (see physics contract): sample(), sampleAbsGrad()
   * @param {number} strength 0..1
   * @param {number} dt seconds (clamped to <= 1/30)
   */
  step(field, strength, dt) {
    if (!field || this.count === 0) return;
    if (!(dt > 0)) return;
    if (dt > MAX_DT) dt = MAX_DT;
    const k = dt * 60;
    const kick = KICK * strength * Math.sqrt(k);
    const drift = DRIFT * strength * k;
    const p = this.positions;
    const n = this.count * 2;
    const g = this._grad;
    const circle = this.shape === 'circle';
    const rnd = Math.random;

    for (let i = 0; i < n; i += 2) {
      let x = p[i];
      let y = p[i + 1];
      const a = Math.abs(field.sample(x, y));
      const s = kick * a;
      // cheap gaussian-ish noise: sum of 3 uniforms, mean 1.5, scaled to ~unit variance
      x += s * ((rnd() + rnd() + rnd() - 1.5) * 2);
      y += s * ((rnd() + rnd() + rnd() - 1.5) * 2);
      field.sampleAbsGrad(x, y, g);
      x -= drift * g[0];
      y -= drift * g[1];

      if (circle) {
        const r2 = x * x + y * y;
        if (r2 > 1) {
          const r = Math.sqrt(r2);
          const r2n = Math.min(2 - r, EDGE);
          const sc = (r2n > 0 ? r2n : 0) / r;
          x *= sc;
          y *= sc;
        }
      } else {
        if (x > 1) x = 2 - x; else if (x < -1) x = -2 - x;
        if (y > 1) y = 2 - y; else if (y < -1) y = -2 - y;
        if (x > EDGE) x = EDGE; else if (x < -EDGE) x = -EDGE;
        if (y > EDGE) y = EDGE; else if (y < -EDGE) y = -EDGE;
      }
      p[i] = x;
      p[i + 1] = y;
    }
  }
}
