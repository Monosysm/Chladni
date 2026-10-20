// Simple sine-tone engine. The AudioContext is created lazily on first enable
// (browsers require a user gesture).

const GAIN_CAP = 0.3; // ear-safety cap: volume 1 -> gain 0.3

export class AudioEngine {
  constructor() {
    this._enabled = false;
    this._freq = 440;
    this._volume = 0.25;
    this._ctx = null;
    this._osc = null;
    this._gain = null;
  }

  get enabled() {
    return this._enabled;
  }

  /** Enable/disable sound. Disabling ramps the gain to 0 but keeps the nodes alive. */
  async setEnabled(on) {
    on = !!on;
    if (on) {
      if (!this._ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this._ctx = new Ctx();
        this._osc = this._ctx.createOscillator();
        this._osc.type = 'sine';
        this._osc.frequency.value = this._freq;
        this._gain = this._ctx.createGain();
        this._gain.gain.value = 0;
        this._osc.connect(this._gain);
        this._gain.connect(this._ctx.destination);
        this._osc.start();
      }
      this._enabled = true;
      try {
        await this._ctx.resume();
      } catch (e) { /* ignore: resume can reject without a user gesture */ }
      this._applyGain(0.05);
    } else {
      this._enabled = false;
      this._applyGain(0.05);
    }
  }

  /** @param {number} f frequency in Hz */
  setFrequency(f) {
    if (!(f > 0)) return;
    this._freq = f;
    if (this._osc) {
      this._osc.frequency.setTargetAtTime(f, this._ctx.currentTime, 0.02);
    }
  }

  /** @param {number} v volume 0..1 */
  setVolume(v) {
    this._volume = Math.min(1, Math.max(0, +v || 0));
    this._applyGain(0.05);
  }

  _applyGain(tc) {
    if (!this._gain) return;
    const target = this._enabled ? this._volume * GAIN_CAP : 0;
    this._gain.gain.setTargetAtTime(target, this._ctx.currentTime, tc);
  }
}
