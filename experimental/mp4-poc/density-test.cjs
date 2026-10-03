'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs/promises'), path = require('node:path');
const s = require('./symbols-dense.cjs'), pipeline = require('./pipeline.cjs');
test('dense profile 2 header, cell correction and bounded packet recovery', async () => {
  const data = Buffer.alloc(3008, 171), id = crypto.createHash('sha256').update(data).digest().subarray(0, 16), packet = s.makePacket(data, 0, data.length, id), frame = s.raster(packet);
  assert.equal(packet[8], 2); assert.equal(s.CELL, 4); assert.equal(s.PACKET, 3072); assert.deepEqual(s.unraster(frame).packet, packet);
  const old = frame[(2 * 4 + 1) * s.WIDTH + 2 * 4 + 1]; s.paintCell(frame, 0, old < 128 ? 235 : 16);
  const decoded = s.unraster(frame); assert.equal(decoded.corrections, 1); assert.deepEqual(decoded.data, data);
  const chunks = [], collector = pipeline.collector(async b => chunks.push(Buffer.from(b))); for (let i = 0; i < 3; i++) await collector.frame(frame);
  assert.equal(collector.finish().profile, 2); assert.deepEqual(Buffer.concat(chunks), data);
  assert.throws(() => s.parsePacket(Buffer.alloc(3072)), /Invalid/);
});
test('invalid settings, oversized hash input and operation deadline fail without publishing', async () => {
  const root = path.join(__dirname, 'test-work'); await fs.mkdir(root, { recursive: true }); const dir = await fs.mkdtemp(path.join(root, 'density-'));
  try {
    const input = path.join(dir, 'input'), output = path.join(dir, 'never.mp4'); await fs.writeFile(input, Buffer.alloc(1024));
    for (const options of [{ carrierProfile: 3 }, { crf: '24;exit' }, { gop: 100000 }, { maxVideoBytes: -1 }, { maxJobMs: 30001 }]) await assert.rejects(pipeline.encode(input, output, 'disposable-density-password', options));
    await assert.rejects(pipeline.hashFile(input, 16), /bound/);
    await assert.rejects(pipeline.encode(input, output, 'disposable-density-password', { maxJobMs: 1 }), /Canceled/);
    await assert.rejects(fs.stat(output), { code: 'ENOENT' }); assert.deepEqual(await fs.readdir(dir), ['input']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
