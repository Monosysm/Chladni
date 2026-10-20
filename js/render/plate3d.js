// Three.js vibrating plate. Vertex positions are domain coordinates: a vertex at
// domain (x, y) has local position (x, -y, 0); the mesh is rotated -PI/2 about X so
// the plate lies in the x-z plane with domain +y toward the camera (matching the 2D
// view) and local +z (the displacement axis) pointing up (+Y world).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LUT } from './colormap.js';

// The real plate vibrates at audio frequencies (hundreds of Hz), which cannot be
// shown on a display; the visual oscillation is fixed at a slow, readable 1.2 Hz.
const VISUAL_HZ = 1.2;
const SQUARE_DIVS = 127;
const CIRCLE_RINGS = 64;
const CIRCLE_SEGMENTS = 256;

export class Plate3D {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this.shape = null;
    this.field = null;
    this.mesh = null;
    this.u = null;          // per-vertex base amplitude
    this._w = 0;
    this._h = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x0e1014, 1);
    const el = this.renderer.domElement;
    el.style.display = 'block';
    el.style.width = '100%';
    el.style.height = '100%';
    container.appendChild(el);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1014);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    const dist = 4.0;
    const elev = (35 * Math.PI) / 180;
    this.camera.position.set(0, dist * Math.sin(elev), dist * Math.cos(elev));
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, el);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 12;
    this.controls.target.set(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2.5, 5, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x8fb4ff, 0.7);
    fill.position.set(-3, 2, -2);
    this.scene.add(fill);

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.3,
      roughness: 0.55,
      side: THREE.DoubleSide,
    });

    this.setShape('square');
    this.resize();
  }

  /** Rebuild geometry for the given shape ('square' | 'circle'). */
  setShape(shape) {
    if (shape !== 'circle') shape = 'square';
    if (this.mesh && this.shape === shape) return;
    this.shape = shape;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    const geometry = shape === 'circle' ? buildCircleGeometry() : buildSquareGeometry();
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.scene.add(this.mesh);
    const count = geometry.attributes.position.count;
    this.u = new Float32Array(count);
    this._applyField();
  }

  /** Store the field and recompute per-vertex amplitude and colors. */
  setField(field) {
    this.field = field || null;
    if (field && field.shape !== this.shape) {
      this.setShape(field.shape); // also applies the field
      return;
    }
    this._applyField();
  }

  _applyField() {
    const geo = this.mesh.geometry;
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    const n = pos.count;
    const u = this.u;
    const field = this.field && this.field.shape === this.shape ? this.field : null;
    for (let i = 0; i < n; i++) {
      const x = pos.array[3 * i];
      const y = -pos.array[3 * i + 1];
      const v = field ? field.sample(x, y) : 0;
      u[i] = v;
      let li = (Math.abs(v) * 255 + 0.5) | 0;
      if (li > 255) li = 255;
      li *= 3;
      col.array[3 * i] = LUT[li] / 255;
      col.array[3 * i + 1] = LUT[li + 1] / 255;
      col.array[3 * i + 2] = LUT[li + 2] / 255;
      pos.array[3 * i + 2] = 0;
    }
    col.needsUpdate = true;
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  /** Match the renderer to the container's client size (no-op while it is 0). */
  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w < 1 || h < 1) return;
    this._w = w;
    this._h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Narrow panes: widen the vertical FOV so the plate still fits horizontally.
    const minAspect = 1.1;
    this.camera.fov = this.camera.aspect >= minAspect
      ? 40
      : (2 * Math.atan(Math.tan((20 * Math.PI) / 180) * minAspect / this.camera.aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param {number} timeSec
   * @param {number} displacement peak displacement in domain units
   */
  render(timeSec, displacement) {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w < 1 || h < 1) return;
    if (w !== this._w || h !== this._h) this.resize();

    const geo = this.mesh.geometry;
    const pos = geo.attributes.position;
    const arr = pos.array;
    const u = this.u;
    const n = pos.count;
    const s = displacement * Math.cos(2 * Math.PI * VISUAL_HZ * timeSec);
    for (let i = 0; i < n; i++) arr[3 * i + 2] = u[i] * s;
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.controls.dispose();
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.material.dispose();
    this.renderer.dispose();
    const el = this.renderer.domElement;
    if (el.parentNode) el.parentNode.removeChild(el);
  }
}

/** (DIVS+1)^2 grid over [-1,1]^2, local y = -domain y so winding is CCW seen from +z. */
function buildSquareGeometry() {
  const n = SQUARE_DIVS;
  const side = n + 1;
  const positions = new Float32Array(side * side * 3);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const o = 3 * (j * side + i);
      positions[o] = -1 + (2 * i) / n;
      positions[o + 1] = 1 - (2 * j) / n;
      positions[o + 2] = 0;
    }
  }
  const indices = new Uint32Array(n * n * 6);
  let k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * side + i;
      const b = (j + 1) * side + i;
      const c = (j + 1) * side + i + 1;
      const d = j * side + i + 1;
      indices[k++] = a; indices[k++] = b; indices[k++] = d;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }
  return makeGeometry(positions, indices);
}

/** Polar mesh: center vertex + CIRCLE_RINGS rings of CIRCLE_SEGMENTS vertices. */
function buildCircleGeometry() {
  const R = CIRCLE_RINGS;
  const S = CIRCLE_SEGMENTS;
  const positions = new Float32Array((1 + R * S) * 3);
  for (let k = 1; k <= R; k++) {
    const r = k / R;
    for (let s = 0; s < S; s++) {
      const th = (2 * Math.PI * s) / S;
      const o = 3 * (1 + (k - 1) * S + s);
      positions[o] = r * Math.cos(th);
      positions[o + 1] = -r * Math.sin(th); // local y = -domain y
      positions[o + 2] = 0;
    }
  }
  const indices = new Uint32Array((S + (R - 1) * S * 2) * 3);
  let q = 0;
  const ring = (k, s) => 1 + (k - 1) * S + (s % S);
  for (let s = 0; s < S; s++) {
    indices[q++] = 0; indices[q++] = ring(1, s + 1); indices[q++] = ring(1, s);
  }
  for (let k = 1; k < R; k++) {
    for (let s = 0; s < S; s++) {
      const a = ring(k, s);
      const b = ring(k, s + 1);
      const c = ring(k + 1, s);
      const d = ring(k + 1, s + 1);
      indices[q++] = a; indices[q++] = d; indices[q++] = c;
      indices[q++] = a; indices[q++] = b; indices[q++] = d;
    }
  }
  return makeGeometry(positions, indices);
}

function makeGeometry(positions, indices) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}
