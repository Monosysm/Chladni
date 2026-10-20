// Central app state + a tiny pub/sub. Every change goes through set(), which
// notifies subscribers with the name of the top-level key that changed.

/** Mutable application state. Treat nested objects as immutable: replace them via set(). */
export const state = {
  shape: 'square',
  frequency: 0, // set on load (nearest square mode to 900 Hz)
  damping: 0.003,
  amplitude: 0.6,
  particleCount: 15000,
  layers: { sand: true, heatmap: false, nodal: false, plate3d: false },
  audio: { enabled: false, volume: 0.25 },
  sweep: { enabled: false, rate: 0.15 /* octaves/s */, dir: 1 },
};

const listeners = new Set();

/**
 * Set a top-level state key and notify subscribers.
 * @param {keyof typeof state} key
 * @param {*} value
 */
export function set(key, value) {
  if (!(key in state)) throw new Error(`Unknown state key: ${key}`);
  if (state[key] === value) return;
  state[key] = value;
  for (const fn of listeners) fn(state, key);
}

/**
 * Subscribe to state changes.
 * @param {(state: typeof state, key: string) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
