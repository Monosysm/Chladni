// App bootstrap: wires state, physics, renderers, audio and UI, and runs the render loop.

import { computeField, findResonances, FREQ_MIN, FREQ_MAX } from './physics/field.js';
import { getModes } from './physics/modes.js';
import { View2D } from './render/view2d.js';
import { SandSystem } from './render/sand.js';
import { Plate3D } from './render/plate3d.js';
import { AudioEngine } from './audio.js';
import { state, set, subscribe } from './state.js';
import { initUI } from './ui.js';

const $ = (id) => document.getElementById(id);
const els = {
  viewport: $('viewport'),
  pane2d: $('pane-2d'),
  pane3d: $('pane-3d'),
  canvas: $('view2d'),
  host3d: $('plate3d-host'),
  msg3d: $('plate3d-msg'),
  emptyHint: $('empty-hint'),
};

const clampFreq = (f) => Math.min(FREQ_MAX, Math.max(FREQ_MIN, f));
const has2DLayer = (L) => L.sand || L.heatmap || L.nodal;

/** Frequency of the mode of `shape` closest (in log distance) to `target` Hz. */
function nearestModeFreq(shape, target) {
  let best = null;
  let bestD = Infinity;
  for (const m of getModes(shape)) {
    const d = Math.abs(Math.log(m.freq / target));
    if (d < bestD) { bestD = d; best = m; }
  }
  return best ? clampFreq(best.freq) : target;
}

// ---------- Core objects ----------

set('frequency', nearestModeFreq('square', 900));

const view2d = new View2D(els.canvas);
const sand = new SandSystem(state.particleCount, state.shape);
const audio = new AudioEngine();
audio.setFrequency(state.frequency);
audio.setVolume(state.audio.volume);

/** @type {Plate3D|null} created lazily the first time the 3D layer is enabled */
let plate3d = null;
let plate3dFailed = false;

let field = null;
let resonances = null;
let fieldDirty = true;
let lastAudioFreq = state.frequency;

// ---------- Actions used by the UI and the debug handle ----------

function setFrequency(f) {
  f = +f;
  if (!Number.isFinite(f)) return;
  set('frequency', clampFreq(f));
}

function stepResonance(dir) {
  const r = findResonances(state.shape, state.frequency);
  const target = dir < 0 ? r.prev : r.next;
  if (target) setFrequency(target.freq);
}

let soundRequest = 0;
function setSoundEnabled(on) {
  on = !!on;
  const req = ++soundRequest;
  // Called synchronously from the toggle's change handler: AudioContext creation
  // and resume() happen inside the user gesture.
  audio.setFrequency(state.frequency);
  audio.setVolume(state.audio.volume);
  lastAudioFreq = state.frequency;
  const p = audio.setEnabled(on);
  set('audio', { ...state.audio, enabled: on });
  if (!on) return;
  Promise.resolve(p).then(() => {
    if (req === soundRequest && !audio.enabled) {
      set('audio', { ...state.audio, enabled: false });
      ui.toast('Audio is not available in this browser.');
    }
  }).catch((err) => {
    console.warn('Audio could not start:', err);
    if (req !== soundRequest) return;
    set('audio', { ...state.audio, enabled: false });
    ui.toast('Audio could not start. Click the switch again to retry.');
  });
}

const ui = initUI({
  state,
  set,
  subscribe,
  freqMin: FREQ_MIN,
  freqMax: FREQ_MAX,
  actions: {
    setFrequency,
    stepResonance,
    scatter: () => sand.scatter(),
    setSoundEnabled,
  },
});

// ---------- Field ----------

function recomputeField() {
  fieldDirty = false;
  field = computeField(state.shape, state.frequency, state.damping);
  resonances = findResonances(state.shape, state.frequency);
  view2d.setField(field);
  if (plate3d) plate3d.setField(field);
  ui.updateField(field, resonances);
}

// ---------- Layout / 3D pane ----------

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

function show3DMessage(html) {
  els.msg3d.innerHTML = html;
  els.msg3d.hidden = false;
}

function ensurePlate3D() {
  if (plate3d || plate3dFailed) return;
  if (!webglAvailable()) {
    plate3dFailed = true;
    show3DMessage('<strong>3D view unavailable</strong><span>WebGL is not supported or is disabled in this browser.</span>');
    return;
  }
  try {
    plate3d = new Plate3D(els.host3d);
    plate3d.setShape(state.shape);
    if (fieldDirty || !field) recomputeField();
    else plate3d.setField(field);
    plate3d.resize();
  } catch (err) {
    console.error('3D view failed to initialise:', err);
    plate3dFailed = true;
    if (plate3d) { try { plate3d.dispose(); } catch { /* ignore */ } }
    plate3d = null;
    els.host3d.replaceChildren();
    show3DMessage('<strong>3D view unavailable</strong><span>The WebGL renderer could not be created.</span>');
  }
}

