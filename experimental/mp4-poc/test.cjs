'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const s = require('./symbols.cjs'), c = require('./crypto-stream.cjs'), p = require('./pipeline.cjs');
const PASS = 'disposable-mp4-test-password';
const root = path.join(__dirname, 'test-work');
async function temporary(fn) { await fs.mkdir(root, { recursive: true }); const dir = await fs.mkdtemp(path.join(root, 'case-')); try { await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); } }
test('SECDED all nibbles: clean, every single-bit correction and every double-bit rejection', () => {
  for (let nibble = 0; nibble < 16; nibble++) {
    const word = s.encodeNibble(nibble); assert.equal(s.decodeWord(word).nibble, nibble);
    for (let a = 0; a < 8; a++) { assert.deepEqual(s.decodeWord(word ^ (1 << a)), { nibble, corrected: 1 }); for (let b = a + 1; b < 8; b++) assert.throws(() => s.decodeWord(word ^ (1 << a) ^ (1 << b)), /Uncorrectable/); }
  }
  // Independent hand-calculated Hamming(8,4) vectors, parity positions 1,2,4,8.
  assert.equal(s.encodeNibble(0), 0); assert.equal(s.encodeNibble(8), 0x87); assert.equal(s.encodeNibble(15), 0xff);
});
test('visible pixels recover packet; one cell bit corrected, two bits detected', () => {
  const data = Buffer.alloc(96, 39), packet = s.makePacket(data, 0, 96, crypto.createHash('sha256').update(data).digest().subarray(0, 16)), frame = s.raster(packet);
  assert.deepEqual(s.unraster(frame).data, data);
  const corrupt = Buffer.from(frame), slot = 0; const x = 2 + slot % 156, y = 2 + Math.floor(slot / 156); const old = frame[(y * 8 + 3) * s.WIDTH + x * 8 + 3];
  s.paintCell(corrupt, slot, old < 128 ? 235 : 16); assert.equal(s.unraster(corrupt).corrections, 1); assert.deepEqual(s.unraster(corrupt).packet, packet);
  const slot2 = s.WORDS, x2 = 2 + slot2 % 156, y2 = 2 + Math.floor(slot2 / 156), old2 = frame[(y2 * 8 + 3) * s.WIDTH + x2 * 8 + 3];
  s.paintCell(corrupt, slot2, old2 < 128 ? 235 : 16); assert.throws(() => s.unraster(corrupt), /Uncorrectable/);
});
test('repeated-frame erasures recover two damaged copies; all damaged, dropped and extra frames fail', async () => {
  const data = Buffer.alloc(96, 5), id = crypto.createHash('sha256').update(data).digest().subarray(0, 16), frame = s.raster(s.makePacket(data, 0, 96, id));
  const damaged = Buffer.alloc(s.WIDTH * s.HEIGHT, 120), output = []; const good = p.collector(async b => output.push(Buffer.from(b)));
  await good.frame(damaged); await good.frame(frame); await good.frame(damaged); assert.equal(good.finish().invalidFrames, 2); assert.deepEqual(Buffer.concat(output), data);
  const bad = p.collector(async () => {}); await bad.frame(damaged); await bad.frame(damaged); await assert.rejects(bad.frame(damaged), /All copies/);
  const dropped = p.collector(async () => {}); await dropped.frame(frame); await dropped.frame(frame); assert.throws(() => dropped.finish(), /Truncated/);
  const extra = p.collector(async () => {}); for (let i = 0; i < 3; i++) await extra.frame(frame); await extra.frame(frame); assert.throws(() => extra.finish(), /Truncated/);
});
test('stream crypto boundaries, existing-envelope compatibility, wrong password, truncation and trailing bytes', async () => temporary(async dir => {
  const core = require('../../src/core.cjs');
  for (const size of [0, 1, 4097, 65535, 65536]) {
    const input = path.join(dir, `input-${size}`), encrypted = path.join(dir, `encrypted-${size}`), bytes = crypto.randomBytes(size); await fs.writeFile(input, bytes);
    const result = await c.encrypt(input, encrypted, PASS), recovered = await c.decrypt(encrypted, PASS);
    assert.equal(result.sha256, recovered.sha256); assert.equal(recovered.bytes, size);
    if (size === 4097) assert.deepEqual((await core.decryptBytes(await fs.readFile(encrypted), PASS)).data, bytes);
  }
  const encrypted = path.join(dir, 'encrypted-4097'), bytes = await fs.readFile(encrypted);
  await assert.rejects(c.decrypt(encrypted, 'wrong-but-long-password'));
  const truncated = path.join(dir, 'truncated'); await fs.writeFile(truncated, bytes.subarray(0, -1)); await assert.rejects(c.decrypt(truncated, PASS));
  const trailing = path.join(dir, 'trailing'); await fs.writeFile(trailing, Buffer.concat([bytes, Buffer.from([0])])); await assert.rejects(c.decrypt(trailing, PASS));
  const damaged = path.join(dir, 'damaged'); bytes[bytes.length - 1] ^= 1; await fs.writeFile(damaged, bytes); await assert.rejects(c.decrypt(damaged, PASS));
  const tooLarge = path.join(dir, 'too-large'); await fs.writeFile(tooLarge, Buffer.alloc(65537)); await assert.rejects(c.encrypt(tooLarge, path.join(dir, 'must-not-exist'), PASS), /64 KiB/);
}));
test('authenticated MESSAGE tag cannot substitute for mandatory FINAL tag', async () => temporary(async dir => {
  const sodium = require('libsodium-wrappers-sumo'); await sodium.ready;
  const salt = Buffer.alloc(16, 8), key = sodium.crypto_pwhash(32, Buffer.from(PASS), salt, 3, 64 * 1024 * 1024, sodium.crypto_pwhash_ALG_ARGON2ID13);
  const stream = sodium.crypto_secretstream_xchacha20poly1305_init_push(key), meta = Buffer.from(JSON.stringify({ name: 'empty', size: 0 }));
  const number = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const header = Buffer.concat([Buffer.from('IPSSTUD1'), Buffer.from([1, 1]), number(54 + 21 + meta.length + 21), salt, Buffer.from(stream.header)]), parts = [header];
  try {
    for (const [i, plain] of [meta, Buffer.alloc(0)].entries()) { const length = plain.length + 17; parts.push(number(length), Buffer.from(sodium.crypto_secretstream_xchacha20poly1305_push(stream.state, plain, Buffer.concat([header, number(i), number(length)]), sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE))); }
    const file = path.join(dir, 'missing-final.bin'); await fs.writeFile(file, Buffer.concat(parts)); await assert.rejects(c.decrypt(file, PASS));
  } finally { const w = sodium.libsodium; w.HEAPU8.fill(0, stream.state, stream.state + w._crypto_secretstream_xchacha20poly1305_statebytes()); w._free(stream.state); sodium.memzero(key); }
}));
test('real lossy MP4 export verifies and recovers small fixture; failures publish nothing and clean staging', { timeout: 90000 }, async () => temporary(async dir => {
  const input = path.join(dir, 'source.bin'), video = path.join(dir, 'carrier.mp4'), out = path.join(dir, 'recovered.bin'), bytes = crypto.randomBytes(4097); await fs.writeFile(input, bytes);
  const result = await p.encode(input, video, PASS); assert.equal(result.verified.sha256, crypto.createHash('sha256').update(bytes).digest('hex')); assert.equal(result.decoded.codec, 'h264');
  await p.decode(video, out, PASS); assert.deepEqual(await fs.readFile(out), bytes);
  const wrong = path.join(dir, 'wrong.bin'); await assert.rejects(p.decode(video, wrong, 'wrong-but-long-password')); await assert.rejects(fs.stat(wrong), { code: 'ENOENT' });
  await assert.rejects(p.decode(video, out, PASS), { code: 'EEXIST' }); assert.deepEqual(await fs.readFile(out), bytes);
  const decodeAbort = new AbortController(), abortedOut = path.join(dir, 'aborted-recovery.bin');
  await assert.rejects(p.decode(video, abortedOut, PASS, { signal: decodeAbort.signal, progress: event => { if (event.phase === 'decoding') decodeAbort.abort(); } })); await assert.rejects(fs.stat(abortedOut), { code: 'ENOENT' });
  const truncatedVideo = path.join(dir, 'truncated.mp4'), videoBytes = await fs.readFile(video); await fs.writeFile(truncatedVideo, videoBytes.subarray(0, Math.floor(videoBytes.length / 2)));
  const badOut = path.join(dir, 'bad-video.bin'); await assert.rejects(p.decode(truncatedVideo, badOut, PASS)); await assert.rejects(fs.stat(badOut), { code: 'ENOENT' });
  const cancel = new AbortController(), canceled = path.join(dir, 'canceled.mp4');
  await assert.rejects(p.encode(input, canceled, PASS, { signal: cancel.signal, progress: event => { if (event.phase === 'encoding') cancel.abort(); } })); await assert.rejects(fs.stat(canceled), { code: 'ENOENT' });
  const limited = path.join(dir, 'limited.mp4'); await assert.rejects(p.encode(input, limited, PASS, { maxVideoBytes: 1 })); await assert.rejects(fs.stat(limited), { code: 'ENOENT' });
  const realLink = fs.link, blocked = path.join(dir, 'blocked.mp4');
  fs.link = async () => { throw Object.assign(new Error('Injected publication failure'), { code: 'EACCES' }); };
  try { await assert.rejects(p.encode(input, blocked, PASS), /Injected publication failure/); } finally { fs.link = realLink; }
  await assert.rejects(fs.stat(blocked), { code: 'ENOENT' });
  assert.ok((await fs.readdir(dir)).every(name => !name.startsWith('.ips-mp4-')));
}));
