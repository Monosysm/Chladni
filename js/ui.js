// DOM bindings for the control panel: user input -> state/actions, state -> controls.

const FREQ_SLIDER_MAX = 1000;
const DAMP_MIN = 0.001;
const DAMP_MAX = 0.1;
const DAMP_SLIDER_MAX = 1000;

const $ = (id) => document.getElementById(id);

const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Format a frequency for display, e.g. "1,234.5". */
export function formatHz(f) {
  return nf1.format(f);
}

/** Set textContent only when it changed (cheap during 60 fps sweeps). */
function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

/** Update the CSS fill percentage of a styled range input. */
function setRangeFill(el) {
  const min = +el.min || 0;
  const max = +el.max || 100;
  const pct = ((+el.value - min) / (max - min)) * 100;
  el.style.setProperty('--fill', `${Math.max(0, Math.min(100, pct))}%`);
}

function setRange(el, value) {
  if (el.dataset.dragging !== '1') el.value = String(value);
  setRangeFill(el);
}

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file']);

/** True for elements that consume typed characters (text/number fields etc.). */
function isTextEntry(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !NON_TEXT_INPUTS.has(el.type);
}

/**
 * Wire up the control panel.
 * @param {object} opts
 * @param {object} opts.state      shared state object
 * @param {Function} opts.set      state setter
 * @param {Function} opts.subscribe state subscription
 * @param {number} opts.freqMin
 * @param {number} opts.freqMax
 * @param {object} opts.actions    { setFrequency(f), stepResonance(dir), scatter(), setSoundEnabled(on) }
 * @returns {{ updateField(field: object, res: object): void, toast(msg: string): void }}
 */
