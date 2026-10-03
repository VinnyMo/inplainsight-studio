'use strict';
// Carrier v2/profile 3 wire-format constants. Freeze after shipping; revise via a new profile.
// Public deterministic artwork, not encryption. Payload stays in the low channel nibbles.
const WIDTH = 1024, PANEL = 768, HEADER = 48, BLOCKS = 3072;
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
function composition(digest, panelIndex) {
  // Use all digest words, with domain separation from the legacy generators.
  let state = mix(0x49505333 ^ panelIndex);
  for (let i = 0; i < 32; i += 4) state = mix(state ^ digest.readUInt32BE(i));
  const seed = state;
  const pick = n => { state = mix((state + 0x9e3779b9) >>> 0); return state % n; };
  const cut = pick(5) === 0 ? BLOCKS : (29 + pick(18)) * 64 + pick(64);
  const count = 2 + pick(4), faults = [];
  const spacing = Math.floor((cut - 192) / count);
  for (let i = 0; i < count; i++) faults.push({
    at: 96 + i * spacing + pick(Math.max(1, spacing - 64)),
    shift: (pick(2) ? 1 : -1) * (3 + pick(21)),
    cb: pick(39) - 19, cr: pick(39) - 19,
    burst: 3 + pick(13),
  });
  return { seed, cut, faults, gray: 104 + pick(41), tile: pick(2) === 0,
    smearY: (5 + pick(34)) * 16, smearHeight: (1 + pick(6)) * 16,
    repeatX: (3 + pick(45)) * 16, repeatWidth: (5 + pick(11)) * 16,
    repeatSource: pick(30) * 32, repeatPeriod: (1 + pick(3)) * 16,
    coarse: [112, 144, 176, 208][pick(4)], detail: [28, 36, 44][pick(3)],
    base: 24 + pick(15), contrast: 126 + pick(35) };
}
function panel(p) {
  const field = new Uint8Array(WIDTH * PANEL);
  for (let y = 0; y < PANEL; y++) for (let x = 0; x < WIDTH; x++) {
    field[y * WIDTH + x] = clamp(p.base + Math.floor(p.contrast * noise(x, y, p.coarse, p.seed ^ 2) / 255)
      + Math.floor(35 * noise(x, Math.floor(y * 17 / 10), p.detail, p.seed ^ 4) / 255)
      + Math.floor((sample(x >>> 5, y >>> 3, p.seed ^ 6) - 128) * 7 / 256));
  }
  return field;
}
function applyArtwork3(rgb, digest, length, verify = false) {
  const end = HEADER + 2 * length, height = rgb.length / (WIDTH * 3);
  for (let origin = 0; origin < height; origin += PANEL) {
    const p = composition(digest, origin / PANEL), field = panel(p);
    let stage = -1;
    for (let y = 0; y < Math.min(PANEL, height - origin); y++) for (let x = 0; x < WIDTH; x++) {
      const q = ((origin + y) * WIDTH + x) * 3;
      if (q < HEADER) continue;
      const m = (y >>> 4) * 64 + (x >>> 4);
      // Block indices repeat across the 16 scanlines of each block row.
      stage = -1;
      for (let i = 0; i < p.faults.length && m >= p.faults[i].at; i++) stage = i;
      const fault = stage < 0 ? null : p.faults[stage];
      const source = Math.max(0, Math.min(BLOCKS - 1, m + (fault ? fault.shift : 0)));
      let sx = (source % 64) * 16 + (x & 15), sy = Math.floor(source / 64) * 16 + (y & 15);
      if (p.tile && fault) {
        sx &= ~7; sy &= ~7;
        if (x >= p.repeatX && x < p.repeatX + p.repeatWidth) sx = p.repeatSource + (sx % p.repeatPeriod);
      }
      if (!p.tile && y >= p.smearY && y < p.smearY + p.smearHeight) sy = p.smearY;
      let Y = field[sy * WIDTH + sx], cb = fault ? fault.cb : 0, cr = fault ? fault.cr : 0;
      if (m >= p.cut) { Y = p.gray; cb = 0; cr = 0; }
      let red = clamp(Y + Math.floor(1402 * cr / 1000));
      let green = clamp(Y - Math.floor((344 * cb + 714 * cr) / 1000));
      let blue = clamp(Y + Math.floor(1772 * cb / 1000));
      if (fault && m < fault.at + fault.burst && m < p.cut) {
        const burst = mix(p.seed ^ Math.imul(x >>> 1, 12345) ^ Math.imul(y >>> 1, 456789));
        red = burst & 255; green = (burst >>> 8) & 255; blue = (burst >>> 16) & 255;
      }
      const grain = mix(p.seed ^ q), colors = [red, green, blue];
      for (let k = 0; k < 3; k++) {
        const expected = (colors[k] & 240) | (q + k >= end ? (grain >>> (k * 4)) & 15 : rgb[q + k] & 15);
        if (verify) { if (rgb[q + k] !== expected) return false; }
        else rgb[q + k] = expected;
      }
    }
  }
  return true;
}
module.exports = { applyArtwork3, composition };
