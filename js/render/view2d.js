// 2D compositor: plate base, amplitude heatmap, nodal lines and sand particles.
// All layers share the screen mapping px = x0 + (x+1)/2*size, py = y0 + (y+1)/2*size.

import { LUT } from './colormap.js';

const BG = '#0e1014';
const SAND_ABGR = 0xffc3e4f1; // #f1e4c3 as little-endian packed RGBA
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const SAND_PIXEL = LITTLE_ENDIAN ? SAND_ABGR : 0xf1e4c3ff;

export class View2D {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.plateRect = { x0: 0, y0: 0, size: 0 };
    this.field = null;
    this.shape = 'square';

    // heatmap (G x G offscreen)
    this._heatCanvas = document.createElement('canvas');
    this._heatCtx = this._heatCanvas.getContext('2d');
    this._heatImage = null;

    // nodal segments in domain coords: [x1,y1,x2,y2, ...]
    this._segs = new Float32Array(4096);
    this._segCount = 0; // number of floats used
    this._nodalPath = null;
    this._nodalKey = '';

    // sand offscreen
    this._sandCanvas = document.createElement('canvas');
    this._sandCtx = this._sandCanvas.getContext('2d');
    this._sandImage = null;
    this._sandPix = null;
    this._sandSize = 0;

    this.resize();
  }

  /** Sync canvas backing store to its CSS size and recompute the plate rect. */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    const size = Math.max(1, Math.floor(Math.min(w, h) * 0.92));
    this.plateRect = {
      x0: Math.round((w - size) / 2),
      y0: Math.round((h - size) / 2),
      size,
    };
    this._nodalKey = ''; // force path rebuild
    if (size !== this._sandSize) {
      this._sandSize = size;
      this._sandCanvas.width = size;
      this._sandCanvas.height = size;
      this._sandImage = this._sandCtx.createImageData(size, size);
      this._sandPix = new Uint32Array(this._sandImage.data.buffer);
    }
  }

  /** Set the plate shape used when no field is available. */
  setShape(shape) {
    this.shape = shape;
  }

  /** @param {object|null} field Field object (physics contract) */
  setField(field) {
    this.field = field || null;
    if (!field) {
      this._nodalPath = null;
      this._segCount = 0;
      return;
    }
    this.shape = field.shape;
    this._buildHeatmap(field);
    this._buildNodal(field);
    this._nodalKey = '';
  }

  _buildHeatmap(field) {
    const G = field.G;
    const hc = this._heatCanvas;
    if (hc.width !== G || hc.height !== G || !this._heatImage) {
      hc.width = G;
      hc.height = G;
      this._heatImage = this._heatCtx.createImageData(G, G);
    }
    const px = this._heatImage.data;
    const data = field.data;
    const mask = field.mask;
    const n = G * G;
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      if (mask[i]) {
        let v = data[i];
        if (v < 0) v = -v;
        let li = (v * 255 + 0.5) | 0;
        if (li > 255) li = 255;
        li *= 3;
        px[o] = LUT[li];
        px[o + 1] = LUT[li + 1];
        px[o + 2] = LUT[li + 2];
        px[o + 3] = 255;
      } else {
        px[o + 3] = 0;
      }
    }
    this._heatCtx.putImageData(this._heatImage, 0, 0);
  }

  _pushSeg(x1, y1, x2, y2) {
    if (this._segCount + 4 > this._segs.length) {
      const bigger = new Float32Array(this._segs.length * 2);
      bigger.set(this._segs);
      this._segs = bigger;
    }
    const s = this._segs;
    const c = this._segCount;
    s[c] = x1; s[c + 1] = y1; s[c + 2] = x2; s[c + 3] = y2;
    this._segCount = c + 4;
  }

  /** Marching squares at level 0 on field.data (cells fully inside the mask only). */
  _buildNodal(field) {
    const G = field.G;
    const data = field.data;
    const mask = field.mask;
    const step = 2 / (G - 1);
    this._segCount = 0;
    // edge crossing helpers: interpolated position of zero between two corners
    for (let j = 0; j < G - 1; j++) {
      const row = j * G;
      for (let i = 0; i < G - 1; i++) {
        const i00 = row + i;
        const i10 = i00 + 1;
        const i01 = i00 + G;
        const i11 = i01 + 1;
        if (!(mask[i00] && mask[i10] && mask[i01] && mask[i11])) continue;
        const v00 = data[i00];
        const v10 = data[i10];
        const v01 = data[i01];
        const v11 = data[i11];
        let code = 0;
        if (v00 > 0) code |= 1;
        if (v10 > 0) code |= 2;
        if (v11 > 0) code |= 4;
        if (v01 > 0) code |= 8;
        if (code === 0 || code === 15) continue;
        const x0 = -1 + i * step;
        const y0 = -1 + j * step;
        // crossing points on the four edges (computed lazily where used)
        // top: 00-10, right: 10-11, bottom: 01-11, left: 00-01
        const tx = x0 + step * (v00 / (v00 - v10));
        const ty = y0;
        const rx = x0 + step;
        const ry = y0 + step * (v10 / (v10 - v11));
        const bx = x0 + step * (v01 / (v01 - v11));
        const by = y0 + step;
        const lx = x0;
        const ly = y0 + step * (v00 / (v00 - v01));
        switch (code) {
          case 1: case 14: this._pushSeg(lx, ly, tx, ty); break;
          case 2: case 13: this._pushSeg(tx, ty, rx, ry); break;
          case 3: case 12: this._pushSeg(lx, ly, rx, ry); break;
          case 4: case 11: this._pushSeg(rx, ry, bx, by); break;
          case 6: case 9: this._pushSeg(tx, ty, bx, by); break;
          case 7: case 8: this._pushSeg(lx, ly, bx, by); break;
          case 5: case 10: {
            // saddle: disambiguate with the cell-center average
            const centerPos = (v00 + v10 + v01 + v11) > 0;
            if ((code === 5) === centerPos) {
              this._pushSeg(lx, ly, bx, by);
              this._pushSeg(tx, ty, rx, ry);
            } else {
              this._pushSeg(lx, ly, tx, ty);
              this._pushSeg(rx, ry, bx, by);
            }
            break;
          }
          default: break;
        }
      }
    }
  }

  _ensureNodalPath() {
    const { x0, y0, size } = this.plateRect;
    const key = x0 + ',' + y0 + ',' + size;
    if (this._nodalPath && this._nodalKey === key) return;
    const path = new Path2D();
    const s = this._segs;
    const half = size / 2;
    for (let c = 0; c < this._segCount; c += 4) {
      path.moveTo(x0 + (s[c] + 1) * half, y0 + (s[c + 1] + 1) * half);
      path.lineTo(x0 + (s[c + 2] + 1) * half, y0 + (s[c + 3] + 1) * half);
    }
    this._nodalPath = path;
    this._nodalKey = key;
  }

  _platePath(ctx, shape) {
    const { x0, y0, size } = this.plateRect;
    ctx.beginPath();
    if (shape === 'circle') {
      const r = size / 2;
      ctx.arc(x0 + r, y0 + r, r, 0, Math.PI * 2);
    } else {
      ctx.rect(x0, y0, size, size);
    }
  }

  /**
   * @param {{sand?:boolean, heatmap?:boolean, nodal?:boolean}} layers
   * @param {import('./sand.js').SandSystem} [sand]
   */
  draw(layers, sand) {
    const ctx = this.ctx;
    const { x0, y0, size } = this.plateRect;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const field = this.field;
    const shape = field ? field.shape : this.shape;
    layers = layers || {};

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cw, ch);

    // plate base
    const grad = ctx.createLinearGradient(x0, y0, x0 + size, y0 + size);
    grad.addColorStop(0, '#2a2f38');
    grad.addColorStop(1, '#1b1f26');
    this._platePath(ctx, shape);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#4a5160';
    ctx.stroke();

    if (!field) return;

    // heatmap, clipped to the plate shape
    if (layers.heatmap) {
      const G = field.G;
      const px = size / (G - 1); // node spacing in px; image pixel i is centered on node i
      ctx.save();
      this._platePath(ctx, shape);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this._heatCanvas, x0 - px / 2, y0 - px / 2, px * G, px * G);
      ctx.restore();
    }

    if (layers.nodal && this._segCount > 0) {
      this._ensureNodalPath();
      ctx.save();
      ctx.strokeStyle = '#5ee6ff';
      ctx.lineWidth = 1.5 * this.dpr;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke(this._nodalPath);
      ctx.restore();
    }

    if (layers.sand && sand && sand.count > 0) {
      this._drawSand(sand);
    }
  }

  _drawSand(sand) {
    const { x0, y0, size } = this.plateRect;
    const pix = this._sandPix;
    pix.fill(0);
    const p = sand.positions;
    const n = sand.count * 2;
    const half = size / 2;
    const max = size - 1;
    const big = size > 900;
    const lim = big ? max - 1 : max;
    for (let i = 0; i < n; i += 2) {
      let ix = ((p[i] + 1) * half) | 0;
      let iy = ((p[i + 1] + 1) * half) | 0;
      if (ix < 0) ix = 0; else if (ix > lim) ix = lim;
      if (iy < 0) iy = 0; else if (iy > lim) iy = lim;
      const o = iy * size + ix;
      pix[o] = SAND_PIXEL;
      if (big) {
        pix[o + 1] = SAND_PIXEL;
        pix[o + size] = SAND_PIXEL;
        pix[o + size + 1] = SAND_PIXEL;
      }
    }
    this._sandCtx.putImageData(this._sandImage, 0, 0);
    this.ctx.drawImage(this._sandCanvas, x0, y0);
  }
}