function applyLayout() {
  const L = state.layers;
  const any2D = has2DLayer(L);
  const mode = L.plate3d ? (any2D ? 'split' : '3d') : '2d';
  els.viewport.dataset.mode = mode;
  els.pane2d.hidden = mode === '3d';
  els.pane3d.hidden = mode === '2d';
  els.emptyHint.hidden = any2D || L.plate3d;
}

function updateOrientation() {
  const w = els.viewport.clientWidth;
  const h = els.viewport.clientHeight;
  if (w > 0 && h > 0) els.viewport.dataset.orient = h > w ? 'portrait' : 'landscape';
}

// ---------- State side effects ----------

subscribe((s, key) => {
  switch (key) {
    case 'shape':
      sand.setShape(s.shape);
      if (plate3d) plate3d.setShape(s.shape);
      fieldDirty = true;
      // Land on a resonance of the new plate so the switch shows a crisp figure.
      if (!s.sweep.enabled) set('frequency', nearestModeFreq(s.shape, s.frequency));
      break;
    case 'frequency':
    case 'damping':
      fieldDirty = true;
      break;
    case 'particleCount':
      sand.setCount(s.particleCount);
      break;
    case 'layers':
      applyLayout();
      if (s.layers.plate3d) ensurePlate3D();
      break;
    case 'audio':
      audio.setVolume(s.audio.volume);
      break;
    default:
      break;
  }
});

// ---------- Rendering ----------

let timeSec = 0;

function draw2D() {
  const L = state.layers;
  if (has2DLayer(L) || !L.plate3d) view2d.draw(L, sand);
}

function render3D() {
  if (!plate3d || !state.layers.plate3d) return;
  const res = field ? field.resonance : 0;
  plate3d.render(timeSec, 0.12 * state.amplitude * (0.2 + 0.8 * res));
}

function stepSweep(dt) {
  const sw = state.sweep;
  const lo = Math.log(FREQ_MIN);
  const hi = Math.log(FREQ_MAX);
  let dir = sw.dir >= 0 ? 1 : -1;
  let logf = Math.log(state.frequency) + dir * sw.rate * Math.LN2 * dt;
  if (logf >= hi) { logf = Math.max(lo, 2 * hi - logf); dir = -1; }
  else if (logf <= lo) { logf = Math.min(hi, 2 * lo - logf); dir = 1; }
  if (dir !== sw.dir) set('sweep', { ...sw, dir });
  set('frequency', clampFreq(Math.exp(logf)));
}

let lastNow = performance.now();
let rafId = 0;

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(Math.max((now - lastNow) / 1000, 0), 1 / 30);
  lastNow = now;
  timeSec += dt;

  if (state.sweep.enabled) stepSweep(dt);
  if (fieldDirty) recomputeField();

  const L = state.layers;
  if (L.sand) sand.step(field, state.amplitude * (0.15 + 0.85 * field.resonance), dt);
  draw2D();
  render3D();

  if (state.frequency !== lastAudioFreq) {
    lastAudioFreq = state.frequency;
    audio.setFrequency(state.frequency);
  }
}

function start() {
  if (rafId) return;
  lastNow = performance.now();
  rafId = requestAnimationFrame(frame);
}

function stop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
  else start();
});

// ---------- Resize ----------

const ro = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const t = entry.target;
    if (t === els.viewport) {
      updateOrientation();
    } else if (t === els.pane2d) {
      if (els.pane2d.clientWidth > 0 && els.pane2d.clientHeight > 0) {
        view2d.resize();
        if (field) draw2D();
      }
    } else if (t === els.pane3d) {
      if (plate3d && els.pane3d.clientWidth > 0 && els.pane3d.clientHeight > 0) {
        plate3d.resize();
        render3D();
      }
    }
  }
});
ro.observe(els.viewport);
ro.observe(els.pane2d);
ro.observe(els.pane3d);

// ---------- Debug handle (used by automated verification) ----------

window.chladni = {
  state,
  get field() {
    if (fieldDirty || !field) recomputeField();
    return field;
  },
  sand,
  setFrequency(f) { setFrequency(f); },
  setShape(s) { if (s === 'square' || s === 'circle') set('shape', s); },
  setLayer(name, on) {
    if (!(name in state.layers)) return;
    set('layers', { ...state.layers, [name]: !!on });
  },
};

// ---------- Go ----------

updateOrientation();
applyLayout();
if (state.layers.plate3d) ensurePlate3D();
view2d.resize();
recomputeField();
draw2D();
if (!document.hidden) start();
