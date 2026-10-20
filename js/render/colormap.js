// "Inferno"-like colormap shared by the 2D heatmap and the 3D plate vertex colors.

const STOPS = ['#000004', '#320a5e', '#781c6d', '#bc3754', '#ed6925', '#fbb61a', '#fcffa4'];

const STOP_RGB = STOPS.map((hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]);

/**
 * Evaluate the colormap with linear interpolation between stops.
 * @param {number} t value in [0, 1] (clamped)
 * @returns {number[]} [r, g, b], each 0..255
 */
export function colorAt(t) {
  if (!(t > 0)) t = 0;
  else if (t > 1) t = 1;
  const last = STOP_RGB.length - 1;
  const p = t * last;
  const i = Math.min(Math.floor(p), last - 1);
  const f = p - i;
  const a = STOP_RGB[i];
  const b = STOP_RGB[i + 1];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

/** 256-entry lookup table, packed r,g,b per entry: index = round(t * 255). */
export const LUT = new Uint8ClampedArray(256 * 3);
for (let i = 0; i < 256; i++) {
  const c = colorAt(i / 255);
  LUT[i * 3] = c[0];
  LUT[i * 3 + 1] = c[1];
  LUT[i * 3 + 2] = c[2];
}
