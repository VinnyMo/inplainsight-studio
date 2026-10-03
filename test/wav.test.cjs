'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const wav = require('../src/wav.cjs'), stream = require('../src/stream-envelope.cjs'), core = require('../src/core.cjs');
const PASS = 'synthetic WAV test password';
async function fixture(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ips-wav-test-'));
  try { await run(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
test('streaming envelope interoperates with existing PNG crypto in both directions', async () => fixture(async dir => {
  const source = path.join(dir, 'report.pdf'), env = path.join(dir, 'stream'), legacy = path.join(dir, 'legacy');
  const bytes = Buffer.from('Synthetic interoperation fixture'); await fs.writeFile(source, bytes);
  await stream.encrypt(source, env, PASS);
  const recovered = await core.decryptBytes(await fs.readFile(env), PASS);
  assert.deepEqual(recovered.data, bytes); assert.equal(recovered.name, 'report.pdf'); recovered.data.fill(0);
  await fs.writeFile(legacy, await core.encryptBytes(bytes, PASS, '../../report.pdf'));
  const chunks = []; const result = await stream.decrypt(legacy, PASS, { onChunk: async b => chunks.push(Buffer.from(b)) });
  assert.deepEqual(Buffer.concat(chunks), bytes); assert.equal(result.name, 'report.pdf');
}));
test('WAV round trips empty, chunk boundaries and 16 MiB maximum with valid PCM headers', { timeout: 60000 }, async () => fixture(async dir => {
  for (const size of [0, 1, 65535, 65536, 65537, wav.MAX_INPUT]) {
    const source = path.join(dir, 'original.dat'), audio = path.join(dir, 'carrier.wav'), out = path.join(dir, 'recovered');
    const bytes = Buffer.alloc(size); for (let i = 0; i < size; i++) bytes[i] = (i * 73 + (i >>> 8)) & 255;
    await fs.writeFile(source, bytes);
    const result = await wav.encodeFile(source, PASS, audio);
    assert.equal(result.verified, true); assert.equal((await fs.stat(audio)).size, result.wavBytes);
    const handle = await fs.open(audio, 'r'); const h = Buffer.alloc(44); await handle.read(h, 0, 44, 0); await handle.close();
    assert.equal(h.toString('ascii', 0, 4), 'RIFF'); assert.equal(h.readUInt16LE(20), 1); assert.equal(h.readUInt16LE(22), 1);
    assert.equal(h.readUInt32LE(24), 48000); assert.equal(h.readUInt16LE(34), 16); assert.equal(h.readUInt32LE(4) + 8, result.wavBytes);
    await wav.decodeFile(audio, PASS, async name => { assert.equal(name, 'original.dat'); return out; }, { tempRoot: dir });
    assert.deepEqual(await fs.readFile(out), bytes);
    await fs.unlink(audio); await fs.unlink(out);
    assert.deepEqual(await fs.readdir(dir), ['original.dat']);
  }
}));
test('wrong password, malformed RIFF, truncation, trailing bytes and canonical-sample corruption never reach Save', async () => fixture(async dir => {
  const source = path.join(dir, 'source'), audio = path.join(dir, 'audio.wav'), broken = path.join(dir, 'broken.wav');
  await fs.writeFile(source, Buffer.alloc(1024, 42)); await wav.encodeFile(source, PASS, audio);
  const bytes = await fs.readFile(audio); let saves = 0;
  const chooser = () => { saves++; return path.join(dir, 'bad-output'); };
  await assert.rejects(wav.decodeFile(audio, 'wrong-password', chooser, { tempRoot: dir }));
  const variants = [bytes.subarray(0, 43), bytes.subarray(0, -2), Buffer.concat([bytes, Buffer.from([0])])];
  for (const offset of [4, 16, 20, 22, 24, 28, 32, 34, 40]) { const copy = Buffer.from(bytes); copy[offset] ^= 1; variants.push(copy); }
  const badSample = Buffer.from(bytes); badSample[80] ^= 1; variants.push(badSample);
  const badCipher = Buffer.from(bytes); badCipher[bytes.length - 4] ^= 16; variants.push(badCipher);
  for (const data of variants) { await fs.writeFile(broken, data); await assert.rejects(wav.decodeFile(broken, PASS, chooser, { tempRoot: dir })); }
  assert.equal(saves, 0); assert.deepEqual((await fs.readdir(dir)).sort(), ['audio.wav', 'broken.wav', 'source']);
}));
test('limits fail without output and existing destinations/source are never replaced', async () => fixture(async dir => {
  const source = path.join(dir, 'source'), audio = path.join(dir, 'audio.wav');
  await fs.writeFile(source, 'source bytes'); await wav.encodeFile(source, PASS, audio);
  const original = await fs.readFile(audio);
  await assert.rejects(wav.encodeFile(source, PASS, audio), { code: 'EEXIST' });
  await assert.rejects(wav.decodeFile(audio, PASS, source, { tempRoot: dir }), { code: 'EEXIST' });
  assert.equal(await fs.readFile(source, 'utf8'), 'source bytes'); assert.deepEqual(await fs.readFile(audio), original);
  await fs.truncate(source, wav.MAX_INPUT + 1);
  await assert.rejects(wav.encodeFile(source, PASS, path.join(dir, 'too-big.wav')), /16 MiB/);
  assert.deepEqual((await fs.readdir(dir)).sort(), ['audio.wav', 'source']);
}));
test('cancel export at each streaming phase, cancel recovery/chooser/second pass and retry cleanly', async () => fixture(async dir => {
  const source = path.join(dir, 'source'), audio = path.join(dir, 'audio.wav'), out = path.join(dir, 'output');
  await fs.writeFile(source, Buffer.alloc(131073, 123));
  for (const phase of ['encrypting', 'writing-audio', 'reading-audio', 'authenticating']) {
    const signal = { aborted: false };
    await assert.rejects(wav.encodeFile(source, PASS, audio, { signal, progress: p => { if (p.phase === phase) signal.aborted = true; } }), { code: 'ABORT_ERR' });
    assert.deepEqual(await fs.readdir(dir), ['source']);
  }
  await wav.encodeFile(source, PASS, audio);
  assert.equal((await wav.decodeFile(audio, PASS, () => null, { tempRoot: dir })).canceled, true);
  for (const phase of ['reading-audio', 'authenticating']) {
    const signal = { aborted: false };
    await assert.rejects(wav.decodeFile(audio, PASS, out, { tempRoot: dir, signal, progress: p => { if (p.phase === phase) signal.aborted = true; } }), { code: 'ABORT_ERR' });
  }
  const signal = { aborted: false }; let secondPass = false;
  await assert.rejects(wav.decodeFile(audio, PASS, () => { secondPass = true; return out; }, {
    tempRoot: dir, signal, progress: p => { if (secondPass && p.phase === 'authenticating') signal.aborted = true; },
  }), { code: 'ABORT_ERR' });
  assert.deepEqual((await fs.readdir(dir)).sort(), ['audio.wav', 'source']);
  await wav.decodeFile(audio, PASS, out, { tempRoot: dir }); assert.deepEqual(await fs.readFile(out), await fs.readFile(source));
}));
test('publication failure and chooser failure clean owned staging directories', async () => fixture(async dir => {
  const source = path.join(dir, 'source'), audio = path.join(dir, 'audio.wav'); await fs.writeFile(source, 'fixture');
  await wav.encodeFile(source, PASS, audio);
  await assert.rejects(wav.decodeFile(audio, PASS, () => { throw new Error('dialog failed'); }, { tempRoot: dir }), /dialog failed/);
  const link = fs.link; fs.link = async () => { throw Object.assign(new Error('simulated disk failure'), { code: 'ENOSPC' }); };
  try {
    await assert.rejects(wav.encodeFile(source, PASS, path.join(dir, 'fail.wav')), { code: 'ENOSPC' });
    await assert.rejects(wav.decodeFile(audio, PASS, path.join(dir, 'fail.out'), { tempRoot: dir }), { code: 'ENOSPC' });
  } finally { fs.link = link; }
  assert.deepEqual((await fs.readdir(dir)).sort(), ['audio.wav', 'source']);
}));

test('authenticated MESSAGE tag cannot substitute for mandatory FINAL tag', async () => fixture(async dir => {
  const sodium = require('libsodium-wrappers-sumo'); await sodium.ready;
  const salt = Buffer.alloc(16, 8), key = sodium.crypto_pwhash(32, Buffer.from(PASS), salt, 3, 64 * 1024 * 1024, sodium.crypto_pwhash_ALG_ARGON2ID13);
  const writer = sodium.crypto_secretstream_xchacha20poly1305_init_push(key), meta = Buffer.from(JSON.stringify({ name: 'empty', size: 0 }));
  const number = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const header = Buffer.concat([Buffer.from('IPSSTUD1'), Buffer.from([1, 1]), number(54 + 21 + meta.length + 21), salt, Buffer.from(writer.header)]), parts = [header];
  try {
    for (const [i, plain] of [meta, Buffer.alloc(0)].entries()) { const length = plain.length + 17; parts.push(number(length), Buffer.from(sodium.crypto_secretstream_xchacha20poly1305_push(writer.state, plain, Buffer.concat([header, number(i), number(length)]), sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE))); }
    const file = path.join(dir, 'missing-final.bin'); await fs.writeFile(file, Buffer.concat(parts)); await assert.rejects(require('../src/stream-envelope.cjs').decrypt(file, PASS));
  } finally { const w = sodium.libsodium; w.HEAPU8.fill(0, writer.state, writer.state + w._crypto_secretstream_xchacha20poly1305_statebytes()); w._free(writer.state); sodium.memzero(key); }
}));
