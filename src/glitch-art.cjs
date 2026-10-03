'use strict';
// Carrier v2/profile 2 wire-format constants. Never edit without a new profile.
// All artwork is public, integer-only and independent of plaintext.
const WIDTH = 1024, PANEL = 768, HEADER = 48;
function mix(v) {
  v = Math.imul(v ^ (v >>> 16), 0x7feb352d);
  v = Math.imul(v ^ (v >>> 15), 0x846ca68b);
  return (v ^ (v >>> 16)) >>> 0;
}
function sample(x, y, seed) { return mix(Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed) & 255; }
function noise(x, y, scale, seed) {
  const a = Math.floor(x / scale), b = Math.floor(y / scale);
  let u = Math.floor((x - a * scale) * 256 / scale), v = Math.floor((y - b * scale) * 256 / scale);
  u = Math.floor(u * u * (768 - 2 * u) / 65536);
  v = Math.floor(v * v * (768 - 2 * v) / 65536);
  const top = sample(a, b, seed) * (256 - u) + sample(a + 1, b, seed) * u;
  const bottom = sample(a, b + 1, seed) * (256 - u) + sample(a + 1, b + 1, seed) * u;
  return Math.floor((top * (256 - v) + bottom * v) / 65536);
}
const clamp = v => Math.max(0, Math.min(255, v));
function panel(seed) {
  const field = new Uint8Array(WIDTH * PANEL);
  for (let y = 0; y < PANEL; y++) for (let x = 0; x < WIDTH; x++) {
    field[y * WIDTH + x] = clamp(28 + Math.floor(150 * noise(x, y, 160, seed ^ 2) / 255)
      + Math.floor(35 * noise(x, Math.floor(y * 17 / 10), 36, seed ^ 4) / 255)
      + Math.floor((sample(x >>> 5, y >>> 3, seed ^ 6) - 128) * 7 / 256));
  }
  return field;
}
function applyArtwork2(rgb, digest, length, verify = false) {
  const seed = digest.readUInt32BE(0), end = HEADER + 2 * length;
  const height = rgb.length / (WIDTH * 3);
  for (let origin = 0; origin < height; origin += PANEL) {
    const s = mix(seed ^ Math.imul(origin / PANEL + 1, 0x9e3779b1)), field = panel(s);
    const f1 = (11 + (s % 3)) * 64 + 12 + ((s >>> 4) % 28);
    const f2 = (15 + ((s >>> 9) % 3)) * 64 + 37 + ((s >>> 12) % 24);
    const f3 = (35 + ((s >>> 17) % 3)) * 64 + 23 + ((s >>> 20) % 26);
    const cut = 43 * 64 + 20 + ((s >>> 24) % 24);
    const tile = (s & 1) !== 0, direction = (s & 2) ? 1 : -1;
    for (let y = 0; y < Math.min(PANEL, height - origin); y++) for (let x = 0; x < WIDTH; x++) {
      const q = ((origin + y) * WIDTH + x) * 3;
      if (q < HEADER) continue;
      const m = (y >>> 4) * 64 + (x >>> 4);
      const shift = m < f1 ? 0 : m < f2 ? 11 : m < f3 ? -7 : 5;
      const source = Math.max(0, Math.min(3071, m + shift));
      let sx = (source % 64) * 16 + (x & 15), sy = Math.floor(source / 64) * 16 + (y & 15);
      if (tile && m >= f2) {
        sx &= ~7; sy &= ~7;
        if ((m % 64) > 38 && (m % 64) < 53) sx = (sx % 32) + 600;
      }
      if (!tile && y >= 384 && y < 432) sy = 384;
      let Y = field[sy * WIDTH + sx];
      let cb = direction * (m < f1 ? 0 : m < f2 ? 18 : m < f3 ? 4 : -15);
      let cr = direction * (m < f1 ? 0 : m < f2 ? -11 : m < f3 ? 11 : 17);
      if (m >= cut) { Y = 122; cb = 0; cr = 0; }
      let red = clamp(Y + Math.floor(1402 * cr / 1000));
      let green = clamp(Y - Math.floor((344 * cb + 714 * cr) / 1000));
      let blue = clamp(Y + Math.floor(1772 * cb / 1000));
      if ([f1, f2, f3].some(f => m >= f && m < f + 11)) {
        const burst = mix(s ^ Math.imul(x >>> 1, 12345) ^ Math.imul(y >>> 1, 456789));
        red = burst & 255; green = (burst >>> 8) & 255; blue = (burst >>> 16) & 255;
      }
      const color = [red, green, blue];
      // Tail grain is canonical public padding, never additional encrypted data.
      const grain = mix(s ^ q);
      for (let k = 0; k < 3; k++) {
        const high = color[k] & 240;
        const expected = high | (q + k >= end ? (grain >>> (k * 4)) & 15 : rgb[q + k] & 15);
        if (verify) { if (rgb[q + k] !== expected) return false; }
        else rgb[q + k] = expected;
      }
    }
  }
  return true;
}
module.exports = { applyArtwork2 };