export function initUI({ state, set, subscribe, freqMin, freqMax, actions }) {
  const freqRatioLn = Math.log(freqMax / freqMin);
  const freqToSlider = (f) => (FREQ_SLIDER_MAX * Math.log(f / freqMin)) / freqRatioLn;
  const sliderToFreq = (v) => freqMin * Math.exp((v / FREQ_SLIDER_MAX) * freqRatioLn);
  const dampToSlider = (d) => (DAMP_SLIDER_MAX * Math.log(d / DAMP_MIN)) / Math.log(DAMP_MAX / DAMP_MIN);
  const sliderToDamp = (v) => DAMP_MIN * Math.pow(DAMP_MAX / DAMP_MIN, v / DAMP_SLIDER_MAX);
  const clampFreq = (f) => Math.min(freqMax, Math.max(freqMin, f));

  const el = {
    shapeSeg: $('shape-seg'),
    shapeRadios: document.querySelectorAll('input[name="shape"]'),
    freqValue: $('freq-value'),
    freqSlider: $('freq-slider'),
    freqInput: $('freq-input'),
    freqDown: $('freq-down'),
    freqUp: $('freq-up'),
    resPrev: $('res-prev'),
    resNext: $('res-next'),
    resPrevFreq: $('res-prev-freq'),
    resNextFreq: $('res-next-freq'),
    nearestLabel: $('nearest-label'),
    nearestFreq: $('nearest-freq'),
    nearestDetune: $('nearest-detune'),
    resMeter: $('res-meter'),
    resFill: $('res-fill'),
    resValue: $('res-value'),
    sweepToggle: $('sweep-toggle'),
    sweepRate: $('sweep-rate'),
    sweepRateValue: $('sweep-rate-value'),
    sweepDir: $('sweep-dir'),
    ampSlider: $('amp-slider'),
    ampValue: $('amp-value'),
    dampSlider: $('damp-slider'),
    dampValue: $('damp-value'),
    countSlider: $('count-slider'),
    countValue: $('count-value'),
    scatterBtn: $('scatter-btn'),
    layerInputs: document.querySelectorAll('input[data-layer]'),
    soundToggle: $('sound-toggle'),
    volumeSlider: $('volume-slider'),
    volumeValue: $('volume-value'),
    hudFreq: $('hud-freq'),
    hudMode: $('hud-mode'),
    hudDot: $('hud-dot'),
    hudSweep: $('hud-sweep'),
    toast: $('toast'),
  };

  // Manual frequency changes stop an active sweep so the two don't fight.
  const userSetFrequency = (f) => {
    if (state.sweep.enabled) set('sweep', { ...state.sweep, enabled: false });
    actions.setFrequency(clampFreq(f));
  };

  // Track slider drags so state echoes don't move the thumb under the pointer.
  for (const r of document.querySelectorAll('input[type="range"]')) {
    r.addEventListener('pointerdown', () => { r.dataset.dragging = '1'; });
    const end = () => { r.dataset.dragging = '0'; };
    r.addEventListener('pointerup', end);
    r.addEventListener('pointercancel', end);
    r.addEventListener('blur', end);
  }

  // ---- Plate ----
  for (const radio of el.shapeRadios) {
    radio.addEventListener('change', () => {
      if (radio.checked) set('shape', radio.value);
    });
  }

  // ---- Frequency ----
  el.freqSlider.addEventListener('input', () => {
    setRangeFill(el.freqSlider);
    userSetFrequency(sliderToFreq(+el.freqSlider.value));
  });

  const commitFreqInput = () => {
    const raw = el.freqInput.value.trim();
    const f = parseFloat(raw);
    if (!Number.isFinite(f)) {
      el.freqInput.value = state.frequency.toFixed(1);
      el.freqInput.classList.remove('is-invalid');
      return;
    }
    const c = clampFreq(f);
    el.freqInput.classList.remove('is-invalid');
    if (Math.abs(c - state.frequency) > 1e-9) userSetFrequency(c);
    el.freqInput.value = c.toFixed(1);
  };
  el.freqInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitFreqInput();
      el.freqInput.select();
    } else if (e.key === 'Escape') {
      el.freqInput.value = state.frequency.toFixed(1);
      el.freqInput.classList.remove('is-invalid');
      el.freqInput.blur();
    }
  });
  el.freqInput.addEventListener('input', () => {
    const f = parseFloat(el.freqInput.value);
    el.freqInput.classList.toggle('is-invalid', el.freqInput.value !== '' && (!Number.isFinite(f) || f < freqMin || f > freqMax));
  });
  el.freqInput.addEventListener('blur', commitFreqInput);
  el.freqInput.addEventListener('focus', () => el.freqInput.select());

  el.freqDown.addEventListener('click', () => userSetFrequency(state.frequency * 0.99));
  el.freqUp.addEventListener('click', () => userSetFrequency(state.frequency * 1.01));
  el.resPrev.addEventListener('click', () => {
    if (state.sweep.enabled) set('sweep', { ...state.sweep, enabled: false });
    actions.stepResonance(-1);
  });
  el.resNext.addEventListener('click', () => {
    if (state.sweep.enabled) set('sweep', { ...state.sweep, enabled: false });
    actions.stepResonance(1);
  });

  // ---- Sweep ----
  el.sweepToggle.addEventListener('change', () => {
    set('sweep', { ...state.sweep, enabled: el.sweepToggle.checked });
  });
  el.sweepRate.addEventListener('input', () => {
    set('sweep', { ...state.sweep, rate: +el.sweepRate.value });
  });

  // ---- Vibration ----
  el.ampSlider.addEventListener('input', () => set('amplitude', +el.ampSlider.value));
  el.dampSlider.addEventListener('input', () => set('damping', sliderToDamp(+el.dampSlider.value)));

  // ---- Sand ----
  el.countSlider.addEventListener('input', () => set('particleCount', Math.round(+el.countSlider.value)));
  el.scatterBtn.addEventListener('click', () => {
    actions.scatter();
    pulse(el.scatterBtn);
  });

  // ---- Layers ----
  for (const input of el.layerInputs) {
    input.addEventListener('change', () => {
      set('layers', { ...state.layers, [input.dataset.layer]: input.checked });
    });
  }

  // ---- Sound ----
  // Runs inside the click/change handler so AudioContext creation counts as a user gesture.
  el.soundToggle.addEventListener('change', () => actions.setSoundEnabled(el.soundToggle.checked));
  el.volumeSlider.addEventListener('input', () => {
    set('audio', { ...state.audio, volume: +el.volumeSlider.value });
  });

  // ---- Keyboard shortcuts ----
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    if (isTextEntry(target)) return;
    const type = target && target.tagName === 'INPUT' ? target.type : '';
    const isArrow = e.key.startsWith('Arrow');
    // Sliders and radio groups use the arrow keys natively.
    if (isArrow && (type === 'range' || type === 'radio')) return;
    // A keyboard-focused button/switch activates on Space itself; after a mouse
    // click (no :focus-visible) Space falls through to the sweep shortcut.
    const activatable = target && (target.tagName === 'BUTTON' || type === 'checkbox') && focusVisible(target);
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        const pct = e.shiftKey ? 0.1 : 0.01;
        const factor = e.key === 'ArrowRight' ? 1 + pct : 1 - pct;
        userSetFrequency(state.frequency * factor);
        e.preventDefault();
        break;
      }
      case '[':
        el.resPrev.click();
        e.preventDefault();
        break;
      case ']':
        el.resNext.click();
        e.preventDefault();
        break;
      case ' ':
      case 'Spacebar':
        if (activatable) return;
        e.preventDefault();
        // Drop mouse focus so the keyup can't activate the focused control.
        if (target && (target.tagName === 'BUTTON' || type === 'checkbox')) target.blur();
        if (e.repeat) return;
        set('sweep', { ...state.sweep, enabled: !state.sweep.enabled });
        break;
      case 's':
      case 'S':
        if (e.repeat) return;
        actions.scatter();
        pulse(el.scatterBtn);
        e.preventDefault();
        break;
      default:
        break;
    }
  });

  // ---- State -> controls ----
  function syncShape() {
    for (const r of el.shapeRadios) r.checked = r.value === state.shape;
    el.shapeSeg.dataset.value = state.shape;
  }

  function syncFrequency() {
    const f = state.frequency;
    if (!(f > 0)) return;
    const txt = formatHz(f);
    setText(el.freqValue, txt);
    setText(el.hudFreq, `${txt} Hz`);
    setRange(el.freqSlider, freqToSlider(f));
    if (document.activeElement !== el.freqInput) el.freqInput.value = f.toFixed(1);
  }

  function syncSweep() {
    const { enabled, rate, dir } = state.sweep;
    el.sweepToggle.checked = enabled;
    setRange(el.sweepRate, rate);
    setText(el.sweepRateValue, `${rate.toFixed(2)} oct/s`);
    setText(el.sweepDir, enabled
      ? (dir > 0 ? '↗ Rising toward 5 kHz' : '↘ Falling toward 20 Hz')
      : 'Ping-pong between 20 Hz and 5 kHz');
    el.hudSweep.hidden = !enabled;
  }

  function syncAmplitude() {
    setRange(el.ampSlider, state.amplitude);
    setText(el.ampValue, `${Math.round(state.amplitude * 100)}%`);
  }

  function syncDamping() {
    const d = state.damping;
    setRange(el.dampSlider, dampToSlider(d));
    setText(el.dampValue, `ζ ${d < 0.01 ? d.toFixed(4) : d.toFixed(3)}`);
  }

  function syncCount() {
    setRange(el.countSlider, state.particleCount);
    setText(el.countValue, nf0.format(state.particleCount));
  }

  function syncLayers() {
    for (const input of el.layerInputs) input.checked = !!state.layers[input.dataset.layer];
  }

  function syncAudio() {
    el.soundToggle.checked = state.audio.enabled;
    setRange(el.volumeSlider, state.audio.volume);
    setText(el.volumeValue, `${Math.round(state.audio.volume * 100)}%`);
  }

  const syncers = {
    shape: syncShape,
    frequency: syncFrequency,
    sweep: syncSweep,
    amplitude: syncAmplitude,
    damping: syncDamping,
    particleCount: syncCount,
    layers: syncLayers,
    audio: syncAudio,
  };

  subscribe((_s, key) => {
    const fn = syncers[key];
    if (fn) fn();
  });
  for (const fn of Object.values(syncers)) fn();

  // ---- Field-derived readouts ----
  let lastRes = -1;
  function updateField(field, res) {
    const f = state.frequency;
    const nearest = res && res.nearest;
    if (nearest) {
      setText(el.nearestLabel, nearest.label);
      setText(el.nearestFreq, `${formatHz(nearest.freq)} Hz`);
      setText(el.hudMode, `${state.shape === 'circle' ? 'Circle' : 'Square'} · ${nearest.label}`);
      const detune = (f / nearest.freq - 1) * 100;
      const onMode = Math.abs(detune) < 0.05;
      setText(el.nearestDetune, onMode
        ? 'On resonance'
        : `${detune > 0 ? '+' : '−'}${Math.abs(detune).toFixed(Math.abs(detune) < 10 ? 2 : 1)}% from mode`);
      el.nearestDetune.classList.toggle('is-on', onMode);
    }

    const prev = res && res.prev;
    const next = res && res.next;
    el.resPrev.disabled = !prev;
    el.resNext.disabled = !next;
    setText(el.resPrevFreq, prev ? `${formatHz(prev.freq)} Hz` : 'none');
    setText(el.resNextFreq, next ? `${formatHz(next.freq)} Hz` : 'none');
    el.resPrev.title = prev ? `Previous resonance: ${prev.label} · ${formatHz(prev.freq)} Hz  ([ key)` : 'No lower resonance';
    el.resNext.title = next ? `Next resonance: ${next.label} · ${formatHz(next.freq)} Hz  (] key)` : 'No higher resonance';
    el.resPrev.setAttribute('aria-label', prev ? `Previous resonance: ${prev.label} at ${formatHz(prev.freq)} hertz` : 'No lower resonance');
    el.resNext.setAttribute('aria-label', next ? `Next resonance: ${next.label} at ${formatHz(next.freq)} hertz` : 'No higher resonance');

    const r = field ? Math.max(0, Math.min(1, field.resonance || 0)) : 0;
    const pct = Math.round(r * 100);
    if (pct !== lastRes) {
      lastRes = pct;
      el.resFill.style.width = `${(r * 100).toFixed(1)}%`;
      setText(el.resValue, `${pct}%`);
      el.resMeter.setAttribute('aria-valuenow', String(pct));
      const hot = r >= 0.8;
      el.resMeter.parentElement.classList.toggle('is-hot', hot);
      el.hudDot.classList.toggle('is-hot', hot);
    }
  }

  // ---- Toast ----
  let toastTimer = 0;
  function toast(msg, ms = 4000) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
  }

  return { updateField, toast };
}

function focusVisible(el) {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

function pulse(btn) {
  btn.classList.remove('is-pulsing');
  void btn.offsetWidth; // restart the animation
  btn.classList.add('is-pulsing');
}
