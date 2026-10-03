'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { PNG } = require('pngjs');
const c = require('../src/core.cjs');
const { composition } = require('../src/glitch-art3.cjs');
function envelope(n) { const e = Buffer.alloc(n, 73); Buffer.from('IPSSTUD1').copy(e); e[8] = 1; e[9] = 1; e.writeUInt32BE(n, 10); return e; }
function pixels(png) { const d = PNG.sync.read(png), rgb = Buffer.alloc(d.width * d.height * 3); for (let p = 0, q = 0; p < d.data.length; p += 4) { rgb[q++] = d.data[p]; rgb[q++] = d.data[p + 1]; rgb[q++] = d.data[p + 2]; } return { width: d.width, height: d.height, rgb }; }
function png(d) { return PNG.sync.write({ width: d.width, height: d.height, data: d.rgb }, { colorType: 2, inputColorType: 2, inputHasAlpha: false, bitDepth: 8 }); }
test('profile 3 default, canonical boundaries and independent nibble extraction', () => {
  for (const n of [96, 97, 98, 1179624, 1179625, 1204201]) {
    const e = envelope(n), p = c.envelopeToPng(e), d = pixels(p);
    assert.deepEqual([...d.rgb.subarray(8, 12)], [2, 3, 0, 0]);
    assert.equal(d.height, Math.max(768, 16 * Math.ceil((48 + 2 * n) / (3072 * 16))));
    const recovered = Buffer.alloc(n);
    for (let i = 0; i < n; i++) recovered[i] = ((d.rgb[48 + 2 * i] & 15) << 4) | (d.rgb[49 + 2 * i] & 15);
    assert.deepEqual(recovered, e); assert.deepEqual(c.pngToEnvelope(p), e);
    if (n === 96) assert.deepEqual(c.envelopeToPng(e), p);
  }
});
test('profile 3 rejects changed header, profile, payload, artwork, padding and dimensions', () => {
  const d = pixels(c.envelopeToPng(envelope(101)));
  for (const [index, mask] of [[8, 1], [9, 1], [9, 7], [10, 1], [11, 1], [15, 1], [16, 1], [48, 1], [48, 16], [250, 1], [d.rgb.length - 1, 1], [d.rgb.length - 2, 128]]) {
    const rgb = Buffer.from(d.rgb); rgb[index] ^= mask;
    assert.throws(() => c.pngToEnvelope(png({ ...d, rgb })), c.FormatError, `index ${index}`);
  }
  assert.throws(() => c.pngToEnvelope(png({ ...d, height: d.height + 16, rgb: Buffer.concat([d.rgb, Buffer.alloc(3072 * 16)]) })), c.FormatError);
});
test('profile 3 preserves legacy recovery and rewrapping cannot bypass authentication', async () => {
  const password = 'profile three disposable password', data = Buffer.from('exact synthetic payload');
  const e = await c.encryptBytes(data, password, 'sample.txt');
  for (const [appearance, profile] of [['plain', 1], ['glitch', 1], ['glitch', 2], ['glitch', 3]]) {
    const result = await c.decryptBytes(c.pngToEnvelope(c.envelopeToPng(e, appearance, profile)), password);
    assert.deepEqual(result.data, data); assert.equal(result.name, 'sample.txt');
  }
  const damaged = Buffer.from(e); damaged[damaged.length - 1] ^= 1;
  await assert.rejects(c.decryptBytes(c.pngToEnvelope(c.envelopeToPng(damaged)), password), c.FormatError);
  const second = await c.encryptBytes(data, password, 'sample.txt');
  assert.notDeepEqual(composition(crypto.createHash('sha256').update(e).digest(), 0), composition(crypto.createHash('sha256').update(second).digest(), 0));
});
test('profile 3 composition varies across digest words and panels within bounded geometry', () => {
  const plans = Array.from({ length: 64 }, (_, i) => composition(crypto.createHash('sha256').update(`fixture ${i}`).digest(), 0));
  assert.deepEqual([...new Set(plans.map(p => p.faults.length))].sort(), [2, 3, 4, 5]);
  assert.equal(new Set(plans.map(p => p.tile)).size, 2);
  assert.ok(plans.some(p => p.cut === 3072) && plans.some(p => p.cut < 2200));
  assert.ok(new Set(plans.map(p => p.smearY)).size > 12);
  assert.ok(new Set(plans.map(p => p.repeatX)).size > 12);
  assert.ok(new Set(plans.map(p => p.faults[0].shift)).size > 12);
  for (const p of plans) {
    assert.ok(p.smearY + p.smearHeight <= 768);
    assert.ok(p.repeatSource + p.repeatPeriod <= 1024);
    assert.ok(p.repeatX + p.repeatWidth <= 1024);
    assert.ok(p.faults.every((f, i) => f.at < p.cut && f.at >= 0 && (!i || f.at > p.faults[i - 1].at)));
    assert.ok(p.faults.every(f => Math.abs(f.cb) <= 19 && Math.abs(f.cr) <= 19));
  }
  const digest = Buffer.alloc(32), base = composition(digest, 0);
  for (let word = 0; word < 8; word++) { const other = Buffer.from(digest); other[word * 4] = 1; assert.notDeepEqual(composition(other, 0), base); }
  assert.notDeepEqual(composition(digest, 1), base);
});
test('profile 3 integer artwork golden vector', () => {
  assert.equal(crypto.createHash('sha256').update(PNG.sync.read(c.envelopeToPng(envelope(96))).data).digest('hex'), '289ce859e7fff2cc5c8cd4ecba2487643b9c6736596e7d7fd55ea6fdf0f5fa53');
});
